// USAspending source — Organization resolver
//
// Per Award integration spec Part Six: resolve recipient names and agency
// names to Corsair Organization entities. Match against existing, auto-
// create when no match.
//
// For V1 we use simple name-normalization + exact match. Fuzzy matching
// (Jaro-Winkler) is a follow-up enhancement.

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import type { SourceProvenance } from "../../framework/types";
import type { Organization, OrganizationType } from "../../framework/types/entities";

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
}

let _cache: { workspaceId: string; cache: OrgCache; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadOrgCache(workspaceId: string): Promise<OrgCache> {
  const now = Date.now();
  if (_cache && _cache.workspaceId === workspaceId && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.cache;
  }
  const snap = await db.ref(wsPath(workspaceId, "nodes")).once("value");
  const nodes = (snap.val() as Record<string, Organization> | null) ?? {};
  const cache: OrgCache = { byName: new Map(), byUei: new Map() };
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || !node.name) continue;
    cache.byName.set(normalizeName(node.name), id);
    if (node.uei) cache.byUei.set(node.uei, id);
    if (node.alternateNames) {
      for (const alt of node.alternateNames) {
        cache.byName.set(normalizeName(alt), id);
      }
    }
  }
  _cache = { workspaceId, cache, loadedAt: now };
  return cache;
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
  } = {}
): Promise<{ orgId: string; created: boolean }> {
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

  if (options.autoCreate === false) {
    throw new Error(`No matching Organization for "${recipientName}" (UEI: ${uei || "n/a"})`);
  }

  // Auto-create
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

  const newOrg: Organization = {
    id: orgId,
    type: options.type ?? "company",
    name: recipientName.trim(),
    uei: uei ?? undefined,
    alternateNames: altPersist.length > 0 ? altPersist : undefined,
    autoCreated: true,
    created: new Date().toISOString(),
    source: provenance,
  };

  await db.ref(wsPath(workspaceId, "nodes", orgId)).set(newOrg);

  // Update cache
  cache.byName.set(norm, orgId);
  if (uei) cache.byUei.set(uei, orgId);
  // v1.2: cache alternates so a subsequent lookup in the same sync run
  // hits without re-loading
  for (const alt of altPersist) {
    const altNorm = normalizeName(alt);
    if (altNorm) cache.byName.set(altNorm, orgId);
  }

  return { orgId, created: true };
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
