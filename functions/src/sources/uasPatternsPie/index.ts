// uas-patterns PIE Supply-Chain Intelligence — SourceClient (v1.0)
//
// Daily HTML scrape of https://uas-patterns.com/patterns/, extracting
// the embedded MANUFACTURERS + SCENARIOS data structures and emitting:
//
//   supply_chain_status     per manufacturer that resolves to a
//                           workspace Org node
//   supply_chain_scenario   per forecast (with relatedIds linking any
//                           workspace Org mentioned in the scenario)
//
// Companion to the uas-patterns DDG plugin (P13.273). Same domain,
// shared rate-limit bucket. Confidence 0.75 (INFERRED tier — third-party
// curation).
//
// Note: the page also exposes FLAGS / PREDICTIONS / OUTCOMES / signals
// arrays as empty placeholders, populated at runtime from a token-gated
// /api/data endpoint. v1 ignores them; v1.1 will wire the dynamic flow
// if an operator-supplied access token gets added to the per-workspace
// config.

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
  type UasPatternsPieConfig,
} from "./config";
import { fetchPiePage } from "./client";
import {
  upsertManufacturerSignals,
  upsertScenarioSignals,
  loadWorkspaceOrgNameMap,
} from "./mapper";

export const SOURCE_NAME = "uas_patterns_pie";
export const SOURCE_VERSION = "1.0.0";

export interface UasPatternsPieSyncOptions {
  dryRun?: boolean;
}

export interface UasPatternsPieSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  manufacturersFetched: number;
  scenariosFetched: number;
  manufacturerSignalsCreated: number;
  manufacturerSignalsUpdated: number;
  manufacturerSignalsUnchanged: number;
  manufacturersSkippedNoOrg: number;
  scenarioSignalsCreated: number;
  scenarioSignalsUpdated: number;
  scenarioSignalsUnchanged: number;
  apiCallsCount: number;
  errors: Array<{ ref: string; message: string }>;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: UasPatternsPieSyncOptions = {},
  log?: Logger
): Promise<UasPatternsPieSyncResult> {
  const startedAt = Date.now();
  log?.info("uas_patterns_pie_sync_started", { workspaceId, options });

  const result: UasPatternsPieSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    manufacturersFetched: 0,
    scenariosFetched: 0,
    manufacturerSignalsCreated: 0,
    manufacturerSignalsUpdated: 0,
    manufacturerSignalsUnchanged: 0,
    manufacturersSkippedNoOrg: 0,
    scenarioSignalsCreated: 0,
    scenarioSignalsUpdated: 0,
    scenarioSignalsUnchanged: 0,
    apiCallsCount: 0,
    errors: [],
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: UasPatternsPieConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const payload = await fetchPiePage(log);
    result.apiCallsCount = 1;
    result.manufacturersFetched = payload.manufacturers.length;
    result.scenariosFetched = payload.scenarios.length;
    const confidence = config.confidence ?? 0.75;

    if (!options.dryRun) {
      const mfrRes = await upsertManufacturerSignals(
        workspaceId,
        payload.manufacturers,
        payload.pageUrl,
        payload.fetchedAt,
        confidence,
        log
      );
      result.manufacturerSignalsCreated = mfrRes.manufacturerSignalsCreated;
      result.manufacturerSignalsUpdated = mfrRes.manufacturerSignalsUpdated;
      result.manufacturerSignalsUnchanged = mfrRes.manufacturerSignalsUnchanged;
      result.manufacturersSkippedNoOrg = mfrRes.manufacturersSkippedNoOrg;

      const orgNameMap = await loadWorkspaceOrgNameMap(workspaceId);
      const scnRes = await upsertScenarioSignals(
        workspaceId,
        payload.scenarios,
        payload.pageUrl,
        payload.fetchedAt,
        confidence,
        log,
        orgNameMap
      );
      result.scenarioSignalsCreated = scnRes.created;
      result.scenarioSignalsUpdated = scnRes.updated;
      result.scenarioSignalsUnchanged = scnRes.unchanged;
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted:
          result.manufacturerSignalsCreated +
          result.manufacturerSignalsUpdated +
          result.scenarioSignalsCreated +
          result.scenarioSignalsUpdated,
        recordsSkipped:
          result.manufacturerSignalsUnchanged +
          result.scenarioSignalsUnchanged,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("uas_patterns_pie_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      manufacturersFetched: result.manufacturersFetched,
      scenariosFetched: result.scenariosFetched,
      manufacturerSignalsCreated: result.manufacturerSignalsCreated,
      manufacturerSignalsUpdated: result.manufacturerSignalsUpdated,
      manufacturerSignalsUnchanged: result.manufacturerSignalsUnchanged,
      manufacturersSkippedNoOrg: result.manufacturersSkippedNoOrg,
      scenarioSignalsCreated: result.scenarioSignalsCreated,
      scenarioSignalsUpdated: result.scenarioSignalsUpdated,
      scenarioSignalsUnchanged: result.scenarioSignalsUnchanged,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({
      ref: "_sync_root",
      message: e.message ?? String(err),
    });
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
