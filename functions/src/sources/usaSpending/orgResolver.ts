// USAspending source — Organization resolver
//
// Per Award integration spec Part Six: resolve recipient names and agency
// names to Corsair Organization entities. Match against existing, auto-
// create when no match.
//
// Resolution stays exact-normalized-name match only — fuzzy auto-merge
// is too risky for Orgs given the high false-positive rate on common
// suffixes (Defense Systems Inc vs Defense Systems LLC vs Defense
// Systems Group).
//
// v1.1 (additive): on auto-create, runs a Jaro-Winkler similarity scan
// against the existing in-workspace Org name cache. Pairs at sim >= 0.92
// (and < 1.0) get persisted to
// workspaces/{wsId}/orgMergeCandidates/{pairKey} for operator review.
// Mirrors the personResolver v1.1 pattern. Never auto-merges across
// fuzzy matches. Operator confirmation surface ships in a follow-up arc.
//
// File path note: this resolver lives under sources/usaSpending/ for
// historical reasons but functions as a shared utility — 12+ source
// plugins import resolveRecipientOrg / resolveAgencyOrg from this file.

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import type { SourceProvenance } from "../../framework/types";
import type { Organization, OrganizationType } from "../../framework/types/entities";
import { Logger } from "../../framework/logger";

/** Normalize an organization name for matching: lowercase, strip suffixes, collapse whitespace. */
export function normalizeName(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/\b(corporation|corp\.?|incorporated|inc\.?|llc|l\.l\.c\.|limited|ltd\.?|company|co\.?|holdings|group)\b/gi, "")
    .replace(/[,.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface OrgCache {
  byName: Map<string, string>; // normalized name → orgId
  byUei: Map<string, string>; // UEI → orgId
  /** v1.1: id → display name for fuzzy candidate emission. */
  displayNameById: Map<string, string>;
}

let _cache: { workspaceId: string; cache: OrgCache; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// v1.3 (2026-06-02) — per-process in-flight dedupe for cache load + create.
//
// Root cause being fixed: between cache.byName.has(norm) (line ~222) and the
// cache.byName.set(norm, orgId) that follows db.ref().set(newOrg), there is
// an `await` boundary. Two parallel calls into resolveRecipientOrg for the
// same logical entity (same agency name resolved by different mappers within
// one warm Cloud Functions instance) BOTH miss the cache, BOTH mint a new
// orgId, BOTH write — and the workspace ends up with duplicate org nodes.
// Workspace 1777435779676 accumulated 17 such clusters (4× "Senate Armed
// Services", 4× "Senate Intelligence", 2× L3Harris, etc) before this fix.
//
// The cache itself has its own load race: two callers when _cache is null
// both `await db.once()` and end up with separate OrgCache instances. Even
// after one wins the assignment to _cache, the loser is still holding a
// stale local reference. That makes the create-race possible even when the
// in-memory cache "should" be hot.
//
// Two maps fix both:
//   _inFlightCacheLoad collapses concurrent loadOrgCache calls into one.
//   _inFlightByName/_inFlightByUei collapse concurrent creates for the same
//   normalized name / UEI into a single shared promise.
//
// Per-process only. Cross-instance races (two Cloud Functions containers
// running the same workspace at the same time) are still possible but rare
// at our volume; if they show up, the fix is an RTDB transaction on a
// /workspaces/{ws}/orgNameIndex/{norm} node, deferred for now.
const _inFlightCacheLoad = new Map<string, Promise<OrgCache>>();
const _inFlightByName = new Map<string, Promise<{ orgId: string; created: boolean; fuzzyCandidatesEmitted?: number }>>();
const _inFlightByUei = new Map<string, Promise<{ orgId: string; created: boolean; fuzzyCandidatesEmitted?: number }>>();

/** v1.1: Jaro-Winkler threshold for surfacing a merge candidate. Set
 *  slightly tighter than the personResolver default (0.92 vs 0.92) —
 *  Org names are typically longer than personal names, so a JW match
 *  at this bar implies near-identical normalized form. Common suffix
 *  divergence (Inc / LLC / Group) gets stripped by normalizeName
 *  before the comparison, so this catches things like 'Lockheed
 *  Martin' vs 'Lockheed Martin Corp' that survive normalization. */
const ORG_MERGE_CANDIDATE_THRESHOLD = 0.92;

/** v1.1: per-call cap on fuzzy candidate emissions. */
const MAX_FUZZY_ORG_CANDIDATES_PER_CALL = 3;

// v1.1.1 (2026-05-22): jaroWinklerSimilarity moved to
// framework/similarity.ts (shared with personResolver). Re-exporting
// from here so existing callers of the named export keep working.
export { jaroWinklerSimilarity } from "../../framework/similarity";
import { jaroWinklerSimilarity } from "../../framework/similarity";

async function loadOrgCache(workspaceId: string): Promise<OrgCache> {
  const now = Date.now();
  if (_cache && _cache.workspaceId === workspaceId && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.cache;
  }
  // Collapse parallel cold loads — otherwise two callers race to build
  // separate OrgCache instances and only one wins the _cache slot, leaving
  // the loser holding a stale-by-construction local reference.
  const inflight = _inFlightCacheLoad.get(workspaceId);
  if (inflight) return inflight;
  const work = (async (): Promise<OrgCache> => {
    const snap = await db.ref(wsPath(workspaceId, "nodes")).once("value");
    const nodes = (snap.val() as Record<string, Organization> | null) ?? {};
    const cache: OrgCache = {
      byName: new Map(),
      byUei: new Map(),
      displayNameById: new Map(),
    };
    for (const [id, node] of Object.entries(nodes)) {
      if (!node || !node.name) continue;
      // Skip non-Org node types (Person, etc.) — orgResolver is scoped
      // to Orgs only. Persons appear in the same nodes table but
      // shouldn't be candidates for Org-side merging.
      if (node.type && node.type !== "company" && node.type !== "government") {
        continue;
      }
      cache.byName.set(normalizeName(node.name), id);
      if (!cache.displayNameById.has(id)) cache.displayNameById.set(id, node.name);
      if (node.uei) cache.byUei.set(node.uei, id);
      if (node.alternateNames) {
        for (const alt of node.alternateNames) {
          cache.byName.set(normalizeName(alt), id);
        }
      }
    }
    _cache = { workspaceId, cache, loadedAt: Date.now() };
    return cache;
  })();
  _inFlightCacheLoad.set(workspaceId, work);
  try {
    return await work;
  } finally {
    _inFlightCacheLoad.delete(workspaceId);
  }
}

/** v1.1: scan the cache for fuzzy matches against the just-created Org
 *  and persist candidate merge entries to RTDB for operator review.
 *  Never auto-merges. Skips pairs already resolved by the operator.
 *  Capped at MAX_FUZZY_ORG_CANDIDATES_PER_CALL per call. */
async function emitFuzzyOrgMergeCandidates(
  workspaceId: string,
  resolvedOrgId: string,
  resolvedDisplayName: string,
  resolvedNorm: string,
  cache: OrgCache,
  log?: Logger
): Promise<number> {
  if (!resolvedNorm) return 0;
  // First-token gating heuristic: skip pairs whose first words diverge
  // sharply. 'Lockheed Martin' vs 'Lockheed Martin Corp' shares the
  // first word, but 'Lockheed Martin' vs 'Northrop Grumman' obviously
  // doesn't — short-circuit before the (more expensive) full-name JW.
  const myParts = resolvedNorm.split(/\s+/);
  if (myParts.length === 0 || myParts[0].length === 0) return 0;
  const myFirstWord = myParts[0];

  const ranked: Array<{ otherId: string; sim: number; otherNorm: string }> = [];
  for (const [otherNorm, otherId] of cache.byName) {
    if (otherId === resolvedOrgId) continue;
    if (otherNorm === resolvedNorm) continue;
    const otherParts = otherNorm.split(/\s+/);
    if (otherParts.length === 0) continue;
    // Quick first-word JW; bail if too distant.
    const firstWordSim = jaroWinklerSimilarity(myFirstWord, otherParts[0]);
    if (firstWordSim < 0.75) continue;
    const sim = jaroWinklerSimilarity(resolvedNorm, otherNorm);
    if (sim < ORG_MERGE_CANDIDATE_THRESHOLD) continue;
    if (sim >= 1.0) continue;
    ranked.push({ otherId, sim, otherNorm });
  }
  ranked.sort((a, b) => b.sim - a.sim);
  const top = ranked.slice(0, MAX_FUZZY_ORG_CANDIDATES_PER_CALL);

  let emitted = 0;
  for (const c of top) {
    const [idA, idB] =
      resolvedOrgId < c.otherId
        ? [resolvedOrgId, c.otherId]
        : [c.otherId, resolvedOrgId];
    const pairKey = `${idA}__${idB}`;
    try {
      const existingSnap = await db
        .ref(wsPath(workspaceId, "orgMergeCandidates", pairKey))
        .once("value");
      const existing = existingSnap.val() as { resolved?: string } | null;
      if (existing && existing.resolved) continue;
      const otherDisplayName =
        cache.displayNameById.get(c.otherId) || c.otherNorm;
      const candidate = {
        idA,
        idB,
        nameA: idA === resolvedOrgId ? resolvedDisplayName : otherDisplayName,
        nameB: idB === resolvedOrgId ? resolvedDisplayName : otherDisplayName,
        normA: idA === resolvedOrgId ? resolvedNorm : c.otherNorm,
        normB: idB === resolvedOrgId ? resolvedNorm : c.otherNorm,
        similarity: Math.round(c.sim * 1000) / 1000,
        proposedAt: Date.now(),
      };
      await db
        .ref(wsPath(workspaceId, "orgMergeCandidates", pairKey))
        .set(candidate);
      emitted++;
    } catch (err) {
      log?.warn?.("org_fuzzy_candidate_emit_failed", {
        pairKey,
        message: (err as Error).message,
      });
    }
  }
  if (emitted > 0) {
    log?.debug?.("org_fuzzy_candidates_emitted", {
      resolvedOrgId,
      count: emitted,
    });
  }
  return emitted;
}

export function invalidateOrgCache(): void {
  _cache = null;
}

/**
 * Resolve a recipient name to an existing Organization, or create one.
 * Returns the Organization ID.
 */
export async function resolveRecipientOrg(
  workspaceId: string,
  recipientName: string,
  uei: string | null,
  options: {
    autoCreate?: boolean;
    type?: OrganizationType;
    /** v1.2 cross-source dedupe (advisory_boards / faca): try matching
     *  the supplied alternate names (acronyms etc.) against existing
     *  cached normalized names + alternateNames. On auto-create, persist
     *  them on the new node. Improves dedupe between sources that share
     *  an entity but use different canonical names ("Defense Science
     *  Board" vs "DSB"). */
    alternateNames?: string[];
    /** v1.1: emit fuzzy merge candidates on auto-create. Default true.
     *  High-volume callers (one-time migrations) can set false to skip
     *  the scan + RTDB writes. */
    emitFuzzyCandidates?: boolean;
    /** v1.1: optional logger for fuzzy-candidate diagnostics. */
    log?: Logger;
  } = {}
): Promise<{ orgId: string; created: boolean; fuzzyCandidatesEmitted?: number }> {
  const cache = await loadOrgCache(workspaceId);

  // UEI exact match
  if (uei && cache.byUei.has(uei)) {
    return { orgId: cache.byUei.get(uei)!, created: false };
  }

  // Normalized name match
  const norm = normalizeName(recipientName);
  if (cache.byName.has(norm)) {
    return { orgId: cache.byName.get(norm)!, created: false };
  }

  // v1.2: try alternateNames against existing normalized name index
  if (Array.isArray(options.alternateNames) && options.alternateNames.length > 0) {
    for (const alt of options.alternateNames) {
      if (!alt) continue;
      const altNorm = normalizeName(alt);
      if (altNorm && cache.byName.has(altNorm)) {
        return { orgId: cache.byName.get(altNorm)!, created: false };
      }
    }
  }

  // v1.3 — in-flight dedupe. A parallel call already mid-create for the same
  // normalized name (or UEI) wins; we latch onto its promise and return its
  // orgId. Keyed by workspaceId so cross-workspace creates don't collide.
  const ueiKey = uei ? `${workspaceId}::uei::${uei}` : null;
  const nameKey = `${workspaceId}::name::${norm}`;
  if (ueiKey) {
    const existing = _inFlightByUei.get(ueiKey);
    if (existing) return existing;
  }
  {
    const existing = _inFlightByName.get(nameKey);
    if (existing) return existing;
  }

  if (options.autoCreate === false) {
    throw new Error(`No matching Organization for "${recipientName}" (UEI: ${uei || "n/a"})`);
  }

  // Auto-create — wrap in an IIFE so we can register the in-flight promise
  // BEFORE any await. A concurrent caller that arrives between our cache
  // miss and our db.set will find this promise and avoid creating a dup.
  const work = (async (): Promise<{ orgId: string; created: boolean; fuzzyCandidatesEmitted?: number }> => {
    const orgId = "org_" + (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 12)
      : String(Date.now()) + Math.floor(Math.random() * 1000));

    const provenance: SourceProvenance = externalProvenance(
      "usaspending",
      uei || recipientName,
      null,
      null,
      Date.now()
    );

    // v1.2: persist alternateNames on auto-create so future cross-source
    // lookups via either canonical name OR alternate match cleanly.
    const altPersist = (options.alternateNames || []).filter(
      (a): a is string => !!a && a.trim().length > 0 && normalizeName(a) !== norm
    );

    // P13.266 — Firebase RTDB rejects undefined values ("set failed: value
    // argument contains undefined in property..."). The Organization interface
    // marks uei/alternateNames as optional, so OMIT the keys entirely when
    // null/empty rather than setting them to undefined. Discovered via SAM.gov
    // first-key activation — every record was failing the org write.
    const newOrg: Organization = {
      id: orgId,
      type: options.type ?? "company",
      name: recipientName.trim(),
      autoCreated: true,
      created: new Date().toISOString(),
      source: provenance,
    };
    if (uei) newOrg.uei = uei;
    if (altPersist.length > 0) newOrg.alternateNames = altPersist;

    await db.ref(wsPath(workspaceId, "nodes", orgId)).set(newOrg);

    // Update local cache AND the shared _cache if it points elsewhere (the
    // load race can leave us holding a non-canonical OrgCache instance).
    cache.byName.set(norm, orgId);
    if (uei) cache.byUei.set(uei, orgId);
    if (!cache.displayNameById.has(orgId)) {
      cache.displayNameById.set(orgId, newOrg.name);
    }
    for (const alt of altPersist) {
      const altNorm = normalizeName(alt);
      if (altNorm) cache.byName.set(altNorm, orgId);
    }
    if (_cache && _cache.workspaceId === workspaceId && _cache.cache !== cache) {
      _cache.cache.byName.set(norm, orgId);
      if (uei) _cache.cache.byUei.set(uei, orgId);
      if (!_cache.cache.displayNameById.has(orgId)) {
        _cache.cache.displayNameById.set(orgId, newOrg.name);
      }
      for (const alt of altPersist) {
        const altNorm = normalizeName(alt);
        if (altNorm) _cache.cache.byName.set(altNorm, orgId);
      }
    }

    // v1.1: fuzzy candidate emission (default on; opt-out for migrations)
    let fuzzyCandidatesEmitted = 0;
    if (options.emitFuzzyCandidates !== false) {
      try {
        fuzzyCandidatesEmitted = await emitFuzzyOrgMergeCandidates(
          workspaceId,
          orgId,
          newOrg.name,
          norm,
          cache,
          options.log
        );
      } catch (err) {
        options.log?.warn?.("org_fuzzy_emit_pass_failed", {
          orgId,
          message: (err as Error).message,
        });
      }
    }

    return { orgId, created: true, fuzzyCandidatesEmitted };
  })();

  if (ueiKey) _inFlightByUei.set(ueiKey, work);
  _inFlightByName.set(nameKey, work);
  try {
    return await work;
  } finally {
    if (ueiKey) _inFlightByUei.delete(ueiKey);
    _inFlightByName.delete(nameKey);
  }
}

/**
 * Resolve a customer agency name (toptier or subtier) to an Organization.
 * Government agencies use `type: 'government'`.
 */
export async function resolveAgencyOrg(
  workspaceId: string,
  agencyName: string
): Promise<{ orgId: string; created: boolean }> {
  return resolveRecipientOrg(workspaceId, agencyName, null, {
    autoCreate: true,
    type: "government",
  });
}
