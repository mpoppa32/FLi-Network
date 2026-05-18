// Advisory Boards — SourceClient implementation (Phase 8.6.8 v1.0)
//
// DSB / DBB / DIB advisory body reports — Pattern C (PDF-heavy extraction)
// via HTML index walk + per-report PDF fetch + structured parse.

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
  ADVISORY_DEFENSE_KEYWORDS,
  type AdvisoryBoardsConfig,
} from "./config";
import { fetchBoardIndex, matchesKeywords, type AdvisoryBoardIndexItem } from "./client";
import { upsertAdvisoryReportSignal } from "./mapper";

export const SOURCE_NAME = "advisory_boards";
export const SOURCE_VERSION = "1.0.0";

export interface AdvisoryBoardsSyncOptions {
  itemCap?: number;
  dryRun?: boolean;
  extractReportPdfs?: boolean;
  maxPdfsPerSync?: number;
}

export interface AdvisoryBoardsSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  itemsConsidered: number;
  itemsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  perBoardIndexed: Record<string, number>;
  pdfExtractionsAttempted: number;
  pdfExtractionsSucceeded: number;
  pdfExtractionsFailed: number;
  pdfBytesDownloaded: number;
  pdfPagesProcessed: number;
  findingsExtractedTotal: number;
  recommendationsExtractedTotal: number;
  contractorMentionsTotal: number;
  programMentionsTotal: number;
  agencyMentionsTotal: number;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

function dedupeByGuid(items: AdvisoryBoardIndexItem[]): AdvisoryBoardIndexItem[] {
  const seen = new Set<string>();
  const out: AdvisoryBoardIndexItem[] = [];
  for (const it of items) {
    if (seen.has(it.guid)) continue;
    seen.add(it.guid);
    out.push(it);
  }
  return out;
}

export async function syncWorkspace(
  workspaceId: string,
  options: AdvisoryBoardsSyncOptions = {},
  log?: Logger
): Promise<AdvisoryBoardsSyncResult> {
  const startedAt = Date.now();
  log?.info("advisory_boards_sync_started", { workspaceId, options });

  const result: AdvisoryBoardsSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    itemsConsidered: 0,
    itemsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    perBoardIndexed: {},
    pdfExtractionsAttempted: 0,
    pdfExtractionsSucceeded: 0,
    pdfExtractionsFailed: 0,
    pdfBytesDownloaded: 0,
    pdfPagesProcessed: 0,
    findingsExtractedTotal: 0,
    recommendationsExtractedTotal: 0,
    contractorMentionsTotal: 0,
    programMentionsTotal: 0,
    agencyMentionsTotal: 0,
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: AdvisoryBoardsConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    // Fetch each board's index in sequence — small N (3 boards), and they
    // share a single token bucket so parallel fetches would waste budget
    // without speed gain.
    const allItems: AdvisoryBoardIndexItem[] = [];
    for (const board of config.boards) {
      try {
        const items = await fetchBoardIndex(board, config, log);
        result.apiCallsCount += 1;
        result.perBoardIndexed[board] = items.length;
        allItems.push(...items);
      } catch (err) {
        const e = err as Error;
        log?.warn("advisory_boards_index_fetch_failed", {
          board,
          message: e.message,
        });
        result.errors.push({ ref: `index:${board}`, message: e.message });
      }
    }

    const deduped = dedupeByGuid(allItems);
    result.itemsConsidered = deduped.length;

    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const effectiveKeywords = config.keywords.length
      ? config.keywords
      : ADVISORY_DEFENSE_KEYWORDS;
    const itemCap = options.itemCap ?? 60;

    const relevant = deduped
      .filter((it) => !it.pubDateMs || it.pubDateMs >= cutoff)
      .filter((it) => matchesKeywords(it, effectiveKeywords))
      .slice(0, itemCap);

    result.itemsMatched = relevant.length;

    const extractPdfs = options.extractReportPdfs ?? config.extractReportPdfs ?? true;
    let pdfBudget = extractPdfs
      ? options.maxPdfsPerSync ?? config.maxPdfsPerSync ?? 18
      : 0;

    if (!options.dryRun) {
      for (const item of relevant) {
        try {
          const wantPdf = pdfBudget > 0;
          const r = await upsertAdvisoryReportSignal(workspaceId, item, log, {
            extractPdf: wantPdf,
            maxPdfBytes: config.maxPdfBytes,
            maxReportTextChars: config.maxReportTextChars,
            pdfExtractionTimeoutMs: config.pdfExtractionTimeoutMs,
          });
          if (r.metrics.pdfAttempted) {
            pdfBudget--;
            result.pdfExtractionsAttempted++;
            // 1 report-page HTML fetch + 1 PDF fetch (when product page)
            // or just 1 PDF fetch (when direct PDF link)
            result.apiCallsCount += 2;
            if (r.metrics.pdfSucceeded) {
              result.pdfExtractionsSucceeded++;
              result.pdfBytesDownloaded += r.metrics.pdfBytes;
              result.pdfPagesProcessed += r.metrics.pdfPages;
              result.findingsExtractedTotal += r.metrics.findingsExtracted;
              result.recommendationsExtractedTotal += r.metrics.recommendationsExtracted;
              result.contractorMentionsTotal += r.metrics.contractorsMatched;
              result.programMentionsTotal += r.metrics.programsMatched;
              result.agencyMentionsTotal += r.metrics.agencyMentionsExtracted;
            } else {
              result.pdfExtractionsFailed++;
            }
          }
          if (r.action === "created") result.signalsCreated++;
          else if (r.action === "updated") result.signalsUpdated++;
          else result.signalsUnchanged++;
        } catch (err) {
          result.errors.push({ ref: item.guid, message: (err as Error).message });
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

    log?.info("advisory_boards_sync_completed", {
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
