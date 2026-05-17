// DSCA FMS source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface DscaFmsConfig {
  /** Operator must opt in — default off; FMS volume may not be relevant
   *  to operators focused on domestic-only US gov work. */
  enabled: boolean;
  /** Optional country filter (empty = all). Case-insensitive substring. */
  countries: string[];
  /** Optional prime contractor filter (empty = all). */
  primes: string[];
  /** Minimum dollar threshold; FMS notifications < threshold skipped. Default 0. */
  minDollar: number;
  /** Confidence floor — parsed notifications below this skip creation. */
  confidenceFloor: number;
  disabled?: boolean;
  initializedAt?: number;
}

export const DEFAULT_DSCA_FMS_CONFIG: DscaFmsConfig = {
  enabled: false,
  countries: [],
  primes: [],
  minDollar: 0,
  confidenceFloor: 0.55,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<DscaFmsConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "dsca_fms", "config")).once("value");
  const raw = (snap.val() as Partial<DscaFmsConfig> | null) ?? {};
  const merged: DscaFmsConfig = { ...DEFAULT_DSCA_FMS_CONFIG, ...raw };
  log?.debug("dsca_fms_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    countries: merged.countries.length,
    primes: merged.primes.length,
  });
  return merged;
}

export function validateConfig(config: DscaFmsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!Array.isArray(config.countries)) errors.push("countries must be an array");
  if (!Array.isArray(config.primes)) errors.push("primes must be an array");
  if (typeof config.minDollar !== "number") errors.push("minDollar must be a number");
  if (typeof config.confidenceFloor !== "number" || config.confidenceFloor < 0 || config.confidenceFloor > 1) {
    errors.push("confidenceFloor must be 0.0-1.0");
  }
  return { valid: errors.length === 0, errors };
}
