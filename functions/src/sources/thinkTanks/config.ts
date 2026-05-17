// Think tank source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { THINK_TANK_REGISTRY } from "./registry";

export interface ThinkTankConfig {
  /** Tank keys the operator wants to track. Empty = all defaultOn:true. */
  enabledTanks: string[];
  /** Lookback window in days — older items skipped. Default 30. */
  lookbackDays: number;
  /** Optional keyword filter (case-insensitive substring on title+description) */
  keywords: string[];
  /** Operator-set disable */
  disabled?: boolean;
  initializedAt?: number;
}

function defaultEnabledTanks(): string[] {
  return THINK_TANK_REGISTRY.filter((t) => t.defaultOn).map((t) => t.key);
}

export const DEFAULT_THINK_TANK_CONFIG: ThinkTankConfig = {
  enabledTanks: defaultEnabledTanks(),
  lookbackDays: 30,
  keywords: [],
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<ThinkTankConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "think_tank", "config")).once("value");
  const raw = (snap.val() as Partial<ThinkTankConfig> | null) ?? {};
  const merged: ThinkTankConfig = { ...DEFAULT_THINK_TANK_CONFIG, ...raw };
  log?.debug("think_tank_config_loaded", {
    workspaceId,
    enabledTanks: merged.enabledTanks.length,
    keywords: merged.keywords.length,
  });
  return merged;
}

export function validateConfig(config: ThinkTankConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.enabledTanks)) errors.push("enabledTanks must be an array");
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  return { valid: errors.length === 0, errors };
}
