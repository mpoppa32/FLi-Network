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
}

export const DEFAULT_SAMGOV_CONFIG: SamGovConfig = {
  naics: [],
  agencies: [],
  setAsides: [],
  noticeTypes: ["o", "p", "r", "k"], // solicitations + presol + sources sought + combined synopsis
  lookBackMonths: 1,
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
