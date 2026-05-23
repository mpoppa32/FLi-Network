// NASA OIG source — per-workspace configuration
//
// Defaults are tuned for defense BD relevance: contractor list emphasizes
// defense primes that also do NASA work; program list emphasizes
// NASA programs with defense-industrial-base overlap (SLS, Orion,
// Artemis, ISS, commercial crew/cargo, deep-space comm, etc.).

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { DEFAULT_RSS_URL } from "./client";

export interface NasaOigConfig {
  /** Default OFF — NASA OIG is defense-adjacent rather than core defense.
   *  Operators who care about NASA contractor exposure (Boeing SLS,
   *  Lockheed Orion, SpaceX Crew/Cargo, etc.) opt in. */
  enabled: boolean;
  /** RSS endpoint override. Default = NASA OIG Audit Reports feed. */
  rssUrl: string;
  /** Lookback days for what's considered "recent". Default 120 (NASA OIG
   *  publishes ~1-3 reports/month — longer window keeps the queue full). */
  lookbackDays: number;
  /** Keyword filter (empty = all when defenseRelevantOnly:false). */
  keywords: string[];
  /** Filter to defense-industrial-base relevant reports. Default true:
   *  operators on this plugin usually care about defense contractor
   *  NASA exposure, not pure-space-science findings. */
  defenseRelevantOnly: boolean;
  /** Resolve body-text contractor mentions to Org nodes. Default true. */
  resolveBodyOrgs: boolean;
  /** Cap on related Orgs resolved per signal. Default 6. */
  maxRelatedPerSignal: number;
  /** Per-workspace contractor name override list. Empty → use default. */
  contractorPatterns: string[];
  /** Per-workspace program name pattern list. Empty → use default. */
  programPatterns: string[];
  disabled?: boolean;
  initializedAt?: number;
}

/** Defense primes + space-tech contractors with significant NASA exposure. */
export const DEFAULT_NASA_CONTRACTOR_PATTERNS = [
  "Boeing",
  "Lockheed Martin",
  "Northrop Grumman",
  "Aerojet Rocketdyne",
  "L3Harris",
  "Raytheon",
  "RTX",
  "Leidos",
  "SAIC",
  "Booz Allen",
  "Jacobs",
  "KBR",
  "SpaceX",
  "Blue Origin",
  "Sierra Space",
  "Sierra Nevada",
  "Maxar",
  "Rocket Lab",
  "ULA",
  "United Launch Alliance",
  "Firefly Aerospace",
  "Astrobotic",
  "Intuitive Machines",
  "Axiom Space",
  "Voyager Space",
  "Redwire",
  "Planet Labs",
  "Ball Aerospace",
  "BAE Systems",
];

/** NASA programs / projects with defense-industrial-base overlap. */
export const DEFAULT_NASA_PROGRAM_PATTERNS = [
  "SLS",
  "Space Launch System",
  "Orion",
  "Artemis",
  "Gateway",
  "Human Landing System",
  "HLS",
  "Mars Sample Return",
  "MSR",
  "Commercial Crew",
  "Commercial Cargo",
  "ISS",
  "International Space Station",
  "Deep Space Network",
  "DSN",
  "Europa Clipper",
  "Mars 2020",
  "Perseverance",
  "JWST",
  "James Webb",
  "Landsat",
  "GPM",
  "TDRS",
  "VIPER",
  "DAVINCI",
  "VERITAS",
];

/** Defense-relevance keyword filter applied when defenseRelevantOnly:true.
 *  Reports must mention at least one of these to be retained. */
export const DEFENSE_RELEVANT_KEYWORDS = [
  "contract",
  "contractor",
  "Boeing",
  "Lockheed",
  "Northrop",
  "SpaceX",
  "SLS",
  "Orion",
  "Artemis",
  "Gateway",
  "HLS",
  "Commercial Crew",
  "national security",
  "defense",
  "DoD",
  "Space Force",
  "Space Development Agency",
  "SDA",
];

export const DEFAULT_NASA_OIG_CONFIG: NasaOigConfig = {
  enabled: false, // opt-in
  rssUrl: DEFAULT_RSS_URL,
  lookbackDays: 120,
  keywords: [],
  defenseRelevantOnly: true,
  resolveBodyOrgs: true,
  maxRelatedPerSignal: 6,
  contractorPatterns: [],
  programPatterns: [],
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<NasaOigConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "nasa_oig", "config")).once("value");
  const raw = (snap.val() as Partial<NasaOigConfig> | null) ?? {};
  const merged: NasaOigConfig = { ...DEFAULT_NASA_OIG_CONFIG, ...raw };
  log?.debug("nasa_oig_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    rssUrl: merged.rssUrl,
    defenseRelevantOnly: merged.defenseRelevantOnly,
    keywords: merged.keywords.length,
    contractorOverrides: merged.contractorPatterns.length,
    programOverrides: merged.programPatterns.length,
  });
  return merged;
}

export function validateConfig(config: NasaOigConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (typeof config.rssUrl !== "string" || !/^https?:\/\//i.test(config.rssUrl)) {
    errors.push("rssUrl must be an http(s) URL");
  }
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (typeof config.defenseRelevantOnly !== "boolean") errors.push("defenseRelevantOnly must be boolean");
  if (typeof config.resolveBodyOrgs !== "boolean") errors.push("resolveBodyOrgs must be boolean");
  if (typeof config.maxRelatedPerSignal !== "number" || config.maxRelatedPerSignal < 1) {
    errors.push("maxRelatedPerSignal must be a positive number");
  }
  if (!Array.isArray(config.contractorPatterns)) errors.push("contractorPatterns must be an array");
  if (!Array.isArray(config.programPatterns)) errors.push("programPatterns must be an array");
  return { valid: errors.length === 0, errors };
}

export function effectiveContractorPatterns(config: NasaOigConfig): string[] {
  return config.contractorPatterns.length > 0
    ? [...DEFAULT_NASA_CONTRACTOR_PATTERNS, ...config.contractorPatterns]
    : DEFAULT_NASA_CONTRACTOR_PATTERNS;
}

export function effectiveProgramPatterns(config: NasaOigConfig): string[] {
  return config.programPatterns.length > 0
    ? [...DEFAULT_NASA_PROGRAM_PATTERNS, ...config.programPatterns]
    : DEFAULT_NASA_PROGRAM_PATTERNS;
}
