// Framework — Person resolver
//
// Cross-source Person dedupe utility. Mirrors the orgResolver pattern
// (sources/usaSpending/orgResolver.ts) but tuned for Person nodes:
//   - Normalizes full names (strips honorifics + suffixes + punctuation,
//     lowercases, collapses whitespace, drops middle initials when fuzzy
//     matching).
//   - Cache keyed on normalized full name + alternate-name set.
//   - Cache TTL matches orgResolver (5 minutes); cross-source dedupe
//     within a single sync run hits even when both sides are creating
//     fresh Persons.
//   - Auto-create persists alternates on node.alternateNames so future
//     lookups via either form (formal vs informal) hit cleanly.
//
// Used by senate_lda (revolving-door lobbyists) and advisory_boards
// (board members) v1.3+; FACA stays on its own pattern until a deliberate
// migration pass.
//
// **CAUTION**: Person dedupe is delicate. "John Smith" can be 10 unrelated
// people in a workspace. Exact-name auto-merging risks false positives.
// This resolver uses exact normalized-name match only for resolution.
//
// v1.1 (additive): on auto-create, the resolver runs a Jaro-Winkler
// similarity scan against the existing Person cache. Matches at or above
// `MERGE_CANDIDATE_THRESHOLD` (0.92 default) write entries to
// `workspaces/{wsId}/personMergeCandidates/{pairKey}` for operator
// review — the resolver itself never auto-merges across fuzzy matches.
// Operator confirmation/decline surface is built in a follow-up arc.

import { db, wsPath } from "./rtdb";
import { Logger } from "./logger";
import type { Person } from "./types/entities";
import type { SourceProvenance } from "./types";

// Honorifics + military ranks stripped from the start of a name when
// normalizing. Order matters — longer phrases first so "Lt Gen" doesn't
// get partially consumed by "Lt".
const HONORIFIC_PREFIXES = [
  "the\\s+honorable",
  "lt\\s+gen",
  "maj\\s+gen",
  "brig\\s+gen",
  "rear\\s+adm",
  "vice\\s+adm",
  "dr",
  "mr",
  "mrs",
  "ms",
  "hon",
  "gen",
  "ltc",
  "ltg",
  "mg",
  "bg",
  "adm",
  "vadm",
  "radm",
  "rdml",
  "capt",
  "col",
  "lt\\s+col",
  "maj",
  "sgt",
  "amb",
  "prof",
  "sen",
  "rep",
];

const HONORIFIC_RE = new RegExp(
  `^(?:${HONORIFIC_PREFIXES.join("|")})\\.?\\s+`,
  "i"
);

const SUFFIX_RE = /\s+(?:jr\.?|sr\.?|ii|iii|iv|v|usa(?:f)?(?:\s*\(?ret\.?\)?)?|usn(?:\s*\(?ret\.?\)?)?|usmc(?:\s*\(?ret\.?\)?)?|uscg(?:\s*\(?ret\.?\)?)?|ussf(?:\s*\(?ret\.?\)?)?|\(?ret\.?\)?)$/i;

/** Normalize a Person full name for dedupe matching:
 *   1. Strip leading honorifics + military ranks
 *   2. Strip trailing suffixes (Jr/Sr/II-V, military branch + Ret.)
 *   3. Lowercase, strip punctuation, collapse whitespace
 *   4. Drop middle initials (single uppercase letter + optional period) —
 *      keeps "John A. Smith" and "John Smith" colliding, which is the
 *      common dedupe case. Multi-letter middle names are preserved.
 */
export function normalizePersonName(name: string): string {
  let s = String(name || "").trim();
  if (!s) return "";
  // Strip leading honorifics, possibly multiple
  let prevLen = -1;
  while (s.length !== prevLen) {
    prevLen = s.length;
    s = s.replace(HONORIFIC_RE, "");
  }
  // Strip trailing suffixes, possibly multiple
  prevLen = -1;
  while (s.length !== prevLen) {
    prevLen = s.length;
    s = s.replace(SUFFIX_RE, "");
  }
  // Drop punctuation (commas, periods) for stable matching
  s = s.replace(/[,.]/g, "");
  // Lowercase, collapse whitespace
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  // Drop middle initial(s) — single-letter tokens between first and last
  const parts = s.split(" ");
  if (parts.length >= 3) {
    const filtered = parts.filter((p, i) => {
      if (i === 0 || i === parts.length - 1) return true;
      return p.length > 1; // drop bare single-letter initials
    });
    s = filtered.join(" ");
  }
  return s;
}

interface PersonCache {
  byName: Map<string, string>; // normalized full name → personId
  /** v1.1: id → display name for fuzzy candidate emission. Tracked
   *  alongside byName so the merge-candidate writer can persist both
   *  sides' display names without an extra RTDB read. Display name = the
   *  first canonical form seen for this id. */
  displayNameById: Map<string, string>;
}

let _cache: { workspaceId: string; cache: PersonCache; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// v1.2 (2026-06-02) — per-process in-flight dedupe for cache load + create.
// Mirrors the orgResolver v1.3 fix. The race shape is identical: between
// cache.byName.has(norm) and the cache.byName.set after db.set, an `await`
// boundary lets two concurrent callers each mint a new personId for the
// same normalized name. Workspace 1777435779676 produced "Bruce Hoffman",
// "Jamil Jaffer", and 6 honorific pairs (The Honorable X / General X)
// because the honorific normalizer collapsed both forms to the same key
// but the create race produced separate person nodes.
const _inFlightCacheLoad = new Map<string, Promise<PersonCache>>();
const _inFlightByName = new Map<string, Promise<{ personId: string; created: boolean; matchedVia: "canonical" | "alternate" | "none"; fuzzyCandidatesEmitted?: number }>>();

/** v1.1: Jaro-Winkler similarity threshold for surfacing a merge
 *  candidate to the operator. Exact matches collapse via byName before
 *  reaching this code. Tuned conservatively — at 0.92 the typical false
 *  positive rate on real-world rosters is low while still catching
 *  "Jane A Doe" vs "Jane Anne Doe" and "Robert Smith" vs "Bob Smith"
 *  (after honorific/suffix stripping). */
const MERGE_CANDIDATE_THRESHOLD = 0.92;

/** v1.1: per-call cap on fuzzy candidate emissions to keep sync-run
 *  costs bounded when a fresh source dumps hundreds of Persons. */
const MAX_FUZZY_CANDIDATES_PER_CALL = 3;

async function loadPersonCache(workspaceId: string): Promise<PersonCache> {
  const now = Date.now();
  if (_cache && _cache.workspaceId === workspaceId && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.cache;
  }
  const inflight = _inFlightCacheLoad.get(workspaceId);
  if (inflight) return inflight;
  const work = (async (): Promise<PersonCache> => {
    const snap = await db.ref(wsPath(workspaceId, "nodes")).once("value");
    const nodes = (snap.val() as Record<string, Person> | null) ?? {};
    const cache: PersonCache = { byName: new Map(), displayNameById: new Map() };
    for (const [id, node] of Object.entries(nodes)) {
      if (!node || node.type !== "person" || !node.name) continue;
      const norm = normalizePersonName(node.name);
      if (norm) cache.byName.set(norm, id);
      if (!cache.displayNameById.has(id)) cache.displayNameById.set(id, node.name);
      if (node.alternateNames) {
        for (const alt of node.alternateNames) {
          const altNorm = normalizePersonName(alt);
          if (altNorm) cache.byName.set(altNorm, id);
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

// ─── v1.1: Jaro-Winkler fuzzy similarity ────────────────────────────────
//
// v1.1.1 (2026-05-22): jaroSimilarity + jaroWinklerSimilarity extracted
// to framework/similarity.ts (shared with orgResolver). Re-exporting from
// here so any existing callers of this module's named export keep working.

export { jaroWinklerSimilarity } from "./similarity";
import { jaroWinklerSimilarity } from "./similarity";

/** v1.1: scan the cache for fuzzy matches against the just-resolved
 *  Person and persist candidate merge entries for operator review.
 *  Never auto-merges. Skips pairs already resolved (operator merged
 *  or declined). Caps emissions per call at MAX_FUZZY_CANDIDATES_PER_CALL.
 *
 *  Returns the count of new candidates written. */
async function emitFuzzyMergeCandidates(
  workspaceId: string,
  resolvedPersonId: string,
  resolvedDisplayName: string,
  resolvedNorm: string,
  cache: PersonCache,
  log?: Logger
): Promise<number> {
  if (!resolvedNorm) return 0;
  // Surnames as a quick gating heuristic: skip pairs whose last tokens
  // diverge sharply. "John Smith" vs "John Schmidt" gets through; "John
  // Smith" vs "John Lopez" gets filtered before the (more expensive)
  // full-name JW call.
  const myParts = resolvedNorm.split(" ");
  if (myParts.length < 2) return 0;
  const mySurname = myParts[myParts.length - 1];

  // Collect candidates in a first pass without RTDB hits, then write
  // top-scoring N in a second pass. This keeps the read-cost bounded
  // even when many cache entries qualify by similarity.
  const ranked: Array<{ otherId: string; sim: number; otherNorm: string }> = [];
  for (const [otherNorm, otherPersonId] of cache.byName) {
    if (otherPersonId === resolvedPersonId) continue;
    if (otherNorm === resolvedNorm) continue;
    const otherParts = otherNorm.split(" ");
    if (otherParts.length < 2) continue;
    const otherSurname = otherParts[otherParts.length - 1];
    if (mySurname[0] !== otherSurname[0]) {
      const surnameSim = jaroWinklerSimilarity(mySurname, otherSurname);
      if (surnameSim < 0.85) continue;
    }
    const sim = jaroWinklerSimilarity(resolvedNorm, otherNorm);
    if (sim < MERGE_CANDIDATE_THRESHOLD) continue;
    if (sim >= 1.0) continue;
    ranked.push({ otherId: otherPersonId, sim, otherNorm });
  }
  ranked.sort((a, b) => b.sim - a.sim);
  const top = ranked.slice(0, MAX_FUZZY_CANDIDATES_PER_CALL);

  let emitted = 0;
  for (const c of top) {
    const [idA, idB] =
      resolvedPersonId < c.otherId
        ? [resolvedPersonId, c.otherId]
        : [c.otherId, resolvedPersonId];
    const pairKey = `${idA}__${idB}`;
    try {
      const existingSnap = await db
        .ref(wsPath(workspaceId, "personMergeCandidates", pairKey))
        .once("value");
      const existing = existingSnap.val() as { resolved?: string } | null;
      if (existing && existing.resolved) continue;
      const otherDisplayName =
        cache.displayNameById.get(c.otherId) || c.otherNorm;
      const candidate = {
        idA,
        idB,
        nameA: idA === resolvedPersonId ? resolvedDisplayName : otherDisplayName,
        nameB: idB === resolvedPersonId ? resolvedDisplayName : otherDisplayName,
        normA: idA === resolvedPersonId ? resolvedNorm : c.otherNorm,
        normB: idB === resolvedPersonId ? resolvedNorm : c.otherNorm,
        similarity: Math.round(c.sim * 1000) / 1000,
        proposedAt: Date.now(),
      };
      await db
        .ref(wsPath(workspaceId, "personMergeCandidates", pairKey))
        .set(candidate);
      emitted++;
    } catch (err) {
      log?.warn?.("person_fuzzy_candidate_emit_failed", {
        pairKey,
        message: (err as Error).message,
      });
    }
  }
  if (emitted > 0) {
    log?.debug?.("person_fuzzy_candidates_emitted", {
      resolvedPersonId,
      count: emitted,
    });
  }
  return emitted;
}

export function invalidatePersonCache(): void {
  _cache = null;
}

/**
 * Resolve a Person by full name to an existing node (if matched) or
 * auto-create. Returns the Person id + whether a fresh node was written
 * and whether the existing node was found via the canonical name or an
 * alternate.
 *
 * `preferredId` is an optional hint: when supplied AND no existing match
 * is found, the new Person is created with that id (lets callers keep
 * source-stable ids like "pers_lda_{lobbyistId}" or
 * "pers_advboard_{boardKey}_{name_norm}"). When omitted, a random id is
 * generated.
 *
 * `alternateNames` are persisted on auto-create + indexed in the cache
 * so subsequent lookups from the other source dedupe correctly.
 */
export async function resolvePersonByName(
  workspaceId: string,
  fullName: string,
  options: {
    autoCreate?: boolean;
    preferredId?: string;
    alternateNames?: string[];
    role?: string;
    org?: string;
    provenance: SourceProvenance;
    /** v1.1: emit fuzzy merge candidates on auto-create. Default true.
     *  Callers running in high-volume batch contexts (e.g., a one-time
     *  migration) can set false to skip the scan + RTDB writes. */
    emitFuzzyCandidates?: boolean;
    /** v1.1: optional logger for fuzzy-candidate diagnostics. */
    log?: Logger;
  }
): Promise<{ personId: string; created: boolean; matchedVia: "canonical" | "alternate" | "none"; fuzzyCandidatesEmitted?: number }> {
  if (!fullName || !fullName.trim()) {
    throw new Error("resolvePersonByName: fullName is required");
  }
  const cache = await loadPersonCache(workspaceId);
  const norm = normalizePersonName(fullName);

  // Exact normalized match
  if (norm && cache.byName.has(norm)) {
    return { personId: cache.byName.get(norm)!, created: false, matchedVia: "canonical" };
  }
  // Alternate-name match
  if (Array.isArray(options.alternateNames) && options.alternateNames.length > 0) {
    for (const alt of options.alternateNames) {
      if (!alt) continue;
      const altNorm = normalizePersonName(alt);
      if (altNorm && cache.byName.has(altNorm)) {
        return {
          personId: cache.byName.get(altNorm)!,
          created: false,
          matchedVia: "alternate",
        };
      }
    }
  }

  // v1.2 — in-flight dedupe. Skip the key when norm is empty (resolver
  // would still fall through to creating a Person with no normalized key,
  // which is rare but valid; we just don't bother deduping that case).
  // When a preferredId is supplied (deterministic source-stable id), the
  // create itself is idempotent, so skip in-flight registration too.
  const nameKey = norm && !options.preferredId ? `${workspaceId}::name::${norm}` : null;
  if (nameKey) {
    const existing = _inFlightByName.get(nameKey);
    if (existing) return existing;
  }

  if (options.autoCreate === false) {
    throw new Error(`No matching Person for "${fullName}"`);
  }

  // Auto-create — wrap in IIFE so the in-flight promise is published
  // synchronously, before the first await inside the create.
  const work = (async (): Promise<{ personId: string; created: boolean; matchedVia: "canonical" | "alternate" | "none"; fuzzyCandidatesEmitted?: number }> => {
    const personId =
      options.preferredId ||
      "pers_" + (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 12)
        : String(Date.now()) + Math.floor(Math.random() * 1000));

    // Persist alternates that don't normalize to the canonical form
    const altPersist = (options.alternateNames || []).filter(
      (a): a is string =>
        !!a && a.trim().length > 0 && normalizePersonName(a) !== norm
    );

    const newPerson: Person = {
      id: personId,
      type: "person",
      name: fullName.trim(),
      role: options.role || undefined,
      org: options.org || undefined,
      alternateNames: altPersist.length > 0 ? altPersist : undefined,
      created: new Date().toISOString(),
      source: options.provenance,
    };

    await db.ref(wsPath(workspaceId, "nodes", personId)).set(newPerson);

    // Update cache
    if (norm) cache.byName.set(norm, personId);
    if (!cache.displayNameById.has(personId)) {
      cache.displayNameById.set(personId, newPerson.name);
    }
    for (const alt of altPersist) {
      const altNorm = normalizePersonName(alt);
      if (altNorm) cache.byName.set(altNorm, personId);
    }
    // Mirror to the canonical _cache if we're holding a non-canonical copy.
    if (_cache && _cache.workspaceId === workspaceId && _cache.cache !== cache) {
      if (norm) _cache.cache.byName.set(norm, personId);
      if (!_cache.cache.displayNameById.has(personId)) {
        _cache.cache.displayNameById.set(personId, newPerson.name);
      }
      for (const alt of altPersist) {
        const altNorm = normalizePersonName(alt);
        if (altNorm) _cache.cache.byName.set(altNorm, personId);
      }
    }

    // v1.1: fuzzy candidate emission (default on; opt-out for migrations)
    let fuzzyCandidatesEmitted = 0;
    if (options.emitFuzzyCandidates !== false) {
      try {
        fuzzyCandidatesEmitted = await emitFuzzyMergeCandidates(
          workspaceId,
          personId,
          newPerson.name,
          norm,
          cache,
          options.log
        );
      } catch (err) {
        options.log?.warn?.("person_fuzzy_emit_pass_failed", {
          personId,
          message: (err as Error).message,
        });
      }
    }

    return { personId, created: true, matchedVia: "none", fuzzyCandidatesEmitted };
  })();

  if (nameKey) _inFlightByName.set(nameKey, work);
  try {
    return await work;
  } finally {
    if (nameKey) _inFlightByName.delete(nameKey);
  }
}
