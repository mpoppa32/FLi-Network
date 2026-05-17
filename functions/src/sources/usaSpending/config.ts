// USAspending source — per-workspace configuration
//
// Per architecture v1 OQ-2: per-workspace watchlist composition. Operator
// populates via Watchlist UX (Settings UI) or directly via RTDB.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface UsaSpendingConfig {
  /** NAICS codes to filter awards by. Empty = no NAICS filter (likely too broad). */
  naics: string[];

  /** Toptier agency names (e.g., "Department of Defense"). Empty = no agency filter. */
  agencies: string[];

  /** Specific competitor Organization IDs to track wins for. */
  competitorOrgs: string[];

  /** How far back to look on initial backfill. Per OQ-1 (LOCKED): 24 months. */
  lookBackMonths: number;

  /** Recompete watch horizon. Per architecture: 18 months default. */
  recompeteWatchHorizonMonths: number;

  /** Award types to include. Default A-D (BPA call, PO, task order, definitive). */
  awardTypeCodes?: string[];

  /** Optional minimum award dollar threshold (filters out low-value noise). */
  minDollarThreshold?: number;

  /** When the config was initialized (via migration Step 4). */
  initializedAt?: number;

  /** Operator-set marker to disable this source on a per-workspace basis. */
  disabled?: boolean;
}

export const DEFAULT_USASPENDING_CONFIG: UsaSpendingConfig = {
  naics: [],
  agencies: [],
  competitorOrgs: [],
  lookBackMonths: 24,
  recompeteWatchHorizonMonths: 18,
  awardTypeCodes: ["A", "B", "C", "D"],
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<UsaSpendingConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "usaspending", "config")).once("value");
  const raw = (snap.val() as Partial<UsaSpendingConfig> | null) ?? {};
  const merged: UsaSpendingConfig = {
    ...DEFAULT_USASPENDING_CONFIG,
    ...raw,
  };
  log?.debug("usaspending_config_loaded", {
    workspaceId,
    naicsCount: merged.naics.length,
    agencyCount: merged.agencies.length,
    competitorCount: merged.competitorOrgs.length,
  });
  return merged;
}

export function validateConfig(config: UsaSpendingConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.naics)) errors.push("naics must be an array");
  if (!Array.isArray(config.agencies)) errors.push("agencies must be an array");
  if (!Array.isArray(config.competitorOrgs)) errors.push("competitorOrgs must be an array");
  if (
    typeof config.lookBackMonths !== "number" ||
    config.lookBackMonths < 1 ||
    config.lookBackMonths > 60
  ) {
    errors.push("lookBackMonths must be between 1 and 60");
  }
  if (config.naics.length === 0 && config.agencies.length === 0 && config.competitorOrgs.length === 0) {
    // Allow but warn — operator can run intentionally broad searches with low thresholds
  }
  return { valid: errors.length === 0, errors };
}
