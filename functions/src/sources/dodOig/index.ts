// DoD OIG — SourceClient implementation (Phase 8.6.16 v1.0)
//
// Walks the configured DoD IG audit feed, parses RSS items, emits
// oversight_finding Signals with body-text contractor + program
// resolution. Sibling to gao_reports: same Signal type, different
// publisher (attrs.publisher = "dod_oig" vs implicit "gao" for GAO).
//
// Downstream consumers (Brief Synthesis WIN/STAGE/etc., touches popover,
// Adversary/Customer rollups) treat oversight_finding signals
// publisher-agnostic, so DoD IG findings flow into the same scoring
// matrix as GAO reports for free.

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
  DEFENSE_KEYWORDS,
  type DodOigConfig,
} from "./config";
import { fetchDodOigFeed } from "./client";
import { upsertDodOigSignal, matchesKeywords } from "./mapper";

export const SOURCE_NAME = "dod_oig";
export const SOURCE_VERSION = "1.0.0";

export interface DodOigSyncOptions {
  itemCap?: number;
  dryRun?: boolean;
}

export interface DodOigSyncResult {
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
  reportKindCounts: Record<string, number>;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: DodOigSyncOptions = {},
  log?: Logger
): Promise<DodOigSyncResult> {
  const startedAt = Date.now();
  log?.info("dod_oig_sync_started", { workspaceId, options });

  const result: DodOigSyncResult = {
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
    reportKindCounts: {},
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: DodOigConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const feed = await fetchDodOigFeed(config.rssUrl, log);
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

    const patterns = {
      contractors: effectiveContractorPatterns(config),
      programs: effectiveProgramPatterns(config),
      maxRelatedPerSignal: config.maxRelatedPerSignal,
      resolveBodyOrgs: config.resolveBodyOrgs,
    };

    if (!options.dryRun) {
      for (const item of relevant) {
        try {
          const r = await upsertDodOigSignal(workspaceId, item, patterns, log);
          if (r.action === "created") result.signalsCreated++;
          else if (r.action === "updated") result.signalsUpdated++;
          else result.signalsUnchanged++;
          result.contractorsResolvedTotal += r.contractorsResolved;
          result.programsMatchedTotal += r.programsMatched;
          result.reportKindCounts[r.reportKind] =
            (result.reportKindCounts[r.reportKind] || 0) + 1;
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

    log?.info("dod_oig_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      itemsConsidered: result.itemsConsidered,
      itemsMatched: result.itemsMatched,
      signalsCreated: result.signalsCreated,
      signalsUpdated: result.signalsUpdated,
      contractorsResolvedTotal: result.contractorsResolvedTotal,
      programsMatchedTotal: result.programsMatchedTotal,
      reportKindCounts: result.reportKindCounts,
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
