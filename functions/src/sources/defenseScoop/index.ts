// Defense BD news — SourceClient implementation (Phase 8.6.X v1.0)
//
// Walks the configured publication list (Breaking Defense + DefenseScoop
// + Defense News default on; FedScoop + NextGov opt-in), parses each
// RSS feed, and emits analysis_publication Signals with body-text
// contractor + program resolution.

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
  DEFAULT_DS_CONTRACTOR_PATTERNS,
  DEFAULT_DS_PROGRAM_PATTERNS,
  type DefenseScoopConfig,
} from "./config";
import {
  DEFENSE_SCOOP_REGISTRY,
  getPublicationByKey,
  type DefenseScoopPublication,
} from "./registry";
import { fetchDsFeed, type DsRssItem } from "./client";
import { upsertDsPublicationSignal, matchesKeywords } from "./mapper";
import { loadWorkspacePatterns } from "../../framework/loadWorkspacePatterns";

export const SOURCE_NAME = "defense_scoop";
export const SOURCE_VERSION = "1.0.0";

export interface DefenseScoopSyncOptions {
  dryRun?: boolean;
  publicationKeyOverride?: string;
}

export interface DefenseScoopSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  publicationsProcessed: number;
  publicationsFailed: number;
  itemsFetched: number;
  itemsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  bodyOrgsResolvedTotal: number;
  programMatchesTotal: number;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: DefenseScoopSyncOptions = {},
  log?: Logger
): Promise<DefenseScoopSyncResult> {
  const startedAt = Date.now();
  log?.info("defense_scoop_sync_started", { workspaceId, options });

  const result: DefenseScoopSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    publicationsProcessed: 0,
    publicationsFailed: 0,
    itemsFetched: 0,
    itemsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    bodyOrgsResolvedTotal: 0,
    programMatchesTotal: 0,
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: DefenseScoopConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const pubs: DefenseScoopPublication[] = options.publicationKeyOverride
      ? ([getPublicationByKey(options.publicationKeyOverride)].filter(
          Boolean
        ) as DefenseScoopPublication[])
      : DEFENSE_SCOOP_REGISTRY.filter((p) =>
          config.enabledPublications.includes(p.key)
        );

    if (pubs.length === 0) {
      log?.info("defense_scoop_sync_no_publications_enabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const maxItems = Math.max(1, config.maxItemsPerPublication ?? 80);

    // P13.283 — merge workspace-scoped operator-seeded patterns at
    // /workspaces/{ws}/patterns/{contractors,programs} with the
    // hardcoded defaults (or config overrides). Atlas at write-time
    // carried 110+ operator-curated vendor names in workspace patterns
    // that the pre-P13.283 mapper-time pattern list was ignoring; the
    // empirical effect was 11 of 53 defense_scoop signals carrying
    // relatedIds. Merging closes that gap so the Brief's customer +
    // adversary rollups populate from the lake. See
    // framework/loadWorkspacePatterns.ts for dedupe discipline.
    const baseContractors =
      config.defenseContractorPatterns &&
      config.defenseContractorPatterns.length > 0
        ? config.defenseContractorPatterns
        : DEFAULT_DS_CONTRACTOR_PATTERNS;
    const basePrograms =
      config.programPatterns && config.programPatterns.length > 0
        ? config.programPatterns
        : DEFAULT_DS_PROGRAM_PATTERNS;
    const wsPatterns = await loadWorkspacePatterns(
      workspaceId,
      { contractors: baseContractors, programs: basePrograms },
      log
    );
    log?.info("defense_scoop_patterns_loaded", { workspaceId, meta: wsPatterns.meta });
    const patterns = {
      defenseContractors: wsPatterns.contractors,
      programs: wsPatterns.programs,
      maxRelatedPerSignal: config.maxRelatedPerSignal ?? 6,
    };

    if (!options.dryRun) {
      for (const pub of pubs) {
        try {
          const items: DsRssItem[] = await fetchDsFeed(pub.rssUrl, log);
          result.apiCallsCount++;
          result.publicationsProcessed++;
          result.itemsFetched += items.length;
          const filtered = items
            .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
            .filter((it) => matchesKeywords(it, config.keywords))
            .slice(0, maxItems);
          result.itemsMatched += filtered.length;
          for (const item of filtered) {
            try {
              const r = await upsertDsPublicationSignal(
                workspaceId,
                pub,
                item,
                patterns,
                log
              );
              if (r.action === "created") result.signalsCreated++;
              else if (r.action === "updated") result.signalsUpdated++;
              else result.signalsUnchanged++;
              result.bodyOrgsResolvedTotal += r.bodyOrgsResolved;
              result.programMatchesTotal += r.programMatchesFound;
            } catch (err) {
              result.errors.push({
                ref: `item:${pub.key}:${item.guid || item.link}`,
                message: (err as Error).message,
              });
            }
          }
        } catch (err) {
          result.publicationsFailed++;
          result.errors.push({
            ref: `pub:${pub.key}`,
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

    log?.info("defense_scoop_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      publicationsProcessed: result.publicationsProcessed,
      publicationsFailed: result.publicationsFailed,
      itemsFetched: result.itemsFetched,
      itemsMatched: result.itemsMatched,
      signalsCreated: result.signalsCreated,
      bodyOrgsResolvedTotal: result.bodyOrgsResolvedTotal,
      programMatchesTotal: result.programMatchesTotal,
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
