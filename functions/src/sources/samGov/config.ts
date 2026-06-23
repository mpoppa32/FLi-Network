// SAM.gov source — per-workspace configuration

import { db, sourcePath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";

export interface SamGovConfig {
  naics: string[];
  agencies: string[];
  setAsides: string[];
  noticeTypes: string[]; // 'p', 'r', 's', 'k', 'o', 'u', 'a', 'm' etc.
  keywords?: string[];
  excludeKeywords?: string[];
  states?: string[];
  lookBackMonths?: number;
  initializedAt?: number;
  disabled?: boolean;
  /**
   * v1.2 (P13.341) — PSC-category ingest filter. Notices whose classification
   * code's prefix (letter codes → first char, numeric → first 2 digits) is in
   * this list are not ingested as standalone Opportunities. Absent in RTDB →
   * DEFAULT_EXCLUDED_PSC_PREFIXES applies. To run with NO filtering set
   * pscFilterDisabled (RTDB cannot store an empty array, so absence cannot
   * mean "off").
   */
  excludePscPrefixes?: string[];
  pscFilterDisabled?: boolean;
  /**
   * v1.3 (P13.355) — relevance ALLOW-list of full PSC codes (e.g. 6105 electric
   * motors, 1550 drones). Absent → DEFAULT_ALLOWED_PSC_CODES. A notice is
   * ingested only if a title/description keyword OR an allow-listed PSC code
   * matches; this replaces the leaky v1.2 exclude-list. Set pscFilterDisabled
   * to bypass entirely.
   */
  allowPscCodes?: string[];
}

/**
 * v1.2 (P13.341) — default excluded PSC prefixes. Mirrors the client-side
 * window._oppDropPscPrefixes (FLiIntel.html, P13.340) — keep the two lists in
 * sync. Derived from the 2026-06-08 pipeline categorization of the 3,325-opp
 * Atlas lake (~61% in these categories: facility maintenance Z, construction Y,
 * janitorial S, legal R, transport V, rentals W, cleanup F, inspection H/L,
 * training U/M/N/T, leases X, A&E C, social G, medical Q, marine 20, vehicles
 * 23/25, bearings 31, metalworking 34, materials handling 39, refrigeration 41,
 * safety 42, pumps 43, pipe 47, valves 48, shop equip 49, tools 51, fasteners
 * 53, building materials 56, medical 65, chemicals 68/80, furniture/office
 * 71-79, containers 81, clothing 84, food 89, fuels 91, misc 99).
 * REVIEW categories (aircraft 15-17, engines 28/29, transmission 30, comms 58,
 * electrical 59, power 61, instruments 66, software 7A, R&D A, IT D, repair J,
 * weapons 10/13) are deliberately NOT here.
 */
export const DEFAULT_EXCLUDED_PSC_PREFIXES: string[] = [
  "Z", "Y", "S", "R", "V", "W", "F", "H", "L", "U", "M", "N", "T", "X", "C", "G", "Q",
  "20", "23", "25", "31", "34", "39", "41", "42", "43", "47", "48", "49", "51", "53",
  "56", "65", "68", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81",
  "84", "89", "91", "99",
];

/**
 * v1.3 (P13.355) — relevance allow-list. Corsair builds electric motors for
 * drones; the only PSC codes that are reliably on-target are 6105 (Motors,
 * Electrical) and 1550 (Unmanned Aircraft / drones). Everything else earns
 * ingest via RELEVANCE_KEYWORDS (title/description) in index.ts, so the rare
 * drone-ecosystem notice with an off-target PSC (counter-UAS, sUAS) still flows.
 */
export const DEFAULT_ALLOWED_PSC_CODES: string[] = ["6105", "1550"];

export const DEFAULT_SAMGOV_CONFIG: SamGovConfig = {
  naics: [],
  agencies: [],
  setAsides: [],
  noticeTypes: ["o", "p", "r", "k"], // solicitations + presol + sources sought + combined synopsis
  lookBackMonths: 1,
  excludePscPrefixes: DEFAULT_EXCLUDED_PSC_PREFIXES,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<SamGovConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "sam_gov", "config")).once("value");
  const raw = (snap.val() as Partial<SamGovConfig> | null) ?? {};
  const merged: SamGovConfig = { ...DEFAULT_SAMGOV_CONFIG, ...raw };
  log?.debug("samgov_config_loaded", {
    workspaceId,
    naicsCount: merged.naics.length,
    agencyCount: merged.agencies.length,
    noticeTypes: merged.noticeTypes,
  });
  return merged;
}

export function validateConfig(config: SamGovConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.naics)) errors.push("naics must be an array");
  if (!Array.isArray(config.agencies)) errors.push("agencies must be an array");
  if (!Array.isArray(config.noticeTypes)) errors.push("noticeTypes must be an array");
  return { valid: errors.length === 0, errors };
}
