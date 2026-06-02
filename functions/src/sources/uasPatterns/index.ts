// uas-patterns DDG Tracker — SourceClient (Phase O-7 v1.0)
//
// Daily HTML scrape of https://uas-patterns.com/ddg/, extracting the
// embedded `competitors` + `predictions` data structures and emitting:
//
//   ddg_status_change   per DDG vendor present in workspace
//   ddg_prediction      per analyst forecast (with relatedIds linking
//                       any vendor mentioned in the prediction text)
//
// Per audit Section "Honest treatment": closes Category 13 gap (no
// current drone-specific source coverage). Confidence chip 0.75
// (INFERRED tier — third-party curation, not primary).

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, type UasPatternsConfig } from "./config";
import { fetchDdgPage } from "./client";
import {
  upsertCompetitorSignals,
  upsertPredictionSignals,
  resolveVendorOrgMap,
} from "./mapper";

export const SOURCE_NAME = "uas_patterns";
export const SOURCE_VERSION = "1.0.0";

export interface UasPatternsSyncOptions {
  dryRun?: boolean;
}

export interface UasPatternsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  competitorsFetched: number;
  predictionsFetched: number;
  vendorSignalsCreated: number;
  vendorSignalsUpdated: number;
  vendorSignalsUnchanged: number;
  vendorsSkippedNoOrg: number;
  predictionSignalsCreated: number;
  predictionSignalsUpdated: number;
  predictionSignalsUnchanged: number;
  apiCallsCount: number;
  errors: Array<{ ref: string; message: string }>;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: UasPatternsSyncOptions = {},
  log?: Logger
): Promise<UasPatternsSyncResult> {
  const startedAt = Date.now();
  log?.info("uas_patterns_sync_started", { workspaceId, options });

  const result: UasPatternsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    competitorsFetched: 0,
    predictionsFetched: 0,
    vendorSignalsCreated: 0,
    vendorSignalsUpdated: 0,
    vendorSignalsUnchanged: 0,
    vendorsSkippedNoOrg: 0,
    predictionSignalsCreated: 0,
    predictionSignalsUpdated: 0,
    predictionSignalsUnchanged: 0,
    apiCallsCount: 0,
    errors: [],
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: UasPatternsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const payload = await fetchDdgPage(log);
    result.apiCallsCount = 1;
    result.competitorsFetched = payload.competitors.length;
    result.predictionsFetched = payload.predictions.length;
    const confidence = config.confidence ?? 0.75;

    if (!options.dryRun) {
      const compRes = await upsertCompetitorSignals(
        workspaceId,
        payload.competitors,
        payload.pageUrl,
        payload.fetchedAt,
        confidence,
        log
      );
      result.vendorSignalsCreated = compRes.signalsCreated;
      result.vendorSignalsUpdated = compRes.signalsUpdated;
      result.vendorSignalsUnchanged = compRes.signalsUnchanged;
      result.vendorsSkippedNoOrg = compRes.vendorsSkippedNoOrg;

      const vendorMap = await resolveVendorOrgMap(
        workspaceId,
        payload.competitors
      );
      const predRes = await upsertPredictionSignals(
        workspaceId,
        payload.predictions,
        payload.pageUrl,
        payload.fetchedAt,
        confidence,
        log,
        vendorMap
      );
      result.predictionSignalsCreated = predRes.created;
      result.predictionSignalsUpdated = predRes.updated;
      result.predictionSignalsUnchanged = predRes.unchanged;
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted:
          result.vendorSignalsCreated +
          result.vendorSignalsUpdated +
          result.predictionSignalsCreated +
          result.predictionSignalsUpdated,
        recordsSkipped:
          result.vendorSignalsUnchanged + result.predictionSignalsUnchanged,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("uas_patterns_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      competitorsFetched: result.competitorsFetched,
      predictionsFetched: result.predictionsFetched,
      vendorSignalsCreated: result.vendorSignalsCreated,
      vendorSignalsUpdated: result.vendorSignalsUpdated,
      vendorSignalsUnchanged: result.vendorSignalsUnchanged,
      vendorsSkippedNoOrg: result.vendorsSkippedNoOrg,
      predictionSignalsCreated: result.predictionSignalsCreated,
      predictionSignalsUpdated: result.predictionSignalsUpdated,
      predictionSignalsUnchanged: result.predictionSignalsUnchanged,
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
