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
// This resolver uses exact normalized-name match only — fuzzy matching
// (Jaro-Winkler etc.) is deferred to v1.1 with operator-side review of
// candidate merges.

import { db, wsPath } from "./rtdb";
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
}

let _cache: { workspaceId: string; cache: PersonCache; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadPersonCache(workspaceId: string): Promise<PersonCache> {
  const now = Date.now();
  if (_cache && _cache.workspaceId === workspaceId && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.cache;
  }
  const snap = await db.ref(wsPath(workspaceId, "nodes")).once("value");
  const nodes = (snap.val() as Record<string, Person> | null) ?? {};
  const cache: PersonCache = { byName: new Map() };
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || node.type !== "person" || !node.name) continue;
    const norm = normalizePersonName(node.name);
    if (norm) cache.byName.set(norm, id);
    if (node.alternateNames) {
      for (const alt of node.alternateNames) {
        const altNorm = normalizePersonName(alt);
        if (altNorm) cache.byName.set(altNorm, id);
      }
    }
  }
  _cache = { workspaceId, cache, loadedAt: now };
  return cache;
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
  }
): Promise<{ personId: string; created: boolean; matchedVia: "canonical" | "alternate" | "none" }> {
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

  if (options.autoCreate === false) {
    throw new Error(`No matching Person for "${fullName}"`);
  }

  // Auto-create
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
  for (const alt of altPersist) {
    const altNorm = normalizePersonName(alt);
    if (altNorm) cache.byName.set(altNorm, personId);
  }

  return { personId, created: true, matchedVia: "none" };
}
