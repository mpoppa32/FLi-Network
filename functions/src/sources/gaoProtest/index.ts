// GAO Bid Protest source — orchestrator
//
// Per signal-sources-v1 Part One.
// v1.0 scope: RSS feed → Signal entities (metadata only).
// v1.1 scope: RSS feed → Signal entities + decision PDF text extraction
//   (outcome, awardee, agency, solicitation + contract numbers, corrective
//   action, dates). Awardee + agency Orgs resolved as subject/related links.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { fetchRssFeed, isBidProtest } from "./client";
import { mapRssItemToSignal, upsertSignal } from "./mapper";
import { loadConfig, validateConfig, type GaoProtestConfig } from "./config";

export const SOURCE_NAME = "gao_protest";
export const SOURCE_VERSION = "1.1.0";

export interface GaoProtestSyncOptions {
  /** Max items to process. Default 100. */
  maxItems?: number;
  /** Dry run (fetch + map, no writes). Default false. */
  dryRun?: boolean;
  /** v1.1: override config.extractDecisionPdfs for this run. */
  extractPdfs?: boolean;
  /** v1.1: override config.maxPdfsPerSync for this run. */
  maxPdfsPerSync?: number;
}

export interface GaoProtestSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  recordsFetched: number;
  protestsIdentified: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  // v1.1 PDF extraction metrics
  pdfExtractionsAttempted: number;
  pdfExtractionsSucceeded: number;
  pdfExtractionsFailed: number;
  pdfBytesDownloaded: number;
  pdfPagesProcessed: number;
  fieldsLiftedTotal: number;
  outcomeDetectedCount: number;
  awardeeResolvedCount: number;
  errors: Array<{ recordId: string; message: string }>;
  durationMs: number;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: GaoProtestSyncOptions = {},
  log?: Logger
): Promise<GaoProtestSyncResult> {
  const startedAt = Date.now();
  log?.info("gao_protest_sync_started", { workspaceId, options });

  const result: GaoProtestSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    recordsFetched: 0,
    protestsIdentified: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    pdfExtractionsAttempted: 0,
    pdfExtractionsSucceeded: 0,
    pdfExtractionsFailed: 0,
    pdfBytesDownloaded: 0,
    pdfPagesProcessed: 0,
    fieldsLiftedTotal: 0,
    outcomeDetectedCount: 0,
    awardeeResolvedCount: 0,
    errors: [],
    durationMs: 0,
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: GaoProtestConfig = await loadConfig(workspaceId, log);
    const v = validateConfig(config);
    if (!v.valid) throw new Error(`Invalid config: ${v.errors.join(", ")}`);
    if (config.disabled) {
      log?.info("gao_protest_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const items = await fetchRssFeed(log);
    result.recordsFetched = items.length;
    result.apiCallsCount = 1;

    const maxItems = options.maxItems ?? 100;
    const extractPdfs = options.extractPdfs ?? config.extractDecisionPdfs ?? true;
    const maxPdfsPerSync = options.maxPdfsPerSync ?? config.maxPdfsPerSync ?? 30;
    let pdfBudget = extractPdfs ? maxPdfsPerSync : 0;

    let processed = 0;
    for (const item of items) {
      if (processed >= maxItems) break;
      if (!isBidProtest(item)) continue;
      result.protestsIdentified++;
      try {
        const wantPdf = pdfBudget > 0;
        const { signal, metrics } = await mapRssItemToSignal(
          workspaceId,
          item,
          {
            extractPdf: wantPdf,
            maxDecisionTextChars: config.maxDecisionTextChars,
            maxPdfBytes: config.maxPdfBytes,
            pdfExtractionTimeoutMs: config.pdfExtractionTimeoutMs,
          },
          log
        );
        if (metrics.pdfAttempted) {
          pdfBudget--;
          result.pdfExtractionsAttempted++;
          // Each PDF involves 1 decision-page fetch + 1 PDF fetch
          result.apiCallsCount += 2;
          if (metrics.pdfSucceeded) {
            result.pdfExtractionsSucceeded++;
            result.pdfBytesDownloaded += metrics.pdfBytes;
            result.pdfPagesProcessed += metrics.pdfPages;
            result.fieldsLiftedTotal += metrics.fieldsLifted;
          } else {
            result.pdfExtractionsFailed++;
          }
        }
        if (!signal) continue;
        if (signal.attrs && signal.attrs.outcome) result.outcomeDetectedCount++;
        if (signal.attrs && signal.attrs.awardeeOrgId) result.awardeeResolvedCount++;
        if (options.dryRun) {
          processed++;
          continue;
        }
        const r = await upsertSignal(workspaceId, signal);
        if (r.action === "created") result.signalsCreated++;
        else if (r.action === "updated") result.signalsUpdated++;
        else result.signalsUnchanged++;
        processed++;
      } catch (err) {
        const e = err as Error;
        result.errors.push({
          recordId: item.guid || item.link || "<unknown>",
          message: e.message ?? String(err),
        });
        log?.warn("gao_protest_item_failed", { guid: item.guid, message: e.message });
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

    log?.info("gao_protest_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      protestsIdentified: result.protestsIdentified,
      signalsCreated: result.signalsCreated,
      signalsUpdated: result.signalsUpdated,
      pdfExtractionsAttempted: result.pdfExtractionsAttempted,
      pdfExtractionsSucceeded: result.pdfExtractionsSucceeded,
      outcomeDetectedCount: result.outcomeDetectedCount,
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
    log?.error("gao_protest_sync_failed", { workspaceId, message: e.message });
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
