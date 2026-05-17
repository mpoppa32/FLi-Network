// Service-branch news source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { SERVICE_NEWS_REGISTRY } from "./registry";

export interface ServiceNewsConfig {
  enabledServices: string[];
  /** Lookback window in days; older items skipped. Default 14. */
  lookbackDays: number;
  /** Substring keywords on title/description (empty = no filter) */
  keywords: string[];
  /** If true, only emit Signals for items matching leadership patterns */
  leadershipOnly: boolean;
  disabled?: boolean;
  initializedAt?: number;
}

function defaultEnabled(): string[] {
  return SERVICE_NEWS_REGISTRY.filter((s) => s.defaultOn).map((s) => s.key);
}

export const DEFAULT_SERVICE_NEWS_CONFIG: ServiceNewsConfig = {
  enabledServices: defaultEnabled(),
  lookbackDays: 14,
  keywords: [],
  leadershipOnly: false,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<ServiceNewsConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "service_news", "config")).once("value");
  const raw = (snap.val() as Partial<ServiceNewsConfig> | null) ?? {};
  const merged: ServiceNewsConfig = { ...DEFAULT_SERVICE_NEWS_CONFIG, ...raw };
  log?.debug("service_news_config_loaded", {
    workspaceId,
    enabledServices: merged.enabledServices.length,
    keywords: merged.keywords.length,
    leadershipOnly: merged.leadershipOnly,
  });
  return merged;
}

export function validateConfig(config: ServiceNewsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.enabledServices)) errors.push("enabledServices must be an array");
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  if (typeof config.leadershipOnly !== "boolean") errors.push("leadershipOnly must be boolean");
  return { valid: errors.length === 0, errors };
}
