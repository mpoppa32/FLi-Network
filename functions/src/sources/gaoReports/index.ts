// GAO Reports — SourceClient implementation
//
// Phase 8.6.14 — programmatic GAO oversight reports (distinct from bid
// protests at 8.5.5). RSS-based; defense-keyword filterable.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, DEFENSE_KEYWORDS, type GaoReportsConfig } from "./config";
import { fetchGaoReportsFeed } from "./client";
import { upsertGaoReportSignal, matchesKeywords } from "./mapper";

export const SOURCE_NAME = "gao_reports";
export const SOURCE_VERSION = "1.0.0";

export interface GaoReportsSyncOptions {
  itemCap?: number;
  dryRun?: boolean;
}

export interface GaoReportsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  itemsConsidered: number;
  itemsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
}

export async function syncWorkspace(
  workspaceId: string,
  options: GaoReportsSyncOptions = {},
  log?: Logger
): Promise<GaoReportsSyncResult> {
  const startedAt = Date.now();
  log?.info("gao_reports_sync_started", { workspaceId, options });

  const result: GaoReportsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    itemsConsidered: 0,
    itemsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    errors: [],
    apiCallsCount: 0,
  };

  try {
    const config: GaoReportsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const feed = await fetchGaoReportsFeed(log);
    result.apiCallsCount = 1;
    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const itemCap = options.itemCap ?? 80;

    const effectiveKeywords = config.defenseOnly
      ? [...DEFENSE_KEYWORDS, ...config.keywords]
      : config.keywords;

    const relevant = feed
      .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
      .filter((it) => matchesKeywords(it, effectiveKeywords))
      .slice(0, itemCap);

    result.itemsConsidered = feed.length;
    result.itemsMatched = relevant.length;

    if (!options.dryRun) {
      for (const item of relevant) {
        try {
          const r = await upsertGaoReportSignal(workspaceId, item, log);
          if (r.action === "created") result.signalsCreated++;
          else if (r.action === "updated") result.signalsUpdated++;
          else result.signalsUnchanged++;
        } catch (err) {
          result.errors.push({ ref: item.guid || item.link, message: (err as Error).message });
        }
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

    log?.info("gao_reports_sync_completed", {
      workspaceId,
      durationMs: result.durationMs,
      itemsConsidered: result.itemsConsidered,
      itemsMatched: result.itemsMatched,
      signalsCreated: result.signalsCreated,
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
