// DARPA News source — per-workspace configuration

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";
import { DEFAULT_RSS_URL } from "./client";

export interface DarpaNewsConfig {
  /** Default-on (RSS is lightweight; DARPA news is public). */
  enabled: boolean;
  /** RSS endpoint override. Default = DARPA News & Events feed. */
  rssUrl: string;
  /** Lookback days for what's considered "recent". Default 60 (DARPA
   *  publishes irregularly — handful per month — longer window keeps
   *  the queue full). */
  lookbackDays: number;
  /** Keyword filter (empty = all). Substring match on title + description. */
  keywords: string[];
  /** Resolve body-text contractor mentions to Org nodes. Default true. */
  resolveBodyOrgs: boolean;
  /** Cap on related Orgs resolved per signal. Default 6. */
  maxRelatedPerSignal: number;
  /** Per-workspace contractor name override list. Empty → use default registry. */
  contractorPatterns: string[];
  /** Per-workspace program name pattern list. Empty → use default registry.
   *  Programs are critical to DARPA — every announcement is about a
   *  program. We ship a baseline of 30+ active DARPA programs. */
  programPatterns: string[];
  disabled?: boolean;
  initializedAt?: number;
}

/** Defense contractors / R&D performers commonly named in DARPA awards.
 *  Same lineage as defense_scoop / dod_oig with R&D-skewed additions. */
export const DEFAULT_DARPA_CONTRACTOR_PATTERNS = [
  "Lockheed Martin",
  "Boeing",
  "Raytheon",
  "RTX",
  "Northrop Grumman",
  "General Dynamics",
  "L3Harris",
  "BAE Systems",
  "Leidos",
  "SAIC",
  "Booz Allen",
  "Peraton",
  "ManTech",
  "Anduril",
  "Palantir",
  "Shield AI",
  "Saronic",
  "Helsing",
  "Hadrian",
  "Skydio",
  "Aurora Flight Sciences",
  "Kratos",
  "AeroVironment",
  "Mercury Systems",
  "BlueHalo",
  "ApplDig",
  "HRL Laboratories",
  "GE Aerospace",
  "Boston Dynamics",
  "MIT Lincoln Laboratory",
  "Johns Hopkins APL",
  "RAND",
  "MITRE",
  "Sandia National Laboratories",
  "Lawrence Livermore",
  "Los Alamos",
];

/** Active DARPA programs (broad sample — operator can extend). The list
 *  skews toward currently-active programs to maximize hit rate against
 *  recent news. */
export const DEFAULT_DARPA_PROGRAM_PATTERNS = [
  // Air / Space
  "ACE",
  "AlphaDogfight",
  "Gremlins",
  "LongShot",
  "X-65",
  "CRANE",
  "SPRINT",
  "DRACO",
  "Blackjack",
  // Ground / Maritime
  "RACER",
  "Squad X",
  "Manta Ray",
  "NOMARS",
  "Sea Train",
  // AI / Autonomy
  "OFFSET",
  "OpenSky",
  "GARD",
  "ASKE",
  "Lifelong Learning Machines",
  "L2M",
  "AlphaDogfight",
  // Cyber / Spectrum
  "Cyber Grand Challenge",
  "RACE",
  "RADICS",
  "Hack the Building",
  // Microelectronics / Hardware
  "ERI",
  "POSH",
  "T-MUSIC",
  "ECRP",
  // Bio / Med
  "Pandemic Prevention Platform",
  "P3",
  "Persistent Aquatic Living Sensors",
  // Quantum
  "ONISQ",
  "Quantum Apertures",
  // Munitions / Effectors
  "OpFires",
  "GLide Breaker",
  "Glide Breaker",
  "Tactical Boost Glide",
  "TBG",
];

export const DEFAULT_DARPA_NEWS_CONFIG: DarpaNewsConfig = {
  enabled: true,
  rssUrl: DEFAULT_RSS_URL,
  lookbackDays: 60,
  keywords: [],
  resolveBodyOrgs: true,
  maxRelatedPerSignal: 6,
  contractorPatterns: [],
  programPatterns: [],
};

export async function loadConfig(workspaceId: string, log?: Logger): Promise<DarpaNewsConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "darpa_news", "config")).once("value");
  const raw = (snap.val() as Partial<DarpaNewsConfig> | null) ?? {};
  const merged: DarpaNewsConfig = { ...DEFAULT_DARPA_NEWS_CONFIG, ...raw };
  log?.debug("darpa_news_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    rssUrl: merged.rssUrl,
    keywords: merged.keywords.length,
    contractorOverrides: merged.contractorPatterns.length,
    programOverrides: merged.programPatterns.length,
  });
  return merged;
}

export function validateConfig(config: DarpaNewsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (typeof config.rssUrl !== "string" || !/^https?:\/\//i.test(config.rssUrl)) {
    errors.push("rssUrl must be an http(s) URL");
  }
  if (typeof config.lookbackDays !== "number" || config.lookbackDays < 1) {
    errors.push("lookbackDays must be a positive number");
  }
  if (!Array.isArray(config.keywords)) errors.push("keywords must be an array");
  if (typeof config.resolveBodyOrgs !== "boolean") errors.push("resolveBodyOrgs must be boolean");
  if (typeof config.maxRelatedPerSignal !== "number" || config.maxRelatedPerSignal < 1) {
    errors.push("maxRelatedPerSignal must be a positive number");
  }
  if (!Array.isArray(config.contractorPatterns)) errors.push("contractorPatterns must be an array");
  if (!Array.isArray(config.programPatterns)) errors.push("programPatterns must be an array");
  return { valid: errors.length === 0, errors };
}

export function effectiveContractorPatterns(config: DarpaNewsConfig): string[] {
  return config.contractorPatterns.length > 0
    ? [...DEFAULT_DARPA_CONTRACTOR_PATTERNS, ...config.contractorPatterns]
    : DEFAULT_DARPA_CONTRACTOR_PATTERNS;
}

export function effectiveProgramPatterns(config: DarpaNewsConfig): string[] {
  return config.programPatterns.length > 0
    ? [...DEFAULT_DARPA_PROGRAM_PATTERNS, ...config.programPatterns]
    : DEFAULT_DARPA_PROGRAM_PATTERNS;
}
