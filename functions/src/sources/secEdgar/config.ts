// SEC EDGAR source — per-workspace configuration
//
// Per OQ-7 (LOCKED): default CIK watchlist seeds top defense primes.
// Operator can edit per workspace.

import { db, sourcePath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";

export interface SecEdgarConfig {
  /** CIKs to track (10-digit, zero-padded). */
  watchlistCiks: string[];
  /** Filing types to surface. Default 8-K only for v1. */
  filingTypes: string[];
  /** Months of history to backfill on first sync. */
  lookBackMonths: number;
  initializedAt?: number;
  disabled?: boolean;
}

/** Default CIK watchlist per OQ-7 (LOCKED).
 *  LMT, NOC, RTX, GD, BA, LHX, LDOS, BAH, CACI, SAIC, PSN, KBR, MAXM, MANT, PLTR, KTOS, AVAV.
 *  CIKs are 10-digit zero-padded. */
export const DEFAULT_CIK_WATCHLIST = [
  "0000936468", // Lockheed Martin
  "0001133421", // Northrop Grumman
  "0000101829", // RTX (Raytheon Technologies)
  "0000040533", // General Dynamics
  "0000012927", // Boeing
  "0000202058", // L3Harris (formed from merger; older CIK)
  "0001336920", // Leidos
  "0001443669", // Booz Allen Hamilton
  "0001335730", // CACI International
  "0001571123", // SAIC
  "0001260221", // Parsons
  "0000860731", // KBR
  "0001032220", // Maximus
  "0000892537", // ManTech
  "0001321655", // Palantir
  "0001069258", // Kratos
  "0001368622", // AeroVironment
];

export const DEFAULT_SEC_EDGAR_CONFIG: SecEdgarConfig = {
  watchlistCiks: DEFAULT_CIK_WATCHLIST,
  filingTypes: ["8-K"], // v1: 8-K only; v1.1 adds 10-K, 10-Q, 4, DEF 14A
  lookBackMonths: 6,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<SecEdgarConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "sec_edgar", "config")).once("value");
  const raw = (snap.val() as Partial<SecEdgarConfig> | null) ?? {};
  const merged: SecEdgarConfig = {
    ...DEFAULT_SEC_EDGAR_CONFIG,
    ...raw,
    watchlistCiks: raw.watchlistCiks ?? DEFAULT_SEC_EDGAR_CONFIG.watchlistCiks,
    filingTypes: raw.filingTypes ?? DEFAULT_SEC_EDGAR_CONFIG.filingTypes,
  };
  log?.debug("sec_edgar_config_loaded", {
    workspaceId,
    cikCount: merged.watchlistCiks.length,
    filingTypes: merged.filingTypes,
  });
  return merged;
}

export function validateConfig(config: SecEdgarConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.watchlistCiks)) errors.push("watchlistCiks must be an array");
  if (!Array.isArray(config.filingTypes)) errors.push("filingTypes must be an array");
  if (typeof config.lookBackMonths !== "number" || config.lookBackMonths < 1) {
    errors.push("lookBackMonths must be a positive number");
  }
  for (const cik of config.watchlistCiks) {
    if (!/^\d{1,10}$/.test(String(cik))) {
      errors.push(`Invalid CIK format: ${cik}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Normalize a CIK to 10-digit zero-padded string. */
export function normalizeCik(cik: string | number): string {
  return String(cik).padStart(10, "0");
}
