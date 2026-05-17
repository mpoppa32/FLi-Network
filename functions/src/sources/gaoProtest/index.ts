// GAO Bid Protest source — orchestrator
//
// Per signal-sources-v1 Part One. V1 scope: RSS feed → Signal entities.
// Decision PDF extraction is a v1.1 enhancement.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { fetchRssFeed, isBidProtest } from "./client";
import { mapRssItemToSignal, upsertSignal } from "./mapper";
import { loadConfig, validateConfig, type GaoProtestConfig } from "./config";

export const SOURCE_NAME = "gao_protest";
export const SOURCE_VERSION = "0.1.0";

export interface GaoProtestSyncOptions {
  /** Max items to process. Default 100. */
  maxItems?: number;
  /** Dry run (fetch + map, no writes). Default false. */
  dryRun?: boolean;
}

export interface GaoProtestSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  recordsFetched: number;
  protestsIdentified: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  errors: Array<{ recordId: string; message: string }>;
  durationMs: number;
  apiCallsCount: number;
}

export async function syncWorkspace(
  workspaceId: string,
  options: GaoProtestSyncOptions = {},
  log?: Logger
): Promise<GaoProtestSyncResult> {
  const startedAt = Date.now();
  log?.info("gao_protest_sync_started", { workspaceId, options });

  const result: GaoProtestSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    recordsFetched: 0,
    protestsIdentified: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    errors: [],
    durationMs: 0,
    apiCallsCount: 0,
  };

  try {
    const config: GaoProtestConfig = await loadConfig(workspaceId, log);
    const v = validateConfig(config);
    if (!v.valid) throw new Error(`Invalid config: ${v.errors.join(", ")}`);
    if (config.disabled) {
      log?.info("gao_protest_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const items = await fetchRssFeed(log);
    result.recordsFetched = items.length;
    result.apiCallsCount = 1;

    const maxItems = options.maxItems ?? 100;
    let processed = 0;
    for (const item of items) {
      if (processed >= maxItems) break;
      if (!isBidProtest(item)) continue;
      result.protestsIdentified++;
      try {
        const signal = await mapRssItemToSignal(workspaceId, item);
        if (!signal) continue;
        if (options.dryRun) {
          processed++;
          continue;
        }
        const r = await upsertSignal(workspaceId, signal);
        if (r.action === "created") result.signalsCreated++;
        else if (r.action === "updated") result.signalsUpdated++;
        else result.signalsUnchanged++;
        processed++;
      } catch (err) {
        const e = err as Error;
        result.errors.push({
          recordId: item.guid || item.link || "<unknown>",
          message: e.message ?? String(err),
        });
        log?.warn("gao_protest_item_failed", { guid: item.guid, message: e.message });
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted: result.signalsCreated + result.signalsUpdated,
        recordsSkipped: result.signalsUnchanged,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("gao_protest_sync_completed", {
      workspaceId,
      protestsIdentified: result.protestsIdentified,
      signalsCreated: result.signalsCreated,
      signalsUpdated: result.signalsUpdated,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ recordId: "_sync_root", message: e.message ?? String(err) });
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
    log?.error("gao_protest_sync_failed", { workspaceId, message: e.message });
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
