// Advisory Boards source — per-workspace configuration
//
// Phase 8.6.8 (T2-8): DSB / DBB / DIB advisory body reports. Each board
// publishes a handful of reports per year on its public report index page.
// Reports drive 12-24 month policy direction; recommendations frequently
// anticipate budget actions. Pattern C (PDF-heavy extraction) using the
// framework/pdfExtractor primitives promoted in the 2026-05-17 arc 10
// refactor.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export type AdvisoryBoardKey = "dsb" | "dbb" | "dib";

export interface AdvisoryBoardSpec {
  key: AdvisoryBoardKey;
  /** Display label used in Signal attrs.boardLabel and the source health UI. */
  label: string;
  /** Long name used for board organization resolution. */
  fullName: string;
  /** Public index page listing reports. v1.0 defaults below; per-workspace
   *  override possible via config.indexUrls. */
  indexUrl: string;
}

export const BOARD_REGISTRY: Record<AdvisoryBoardKey, AdvisoryBoardSpec> = {
  dsb: {
    key: "dsb",
    label: "DSB",
    fullName: "Defense Science Board",
    indexUrl: "https://dsb.cto.mil/reports/",
  },
  dbb: {
    key: "dbb",
    label: "DBB",
    fullName: "Defense Business Board",
    indexUrl: "https://dbb.defense.gov/Reports/",
  },
  dib: {
    key: "dib",
    label: "DIB",
    fullName: "Defense Innovation Board",
    indexUrl: "https://innovation.defense.gov/Library/",
  },
};

export const ALL_BOARD_KEYS: AdvisoryBoardKey[] = ["dsb", "dbb", "dib"];

export interface AdvisoryBoardsConfig {
  /** Default-on (public reports; polite-scrape pattern). */
  enabled: boolean;
  /** Which boards to sync. Default: all three. */
  boards: AdvisoryBoardKey[];
  /** Lookback days for what's considered "recent". Default 540 (~18 months) —
   *  these boards publish slowly; a wide window prevents missing recent
   *  reports during initial workspace onboarding. */
  lookbackDays: number;
  /** Keyword filter (empty = all reports the board publishes). */
  keywords: string[];
  /** v1.0: fetch + parse each report's PDF body. Default true. */
  extractReportPdfs?: boolean;
  /** Max PDF bytes per download. Default 16MB (DSB reports run long). */
  maxPdfBytes?: number;
  /** Max chars of extracted text retained on the Signal attrs. Default 100k. */
  maxReportTextChars?: number;
  /** Per-PDF extraction timeout in ms. Default 60s (advisory reports trend
   *  longer than GAO audits, ~30-80 pages typical). */
  pdfExtractionTimeoutMs?: number;
  /** Cap on PDFs extracted in a single sync run across all boards. Default 18. */
  maxPdfsPerSync?: number;
  /** Per-workspace override of the canonical index URL for any board. */
  indexUrls?: Partial<Record<AdvisoryBoardKey, string>>;
  disabled?: boolean;
  initializedAt?: number;
}

/** Defense keyword list intentionally broad — these boards advise OSD on
 *  defense policy by mandate, so most reports are in-scope. The filter is
 *  more about screening administrative/admin-board-business documents (e.g.,
 *  "Annual Report on FACA Compliance") than topic gating. */
export const ADVISORY_DEFENSE_KEYWORDS = [
  "defense", "DOD", "DoD", "joint", "warfighter", "warfighting",
  "acquisition", "procurement", "sustainment", "operational",
  "army", "navy", "air force", "marine", "space force", "marines",
  "weapon", "munition", "missile", "aircraft", "ship", "submarine",
  "cyber", "intelligence", "ISR", "C2", "JADC2", "NDS", "national defense",
  "industrial base", "supply chain", "DIB", "innovation", "technology",
  "research", "S&T", "RDT&E", "F-35", "B-21", "Sentinel", "Columbia",
  "hypersonic", "directed energy", "AI", "artificial intelligence",
  "autonomous", "uncrewed", "unmanned", "data", "software",
];

export const DEFAULT_ADVISORY_BOARDS_CONFIG: AdvisoryBoardsConfig = {
  enabled: true,
  boards: ALL_BOARD_KEYS,
  lookbackDays: 540,
  keywords: [],
  extractReportPdfs: true,
  maxPdfBytes: 16 * 1024 * 1024,
  maxReportTextChars: 100_000,
  pdfExtractionTimeoutMs: 60_000,
  maxPdfsPerSync: 18,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<AdvisoryBoardsConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "advisory_boards", "config")).once("value");
  const raw = (snap.val() as Partial<AdvisoryBoardsConfig> | null) ?? {};
  const merged: AdvisoryBoardsConfig = {
    ...DEFAULT_ADVISORY_BOARDS_CONFIG,
    ...raw,
    boards: Array.isArray(raw.boards) && raw.boards.length ? raw.boards : ALL_BOARD_KEYS,
  };
  log?.debug("advisory_boards_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    boards: merged.boards,
    keywords: merged.keywords.length,
  });
  return merged;
}

export function validateConfig(
  config: AdvisoryBoardsConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!Array.isArray(config.boards) || config.boards.length === 0) {
    errors.push("boards must be a non-empty array");
  } else {
    for (const b of config.boards) {
      if (!ALL_BOARD_KEYS.includes(b)) errors.push(`unknown board key: ${b}`);
    }
  }
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  return { valid: errors.length === 0, errors };
}

export function resolveIndexUrl(
  config: AdvisoryBoardsConfig,
  board: AdvisoryBoardKey
): string {
  return config.indexUrls?.[board] || BOARD_REGISTRY[board].indexUrl;
}
