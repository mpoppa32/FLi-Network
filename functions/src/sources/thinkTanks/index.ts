// Think tank aggregator — SourceClient implementation
//
// Phase 8.6.6: bundled aggregator for major defense think tanks. Per
// tier2-previews-v1 T2-6: one framework module handles all tanks via
// per-source config. Adding a new tank = appending to registry.ts.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, type ThinkTankConfig } from "./config";
import { DEFAULT_DS_CONTRACTOR_PATTERNS } from "../defenseScoop/config";
import { fetchTankFeed } from "./client";
import { upsertPublicationSignal, matchesKeywords } from "./mapper";
import { THINK_TANK_REGISTRY, findTankByKey } from "./registry";

export const SOURCE_NAME = "think_tank";
export const SOURCE_VERSION = "1.0.0";

export { THINK_TANK_REGISTRY };

export interface ThinkTankSyncOptions {
  /** Limit per-tank items processed per run. Default 50. */
  perTankCap?: number;
  /** Skip tanks not yet enabled in workspace config. Default true. */
  skipDisabledTanks?: boolean;
  /** Dry run: fetch + parse but don't write. */
  dryRun?: boolean;
}

export interface ThinkTankSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  tanksConsidered: number;
  tanksSyncedSuccessfully: number;
  itemsConsidered: number;
  itemsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  errors: Array<{ tankKey: string; message: string }>;
  apiCallsCount: number;
}

export async function syncWorkspace(
  workspaceId: string,
  options: ThinkTankSyncOptions = {},
  log?: Logger
): Promise<ThinkTankSyncResult> {
  const startedAt = Date.now();
  log?.info("think_tank_sync_started", { workspaceId, options });

  const result: ThinkTankSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    tanksConsidered: 0,
    tanksSyncedSuccessfully: 0,
    itemsConsidered: 0,
    itemsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    errors: [],
    apiCallsCount: 0,
  };

  try {
    const config: ThinkTankConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      log?.info("think_tank_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const enabledKeys = new Set(config.enabledTanks);
    const tanks = THINK_TANK_REGISTRY.filter((t) => enabledKeys.has(t.key));
    result.tanksConsidered = tanks.length;
    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const perTankCap = options.perTankCap ?? 50;

    // P13.266 — body-text contractor resolution patterns shared with
    // defenseScoop. Includes Atlas's drone-prime customers (Anduril /
    // Shield AI / Saildrone / Skydio / Epirus) so think-tank analysis
    // pieces mentioning them get categorized as customer in the Brief.
    const patterns = {
      defenseContractors: DEFAULT_DS_CONTRACTOR_PATTERNS,
      maxRelatedPerSignal: 6,
    };

    for (const tank of tanks) {
      try {
        const feed = await fetchTankFeed(tank.rssUrl, log);
        result.apiCallsCount++;
        result.tanksSyncedSuccessfully++;
        const relevant = feed
          .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
          .filter((it) => matchesKeywords(it, config.keywords))
          .slice(0, perTankCap);

        result.itemsConsidered += feed.length;
        result.itemsMatched += relevant.length;

        if (options.dryRun) continue;

        for (const item of relevant) {
          try {
            const r = await upsertPublicationSignal(workspaceId, tank, item, patterns, log);
            if (r.action === "created") result.signalsCreated++;
            else if (r.action === "updated") result.signalsUpdated++;
            else result.signalsUnchanged++;
          } catch (err) {
            result.errors.push({ tankKey: tank.key, message: (err as Error).message });
          }
        }
      } catch (err) {
        const e = err as Error;
        result.errors.push({ tankKey: tank.key, message: e.message ?? String(err) });
        log?.warn("think_tank_feed_failed", { tankKey: tank.key, message: e.message });
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

    log?.info("think_tank_sync_completed", {
      workspaceId,
      durationMs: result.durationMs,
      tanksSynced: result.tanksSyncedSuccessfully,
      signalsCreated: result.signalsCreated,
      signalsUpdated: result.signalsUpdated,
      errors: result.errors.length,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ tankKey: "_sync_root", message: e.message ?? String(err) });
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
    log?.error("think_tank_sync_failed", { workspaceId, message: categorized.message });
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}

export { findTankByKey };
