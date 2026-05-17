// DoD News source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface DodNewsConfig {
  /** Operator must explicitly enable — default off to avoid surprise volume. */
  enabled: boolean;
  /** Service filters; empty array = all services. e.g., ["ARMY", "AIR FORCE"] */
  services: string[];
  /** Skip awards below this $ threshold. DoD News only publishes >$7.5M but
   *  operator may want stricter. Default 0 (all). */
  minDollar: number;
  /** Confidence floor; below this, parsed announcements are flagged for
   *  operator review rather than auto-creating provisional Awards. */
  confidenceFloor: number;
  /** Operator-set disable. */
  disabled?: boolean;
  initializedAt?: number;
}

export const DEFAULT_DOD_NEWS_CONFIG: DodNewsConfig = {
  enabled: false,
  services: [],
  minDollar: 0,
  confidenceFloor: 0.6,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<DodNewsConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "dod_news", "config")).once("value");
  const raw = (snap.val() as Partial<DodNewsConfig> | null) ?? {};
  const merged: DodNewsConfig = { ...DEFAULT_DOD_NEWS_CONFIG, ...raw };
  log?.debug("dod_news_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    services: merged.services.length,
    minDollar: merged.minDollar,
  });
  return merged;
}

export function validateConfig(config: DodNewsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!Array.isArray(config.services)) errors.push("services must be an array");
  if (typeof config.minDollar !== "number") errors.push("minDollar must be a number");
  if (
    typeof config.confidenceFloor !== "number" ||
    config.confidenceFloor < 0 ||
    config.confidenceFloor > 1
  ) {
    errors.push("confidenceFloor must be 0.0-1.0");
  }
  return { valid: errors.length === 0, errors };
}
