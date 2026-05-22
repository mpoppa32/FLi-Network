// State Department — SourceClient implementation (Phase 8.6.4 v1.0)
//
// Walks the configured feed list (defaults: press releases + briefings
// + fact sheets; sanctions opt-in via config), parses each RSS, and
// emits analysis_publication Signals via the mapper.

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
  type StateDepartmentConfig,
} from "./config";
import {
  STATE_DEPARTMENT_REGISTRY,
  getFeedByKey,
  type StateDepartmentFeed,
} from "./registry";
import { fetchStateFeed, type StateRssItem } from "./client";
import {
  upsertStatePublicationSignal,
  matchesKeywords,
  matchesSanctionsGate,
} from "./mapper";

export const SOURCE_NAME = "state_department";
export const SOURCE_VERSION = "1.1.0";

export interface StateDepartmentSyncOptions {
  dryRun?: boolean;
  feedKeyOverride?: string;
}

export interface StateDepartmentSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  feedsProcessed: number;
  feedsFailed: number;
  itemsFetched: number;
  itemsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  agencyOrgResolvedTotal: number;
  /** v1.1: total body-mention Orgs resolved across all signals (sum of
   *  per-signal relatedIds.length). Indicates how often defense
   *  contractor / foreign-government patterns matched item bodies. */
  bodyOrgsResolvedTotal: number;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: StateDepartmentSyncOptions = {},
  log?: Logger
): Promise<StateDepartmentSyncResult> {
  const startedAt = Date.now();
  log?.info("state_department_sync_started", { workspaceId, options });

  const result: StateDepartmentSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    feedsProcessed: 0,
    feedsFailed: 0,
    itemsFetched: 0,
    itemsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    agencyOrgResolvedTotal: 0,
    bodyOrgsResolvedTotal: 0,
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: StateDepartmentConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const feeds: StateDepartmentFeed[] = options.feedKeyOverride
      ? ([getFeedByKey(options.feedKeyOverride)].filter(
          Boolean
        ) as StateDepartmentFeed[])
      : STATE_DEPARTMENT_REGISTRY.filter((f) =>
          config.enabledFeeds.includes(f.key)
        );

    if (feeds.length === 0) {
      log?.info("state_department_sync_no_feeds_enabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const maxItems = Math.max(1, config.maxItemsPerFeed ?? 60);

    if (!options.dryRun) {
      for (const feed of feeds) {
        try {
          const items: StateRssItem[] = await fetchStateFeed(feed.rssUrl, log);
          result.apiCallsCount++;
          result.feedsProcessed++;
          result.itemsFetched += items.length;
          // Filter: within lookback window AND keyword pass AND sanctions
          // gate (the sanctions feed shares the press_releases RSS but
          // gates on sanctions language so we don't double-emit).
          const filtered = items
            .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
            .filter((it) => matchesKeywords(it, config.keywords))
            .filter((it) => matchesSanctionsGate(feed, it))
            .slice(0, maxItems);
          result.itemsMatched += filtered.length;
          for (const item of filtered) {
            try {
              const r = await upsertStatePublicationSignal(
                workspaceId,
                feed,
                item,
                log
              );
              if (r.action === "created") result.signalsCreated++;
              else if (r.action === "updated") result.signalsUpdated++;
              else result.signalsUnchanged++;
              if (r.agencyOrgResolved) result.agencyOrgResolvedTotal++;
              result.bodyOrgsResolvedTotal += r.bodyOrgsResolved;
            } catch (err) {
              result.errors.push({
                ref: `item:${feed.key}:${item.guid || item.link}`,
                message: (err as Error).message,
              });
            }
          }
        } catch (err) {
          result.feedsFailed++;
          result.errors.push({
            ref: `feed:${feed.key}`,
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

    log?.info("state_department_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      feedsProcessed: result.feedsProcessed,
      feedsFailed: result.feedsFailed,
      itemsFetched: result.itemsFetched,
      itemsMatched: result.itemsMatched,
      signalsCreated: result.signalsCreated,
      bodyOrgsResolvedTotal: result.bodyOrgsResolvedTotal,
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
