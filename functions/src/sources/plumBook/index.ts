// Plum Book / Federal Vacancies — SourceClient implementation (Phase 8.6.10 v1.0)

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, DEFAULT_DEFENSE_AGENCY_PATTERNS, type PlumBookConfig } from "./config";
import { fetchIndex, type VacancyReportCandidate } from "./client";
import {
  fetchAndExtractPdf,
  fetchAndExtractPdfWithPositional,
} from "../../framework/pdfExtractor";
import {
  parseVacancyReportText,
  parseVacancyReportPositional,
} from "./vacancyParser";
import { upsertVacancySignal } from "./mapper";
import { parsePlumBookPositional } from "./quadrennialParser";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import { resolvePersonByName } from "../../framework/personResolver";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";

export const SOURCE_NAME = "plum_book";
export const SOURCE_VERSION = "1.3.0";

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
  /** v1.1: acting-official Person resolution totals. */
  actingOfficialPersonsResolvedTotal: number;
  actingAtEdgesUpsertedTotal: number;
  /** v1.2: count of PDFs where the positional parser returned vacancies
   *  (vs. text-anchor fallback). Only populated when
   *  config.usePositionalExtraction is true. */
  positionalPdfsHit?: number;
  positionalFallbacksToText?: number;
  /** v1.4: vacancies skipped because the agency string didn't match
   *  the defense-tech / DoW market filter (defenseAgenciesOnly=true). */
  vacanciesSkippedOffDomain?: number;
  /** v1.3: quadrennial Plum Book ingestion totals. Only populated when
   *  config.enableQuadrennialPlumBook is true. */
  quadrennialEntriesParsed?: number;
  quadrennialPersonsResolved?: number;
  quadrennialEdgesUpserted?: number;
  quadrennialAgencyOrgsResolved?: number;
  quadrennialFlags?: string[];
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
    actingOfficialPersonsResolvedTotal: 0,
    actingAtEdgesUpsertedTotal: 0,
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

    // v1.4 (2026-06-01) — defense-tech / DoW market filter. Per operator
    // doctrine: "I only need specific information — focus on the defense
    // tech/DoW market." When defenseAgenciesOnly is true (default), skip
    // vacancies whose agency string doesn't substring-match any pattern
    // in defenseAgencyPatterns. Off-domain agencies (HHS, EPA, Agriculture,
    // Education, etc.) never reach the upsert path.
    const defenseAgenciesOnly = config.defenseAgenciesOnly !== false;
    const defensePatterns = (
      config.defenseAgencyPatterns && config.defenseAgencyPatterns.length
        ? config.defenseAgencyPatterns
        : DEFAULT_DEFENSE_AGENCY_PATTERNS
    ).map((p) => p.toLowerCase());
    function isDefenseRelevantAgency(agency: string | null): boolean {
      if (!agency) return false;
      const lc = agency.toLowerCase();
      for (let i = 0; i < defensePatterns.length; i++) {
        if (lc.indexOf(defensePatterns[i]) >= 0) return true;
      }
      return false;
    }

    if (!options.dryRun) {
      const usePositional = !!config.usePositionalExtraction;
      if (usePositional) {
        result.positionalPdfsHit = 0;
        result.positionalFallbacksToText = 0;
      }
      for (const candidate of toFetch) {
        try {
          let extractionText: string;
          let extractionBytes: number;
          let extractionPages: number;
          let positionalItems:
            | import("../../framework/pdfExtractor").PositionalPdfItem[]
            | undefined;
          if (usePositional) {
            const extraction = await fetchAndExtractPdfWithPositional(
              candidate.url,
              {
                source: "plum_book",
                maxBytes: config.maxPdfBytes,
                timeoutMs: config.pdfExtractionTimeoutMs,
                maxTextChars: 1_000_000,
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
                source: "plum_book",
                maxBytes: config.maxPdfBytes,
                timeoutMs: config.pdfExtractionTimeoutMs,
                maxTextChars: 1_000_000,
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

          // Positional first when enabled, fallback to text-anchor regex.
          let parsed = parseVacancyReportText(extractionText, {
            maxVacanciesPerBook: config.maxVacanciesPerPdf,
          });
          if (usePositional && positionalItems && positionalItems.length > 0) {
            const positionalParsed = parseVacancyReportPositional(
              positionalItems,
              {
                maxVacanciesPerBook: config.maxVacanciesPerPdf,
                reportDate: parsed.reportDate ?? candidate.reportDateMs ?? null,
              }
            );
            if (positionalParsed.vacancies.length > 0) {
              parsed = positionalParsed;
              result.positionalPdfsHit = (result.positionalPdfsHit ?? 0) + 1;
            } else {
              result.positionalFallbacksToText =
                (result.positionalFallbacksToText ?? 0) + 1;
            }
          }
          result.vacanciesParsed += parsed.vacancies.length;

          for (const vacancy of parsed.vacancies) {
            // Filter on days_vacant threshold when set
            if (minDaysVacant > 0 && (vacancy.daysVacant ?? 0) < minDaysVacant) {
              continue;
            }
            // v1.4 — defense-tech / DoW market filter
            if (defenseAgenciesOnly && !isDefenseRelevantAgency(vacancy.agency)) {
              result.vacanciesSkippedOffDomain =
                (result.vacanciesSkippedOffDomain ?? 0) + 1;
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
              if (r.actingOfficialPersonResolved) result.actingOfficialPersonsResolvedTotal++;
              if (r.actingAtEdgeUpserted) result.actingAtEdgesUpsertedTotal++;
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

    // v1.3: quadrennial Plum Book ingestion (opt-in).
    // Distinct from the FVRA tracker loop above — runs only when the
    // operator has enableQuadrennialPlumBook: true. Pulls the
    // quadrennial PDF, runs positional extraction, parses each
    // detected position entry, and writes Person + formerly_at Edge
    // to the agency Org. No Signals emitted — Plum Book entries are
    // BASELINE graph data, not events.
    if (
      !options.dryRun &&
      config.enableQuadrennialPlumBook === true &&
      config.quadrennialPdfUrl
    ) {
      result.quadrennialEntriesParsed = 0;
      result.quadrennialPersonsResolved = 0;
      result.quadrennialEdgesUpserted = 0;
      result.quadrennialAgencyOrgsResolved = 0;
      result.quadrennialFlags = [];
      try {
        log?.info("plum_book_quadrennial_sync_started", {
          url: config.quadrennialPdfUrl,
        });
        const extraction = await fetchAndExtractPdfWithPositional(
          config.quadrennialPdfUrl,
          {
            source: "plum_book",
            maxBytes: 100 * 1024 * 1024, // Plum Book is large — up to ~80MB
            timeoutMs: 180_000,
            maxTextChars: 50_000_000,
          },
          log
        );
        result.apiCallsCount++;
        result.pdfsDownloaded++;
        result.pdfBytesDownloaded += extraction.bytes;
        result.pdfPagesProcessed += extraction.pages;

        const parsed = parsePlumBookPositional(extraction.positionalItems, {
          maxEntries: config.maxPositionsPerPlumBookSync ?? 9000,
        });
        result.quadrennialEntriesParsed = parsed.entries.length;
        result.quadrennialFlags = parsed.flags;

        // Resolve agency Orgs lazily — same agency hit many times
        // per Plum Book; cache resolved IDs.
        const agencyOrgIdByName = new Map<string, string>();
        const personProvenance = externalProvenance(
          "plum_book",
          "quadrennial-" + (parsed.publicationYear ?? "unknown"),
          config.quadrennialPdfUrl,
          null,
          Date.now()
        );

        for (const entry of parsed.entries) {
          if (!entry.incumbent || !entry.agency) continue;
          try {
            // Resolve agency Org
            let agencyOrgId = agencyOrgIdByName.get(entry.agency);
            if (!agencyOrgId) {
              const r = await resolveRecipientOrg(
                workspaceId,
                entry.agency,
                null,
                {
                  autoCreate: true,
                  type: "government",
                  emitFuzzyCandidates: false,
                }
              );
              agencyOrgId = r.orgId;
              if (r.created) result.quadrennialAgencyOrgsResolved!++;
              if (agencyOrgId) agencyOrgIdByName.set(entry.agency, agencyOrgId);
            }
            if (!agencyOrgId) continue;
            // Resolve Person
            const pr = await resolvePersonByName(workspaceId, entry.incumbent, {
              autoCreate: true,
              role: entry.position,
              org: entry.agency,
              provenance: personProvenance,
              emitFuzzyCandidates: false,
            });
            if (pr.created) result.quadrennialPersonsResolved!++;
            // Upsert formerly_at Edge (Person → Agency).
            const edgeId =
              "edge_pb_fa_" + pr.personId + "_" + agencyOrgId;
            const edgeSnap = await db
              .ref(wsPath(workspaceId, "edges", edgeId))
              .once("value");
            if (!edgeSnap.exists()) {
              await db.ref(wsPath(workspaceId, "edges", edgeId)).set({
                id: edgeId,
                source: pr.personId,
                target: agencyOrgId,
                label: "formerly_at",
                dir: "to",
                attrs: {
                  position: entry.position,
                  appointmentType: entry.appointmentType,
                  plumBookYear: parsed.publicationYear,
                  sourceSystem: "plum_book",
                  pageNum: entry.pageNum,
                },
                createdAt: Date.now(),
              });
              result.quadrennialEdgesUpserted!++;
            }
          } catch (err) {
            // best-effort; continue past individual failures
            result.errors.push({
              ref: `plumbook:${entry.agency}:${entry.incumbent}`,
              message: (err as Error).message,
            });
          }
        }

        log?.info("plum_book_quadrennial_sync_completed", {
          entries: parsed.entries.length,
          persons: result.quadrennialPersonsResolved,
          edges: result.quadrennialEdgesUpserted,
          agencies: agencyOrgIdByName.size,
          flags: parsed.flags,
        });
      } catch (err) {
        result.errors.push({
          ref: "_quadrennial_plum_book_sync",
          message: (err as Error).message,
        });
        log?.warn?.("plum_book_quadrennial_sync_failed", {
          message: (err as Error).message,
        });
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
      positionalPdfsHit: result.positionalPdfsHit,
      positionalFallbacksToText: result.positionalFallbacksToText,
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
