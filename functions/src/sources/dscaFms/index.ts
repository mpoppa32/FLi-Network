// DSCA FMS source — orchestrator
//
// Phase 8.6.2: weekly scrape of dsca.mil major-arms-sales page → FMS
// notification Signals + foreign_government Organizations.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, type DscaFmsConfig } from "./config";
import { fetchMajorArmsSalesListing } from "./client";
import { parseListingPage } from "./parser";
import { upsertFmsSignal } from "./mapper";

export const SOURCE_NAME = "dsca_fms";
export const SOURCE_VERSION = "1.0.0";

export { parseListingPage, parseNotificationBlock, CONFIDENCE_FLOOR } from "./parser";
export { upsertFmsSignal } from "./mapper";

export interface DscaFmsSyncOptions {
  dryRun?: boolean;
  confidenceFloor?: number;
}

export interface DscaFmsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  enabled: boolean;
  pagesFetched: number;
  notificationsParsed: number;
  notificationsValid: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  signalsSkipped: number;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
}

export async function syncWorkspace(
  workspaceId: string,
  options: DscaFmsSyncOptions = {},
  log?: Logger
): Promise<DscaFmsSyncResult> {
  const startedAt = Date.now();
  log?.info("dsca_fms_sync_started", { workspaceId, options });

  const result: DscaFmsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    enabled: false,
    pagesFetched: 0,
    notificationsParsed: 0,
    notificationsValid: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    signalsSkipped: 0,
    errors: [],
    apiCallsCount: 0,
  };

  try {
    const config: DscaFmsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      log?.info("dsca_fms_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }
    result.enabled = config.enabled;
    if (!config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      await recordSyncSuccess(
        workspaceId,
        SOURCE_NAME,
        { recordsUpserted: 0, recordsSkipped: 0, durationMs: result.durationMs, apiCalls: 0 },
        log
      );
      return result;
    }

    const page = await fetchMajorArmsSalesListing(log);
    result.pagesFetched = 1;
    result.apiCallsCount = 1;
    const notifications = parseListingPage(page.html);
    result.notificationsParsed = notifications.length;

    const floor = options.confidenceFloor ?? config.confidenceFloor;
    for (const notification of notifications) {
      if (notification.dollarValue < config.minDollar) {
        result.signalsSkipped++;
        continue;
      }
      if (notification.confidence < floor) {
        result.signalsSkipped++;
        continue;
      }
      result.notificationsValid++;
      if (options.dryRun) continue;

      try {
        const r = await upsertFmsSignal(workspaceId, notification, log, {
          confidenceFloor: floor,
          countryFilter: config.countries,
          primeFilter: config.primes,
        });
        if (r.action === "created") result.signalsCreated++;
        else if (r.action === "updated") result.signalsUpdated++;
        else if (r.action === "unchanged") result.signalsUnchanged++;
        else result.signalsSkipped++;
      } catch (err) {
        const e = err as Error;
        result.errors.push({
          ref: notification.transmittalNumber || notification.country,
          message: e.message ?? String(err),
        });
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted: result.signalsCreated + result.signalsUpdated,
        recordsSkipped: result.signalsUnchanged + result.signalsSkipped,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("dsca_fms_sync_completed", {
      workspaceId,
      durationMs: result.durationMs,
      notificationsParsed: result.notificationsParsed,
      notificationsValid: result.notificationsValid,
      signalsCreated: result.signalsCreated,
      signalsSkipped: result.signalsSkipped,
      errors: result.errors.length,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ ref: "_sync_root", message: e.message ?? String(err) });
    await recordSyncError(
      workspaceId,
      SOURCE_NAME,
      {
        occurredAt: Date.now(),
        category: categorized.category,
        message: categorized.message,
        retriable: categorized.retriable,
      },
      log
    );
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
