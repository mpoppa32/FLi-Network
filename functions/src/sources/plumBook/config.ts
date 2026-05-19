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
  return { valid: errors.length === 0, errors };
}
