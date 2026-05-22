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
  /** v1.2: defense contractor names to match against item title +
   *  description. Each match resolves to a company-type Org via
   *  orgResolver and lands in Signal.relatedIds. Empty/unset = use the
   *  v1.1 baked-in default list (Lockheed / Boeing / RTX / Northrop /
   *  GD / L3Harris / BAE / Leidos / Booz Allen / SAIC / CACI / ManTech
   *  / KBR / Parsons / Peraton / Palantir / Anduril / Shield AI). */
  defenseContractorPatterns?: string[];
  /** v1.2: foreign-government / country names. Each match resolves to
   *  a government-type Org. Empty/unset = use the v1.1 baked-in default
   *  list of 21 BD-relevant countries. */
  foreignGovernmentPatterns?: string[];
  /** v1.2: cap on body-mention Orgs added to a single Signal's
   *  relatedIds. Default 8. Higher means more touched-entity surface
   *  for that Signal; lower keeps noise bounded. */
  maxRelatedPerSignal?: number;
  /** Operator-set disable. */
  disabled?: boolean;
  initializedAt?: number;
}

function defaultEnabledFeeds(): string[] {
  return STATE_DEPARTMENT_REGISTRY.filter((f) => f.defaultOn).map((f) => f.key);
}

/** Default contractor patterns. Sourced from v1.1's hardcoded list so
 *  cold-start operators get sensible coverage without configuration. */
export const DEFAULT_DEFENSE_CONTRACTOR_PATTERNS: string[] = [
  "Lockheed Martin",
  "Boeing",
  "Raytheon",
  "RTX",
  "Northrop Grumman",
  "General Dynamics",
  "L3Harris",
  "BAE Systems",
  "Leidos",
  "Booz Allen",
  "SAIC",
  "CACI",
  "ManTech",
  "KBR",
  "Parsons",
  "Peraton",
  "Palantir",
  "Anduril",
  "Shield AI",
];

/** Default foreign-government patterns. Same provenance. */
export const DEFAULT_FOREIGN_GOVERNMENT_PATTERNS: string[] = [
  "Ukraine",
  "Israel",
  "Saudi Arabia",
  "United Arab Emirates",
  "Taiwan",
  "South Korea",
  "Japan",
  "Australia",
  "United Kingdom",
  "Germany",
  "France",
  "Poland",
  "Philippines",
  "India",
  "Egypt",
  "Jordan",
  "Iraq",
  "Kuwait",
  "Qatar",
  "Bahrain",
  "Oman",
];

export const DEFAULT_STATE_DEPARTMENT_CONFIG: StateDepartmentConfig = {
  enabledFeeds: defaultEnabledFeeds(),
  lookbackDays: 30,
  keywords: [],
  maxItemsPerFeed: 60,
  defenseContractorPatterns: DEFAULT_DEFENSE_CONTRACTOR_PATTERNS,
  foreignGovernmentPatterns: DEFAULT_FOREIGN_GOVERNMENT_PATTERNS,
  maxRelatedPerSignal: 8,
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
  if (
    config.defenseContractorPatterns !== undefined &&
    !Array.isArray(config.defenseContractorPatterns)
  ) {
    errors.push("defenseContractorPatterns must be an array if set");
  }
  if (
    config.foreignGovernmentPatterns !== undefined &&
    !Array.isArray(config.foreignGovernmentPatterns)
  ) {
    errors.push("foreignGovernmentPatterns must be an array if set");
  }
  if (
    config.maxRelatedPerSignal !== undefined &&
    (typeof config.maxRelatedPerSignal !== "number" ||
      config.maxRelatedPerSignal < 1 ||
      config.maxRelatedPerSignal > 50)
  ) {
    errors.push("maxRelatedPerSignal must be 1-50 if set");
  }
  return { valid: errors.length === 0, errors };
}
