// DoD Comptroller — per-workspace configuration
//
// Phase 8.6.3 (T2-3) v1.0: program element (PE) discovery + indexing from
// the DoD Comptroller's annual Budget Materials portal (comptroller.defense
// .gov/Budget-Materials/). v1.0 walks the HTML index, fetches R-2 / P-1
// PDFs, extracts PE numbers + titles + service + book-type metadata, and
// emits one budget_change Signal per (service, PE, fy, bookType) tuple.
//
// v1.0 does NOT attempt to extract structured FY funding tables; tabular
// reconstruction from PDF text is a v1.1 problem requiring positional
// extractor work. v1.0 ships the PE catalog, which is enough to:
//   - search by PE number across budget books
//   - cross-link SAM.gov / Congress.gov mentions of a PE
//   - establish the baseline for v1.1 year-over-year delta detection

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

/** DoD budget book types — the BD-relevant subset. v1.0 ships R-2 and P-1;
 *  O-1 (Operations & Maintenance) and M-1 (MILCON) are v1.1 additions. */
export type BudgetBookType = "R-2" | "R-2A" | "R-3" | "P-1" | "P-5" | "P-40" | "O-1" | "M-1";

export const DEFAULT_BOOK_TYPES: BudgetBookType[] = ["R-2", "P-1"];

/** Service slugs as they appear in budget book filenames and URLs. */
export type ServiceSlug =
  | "army"
  | "navy"
  | "air_force"
  | "marine_corps"
  | "space_force"
  | "defense_wide";

/** Human-readable service labels (for Org resolution + UI). */
export const SERVICE_LABELS: Record<ServiceSlug, string> = {
  army: "Department of the Army",
  navy: "Department of the Navy",
  air_force: "Department of the Air Force",
  marine_corps: "United States Marine Corps",
  space_force: "United States Space Force",
  defense_wide: "Defense-Wide (OSD / DARPA / MDA / DLA / DISA)",
};

export interface DodComptrollerConfig {
  /** Default-on (public). */
  enabled: boolean;
  /** Index page to walk. Default points at the budget-materials landing;
   *  per-workspace override possible if DoD reorganizes the site. */
  indexUrl: string;
  /** Fiscal years to include. v1.0 default: ["latest"] which resolves to
   *  the most-recent FY found on the index page. Operator can pin to
   *  specific years like ["2026"] for replay/audit. */
  fiscalYears: string[];
  /** Budget book types to extract. Default: R-2 + P-1. */
  bookTypes: BudgetBookType[];
  /** Services to include. Default: all. */
  services: ServiceSlug[];
  /** Hard cap on PDF downloads per sync. Default 12 — budget books are
   *  large (often 100MB+ aggregated); the cap keeps weekly cost bounded. */
  maxPdfsPerSync?: number;
  /** Max PDF bytes per download. Default 80MB — service-wide R-2 books
   *  routinely exceed 50MB. */
  maxPdfBytes?: number;
  /** Per-PDF extraction timeout in ms. Default 120s — budget books are
   *  the largest defense PDFs we touch. */
  pdfExtractionTimeoutMs?: number;
  /** Max chars of extracted text retained per PE Signal. Default 4000 —
   *  enough for the PE narrative paragraph without bloating RTDB. */
  maxPeNarrativeChars?: number;
  /** Cap on PE Signals emitted per PDF. Default 400 — a service-wide R-2
   *  has 200-300 PE entries; the cap protects against runaway extraction
   *  on a malformed PDF. */
  maxPesPerPdf?: number;
  disabled?: boolean;
  initializedAt?: number;
}

export const DEFAULT_DOD_COMPTROLLER_CONFIG: DodComptrollerConfig = {
  enabled: true,
  indexUrl: "https://comptroller.defense.gov/Budget-Materials/",
  fiscalYears: ["latest"],
  bookTypes: DEFAULT_BOOK_TYPES,
  services: ["army", "navy", "air_force", "marine_corps", "space_force", "defense_wide"],
  maxPdfsPerSync: 12,
  maxPdfBytes: 80 * 1024 * 1024,
  pdfExtractionTimeoutMs: 120_000,
  maxPeNarrativeChars: 4000,
  maxPesPerPdf: 400,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<DodComptrollerConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "dod_comptroller", "config")).once("value");
  const raw = (snap.val() as Partial<DodComptrollerConfig> | null) ?? {};
  const merged: DodComptrollerConfig = {
    ...DEFAULT_DOD_COMPTROLLER_CONFIG,
    ...raw,
    fiscalYears:
      Array.isArray(raw.fiscalYears) && raw.fiscalYears.length
        ? raw.fiscalYears
        : DEFAULT_DOD_COMPTROLLER_CONFIG.fiscalYears,
    bookTypes:
      Array.isArray(raw.bookTypes) && raw.bookTypes.length
        ? raw.bookTypes
        : DEFAULT_DOD_COMPTROLLER_CONFIG.bookTypes,
    services:
      Array.isArray(raw.services) && raw.services.length
        ? raw.services
        : DEFAULT_DOD_COMPTROLLER_CONFIG.services,
  };
  log?.debug("dod_comptroller_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    fiscalYears: merged.fiscalYears,
    bookTypes: merged.bookTypes,
    services: merged.services,
  });
  return merged;
}

export function validateConfig(
  config: DodComptrollerConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!config.indexUrl || typeof config.indexUrl !== "string") {
    errors.push("indexUrl must be a non-empty string");
  }
  if (!Array.isArray(config.fiscalYears) || config.fiscalYears.length === 0) {
    errors.push("fiscalYears must be a non-empty array");
  }
  if (!Array.isArray(config.bookTypes) || config.bookTypes.length === 0) {
    errors.push("bookTypes must be a non-empty array");
  }
  if (!Array.isArray(config.services) || config.services.length === 0) {
    errors.push("services must be a non-empty array");
  }
  return { valid: errors.length === 0, errors };
}
