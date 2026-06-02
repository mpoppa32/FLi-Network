// Defense BD news source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { DEFENSE_SCOOP_REGISTRY } from "./registry";

export interface DefenseScoopConfig {
  /** Publication keys the operator wants to track. Empty = all
   *  defaultOn:true (Breaking Defense + DefenseScoop + Defense News). */
  enabledPublications: string[];
  /** Lookback window in days. Default 21 — high-volume news ages out fast. */
  lookbackDays: number;
  /** Keyword filter (case-insensitive substring on title+description). */
  keywords: string[];
  /** Cap items per sync per publication. Default 80 — these feeds are
   *  high-volume and we don't need everything. */
  maxItemsPerPublication?: number;
  /** v1.1 (mirrors state_department v1.2 pattern): defense contractor
   *  patterns scanned in title + description. Empty/unset = baked-in
   *  default list. */
  defenseContractorPatterns?: string[];
  /** v1.1: program-name patterns (e.g., 'CCA', 'F-35', 'JADC2'). */
  programPatterns?: string[];
  /** v1.1: cap on body-mention Orgs added to a single Signal's
   *  relatedIds. Default 6. */
  maxRelatedPerSignal?: number;
  /** Operator-set disable. */
  disabled?: boolean;
  initializedAt?: number;
}

function defaultEnabledPublications(): string[] {
  return DEFENSE_SCOOP_REGISTRY.filter((p) => p.defaultOn).map((p) => p.key);
}

/** Default contractor patterns. Sourced from state_department v1.2
 *  with a few defense-news-relevant additions.
 *
 *  P13.267 — drone-prime customer additions (Vantor / Firestorm Labs /
 *  Auterion / Neros Technologies / ModalAI / AeroVironment), plus
 *  Performance Drone Works (Atlas node exists; not yet in customerOrgIds
 *  but pattern lets future opps backfill cleanly). Six of the seven are
 *  confirmed customerOrgId in the live Atlas workspace (1777435779676)
 *  via existing opportunities; their normalized names cleanly resolve
 *  through orgResolver (lowercase + Inc/LLC/Corp/etc strip). Lifts the
 *  pattern-to-customer-set overlap from 1 of 28 (Anduril only) to 7 of
 *  35 — unblocking Brief customer category population from think_tank /
 *  service_news / defense_scoop body-text resolution. Per doctrine 3.6
 *  "Specific Information Only" — focus the pattern list on the operator's
 *  actual drone-defense / DoW market, not broad defense. */
export const DEFAULT_DS_CONTRACTOR_PATTERNS: string[] = [
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
  "Saildrone",
  "Skydio",
  "Epirus",
  "HII",
  "Huntington Ingalls",
  "Bell",
  "Sikorsky",
  "Pratt & Whitney",
  "Aerojet Rocketdyne",
  // P13.267 — drone-prime customer additions
  "Vantor",
  "Firestorm Labs",
  "Auterion",
  "Neros Technologies",
  "ModalAI",
  // AeroVironment — resolves to "AeroVironment Inc" node (confirmed customerOrgId).
  // "AeroVironment (AV) Inc." node also exists but won't resolve via this
  // pattern (normalizes to "aerovironment (av)") — left to operator merge.
  "AeroVironment",
  // Performance Drone Works — Atlas node exists (drone-prime), not yet in
  // customerOrgIds set; pattern still added so future opps backfill cleanly
  // and the signal links to the correct node. Bare "PDW" too short to
  // substring-match safely (e.g., "PDW-3" parts numbers in press) — only
  // the spelled-out form used.
  "Performance Drone Works",
];

/** Default program-name patterns. Defense BD news is heavy on program
 *  references — CCA, F-35, JADC2, GMD, NGAD, etc. Matching these to
 *  workspace Org / Program nodes lifts items in the matrix. */
export const DEFAULT_DS_PROGRAM_PATTERNS: string[] = [
  "F-35",
  "F-15EX",
  "B-21",
  "NGAD",
  "CCA",
  "Sentinel",
  "GBSD",
  "GMD",
  "NGI",
  "Patriot",
  "THAAD",
  "JADC2",
  "ABMS",
  "Replicator",
  "GhostShark",
  "Constellation",
  "DDG(X)",
  "FFG-62",
  "Columbia",
  "Virginia-class",
];

export const DEFAULT_DEFENSE_SCOOP_CONFIG: DefenseScoopConfig = {
  enabledPublications: defaultEnabledPublications(),
  lookbackDays: 21,
  keywords: [],
  maxItemsPerPublication: 80,
  defenseContractorPatterns: DEFAULT_DS_CONTRACTOR_PATTERNS,
  programPatterns: DEFAULT_DS_PROGRAM_PATTERNS,
  maxRelatedPerSignal: 6,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<DefenseScoopConfig> {
  const snap = await db
    .ref(sourcePath(workspaceId, "defense_scoop", "config"))
    .once("value");
  const raw = (snap.val() as Partial<DefenseScoopConfig> | null) ?? {};
  const merged: DefenseScoopConfig = {
    ...DEFAULT_DEFENSE_SCOOP_CONFIG,
    ...raw,
  };
  log?.debug("defense_scoop_config_loaded", {
    workspaceId,
    enabledPublications: merged.enabledPublications.length,
    keywords: merged.keywords.length,
    lookbackDays: merged.lookbackDays,
  });
  return merged;
}

export function validateConfig(
  config: DefenseScoopConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.enabledPublications))
    errors.push("enabledPublications must be an array");
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (
    typeof config.lookbackDays !== "number" ||
    config.lookbackDays < 1 ||
    config.lookbackDays > 90
  ) {
    errors.push("lookbackDays must be 1-90");
  }
  if (
    config.defenseContractorPatterns !== undefined &&
    !Array.isArray(config.defenseContractorPatterns)
  ) {
    errors.push("defenseContractorPatterns must be an array if set");
  }
  if (
    config.programPatterns !== undefined &&
    !Array.isArray(config.programPatterns)
  ) {
    errors.push("programPatterns must be an array if set");
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
