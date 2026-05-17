// FACA source — per-workspace configuration
//
// The operator names committees they want to track. The sync resolves names
// to committee IDs on first run; once resolved, sync uses IDs directly.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { FACA_DEFAULT_API_BASE } from "./client";

export interface FacaConfig {
  /** Committee names the operator wants to track (e.g., "Defense Business Board"). */
  committeeNames: string[];

  /** Resolved committee IDs (populated by sync, persisted across runs). */
  committeeIds: string[];

  /** Optional API base override if facadatabase.gov restructures. */
  apiBase?: string;

  /** How far back to look for new meetings on each sync (days). Default: 90. */
  meetingsLookbackDays: number;

  /** Operator marker to disable this source on a per-workspace basis. */
  disabled?: boolean;

  /** When the config was initialized. */
  initializedAt?: number;
}

export const DEFAULT_FACA_CONFIG: FacaConfig = {
  committeeNames: [
    "Defense Business Board",
    "Defense Science Board",
    "Defense Innovation Board",
    "Defense Policy Board",
  ],
  committeeIds: [],
  meetingsLookbackDays: 90,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<FacaConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "faca", "config")).once("value");
  const raw = (snap.val() as Partial<FacaConfig> | null) ?? {};
  const merged: FacaConfig = {
    ...DEFAULT_FACA_CONFIG,
    ...raw,
    apiBase: raw.apiBase || FACA_DEFAULT_API_BASE,
  };
  log?.debug("faca_config_loaded", {
    workspaceId,
    committeeNamesCount: merged.committeeNames.length,
    committeeIdsCount: merged.committeeIds.length,
    disabled: !!merged.disabled,
  });
  return merged;
}

export async function saveResolvedIds(
  workspaceId: string,
  ids: string[],
  log?: Logger
): Promise<void> {
  await db.ref(sourcePath(workspaceId, "faca", "config", "committeeIds")).set(ids);
  log?.debug("faca_resolved_ids_saved", { workspaceId, count: ids.length });
}

export function validateConfig(config: FacaConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.committeeNames)) errors.push("committeeNames must be an array");
  if (!Array.isArray(config.committeeIds)) errors.push("committeeIds must be an array");
  if (typeof config.meetingsLookbackDays !== "number" || config.meetingsLookbackDays < 1) {
    errors.push("meetingsLookbackDays must be a positive number");
  }
  return { valid: errors.length === 0, errors };
}
