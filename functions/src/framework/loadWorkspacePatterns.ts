// Corsair framework — workspace-scoped pattern loader.
//
// Server-side mappers (think_tank, service_news, defense_scoop, dod_oig,
// darpa_news, nasa_oig, etc.) match body text against a pattern list to
// resolve contractor names into orgIds. Pre-P13.283 the mapper-time
// pattern list was JUST the hardcoded DEFAULT_*_CONTRACTOR_PATTERNS
// (~35 entries) — even though the client-side `_osintSeedPatternsFromOpps`
// action (P13.252) writes a much richer set to
// `/workspaces/{ws}/patterns/{contractors,programs}` derived from active
// opp customerOrg + adversaryOrg + tracked-node names + alternateNames.
//
// Atlas at the time of this writing: `/workspaces/1777435779676/patterns/
// contractors` carries 110+ entries (drone vendors, primes, subs, govt
// partners) seeded by the operator. The server-side mappers were
// ignoring all of it. Result: of 736 signals on Atlas, only 49 had
// non-empty subjectIds OR relatedIds — defense_scoop 11/53, think_tank
// 5/89, service_news 0/62. Brief surface adversary/customer rollups
// were empty because the lake had no resolver-bound mentions to roll up.
//
// This helper closes that loop: reads `/workspaces/{ws}/patterns/
// {contractors,programs}`, extracts the display-name values (the keys
// are slugified — useless for matching), dedupes against the passed-in
// hardcoded defaults case-insensitively, returns the merged list.
//
// Doctrine compliance: patterns at `/workspaces/{ws}/patterns/*` are
// workspace-scoped and operator-curated. Public/consented data only.
// No cross-workspace pattern sharing.

import { db, wsPath } from "./rtdb";
import { Logger } from "./logger";

export interface WorkspacePatternsBundle {
  /** Merged + deduped contractor pattern list. Hardcoded defaults are
   *  always first; operator-seeded patterns are appended. Order matters
   *  for the mappers' relatedIds-cap-bounded loops — defaults match
   *  first, then operator additions. */
  contractors: string[];
  /** Same shape for programs. */
  programs: string[];
  /** Empirical sizes for telemetry. */
  meta: {
    defaultsContractors: number;
    operatorContractors: number;
    mergedContractors: number;
    defaultsPrograms: number;
    operatorPrograms: number;
    mergedPrograms: number;
  };
}

/** Walk a record-shaped pattern path. Each entry is `slug → DisplayName`
 *  (per the client-side seed-from-opps writer). Extract the display
 *  values; ignore null / non-string. */
function extractDisplayNames(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const out: string[] = [];
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

/** Dedupe a list case-insensitively, preserving the order in which each
 *  unique name was first seen. Defaults pass through first. */
function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** Load workspace-scoped patterns and merge with the passed-in
 *  hardcoded defaults. Always returns the defaults verbatim plus any
 *  unique operator-seeded entries. Never throws on missing path — empty
 *  workspace patterns degrade to defaults-only. */
export async function loadWorkspacePatterns(
  workspaceId: string,
  defaults: { contractors: string[]; programs: string[] },
  log?: Logger
): Promise<WorkspacePatternsBundle> {
  let opContractors: string[] = [];
  let opPrograms: string[] = [];

  try {
    const snap = await db.ref(wsPath(workspaceId, "patterns")).once("value");
    const raw = (snap.val() as { contractors?: unknown; programs?: unknown } | null) ?? {};
    opContractors = extractDisplayNames(raw.contractors);
    opPrograms = extractDisplayNames(raw.programs);
  } catch (err) {
    log?.warn("workspace_patterns_load_failed", {
      workspaceId,
      message: (err as Error).message ?? String(err),
    });
  }

  const mergedContractors = dedupeCaseInsensitive([...defaults.contractors, ...opContractors]);
  const mergedPrograms = dedupeCaseInsensitive([...defaults.programs, ...opPrograms]);

  return {
    contractors: mergedContractors,
    programs: mergedPrograms,
    meta: {
      defaultsContractors: defaults.contractors.length,
      operatorContractors: opContractors.length,
      mergedContractors: mergedContractors.length,
      defaultsPrograms: defaults.programs.length,
      operatorPrograms: opPrograms.length,
      mergedPrograms: mergedPrograms.length,
    },
  };
}
