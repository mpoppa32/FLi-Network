// Plum Book / Federal Vacancies — SourceClient implementation (Phase 8.6.10 v1.0)

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, type PlumBookConfig } from "./config";
import { fetchIndex, type VacancyReportCandidate } from "./client";
import { fetchAndExtractPdf } from "../../framework/pdfExtractor";
import { parseVacancyReportText } from "./vacancyParser";
import { upsertVacancySignal } from "./mapper";

export const SOURCE_NAME = "plum_book";
export const SOURCE_VERSION = "1.0.0";

export interface PlumBookSyncOptions {
  dryRun?: boolean;
  maxPdfsPerSync?: number;
  minDaysVacantOverride?: number;
}

export interface PlumBookSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  pdfCandidatesFound: number;
  pdfCandidatesMatched: number;
  pdfsDownloaded: number;
  pdfsFailed: number;
  pdfBytesDownloaded: number;
  pdfPagesProcessed: number;
  vacanciesParsed: number;
  vacanciesEmitted: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  agencyOrgsResolvedTotal: number;
  pastLimitVacanciesTotal: number;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: PlumBookSyncOptions = {},
  log?: Logger
): Promise<PlumBookSyncResult> {
  const startedAt = Date.now();
  log?.info("plum_book_sync_started", { workspaceId, options });

  const result: PlumBookSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    pdfCandidatesFound: 0,
    pdfCandidatesMatched: 0,
    pdfsDownloaded: 0,
    pdfsFailed: 0,
    pdfBytesDownloaded: 0,
    pdfPagesProcessed: 0,
    vacanciesParsed: 0,
    vacanciesEmitted: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    agencyOrgsResolvedTotal: 0,
    pastLimitVacanciesTotal: 0,
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: PlumBookConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const allCandidates = await fetchIndex(config.indexUrl, log);
    result.apiCallsCount++;
    result.pdfCandidatesFound = allCandidates.length;

    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    // Prioritize: vacancy-report-shaped anchors first, recent first, cap
    const filtered = allCandidates
      .filter((c: VacancyReportCandidate) => c.isVacancyReport)
      .filter((c: VacancyReportCandidate) => !c.reportDateMs || c.reportDateMs >= cutoff)
      .sort((a, b) => (b.reportDateMs || 0) - (a.reportDateMs || 0));
    const maxPdfs = options.maxPdfsPerSync ?? config.maxPdfsPerSync ?? 6;
    const toFetch = filtered.slice(0, maxPdfs);
    result.pdfCandidatesMatched = filtered.length;

    const minDaysVacant =
      options.minDaysVacantOverride ?? config.minDaysVacantToEmit ?? 0;

    if (!options.dryRun) {
      for (const candidate of toFetch) {
        try {
          const extraction = await fetchAndExtractPdf(
            candidate.url,
            {
              source: "plum_book",
              maxBytes: config.maxPdfBytes,
              timeoutMs: config.pdfExtractionTimeoutMs,
              maxTextChars: 1_000_000,
            },
            log
          );
          result.apiCallsCount++;
          result.pdfsDownloaded++;
          result.pdfBytesDownloaded += extraction.bytes;
          result.pdfPagesProcessed += extraction.pages;

          const parsed = parseVacancyReportText(extraction.text, {
            maxVacanciesPerBook: config.maxVacanciesPerPdf,
          });
          result.vacanciesParsed += parsed.vacancies.length;

          for (const vacancy of parsed.vacancies) {
            // Filter on days_vacant threshold when set
            if (minDaysVacant > 0 && (vacancy.daysVacant ?? 0) < minDaysVacant) {
              continue;
            }
            result.vacanciesEmitted++;
            if (vacancy.pastStatutoryLimit) result.pastLimitVacanciesTotal++;
            try {
              const r = await upsertVacancySignal(
                {
                  workspaceId,
                  reportGuid: candidate.guid,
                  reportUrl: candidate.url,
                  reportDate: parsed.reportDate ?? candidate.reportDateMs ?? null,
                },
                vacancy,
                log
              );
              if (r.action === "created") result.signalsCreated++;
              else if (r.action === "updated") result.signalsUpdated++;
              else result.signalsUnchanged++;
              if (r.agencyOrgResolved) result.agencyOrgsResolvedTotal++;
            } catch (err) {
              result.errors.push({
                ref: `vacancy:${candidate.guid}:${vacancy.position}`,
                message: (err as Error).message,
              });
            }
          }
        } catch (err) {
          result.pdfsFailed++;
          result.errors.push({
            ref: `pdf:${candidate.url}`,
            message: (err as Error).message,
          });
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

    log?.info("plum_book_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      pdfsDownloaded: result.pdfsDownloaded,
      pdfsFailed: result.pdfsFailed,
      vacanciesEmitted: result.vacanciesEmitted,
      pastLimitVacanciesTotal: result.pastLimitVacanciesTotal,
      signalsCreated: result.signalsCreated,
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
