// Plum Book + Federal Vacancies — per-workspace configuration
//
// Phase 8.6.10 (T2-10) v1.0: GAO Federal Vacancies Reform Act (FVRA)
// reports. The GAO maintains an annual list of vacant Senate-confirmable
// positions with designated acting officials and days-past-statutory-limit
// status. v1.0 walks the GAO FVRA index page, fetches the most-recent
// vacancy reports, and emits vacancy_alert Signals per detected entry.
//
// Plum Book itself (plumbook.gpo.gov, published every 4 years after a
// Presidential election) is deferred to v1.1 — the FVRA tracker is the
// higher-frequency, higher-BD-value subset.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface PlumBookConfig {
  /** Default-on (public data). */
  enabled: boolean;
  /** GAO FVRA index page URL. Per-workspace override available if GAO
   *  reorganizes. */
  indexUrl: string;
  /** Lookback days for vacancy reports. Default 365 — FVRA reports
   *  trickle in throughout the year as agency designations change. */
  lookbackDays: number;
  /** Max PDFs to extract per sync. Default 6 — vacancy reports are
   *  modest size and we mainly want the most recent. */
  maxPdfsPerSync?: number;
  /** Max PDF bytes per download. Default 12MB. */
  maxPdfBytes?: number;
  /** Per-PDF extraction timeout in ms. Default 45s. */
  pdfExtractionTimeoutMs?: number;
  /** Cap on vacancy_alert Signals emitted per PDF. Default 200 — single
   *  annual reports can list 100-150 positions. */
  maxVacanciesPerPdf?: number;
  /** Only emit vacancy_alert Signals where days_vacant > this threshold
   *  (0 = emit all). The FVRA statutory limit is 210 days; higher values
   *  filter to genuinely-past-deadline vacancies. */
  minDaysVacantToEmit?: number;
  /** v1.2 (opt-in): use positional PDF extraction (pdfjs-via-pdf-parse
   *  with the per-page render hook) to reconstruct tabular FVRA layouts.
   *  Mirrors the dod_comptroller v1.2 pattern. When true the parser runs
   *  the positional table-row reconstruction FIRST and only falls back to
   *  the text-anchor regex path when the positional pass returns zero
   *  vacancies. Default false — operator opt-in after validating against
   *  the current GAO publication format. */
  usePositionalExtraction?: boolean;
  /** v1.3 (opt-in): ALSO sync the actual Plum Book from plumbook.gpo.gov
   *  (published every 4 years post-Presidential election). Distinct
   *  from the FVRA tracker — Plum Book lists every PAS-confirmable
   *  political appointee historically, providing baseline data for the
   *  revolving-door (v1.17 DOOR) and acting-leadership (v1.21 ACTING)
   *  axes. Default off; opt-in because it's high-volume (one Plum Book
   *  has ~9000 positions) and only refreshes every 4 years. */
  enableQuadrennialPlumBook?: boolean;
  /** v1.3: URL for the current Plum Book PDF. Operator override for
   *  when GPO publishes the next quadrennial edition with a new URL. */
  quadrennialPdfUrl?: string;
  /** v1.3: cap on positions ingested per Plum Book sync. Default 9000
   *  (full publication). Operator can lower for targeted ingestion. */
  maxPositionsPerPlumBookSync?: number;
  disabled?: boolean;
  initializedAt?: number;
}

export const DEFAULT_PLUM_BOOK_CONFIG: PlumBookConfig = {
  enabled: true,
  indexUrl: "https://www.gao.gov/legal/other-legal-work/federal-vacancies-reform-act",
  lookbackDays: 365,
  maxPdfsPerSync: 6,
  maxPdfBytes: 12 * 1024 * 1024,
  pdfExtractionTimeoutMs: 45_000,
  maxVacanciesPerPdf: 200,
  minDaysVacantToEmit: 0,
  usePositionalExtraction: false,
  enableQuadrennialPlumBook: false,
  quadrennialPdfUrl: "https://www.govinfo.gov/content/pkg/GPO-PLUMBOOK-2024/pdf/GPO-PLUMBOOK-2024.pdf",
  maxPositionsPerPlumBookSync: 9000,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<PlumBookConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "plum_book", "config")).once("value");
  const raw = (snap.val() as Partial<PlumBookConfig> | null) ?? {};
  const merged: PlumBookConfig = { ...DEFAULT_PLUM_BOOK_CONFIG, ...raw };
  log?.debug("plum_book_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    indexUrl: merged.indexUrl,
  });
  return merged;
}

export function validateConfig(
  config: PlumBookConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!config.indexUrl) errors.push("indexUrl must be set");
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  if (
    config.enableQuadrennialPlumBook === true &&
    (!config.quadrennialPdfUrl || !config.quadrennialPdfUrl.startsWith("http"))
  ) {
    errors.push("quadrennialPdfUrl must be a valid URL when enableQuadrennialPlumBook is true");
  }
  if (
    config.maxPositionsPerPlumBookSync !== undefined &&
    (typeof config.maxPositionsPerPlumBookSync !== "number" ||
      config.maxPositionsPerPlumBookSync < 1 ||
      config.maxPositionsPerPlumBookSync > 20000)
  ) {
    errors.push("maxPositionsPerPlumBookSync must be 1-20000 if set");
  }
  return { valid: errors.length === 0, errors };
}
