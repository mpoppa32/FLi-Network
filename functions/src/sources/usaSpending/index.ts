// USAspending source — SourceClient implementation
//
// Per award-integration-v1: nightly sync of awards matching workspace
// watchlist (NAICS, agencies, competitors). Each result mapped to an Award
// entity. Hash-equality skipping prevents unnecessary writes.
//
// V1 scope: search endpoint only. Modifications, subawards, recipient
// detail, and DoD News reconciliation are follow-up enhancements.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { invalidateOrgCache } from "./orgResolver";
import { loadConfig, validateConfig, type UsaSpendingConfig } from "./config";
import {
  formatDateForApi,
  searchAllPages,
  type UsaSpendingSearchFilters,
  type UsaSpendingSearchRequest,
} from "./client";
import { mapSearchResultToAward, upsertAward } from "./mapper";

export const SOURCE_NAME = "usaspending";
export const SOURCE_VERSION = "0.1.0";

export interface UsaSpendingSyncOptions {
  /** Override the lookback window in days. Default: from config lookBackMonths. */
  sinceDays?: number;
  /** Cap on records to fetch this sync. Default: 500. */
  maxRecords?: number;
  /** Force refresh of all records (skip hash-equality short-circuit). Default: false. */
  forceRefresh?: boolean;
  /** Dry run: fetch and map, but don't write. Default: false. */
  dryRun?: boolean;
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

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    // 5. Source Health write
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
