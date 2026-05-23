// DARPA News — SourceClient implementation (Phase 8.6.17 v1.0)
//
// Walks the configured DARPA News & Events RSS feed, parses items,
// emits analysis_publication Signals with body-text contractor +
// program resolution. attrs.publisher="darpa_news" + itemKind
// classification (program_announcement / award / demonstration /
// event / leadership / other) give the operator immediate triage.
//
// DARPA is the leading-edge of defense R&D — program announcements
// today become acquisition programs 5-10 years later. This is the
// first plugin in the R&D pipeline coverage; future plugins (DIU,
// AFRL, ARL, ONR, AFWERX) will follow the same shape.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import {
  loadConfig,
  validateConfig,
  effectiveContractorPatterns,
  effectiveProgramPatterns,
  type DarpaNewsConfig,
} from "./config";
import { fetchDarpaFeed } from "./client";
import { upsertDarpaNewsSignal, matchesKeywords } from "./mapper";

export const SOURCE_NAME = "darpa_news";
export const SOURCE_VERSION = "1.0.0";

export interface DarpaNewsSyncOptions {
  itemCap?: number;
  dryRun?: boolean;
}

export interface DarpaNewsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  itemsConsidered: number;
  itemsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  contractorsResolvedTotal: number;
  programsMatchedTotal: number;
  itemKindCounts: Record<string, number>;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: DarpaNewsSyncOptions = {},
  log?: Logger
): Promise<DarpaNewsSyncResult> {
  const startedAt = Date.now();
  log?.info("darpa_news_sync_started", { workspaceId, options });

  const result: DarpaNewsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    itemsConsidered: 0,
    itemsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    contractorsResolvedTotal: 0,
    programsMatchedTotal: 0,
    itemKindCounts: {},
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: DarpaNewsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const feed = await fetchDarpaFeed(config.rssUrl, log);
    result.apiCallsCount = 1;
    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const itemCap = options.itemCap ?? 80;

    const relevant = feed
      .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
      .filter((it) => matchesKeywords(it, config.keywords))
      .slice(0, itemCap);

    result.itemsConsidered = feed.length;
    result.itemsMatched = relevant.length;

    const patterns = {
      contractors: effectiveContractorPatterns(config),
      programs: effectiveProgramPatterns(config),
      maxRelatedPerSignal: config.maxRelatedPerSignal,
      resolveBodyOrgs: config.resolveBodyOrgs,
    };

    if (!options.dryRun) {
      for (const item of relevant) {
        try {
          const r = await upsertDarpaNewsSignal(workspaceId, item, patterns, log);
          if (r.action === "created") result.signalsCreated++;
          else if (r.action === "updated") result.signalsUpdated++;
          else result.signalsUnchanged++;
          result.contractorsResolvedTotal += r.contractorsResolved;
          result.programsMatchedTotal += r.programsMatched;
          result.itemKindCounts[r.itemKind] =
            (result.itemKindCounts[r.itemKind] || 0) + 1;
        } catch (err) {
          result.errors.push({
            ref: item.guid || item.link,
            message: (err as Error).message,
          });
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

    log?.info("darpa_news_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      itemsConsidered: result.itemsConsidered,
      itemsMatched: result.itemsMatched,
      signalsCreated: result.signalsCreated,
      signalsUpdated: result.signalsUpdated,
      contractorsResolvedTotal: result.contractorsResolvedTotal,
      programsMatchedTotal: result.programsMatchedTotal,
      itemKindCounts: result.itemKindCounts,
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
