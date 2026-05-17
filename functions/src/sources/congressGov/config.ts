// Congress.gov source — per-workspace configuration

import { db, sourcePath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";

export interface CongressGovConfig {
  committees: string[]; // committee system codes (e.g., 'hsas00')
  trackedNominationCategories?: string[];
  lookBackMonths: number;
  initializedAt?: number;
  disabled?: boolean;
  // v1.1 additions
  includeNominations?: boolean;
  includeBillActions?: boolean;
  /** Substring keywords against bill title to filter relevant bills */
  billKeywords?: string[];
  /** Bill types to consider (hr, s, hjres, sjres, hconres, sconres, hres, sres) */
  billTypes?: string[];
}

export const DEFAULT_CONGRESSGOV_CONFIG: CongressGovConfig = {
  committees: ["hsas00", "hsap02", "hlig00", "ssas00", "ssap02", "slin00"],
  trackedNominationCategories: ["DoD", "Defense", "Air Force", "Navy", "Army", "Space Force"],
  lookBackMonths: 6,
  includeNominations: true,
  includeBillActions: true,
  billKeywords: ["defense", "armed services", "intelligence", "Pentagon", "national security"],
  billTypes: ["hr", "s", "hjres", "sjres"],
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<CongressGovConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "congress_gov", "config")).once("value");
  const raw = (snap.val() as Partial<CongressGovConfig> | null) ?? {};
  const merged: CongressGovConfig = { ...DEFAULT_CONGRESSGOV_CONFIG, ...raw };
  log?.debug("congressgov_config_loaded", { workspaceId, committeeCount: merged.committees.length });
  return merged;
}

export function validateConfig(config: CongressGovConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.committees)) errors.push("committees must be an array");
  if (typeof config.lookBackMonths !== "number") errors.push("lookBackMonths must be a number");
  return { valid: errors.length === 0, errors };
}
