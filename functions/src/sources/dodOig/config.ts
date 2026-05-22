// DoD OIG source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { DEFAULT_RSS_URL } from "./client";

export interface DodOigConfig {
  /** Default-on (RSS is lightweight; reports are public). */
  enabled: boolean;
  /** RSS endpoint override. Default = Audit Reports feed. */
  rssUrl: string;
  /** Lookback days for what's considered "recent". Default 90 (IG reports
   *  publish less frequently than GAO; longer window keeps the queue full). */
  lookbackDays: number;
  /** Keyword filter (empty = all when defenseOnly:false). Substring match. */
  keywords: string[];
  /** Defense-relevant keyword filter on top of the feed. Default true,
   *  though most DoD IG titles trivially match — kept for parity with
   *  gao_reports + operator override. */
  defenseOnly: boolean;
  /** Resolve body-text contractor + program mentions to Orgs. Default true. */
  resolveBodyOrgs: boolean;
  /** Cap on related Orgs resolved per signal. Default 6. */
  maxRelatedPerSignal: number;
  /** Per-workspace contractor name override list. Empty → use default registry. */
  contractorPatterns: string[];
  /** Per-workspace program name pattern list (e.g., "F-35", "Sentinel"). */
  programPatterns: string[];
  disabled?: boolean;
  initializedAt?: number;
}

/** Defense contractors commonly named in DoD IG audit titles + bodies.
 *  Same backbone used by defense_scoop / state_department for parity. */
export const DEFAULT_OIG_CONTRACTOR_PATTERNS = [
  "Lockheed Martin",
  "Boeing",
  "Raytheon",
  "RTX",
  "Northrop Grumman",
  "General Dynamics",
  "L3Harris",
  "BAE Systems",
  "Huntington Ingalls",
  "Leidos",
  "SAIC",
  "Booz Allen",
  "CACI",
  "Peraton",
  "ManTech",
  "Anduril",
  "Palantir",
  "Shield AI",
  "Saronic",
  "Helsing",
  "Hadrian",
  "HII",
  "Pratt & Whitney",
  "Honeywell",
  "Textron",
  "Oshkosh",
  "AeroVironment",
  "Kratos",
  "Mercury Systems",
];

/** Major DoD programs commonly audited by IG. Operator can extend
 *  per-workspace via config.programPatterns. */
export const DEFAULT_OIG_PROGRAM_PATTERNS = [
  "F-35",
  "F-15EX",
  "B-21",
  "B-2",
  "KC-46",
  "KC-135",
  "CCA",
  "NGAD",
  "Sentinel",
  "Columbia",
  "Virginia",
  "Constellation",
  "DDG(X)",
  "JADC2",
  "JWCC",
  "GLSDB",
  "GMLRS",
  "PrSM",
  "LRHW",
  "Patriot",
  "THAAD",
  "Aegis",
  "AIM-260",
  "JASSM",
  "LRASM",
  "Replicator",
];

/** Defense-relevance keyword filter — same backbone as gao_reports. */
export const DEFENSE_KEYWORDS = [
  "defense",
  "DOD",
  "DoD",
  "army",
  "navy",
  "air force",
  "marine",
  "space force",
  "weapon",
  "missile",
  "aircraft",
  "ship",
  "cyber",
  "intelligence",
  "DARPA",
  "missile defense",
  "sustainment",
  "procurement",
  "acquisition",
  "F-35",
  "Sentinel",
  "Columbia",
  "B-21",
  "KC-46",
  "CCA",
  "NGAD",
];

export const DEFAULT_DOD_OIG_CONFIG: DodOigConfig = {
  enabled: true,
  rssUrl: DEFAULT_RSS_URL,
  lookbackDays: 90,
  keywords: [],
  defenseOnly: true,
  resolveBodyOrgs: true,
  maxRelatedPerSignal: 6,
  contractorPatterns: [],
  programPatterns: [],
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<DodOigConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "dod_oig", "config")).once("value");
  const raw = (snap.val() as Partial<DodOigConfig> | null) ?? {};
  const merged: DodOigConfig = { ...DEFAULT_DOD_OIG_CONFIG, ...raw };
  log?.debug("dod_oig_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    rssUrl: merged.rssUrl,
    defenseOnly: merged.defenseOnly,
    keywords: merged.keywords.length,
    contractorOverrides: merged.contractorPatterns.length,
    programOverrides: merged.programPatterns.length,
  });
  return merged;
}

export function validateConfig(config: DodOigConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (typeof config.rssUrl !== "string" || !/^https?:\/\//i.test(config.rssUrl)) {
    errors.push("rssUrl must be an http(s) URL");
  }
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (typeof config.defenseOnly !== "boolean") errors.push("defenseOnly must be boolean");
  if (typeof config.resolveBodyOrgs !== "boolean") errors.push("resolveBodyOrgs must be boolean");
  if (typeof config.maxRelatedPerSignal !== "number" || config.maxRelatedPerSignal < 1) {
    errors.push("maxRelatedPerSignal must be a positive number");
  }
  if (!Array.isArray(config.contractorPatterns)) errors.push("contractorPatterns must be an array");
  if (!Array.isArray(config.programPatterns)) errors.push("programPatterns must be an array");
  return { valid: errors.length === 0, errors };
}

/** Resolve effective contractor list = defaults + workspace overrides. */
export function effectiveContractorPatterns(config: DodOigConfig): string[] {
  return config.contractorPatterns.length > 0
    ? [...DEFAULT_OIG_CONTRACTOR_PATTERNS, ...config.contractorPatterns]
    : DEFAULT_OIG_CONTRACTOR_PATTERNS;
}

/** Resolve effective program list = defaults + workspace overrides. */
export function effectiveProgramPatterns(config: DodOigConfig): string[] {
  return config.programPatterns.length > 0
    ? [...DEFAULT_OIG_PROGRAM_PATTERNS, ...config.programPatterns]
    : DEFAULT_OIG_PROGRAM_PATTERNS;
}
