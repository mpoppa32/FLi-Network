// GAO Reports source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface GaoReportsConfig {
  /** Default-on (RSS is lightweight; reports themselves are public). */
  enabled: boolean;
  /** Lookback days for what's considered "recent". Default 60. */
  lookbackDays: number;
  /** Keyword filter (empty = all). Substring match on title + description. */
  keywords: string[];
  /** If true, restrict to defense-relevant keywords by default. */
  defenseOnly: boolean;
  disabled?: boolean;
  initializedAt?: number;
}

export const DEFENSE_KEYWORDS = [
  "defense","DOD","army","navy","air force","marine","space force",
  "weapon","missile","aircraft","ship","cyber","intelligence",
  "DARPA","missile defense","sustainment","procurement","acquisition",
  "F-35","Sentinel","Columbia","B-21","KC-46","CCA","NGAD"
];

export const DEFAULT_GAO_REPORTS_CONFIG: GaoReportsConfig = {
  enabled: true,
  lookbackDays: 60,
  keywords: [],
  defenseOnly: true,
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<GaoReportsConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "gao_reports", "config")).once("value");
  const raw = (snap.val() as Partial<GaoReportsConfig> | null) ?? {};
  const merged: GaoReportsConfig = { ...DEFAULT_GAO_REPORTS_CONFIG, ...raw };
  log?.debug("gao_reports_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    defenseOnly: merged.defenseOnly,
    keywords: merged.keywords.length,
  });
  return merged;
}

export function validateConfig(config: GaoReportsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (typeof config.defenseOnly !== "boolean") errors.push("defenseOnly must be boolean");
  return { valid: errors.length === 0, errors };
}
