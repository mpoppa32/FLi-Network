// DoD News source — SourceClient implementation
//
// Phase 8.5.4 v1.2: completes the multi-source reconciliation arc started
// by USAspending v1.0. Daily scrape of defense.gov/News/Contracts/, parse
// into announcements, reconcile against per-workspace Awards.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, type DodNewsConfig } from "./config";
import { fetchContractsListing } from "./client";
import { parsePage } from "./parser";
import { reconcileAnnouncement } from "./mapper";

export const SOURCE_NAME = "dod_news";
export const SOURCE_VERSION = "1.0.0";

export { fetchContractsListing } from "./client";
export { parsePage, parseParagraph, CONFIDENCE_FLOOR } from "./parser";
export { reconcileAnnouncement } from "./mapper";

export interface DodNewsSyncOptions {
  /** Dry run: fetch + parse but don't reconcile. Useful for spec validation. */
  dryRun?: boolean;
  /** Override the confidence floor for this run. */
  confidenceFloor?: number;
}

export interface DodNewsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  enabled: boolean;
  pagesFetched: number;
  paragraphsParsed: number;
  announcementsValid: number;
  provisionalCreated: number;
  observationsAppended: number;
  skippedBelowConfidence: number;
  skippedExisting: number;
  errors: Array<{ piid: string; message: string }>;
  apiCallsCount: number;
}

/**
 * Sync the most recent DoD News Contracts listings into one workspace.
 * Idempotent: existing Awards get observation appends, not duplicates.
 */
export async function syncWorkspace(
  workspaceId: string,
  options: DodNewsSyncOptions = {},
  log?: Logger
): Promise<DodNewsSyncResult> {
  const startedAt = Date.now();
  log?.info("dod_news_sync_started", { workspaceId, options });

  const result: DodNewsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    enabled: false,
    pagesFetched: 0,
    paragraphsParsed: 0,
    announcementsValid: 0,
    provisionalCreated: 0,
    observationsAppended: 0,
    skippedBelowConfidence: 0,
    skippedExisting: 0,
    errors: [],
    apiCallsCount: 0,
  };

  try {
    const config: DodNewsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      log?.info("dod_news_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }
    result.enabled = config.enabled;
    if (!config.enabled) {
      log?.info("dod_news_sync_skipped_not_enabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      // Still emit success health so operator sees the source is reachable;
      // record records as 0 to signal "enabled flag is off".
      await recordSyncSuccess(
        workspaceId,
        SOURCE_NAME,
        { recordsUpserted: 0, recordsSkipped: 0, durationMs: result.durationMs, apiCalls: 0 },
        log
      );
      return result;
    }

    const page = await fetchContractsListing(log);
    result.pagesFetched = 1;
    result.apiCallsCount = 1;
    const announcements = parsePage(page.html);
    result.paragraphsParsed = announcements.length;
    log?.info("dod_news_page_parsed", {
      workspaceId,
      announcements: announcements.length,
    });

    const services = new Set(config.services.map((s) => s.toUpperCase()));
    const confidenceFloor = options.confidenceFloor ?? config.confidenceFloor;
    for (const ann of announcements) {
      if (ann.dollarValue < config.minDollar) continue;
      if (services.size > 0 && ann.serviceOfRecord && !services.has(ann.serviceOfRecord)) {
        continue;
      }
      if (ann.confidence < confidenceFloor) {
        result.skippedBelowConfidence++;
        continue;
      }
      result.announcementsValid++;

      if (options.dryRun) continue;

      try {
        const r = await reconcileAnnouncement(workspaceId, ann, log, { confidenceFloor });
        if (r.action === "created_provisional") result.provisionalCreated++;
        else if (r.action === "appended_observation") result.observationsAppended++;
        else if (r.action === "skipped_below_confidence") result.skippedBelowConfidence++;
        else if (r.action === "skipped_existing_authoritative") result.skippedExisting++;
      } catch (err) {
        result.errors.push({ piid: ann.piid, message: (err as Error).message });
        log?.warn("dod_news_reconcile_failed", {
          piid: ann.piid,
          message: (err as Error).message,
        });
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted: result.provisionalCreated + result.observationsAppended,
        recordsSkipped: result.skippedExisting + result.skippedBelowConfidence,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("dod_news_sync_completed", {
      workspaceId,
      durationMs: result.durationMs,
      paragraphsParsed: result.paragraphsParsed,
      provisionalCreated: result.provisionalCreated,
      observationsAppended: result.observationsAppended,
      skippedBelowConfidence: result.skippedBelowConfidence,
      errors: result.errors.length,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ piid: "_sync_root", message: e.message ?? String(err) });

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

    log?.error("dod_news_sync_failed", {
      workspaceId,
      category: categorized.category,
      message: categorized.message,
    });
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
