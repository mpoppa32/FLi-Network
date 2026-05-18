// Senate LDA (Lobbying Disclosure Act) — per-workspace configuration
//
// Phase 8.6.9 (T2-9): LD-1 / LD-2 / LD-203 filings via lda.senate.gov/api/v1/.
// Pattern A (REST API with structured parsing). The API is keyless (rate-
// limited to ~60/hour for unauthenticated IPs); registered tokens lift that
// substantially but registration is out of band — keyless v1.0 is enough for
// the polling cadence we use.
//
// BD intelligence value: ties lobbying spend to clients (defense primes,
// adversary companies) and to issues / agencies / specific revolving-door
// lobbyists. Crosses with Congress.gov hearings + SEC EDGAR insider posture
// to show *which competitor is paying which lobbyist on which issue*.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface SenateLdaConfig {
  /** Default-on (public data, keyless API). */
  enabled: boolean;
  /** LDA general_issue_code values to include. Defense primary (DEF). */
  issueCodes: string[];
  /** Filing types to include. LD-2 quarterly reports are the BD-relevant
   *  meat; LD-1 (new registration) and LD-203 (semi-annual contribution
   *  reports) carry less day-to-day signal but are useful for first-time
   *  competitor entry detection. */
  filingTypes: string[];
  /** Lookback days. Defaults to 200 — enough to cover the current quarter
   *  + the previous quarter's late amendments without re-pulling years of
   *  history every weekly run. */
  lookbackDays: number;
  /** Cap on filings ingested per sync. Default 200 — modest, since defense
   *  filings run a few hundred per quarter. */
  maxFilingsPerSync?: number;
  /** Cap on API page-list calls in a single sync. Default 24 (≈600 filings
   *  across pages of 25) to keep keyless-rate respect. */
  maxPagesPerSync?: number;
  disabled?: boolean;
  initializedAt?: number;
}

/** Filing-period to filing-type-code mapping. The LDA API uses two
 *  conventions: filing_period in URLs ("first_quarter") and filing_type
 *  in records ("Q1"). We standardize on filing_type for storage. */
export const DEFENSE_ISSUE_CODES = ["DEF", "INT", "HOM"];

export const DEFAULT_SENATE_LDA_CONFIG: SenateLdaConfig = {
  enabled: true,
  issueCodes: ["DEF"],
  filingTypes: ["Q1", "Q2", "Q3", "Q4", "MY", "YE"],
  lookbackDays: 200,
  maxFilingsPerSync: 200,
  maxPagesPerSync: 24,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<SenateLdaConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "senate_lda", "config")).once("value");
  const raw = (snap.val() as Partial<SenateLdaConfig> | null) ?? {};
  const merged: SenateLdaConfig = {
    ...DEFAULT_SENATE_LDA_CONFIG,
    ...raw,
    issueCodes:
      Array.isArray(raw.issueCodes) && raw.issueCodes.length
        ? raw.issueCodes
        : DEFAULT_SENATE_LDA_CONFIG.issueCodes,
    filingTypes:
      Array.isArray(raw.filingTypes) && raw.filingTypes.length
        ? raw.filingTypes
        : DEFAULT_SENATE_LDA_CONFIG.filingTypes,
  };
  log?.debug("senate_lda_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    issueCodes: merged.issueCodes,
    filingTypes: merged.filingTypes,
  });
  return merged;
}

export function validateConfig(
  config: SenateLdaConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!Array.isArray(config.issueCodes) || config.issueCodes.length === 0) {
    errors.push("issueCodes must be a non-empty array");
  }
  if (!Array.isArray(config.filingTypes) || config.filingTypes.length === 0) {
    errors.push("filingTypes must be a non-empty array");
  }
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  return { valid: errors.length === 0, errors };
}
