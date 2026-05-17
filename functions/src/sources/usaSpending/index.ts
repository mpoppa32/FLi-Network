// USAspending source — SourceClient implementation
//
// Per award-integration-v1: nightly sync of awards matching workspace
// watchlist (NAICS, agencies, competitors). Each result mapped to an Award
// entity. Hash-equality skipping prevents unnecessary writes.
//
// v1.1 (2026-05-17):
//   - Mod history refresh for recently-modified active/expiring awards
//   - Server-side Recompete Watch derived view rebuilt at end of each sync
//   - Subawards sync split into a separate weekly job (subawards.ts)

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { db, wsPath } from "../../framework/rtdb";
import { invalidateOrgCache } from "./orgResolver";
import { loadConfig, validateConfig, type UsaSpendingConfig } from "./config";
import {
  formatDateForApi,
  searchAllPages,
  type UsaSpendingSearchFilters,
  type UsaSpendingSearchRequest,
} from "./client";
import { mapSearchResultToAward, upsertAward } from "./mapper";
import { syncAwardModifications } from "./modifications";
import { buildRecompeteWatchView } from "./recompeteWatch";
import type { Award } from "../../framework/types/awards";

export const SOURCE_NAME = "usaspending";
export const SOURCE_VERSION = "1.1.0";

export { syncAwardSubawards, syncWorkspaceSubawards } from "./subawards";
export { syncAwardModifications } from "./modifications";
export { buildRecompeteWatchView } from "./recompeteWatch";
export type { RecompeteWatchView, RecompeteEntry, RecompeteUrgencyTier } from "./recompeteWatch";

export interface UsaSpendingSyncOptions {
  /** Override the lookback window in days. Default: from config lookBackMonths. */
  sinceDays?: number;
  /** Cap on records to fetch this sync. Default: 500. */
  maxRecords?: number;
  /** Force refresh of all records (skip hash-equality short-circuit). Default: false. */
  forceRefresh?: boolean;
  /** Dry run: fetch and map, but don't write. Default: false. */
  dryRun?: boolean;
  /** Cap on awards whose mod history is refreshed this run. Default: 50. */
  maxModRefreshes?: number;
  /** Skip Recompete Watch derived view rebuild. Default: false. */
  skipRecompeteBuild?: boolean;
  /** Skip mod refresh step entirely. Default: false. */
  skipModRefresh?: boolean;
}

export interface UsaSpendingSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  recordsFetched: number;
  awardsCreated: number;
  awardsUpdated: number;
  awardsUnchanged: number;
  orgsCreated: number;
  errors: Array<{ recordId: string; message: string }>;
  durationMs: number;
  apiCallsCount: number;
  filterSummary: { naics: number; agencies: number; competitors: number };
  modRefresh: {
    awardsRefreshed: number;
    modsWritten: number;
    terminationsDetected: number;
    obligatedDeltaTotal: number;
    errors: number;
  };
  recompeteWatch: {
    built: boolean;
    total: number;
    imminent: number;
    near: number;
    mid: number;
    far: number;
  };
}

/**
 * Run one sync cycle for a workspace.
 */
export async function syncWorkspace(
  workspaceId: string,
  options: UsaSpendingSyncOptions = {},
  log?: Logger
): Promise<UsaSpendingSyncResult> {
  const startedAt = Date.now();
  log?.info("usaspending_sync_started", { workspaceId, options });
  invalidateOrgCache(); // fresh cache for this run

  const result: UsaSpendingSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    recordsFetched: 0,
    awardsCreated: 0,
    awardsUpdated: 0,
    awardsUnchanged: 0,
    orgsCreated: 0,
    errors: [],
    durationMs: 0,
    apiCallsCount: 0,
    filterSummary: { naics: 0, agencies: 0, competitors: 0 },
    modRefresh: {
      awardsRefreshed: 0,
      modsWritten: 0,
      terminationsDetected: 0,
      obligatedDeltaTotal: 0,
      errors: 0,
    },
    recompeteWatch: {
      built: false,
      total: 0,
      imminent: 0,
      near: 0,
      mid: 0,
      far: 0,
    },
  };

  try {
    // 1. Load + validate config
    const config: UsaSpendingConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      log?.info("usaspending_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    result.filterSummary = {
      naics: config.naics.length,
      agencies: config.agencies.length,
      competitors: config.competitorOrgs.length,
    };

    // 2. Build filter
    const sinceDays = options.sinceDays ?? Math.min(60, config.lookBackMonths * 30);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const until = new Date();

    const filters: UsaSpendingSearchFilters = {
      award_type_codes: config.awardTypeCodes ?? ["A", "B", "C", "D"],
      time_period: [
        { start_date: formatDateForApi(since), end_date: formatDateForApi(until) },
      ],
    };
    if (config.naics.length > 0) filters.naics_codes = config.naics;
    if (config.agencies.length > 0) {
      filters.agencies = config.agencies.map((name) => ({
        type: "awarding" as const,
        tier: "toptier" as const,
        name,
      }));
    }
    if (config.minDollarThreshold) {
      filters.award_amounts = [{ lower_bound: config.minDollarThreshold }];
    }

    const request: UsaSpendingSearchRequest = {
      filters,
      limit: 100,
      sort: "Award Amount",
      order: "desc",
    };

    // 3. Fetch
    const maxRecords = options.maxRecords ?? 500;
    const records = await searchAllPages(request, maxRecords, log);
    result.recordsFetched = records.length;
    // Pagination ⇒ one API call per page of 100
    result.apiCallsCount = Math.ceil(records.length / 100) || 1;
    log?.info("usaspending_records_fetched", { workspaceId, count: records.length });

    // 4. Map + upsert
    for (const record of records) {
      try {
        const award = await mapSearchResultToAward(workspaceId, record);
        if (options.dryRun) continue;
        const upsertResult = await upsertAward(workspaceId, award);
        if (upsertResult.action === "created") result.awardsCreated++;
        else if (upsertResult.action === "updated") result.awardsUpdated++;
        else result.awardsUnchanged++;
      } catch (err) {
        const e = err as Error;
        result.errors.push({
          recordId: record.generated_internal_id || String(record.internal_id),
          message: e.message ?? String(err),
        });
        log?.warn("usaspending_record_failed", {
          recordId: record.generated_internal_id,
          message: e.message,
        });
      }
    }

    // 5. Mod history refresh — for the most-stale active/expiring awards
    if (!options.dryRun && !options.skipModRefresh) {
      const maxRefresh = options.maxModRefreshes ?? 50;
      try {
        const allSnap = await db.ref(wsPath(workspaceId, "awards")).once("value");
        const allAwards = (allSnap.val() as Record<string, Award> | null) ?? {};
        const candidates = Object.values(allAwards)
          .filter((a) => a && (a.lifecycleState === "active" || a.lifecycleState === "expiring"))
          // Prefer awards whose source.refreshedAt is newer than modsLastSyncAt
          // (i.e., search sync touched them but mods may have drifted), then
          // oldest mod sync.
          .sort((a, b) => {
            const aLag = (a.source?.refreshedAt ?? 0) - (a.modsLastSyncAt ?? 0);
            const bLag = (b.source?.refreshedAt ?? 0) - (b.modsLastSyncAt ?? 0);
            if (aLag !== bLag) return bLag - aLag; // bigger lag first
            return (a.modsLastSyncAt ?? 0) - (b.modsLastSyncAt ?? 0);
          })
          .slice(0, maxRefresh);

        for (const award of candidates) {
          try {
            const modResult = await syncAwardModifications(workspaceId, award, log);
            if (modResult.changed) {
              result.modRefresh.awardsRefreshed++;
              result.modRefresh.modsWritten += modResult.modsWritten;
              result.modRefresh.obligatedDeltaTotal += modResult.obligatedDelta;
              if (modResult.terminated) result.modRefresh.terminationsDetected++;
            }
            result.apiCallsCount++;
          } catch (err) {
            result.modRefresh.errors++;
            log?.warn("usaspending_mod_refresh_failed", {
              awardId: award.id,
              message: (err as Error).message,
            });
          }
        }
      } catch (err) {
        log?.warn("usaspending_mod_refresh_step_failed", { message: (err as Error).message });
      }
    }

    // 6. Server-side Recompete Watch derived view
    if (!options.dryRun && !options.skipRecompeteBuild) {
      try {
        const view = await buildRecompeteWatchView(workspaceId, {}, log);
        result.recompeteWatch = {
          built: true,
          total: view.totals.all,
          imminent: view.totals.imminent,
          near: view.totals.near,
          mid: view.totals.mid,
          far: view.totals.far,
        };
      } catch (err) {
        log?.warn("usaspending_recompete_build_failed", { message: (err as Error).message });
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    // 7. Source Health write
    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted: result.awardsCreated + result.awardsUpdated,
        recordsSkipped: result.awardsUnchanged,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("usaspending_sync_completed", {
      workspaceId,
      durationMs: result.durationMs,
      created: result.awardsCreated,
      updated: result.awardsUpdated,
      unchanged: result.awardsUnchanged,
      errors: result.errors.length,
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

    log?.error("usaspending_sync_failed", {
      workspaceId,
      category: categorized.category,
      message: categorized.message,
    });
    throw err;
  }

  return result;
}

/**
 * Read latest health snapshot for this source.
 */
export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
