// SEC EDGAR source — orchestrator
//
// V1 scope: 8-K material events. V1.1: 10-K/Q + Form 4 + DEF 14A metadata.
// V1.2: Form 4 XML deep parsing (insider name/title/code/shares/price/value/
// sharesOwnedAfter, plus full transaction list). 10-K/Q + DEF 14A deep
// parsing still pending.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { fetchSubmissions, flattenRecentFilings, filterFilings } from "./client";
import { mapFilingToSignal, upsertSignal } from "./mapper";
import { loadConfig, validateConfig, normalizeCik, type SecEdgarConfig } from "./config";

export const SOURCE_NAME = "sec_edgar";
export const SOURCE_VERSION = "1.2.0";

const MECHANICAL_FORM4_CODES = new Set(["F", "G"]);

export interface SecEdgarSyncOptions {
  /** Max filings per CIK to process. Default 30. */
  maxPerCik?: number;
  /** Override lookback days. Default from config. */
  sinceDays?: number;
  dryRun?: boolean;
  /** v1.2: override config.extractForm4Detail for this run. */
  extractForm4Detail?: boolean;
  /** v1.2: override config.maxForm4DeepParsesPerSync for this run. */
  maxForm4DeepParsesPerSync?: number;
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
  // v1.2 Form 4 deep-parse metrics
  form4DeepParseAttempted: number;
  form4DeepParseSucceeded: number;
  form4DeepParseFailed: number;
  form4InsidersResolved: number;
  form4TransactionsParsed: number;
  form4AggregateValue: number;
  form4NetSignedValue: number;
  errors: Array<{ recordId: string; message: string }>;
  durationMs: number;
  apiCallsCount: number;
  sourceVersion: string;
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
    form4DeepParseAttempted: 0,
    form4DeepParseSucceeded: 0,
    form4DeepParseFailed: 0,
    form4InsidersResolved: 0,
    form4TransactionsParsed: 0,
    form4AggregateValue: 0,
    form4NetSignedValue: 0,
    errors: [],
    durationMs: 0,
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
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

    const extractForm4Detail =
      options.extractForm4Detail ?? config.extractForm4Detail ?? true;
    let form4Budget =
      options.maxForm4DeepParsesPerSync ?? config.maxForm4DeepParsesPerSync ?? 60;
    const skipMechanical = !!config.skipMechanicalForm4Codes;

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
          try {
            const form = (filing.form || "").trim().toUpperCase();
            const isForm4 = form === "4" || form === "4/A";
            const wantDeep = isForm4 && extractForm4Detail && form4Budget > 0;
            const dispatch = await mapFilingToSignal(
              workspaceId,
              filing,
              submission,
              wantDeep ? { form4: { extractDeep: true } } : {},
              log
            );
            const signal = dispatch.signal;
            if (dispatch.form4Metrics) {
              const m = dispatch.form4Metrics;
              if (m.attempted) {
                form4Budget--;
                result.form4DeepParseAttempted++;
                result.apiCallsCount++; // one extra HTTP call per attempt
                if (m.succeeded) {
                  result.form4DeepParseSucceeded++;
                  result.form4InsidersResolved += m.insidersResolved;
                  result.form4TransactionsParsed += m.transactionsParsed;
                  result.form4AggregateValue += m.totalValue;
                  result.form4NetSignedValue += m.netSignedValue;
                } else {
                  result.form4DeepParseFailed++;
                }
              }
            }
            if (!signal) continue;
            // v1.2: optionally skip mechanical Form 4 codes (F = tax-withhold,
            // G = gift) from being persisted at all — low signal for BD
            if (
              isForm4 &&
              skipMechanical &&
              signal.attrs &&
              typeof signal.attrs.transactionCode === "string" &&
              MECHANICAL_FORM4_CODES.has(signal.attrs.transactionCode as string)
            ) {
              continue;
            }
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
      sourceVersion: SOURCE_VERSION,
      ciksProcessed: result.ciksProcessed,
      filingsFetched: result.filingsFetched,
      signalsCreated: result.signalsCreated,
      form4DeepParseSucceeded: result.form4DeepParseSucceeded,
      form4DeepParseFailed: result.form4DeepParseFailed,
      form4TransactionsParsed: result.form4TransactionsParsed,
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
