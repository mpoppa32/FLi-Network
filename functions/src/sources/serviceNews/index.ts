// Service-branch news aggregator — SourceClient implementation
//
// Phase 8.6.5: bundled RSS aggregator across 6 service branches.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, type ServiceNewsConfig } from "./config";
import { DEFAULT_DS_CONTRACTOR_PATTERNS } from "../defenseScoop/config";
import { fetchServiceFeed } from "./client";
import { upsertServiceNewsSignal, matchesKeywords } from "./mapper";
import { SERVICE_NEWS_REGISTRY, isLeadershipAnnouncement } from "./registry";

export const SOURCE_NAME = "service_news";
export const SOURCE_VERSION = "1.0.0";

export { SERVICE_NEWS_REGISTRY };

export interface ServiceNewsSyncOptions {
  perServiceCap?: number;
  dryRun?: boolean;
}

export interface ServiceNewsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  servicesConsidered: number;
  servicesSyncedSuccessfully: number;
  itemsConsidered: number;
  itemsMatched: number;
  leadershipAnnouncementsCreated: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  errors: Array<{ serviceKey: string; message: string }>;
  apiCallsCount: number;
}

export async function syncWorkspace(
  workspaceId: string,
  options: ServiceNewsSyncOptions = {},
  log?: Logger
): Promise<ServiceNewsSyncResult> {
  const startedAt = Date.now();
  log?.info("service_news_sync_started", { workspaceId, options });

  const result: ServiceNewsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    servicesConsidered: 0,
    servicesSyncedSuccessfully: 0,
    itemsConsidered: 0,
    itemsMatched: 0,
    leadershipAnnouncementsCreated: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    errors: [],
    apiCallsCount: 0,
  };

  try {
    const config: ServiceNewsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      log?.info("service_news_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const enabledKeys = new Set(config.enabledServices);
    const services = SERVICE_NEWS_REGISTRY.filter((s) => enabledKeys.has(s.key));
    result.servicesConsidered = services.length;
    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const perCap = options.perServiceCap ?? 30;

    // P13.266 — body-text contractor resolution patterns shared with
    // defenseScoop + thinkTanks. Unlocks brief customer/adversary
    // categorization AND brief v1.13 leadership-flux bumps (which key
    // off service_news signals' touched-Org indexing).
    const patterns = {
      defenseContractors: DEFAULT_DS_CONTRACTOR_PATTERNS,
      maxRelatedPerSignal: 6,
    };

    for (const service of services) {
      try {
        const feed = await fetchServiceFeed(service.rssUrl, log);
        result.apiCallsCount++;
        result.servicesSyncedSuccessfully++;

        const filtered = feed
          .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
          .filter((it) => matchesKeywords(it, config.keywords))
          .filter((it) => !config.leadershipOnly || isLeadershipAnnouncement((it.title || "") + " " + (it.description || "")))
          .slice(0, perCap);

        result.itemsConsidered += feed.length;
        result.itemsMatched += filtered.length;

        if (options.dryRun) continue;

        for (const item of filtered) {
          try {
            const r = await upsertServiceNewsSignal(workspaceId, service, item, patterns, log);
            if (r.action === "created") result.signalsCreated++;
            else if (r.action === "updated") result.signalsUpdated++;
            else result.signalsUnchanged++;
            if (r.leadership && r.action === "created") result.leadershipAnnouncementsCreated++;
          } catch (err) {
            result.errors.push({ serviceKey: service.key, message: (err as Error).message });
          }
        }
      } catch (err) {
        const e = err as Error;
        result.errors.push({ serviceKey: service.key, message: e.message ?? String(err) });
        log?.warn("service_news_feed_failed", { serviceKey: service.key, message: e.message });
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

    log?.info("service_news_sync_completed", {
      workspaceId,
      durationMs: result.durationMs,
      servicesSynced: result.servicesSyncedSuccessfully,
      signalsCreated: result.signalsCreated,
      leadershipAnnouncements: result.leadershipAnnouncementsCreated,
      errors: result.errors.length,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ serviceKey: "_sync_root", message: e.message ?? String(err) });
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
    log?.error("service_news_sync_failed", { workspaceId, message: categorized.message });
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
