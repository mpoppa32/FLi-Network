// State Department source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { STATE_DEPARTMENT_REGISTRY } from "./registry";

export interface StateDepartmentConfig {
  /** Feed keys the operator wants to track. Empty = all defaultOn:true. */
  enabledFeeds: string[];
  /** Lookback window in days — older items skipped. Default 30. */
  lookbackDays: number;
  /** Optional keyword filter (case-insensitive substring on title+description) */
  keywords: string[];
  /** Cap items per sync per feed. Default 60. */
  maxItemsPerFeed?: number;
  /** Operator-set disable. */
  disabled?: boolean;
  initializedAt?: number;
}

function defaultEnabledFeeds(): string[] {
  return STATE_DEPARTMENT_REGISTRY.filter((f) => f.defaultOn).map((f) => f.key);
}

export const DEFAULT_STATE_DEPARTMENT_CONFIG: StateDepartmentConfig = {
  enabledFeeds: defaultEnabledFeeds(),
  lookbackDays: 30,
  keywords: [],
  maxItemsPerFeed: 60,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<StateDepartmentConfig> {
  const snap = await db
    .ref(sourcePath(workspaceId, "state_department", "config"))
    .once("value");
  const raw = (snap.val() as Partial<StateDepartmentConfig> | null) ?? {};
  const merged: StateDepartmentConfig = {
    ...DEFAULT_STATE_DEPARTMENT_CONFIG,
    ...raw,
  };
  log?.debug("state_department_config_loaded", {
    workspaceId,
    enabledFeeds: merged.enabledFeeds.length,
    keywords: merged.keywords.length,
    lookbackDays: merged.lookbackDays,
  });
  return merged;
}

export function validateConfig(
  config: StateDepartmentConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.enabledFeeds))
    errors.push("enabledFeeds must be an array");
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (
    typeof config.lookbackDays !== "number" ||
    config.lookbackDays < 1 ||
    config.lookbackDays > 365
  ) {
    errors.push("lookbackDays must be 1-365");
  }
  return { valid: errors.length === 0, errors };
}
