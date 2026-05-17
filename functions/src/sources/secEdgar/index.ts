// SEC EDGAR source — orchestrator
//
// V1 scope: 8-K filings only. For each watchlisted CIK, fetch submission
// history; filter to 8-K filings since lookback; map and upsert as Signal
// entities. 10-K/Q/Form 4/DEF 14A are v1.1 enhancements.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { fetchSubmissions, flattenRecentFilings, filterFilings } from "./client";
import { mapEightKToSignal, upsertSignal } from "./mapper";
import { loadConfig, validateConfig, normalizeCik, type SecEdgarConfig } from "./config";

export const SOURCE_NAME = "sec_edgar";
export const SOURCE_VERSION = "0.1.0";

export interface SecEdgarSyncOptions {
  /** Max filings per CIK to process. Default 30. */
  maxPerCik?: number;
  /** Override lookback days. Default from config. */
  sinceDays?: number;
  dryRun?: boolean;
}

export interface SecEdgarSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  ciksProcessed: number;
  ciksFailed: number;
  filingsFetched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  errors: Array<{ recordId: string; message: string }>;
  durationMs: number;
  apiCallsCount: number;
}

export async function syncWorkspace(
  workspaceId: string,
  options: SecEdgarSyncOptions = {},
  log?: Logger
): Promise<SecEdgarSyncResult> {
  const startedAt = Date.now();
  log?.info("sec_edgar_sync_started", { workspaceId, options });

  const result: SecEdgarSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    ciksProcessed: 0,
    ciksFailed: 0,
    filingsFetched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    errors: [],
    durationMs: 0,
    apiCallsCount: 0,
  };

  try {
    const config: SecEdgarConfig = await loadConfig(workspaceId, log);
    const v = validateConfig(config);
    if (!v.valid) throw new Error(`Invalid config: ${v.errors.join(", ")}`);
    if (config.disabled) {
      log?.info("sec_edgar_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const sinceDays = options.sinceDays ?? Math.min(180, config.lookBackMonths * 30);
    const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    const maxPerCik = options.maxPerCik ?? 30;

    for (const rawCik of config.watchlistCiks) {
      const cik = normalizeCik(rawCik);
      try {
        const submission = await fetchSubmissions(cik, log);
        result.apiCallsCount++;
        const allFilings = flattenRecentFilings(submission);
        const filtered = filterFilings(allFilings, config.filingTypes, sinceMs).slice(0, maxPerCik);
        result.filingsFetched += filtered.length;
        result.ciksProcessed++;

        for (const filing of filtered) {
          if (filing.form !== "8-K") continue; // v1: 8-K only
          try {
            const signal = await mapEightKToSignal(workspaceId, filing, submission);
            if (options.dryRun) continue;
            const r = await upsertSignal(workspaceId, signal);
            if (r.action === "created") result.signalsCreated++;
            else if (r.action === "updated") result.signalsUpdated++;
            else result.signalsUnchanged++;
          } catch (err) {
            const e = err as Error;
            result.errors.push({
              recordId: filing.accessionNumber,
              message: e.message ?? String(err),
            });
            log?.warn("sec_edgar_filing_failed", {
              accession: filing.accessionNumber,
              message: e.message,
            });
          }
        }
      } catch (err) {
        const e = err as Error;
        result.ciksFailed++;
        result.errors.push({
          recordId: `cik:${cik}`,
          message: e.message ?? String(err),
        });
        log?.warn("sec_edgar_cik_failed", { cik, message: e.message });
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

    log?.info("sec_edgar_sync_completed", {
      workspaceId,
      ciksProcessed: result.ciksProcessed,
      filingsFetched: result.filingsFetched,
      signalsCreated: result.signalsCreated,
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
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
