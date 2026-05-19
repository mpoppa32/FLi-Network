// Industry Association rosters — per-workspace configuration
//
// Phase 8.6.11 (T2-11) v1.0: NDIA / AFA / AUSA corporate-member rosters.
// These rosters reveal which companies are positioning in which capability
// areas — operator-visible Posture intelligence at the institutional level.
//
// Pattern B (HTML scrape with member extraction). Emits member_of Edges
// only — no Signals. The Brief surface picks up these Orgs through
// existing pursuit / customer / adversary connections.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export type AssociationKey = "ndia" | "afa" | "ausa";

export interface AssociationSpec {
  key: AssociationKey;
  /** Canonical association name. Resolved as a trade_assoc Org. */
  name: string;
  /** Acronym (added as alternateName for cross-source dedupe). */
  acronym: string;
  /** Public corporate-members roster URL. Per-workspace override available
   *  if the association reorganizes their site. */
  rosterUrl: string;
}

export const ASSOCIATION_REGISTRY: Record<AssociationKey, AssociationSpec> = {
  ndia: {
    key: "ndia",
    name: "National Defense Industrial Association",
    acronym: "NDIA",
    rosterUrl: "https://www.ndia.org/about/membership/corporate-members",
  },
  afa: {
    key: "afa",
    name: "Air & Space Forces Association",
    acronym: "AFA",
    rosterUrl: "https://www.afa.org/membership/corporate-members",
  },
  ausa: {
    key: "ausa",
    name: "Association of the United States Army",
    acronym: "AUSA",
    rosterUrl: "https://www.ausa.org/membership/corporate-membership",
  },
};

export const ALL_ASSOCIATION_KEYS: AssociationKey[] = ["ndia", "afa", "ausa"];

export interface IndustryAssocConfig {
  enabled: boolean;
  associations: AssociationKey[];
  /** Cap on member entries to extract per association per sync.
   *  Default 1500 — NDIA has ~1000 corporate members, AFA + AUSA smaller. */
  maxMembersPerAssociation?: number;
  /** Per-workspace override of the canonical roster URL for any association. */
  rosterUrls?: Partial<Record<AssociationKey, string>>;
  disabled?: boolean;
  initializedAt?: number;
}

export const DEFAULT_INDUSTRY_ASSOC_CONFIG: IndustryAssocConfig = {
  enabled: true,
  associations: ALL_ASSOCIATION_KEYS,
  maxMembersPerAssociation: 1500,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<IndustryAssocConfig> {
  const snap = await db.ref(sourcePath(workspaceId, "industry_assoc", "config")).once("value");
  const raw = (snap.val() as Partial<IndustryAssocConfig> | null) ?? {};
  const merged: IndustryAssocConfig = {
    ...DEFAULT_INDUSTRY_ASSOC_CONFIG,
    ...raw,
    associations:
      Array.isArray(raw.associations) && raw.associations.length
        ? raw.associations
        : ALL_ASSOCIATION_KEYS,
  };
  log?.debug("industry_assoc_config_loaded", {
    workspaceId,
    enabled: merged.enabled,
    associations: merged.associations,
  });
  return merged;
}

export function validateConfig(
  config: IndustryAssocConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!Array.isArray(config.associations) || config.associations.length === 0) {
    errors.push("associations must be a non-empty array");
  }
  return { valid: errors.length === 0, errors };
}

export function resolveRosterUrl(
  config: IndustryAssocConfig,
  assoc: AssociationKey
): string {
  return config.rosterUrls?.[assoc] || ASSOCIATION_REGISTRY[assoc].rosterUrl;
}
