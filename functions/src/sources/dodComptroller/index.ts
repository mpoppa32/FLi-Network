// DoD Comptroller — SourceClient implementation (Phase 8.6.3 v1.0)
//
// Walks comptroller.defense.gov/Budget-Materials/, picks the BD-relevant
// R-2 / P-1 PDFs for configured services + fiscal years, fetches each PDF
// via framework/pdfExtractor, parses out PE entries, emits one
// budget_change Signal per PE.
//
// v1.0 is a "PE catalog" baseline pass — no FY funding extraction. v1.1
// will add table-aware funding extraction and year-over-year delta detection.

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
  type DodComptrollerConfig,
  type BudgetBookType,
  type ServiceSlug,
} from "./config";
import {
  fetchBudgetIndex,
  fetchSubIndexLinks,
  resolveLatestFiscalYear,
  type BudgetBookCandidate,
} from "./client";
import {
  fetchAndExtractPdf,
  fetchAndExtractPdfWithPositional,
  type PositionalPdfItem,
} from "../../framework/pdfExtractor";
import { parseBudgetBookText } from "./budgetParser";
import { upsertBudgetPeSignal } from "./mapper";

export const SOURCE_NAME = "dod_comptroller";
export const SOURCE_VERSION = "1.0.0";

export interface DodComptrollerSyncOptions {
  dryRun?: boolean;
  maxPdfsPerSync?: number;
  fiscalYearsOverride?: string[];
}

export interface DodComptrollerSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  indexPagesWalked: number;
  pdfCandidatesFound: number;
  pdfCandidatesMatched: number;
  pdfsDownloaded: number;
  pdfsFailed: number;
  pdfBytesDownloaded: number;
  pdfPagesProcessed: number;
  programElementsParsed: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  serviceOrgsResolvedTotal: number;
  perBookType: Record<string, number>;
  perService: Record<string, number>;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

function filterCandidates(
  candidates: BudgetBookCandidate[],
  bookTypes: BudgetBookType[],
  services: ServiceSlug[],
  fiscalYears: string[]
): BudgetBookCandidate[] {
  const bookSet = new Set<string>(bookTypes);
  const svcSet = new Set<string>(services);
  const fySet = new Set<string>(fiscalYears);
  return candidates.filter((c) => {
    if (!c.bookType || !bookSet.has(c.bookType)) return false;
    if (!c.service || !svcSet.has(c.service)) return false;
    if (!c.fiscalYear || !fySet.has(c.fiscalYear)) return false;
    return true;
  });
}

export async function syncWorkspace(
  workspaceId: string,
  options: DodComptrollerSyncOptions = {},
  log?: Logger
): Promise<DodComptrollerSyncResult> {
  const startedAt = Date.now();
  log?.info("dod_comptroller_sync_started", { workspaceId, options });

  const result: DodComptrollerSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    indexPagesWalked: 0,
    pdfCandidatesFound: 0,
    pdfCandidatesMatched: 0,
    pdfsDownloaded: 0,
    pdfsFailed: 0,
    pdfBytesDownloaded: 0,
    pdfPagesProcessed: 0,
    programElementsParsed: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    serviceOrgsResolvedTotal: 0,
    perBookType: {},
    perService: {},
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: DodComptrollerConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    // Walk the index page + one level of sub-index pages, collecting all
    // PDF candidates.
    const rootCandidates = await fetchBudgetIndex(config.indexUrl, log);
    result.apiCallsCount++;
    result.indexPagesWalked++;
    let allCandidates: BudgetBookCandidate[] = [...rootCandidates];

    // Sub-index walk — surface PDFs that live one click off the root.
    try {
      const subLinks = await fetchSubIndexLinks(config.indexUrl, log);
      result.apiCallsCount++;
      result.indexPagesWalked++;
      for (const sub of subLinks.slice(0, 8)) {
        try {
          const subCandidates = await fetchBudgetIndex(sub, log);
          result.apiCallsCount++;
          result.indexPagesWalked++;
          allCandidates = allCandidates.concat(subCandidates);
        } catch (err) {
          result.errors.push({
            ref: `subindex:${sub}`,
            message: (err as Error).message,
          });
        }
      }
    } catch (err) {
      log?.debug("dod_comptroller_subindex_skip", { message: (err as Error).message });
    }

    // Dedupe candidates by URL
    const seenUrls = new Set<string>();
    allCandidates = allCandidates.filter((c) => {
      if (seenUrls.has(c.url)) return false;
      seenUrls.add(c.url);
      return true;
    });
    result.pdfCandidatesFound = allCandidates.length;

    // Resolve "latest" fiscal-year request to the most-recent FY found.
    const requestedFys = options.fiscalYearsOverride ?? config.fiscalYears;
    const fyList: string[] = [];
    for (const fy of requestedFys) {
      if (fy === "latest") {
        const latest = resolveLatestFiscalYear(allCandidates);
        if (latest) fyList.push(latest);
      } else {
        fyList.push(fy);
      }
    }
    // Dedupe while preserving order
    const fySetOrdered: string[] = [];
    const fySeen = new Set<string>();
    for (const fy of fyList) {
      if (!fySeen.has(fy)) {
        fySeen.add(fy);
        fySetOrdered.push(fy);
      }
    }

    const filtered = filterCandidates(
      allCandidates,
      config.bookTypes,
      config.services,
      fySetOrdered
    );
    result.pdfCandidatesMatched = filtered.length;

    const maxPdfs = options.maxPdfsPerSync ?? config.maxPdfsPerSync ?? 12;
    const toFetch = filtered.slice(0, maxPdfs);

    if (!options.dryRun) {
      for (const candidate of toFetch) {
        try {
          const usePositional = !!config.usePositionalExtraction;
          let extractionText: string;
          let extractionBytes: number;
          let extractionPages: number;
          let positionalItems: PositionalPdfItem[] | undefined;
          if (usePositional) {
            const extraction = await fetchAndExtractPdfWithPositional(
              candidate.url,
              {
                source: "dod_comptroller",
                maxBytes: config.maxPdfBytes,
                timeoutMs: config.pdfExtractionTimeoutMs,
                maxTextChars: 8_000_000,
              },
              log
            );
            extractionText = extraction.text;
            extractionBytes = extraction.bytes;
            extractionPages = extraction.pages;
            positionalItems = extraction.positionalItems;
          } else {
            const extraction = await fetchAndExtractPdf(
              candidate.url,
              {
                source: "dod_comptroller",
                maxBytes: config.maxPdfBytes,
                timeoutMs: config.pdfExtractionTimeoutMs,
                maxTextChars: 8_000_000,
              },
              log
            );
            extractionText = extraction.text;
            extractionBytes = extraction.bytes;
            extractionPages = extraction.pages;
          }
          result.apiCallsCount++;
          result.pdfsDownloaded++;
          result.pdfBytesDownloaded += extractionBytes;
          result.pdfPagesProcessed += extractionPages;

          const parsed = parseBudgetBookText(extractionText, {
            maxPesPerBook: config.maxPesPerPdf,
            maxNarrativeChars: config.maxPeNarrativeChars,
            positionalItems,
          });
          result.programElementsParsed += parsed.programElements.length;

          for (const pe of parsed.programElements) {
            try {
              const r = await upsertBudgetPeSignal(
                {
                  workspaceId,
                  service: candidate.service!,
                  fiscalYear: candidate.fiscalYear!,
                  bookType: candidate.bookType!,
                  bookUrl: candidate.url,
                  bookFilename: candidate.filename,
                },
                pe,
                log
              );
              if (r.action === "created") result.signalsCreated++;
              else if (r.action === "updated") result.signalsUpdated++;
              else result.signalsUnchanged++;
              if (r.serviceOrgResolved) result.serviceOrgsResolvedTotal++;

              result.perBookType[candidate.bookType!] =
                (result.perBookType[candidate.bookType!] || 0) + 1;
              result.perService[candidate.service!] =
                (result.perService[candidate.service!] || 0) + 1;
            } catch (err) {
              result.errors.push({
                ref: `pe:${candidate.service}:${pe.pe}`,
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

    log?.info("dod_comptroller_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      pdfsDownloaded: result.pdfsDownloaded,
      pdfsFailed: result.pdfsFailed,
      programElementsParsed: result.programElementsParsed,
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
