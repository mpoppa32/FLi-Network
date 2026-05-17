// GAO Reports — SourceClient implementation
//
// Phase 8.6.14 v1.0 — programmatic GAO oversight reports via RSS feed.
// v1.1 — fetches the report PDF, extracts text, lifts findings,
// recommendations, programs, contractors, and agency response posture
// into the Signal attrs. Reuses pdf-parse infrastructure from gaoProtest.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, DEFENSE_KEYWORDS, type GaoReportsConfig } from "./config";
import { fetchGaoReportsFeed } from "./client";
import { upsertGaoReportSignal, matchesKeywords } from "./mapper";

export const SOURCE_NAME = "gao_reports";
export const SOURCE_VERSION = "1.1.0";

export interface GaoReportsSyncOptions {
  itemCap?: number;
  dryRun?: boolean;
  /** v1.1: override config.extractReportPdfs for this run. */
  extractReportPdfs?: boolean;
  /** v1.1: override config.maxPdfsPerSync for this run. */
  maxPdfsPerSync?: number;
}

export interface GaoReportsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  itemsConsidered: number;
  itemsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  // v1.1 PDF extraction metrics
  pdfExtractionsAttempted: number;
  pdfExtractionsSucceeded: number;
  pdfExtractionsFailed: number;
  pdfBytesDownloaded: number;
  pdfPagesProcessed: number;
  findingsExtractedTotal: number;
  recommendationsExtractedTotal: number;
  contractorMentionsTotal: number;
  programMentionsTotal: number;
  agencyResponseConcurCount: number;
  agencyResponseNonConcurCount: number;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: GaoReportsSyncOptions = {},
  log?: Logger
): Promise<GaoReportsSyncResult> {
  const startedAt = Date.now();
  log?.info("gao_reports_sync_started", { workspaceId, options });

  const result: GaoReportsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    itemsConsidered: 0,
    itemsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    pdfExtractionsAttempted: 0,
    pdfExtractionsSucceeded: 0,
    pdfExtractionsFailed: 0,
    pdfBytesDownloaded: 0,
    pdfPagesProcessed: 0,
    findingsExtractedTotal: 0,
    recommendationsExtractedTotal: 0,
    contractorMentionsTotal: 0,
    programMentionsTotal: 0,
    agencyResponseConcurCount: 0,
    agencyResponseNonConcurCount: 0,
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: GaoReportsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const feed = await fetchGaoReportsFeed(log);
    result.apiCallsCount = 1;
    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const itemCap = options.itemCap ?? 80;

    const effectiveKeywords = config.defenseOnly
      ? [...DEFENSE_KEYWORDS, ...config.keywords]
      : config.keywords;

    const relevant = feed
      .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
      .filter((it) => matchesKeywords(it, effectiveKeywords))
      .slice(0, itemCap);

    result.itemsConsidered = feed.length;
    result.itemsMatched = relevant.length;

    const extractPdfs = options.extractReportPdfs ?? config.extractReportPdfs ?? true;
    let pdfBudget = extractPdfs
      ? options.maxPdfsPerSync ?? config.maxPdfsPerSync ?? 25
      : 0;

    if (!options.dryRun) {
      for (const item of relevant) {
        try {
          const wantPdf = pdfBudget > 0;
          const r = await upsertGaoReportSignal(workspaceId, item, log, {
            extractPdf: wantPdf,
            maxPdfBytes: config.maxPdfBytes,
            maxReportTextChars: config.maxReportTextChars,
            pdfExtractionTimeoutMs: config.pdfExtractionTimeoutMs,
          });
          if (r.metrics.pdfAttempted) {
            pdfBudget--;
            result.pdfExtractionsAttempted++;
            // 1 product-page HTML fetch + 1 PDF fetch
            result.apiCallsCount += 2;
            if (r.metrics.pdfSucceeded) {
              result.pdfExtractionsSucceeded++;
              result.pdfBytesDownloaded += r.metrics.pdfBytes;
              result.pdfPagesProcessed += r.metrics.pdfPages;
              result.findingsExtractedTotal += r.metrics.findingsExtracted;
              result.recommendationsExtractedTotal += r.metrics.recommendationsExtracted;
              result.contractorMentionsTotal += r.metrics.contractorsMatched;
              result.programMentionsTotal += r.metrics.programsMatched;
              if (r.metrics.agencyResponse === "concur") result.agencyResponseConcurCount++;
              else if (r.metrics.agencyResponse === "non_concur") result.agencyResponseNonConcurCount++;
            } else {
              result.pdfExtractionsFailed++;
            }
          }
          if (r.action === "created") result.signalsCreated++;
          else if (r.action === "updated") result.signalsUpdated++;
          else result.signalsUnchanged++;
        } catch (err) {
          result.errors.push({ ref: item.guid || item.link, message: (err as Error).message });
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

    log?.info("gao_reports_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      itemsConsidered: result.itemsConsidered,
      itemsMatched: result.itemsMatched,
      signalsCreated: result.signalsCreated,
      pdfExtractionsSucceeded: result.pdfExtractionsSucceeded,
      pdfExtractionsFailed: result.pdfExtractionsFailed,
      findingsExtractedTotal: result.findingsExtractedTotal,
      contractorMentionsTotal: result.contractorMentionsTotal,
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
