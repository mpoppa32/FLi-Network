// GAO Bid Protest source — per-workspace configuration

import { db, sourcePath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";

export interface GaoProtestConfig {
  /** Organization IDs the operator wants to track protests for. Empty = track all. */
  trackedOrgs: string[];
  /** Months of history to consider on first sync. Per OQ-1 (LOCKED). */
  lookBackMonths: number;
  initializedAt?: number;
  disabled?: boolean;
}

export const DEFAULT_GAO_CONFIG: GaoProtestConfig = {
  trackedOrgs: [],
  lookBackMonths: 12,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<GaoProtestConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "gao_protest", "config")).once("value");
  const raw = (snap.val() as Partial<GaoProtestConfig> | null) ?? {};
  const merged: GaoProtestConfig = { ...DEFAULT_GAO_CONFIG, ...raw };
  log?.debug("gao_protest_config_loaded", {
    workspaceId,
    trackedOrgs: merged.trackedOrgs.length,
    lookBackMonths: merged.lookBackMonths,
  });
  return merged;
}

export function validateConfig(config: GaoProtestConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.trackedOrgs)) errors.push("trackedOrgs must be an array");
  if (typeof config.lookBackMonths !== "number" || config.lookBackMonths < 1 || config.lookBackMonths > 60) {
    errors.push("lookBackMonths must be between 1 and 60");
  }
  return { valid: errors.length === 0, errors };
}
