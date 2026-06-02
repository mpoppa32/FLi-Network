// Corsair — generic node-merge backfill core.
//
// Cleans up duplicate Organization and Person nodes accumulated by the
// pre-v1.3 orgResolver / pre-v1.2 personResolver race. Workspace
// 1777435779676 produced 17 such clusters before the in-flight dedupe
// landed; this function exists to clean them up and to handle any future
// stragglers (e.g. cross-instance races that the in-flight fix can't
// catch).
//
// Algorithm per type (orgs scanned with normalizeName, persons with
// normalizePersonName):
//   1. Group nodes by (type, normalized-name).
//   2. For each cluster of >= 2 members:
//        a. Pick canonical — prefer non-autoCreated, then oldest createdAt,
//           then lowest id (deterministic tiebreak so re-runs converge).
//        b. Union display names from non-canonical members onto canonical
//           as alternateNames (only those that don't normalize to the same
//           form as the canonical name).
//        c. Rewrite every reference to any dup id → canonical id across:
//             nodes.parentOrgId
//             awards.primeOrgId / primeParentOrgId / customerOrgId /
//               customerToptierOrgId / subawards[].subOrgId
//             awardsByPrime/{orgId}/* (inverted index — move keys)
//             awardsByCustomer/{orgId}/* (inverted index — move keys)
//             awardsByPopEnd/{day}/{awardId}.primeOrgId (value patch)
//             opportunities.customerOrgId
//             signals.subjectIds[] / relatedIds[]
//             signals.attrs.protestorOrgId / awardeeOrgId / agencyOrgId
//             signals.attrs.witnesses[].personId
//             edges.source / target
//        d. Delete each dup node.
//
// Edge dedupe is NOT performed — after source/target rewrite, edges that
// were previously separate (one per dup) collapse onto the same (source,
// target) pair but retain distinct edge ids. Functional impact is minor;
// operator-visible edge bloat is acceptable. A follow-up pass could
// collapse by (source, target, label) if it proves noisy in practice.
//
// All writes batch into one updates map and apply via db.ref().update() so
// the merge is atomic at the RTDB level — readers see either pre-merge
// or post-merge state but never a half-rewritten reference set.
//
// Idempotent. Re-runs over an already-merged workspace are a no-op (no
// clusters of >= 2 remain).

import { Logger } from "../framework/logger";
import { db, wsPath } from "../framework/rtdb";
import { normalizeName, invalidateOrgCache } from "../sources/usaSpending/orgResolver";
import { normalizePersonName, invalidatePersonCache } from "../framework/personResolver";
import type { Organization, Person } from "../framework/types/entities";

interface NodeLike {
  id?: string;
  type?: string;
  name?: string;
  alternateNames?: string[];
  autoCreated?: boolean;
  created?: string | number;
  parentOrgId?: string;
}

export interface BackfillOrgMergeOptions {
  /** Substrings (lowercased) that, if present in a normalized name, cause
   *  the cluster to be skipped entirely. Operator uses this to exclude
   *  clusters being handled by a separate process (e.g. AeroVironment
   *  during the P13.x parent-session merge). */
  excludeIfNormContains?: string[];
  /** If true, scan and report but skip every write. */
  dryRun?: boolean;
}

export interface MergedCluster {
  type: "org" | "person";
  norm: string;
  canonicalId: string;
  canonicalName: string;
  mergedIds: string[];
  mergedDisplayNames: string[];
  alternateNamesAdded: string[];
  refsRewritten: number;
}

export interface BackfillOrgMergeResult {
  workspaceId: string;
  dryRun: boolean;
  orgClustersScanned: number;
  personClustersScanned: number;
  orgClustersMerged: number;
  personClustersMerged: number;
  clustersSkippedByExclude: number;
  dupsDeleted: number;
  totalRefsRewritten: number;
  clusters: MergedCluster[];
}

interface ScanContext {
  workspaceId: string;
  options: BackfillOrgMergeOptions;
  updates: Record<string, unknown>;
  log?: Logger;
  result: BackfillOrgMergeResult;
}

/** Pick the canonical id from a cluster — non-autoCreated first, then
 *  oldest createdAt, then lowest id lexicographic. */
function pickCanonical(cluster: Array<{ id: string; node: NodeLike }>): { id: string; node: NodeLike } {
  return [...cluster].sort((a, b) => {
    const aAuto = a.node.autoCreated ? 1 : 0;
    const bAuto = b.node.autoCreated ? 1 : 0;
    if (aAuto !== bAuto) return aAuto - bAuto;
    const aTime = parseCreated(a.node.created);
    const bTime = parseCreated(b.node.created);
    if (aTime !== bTime) return aTime - bTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

function parseCreated(c: string | number | undefined): number {
  if (c == null) return Number.MAX_SAFE_INTEGER;
  if (typeof c === "number") return c;
  const t = Date.parse(c);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

function isExcluded(norm: string, options: BackfillOrgMergeOptions): boolean {
  if (!options.excludeIfNormContains || options.excludeIfNormContains.length === 0) return false;
  const lower = norm.toLowerCase();
  return options.excludeIfNormContains.some((needle) => lower.includes(needle.toLowerCase()));
}

/** Walk a value tree and replace any string equal to a key in `idMap`
 *  with idMap.get(key). Returns the rewritten value and a count of
 *  replacements. Designed to handle nested objects/arrays found in
 *  Signal.attrs (witnesses[].personId etc.) without naming each field. */
function rewriteIdsInTree(value: unknown, idMap: Map<string, string>): { value: unknown; count: number } {
  if (typeof value === "string") {
    const replacement = idMap.get(value);
    return replacement ? { value: replacement, count: 1 } : { value, count: 0 };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const next = value.map((v) => {
      const r = rewriteIdsInTree(v, idMap);
      count += r.count;
      return r.value;
    });
    return { value: next, count };
  }
  if (value && typeof value === "object") {
    let count = 0;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = rewriteIdsInTree(v, idMap);
      count += r.count;
      next[k] = r.value;
    }
    return { value: next, count };
  }
  return { value, count: 0 };
}

function isOrgType(t: string | undefined): boolean {
  if (!t) return true; // legacy untyped nodes treated as org
  return (
    t === "company" ||
    t === "government" ||
    t === "foreign_government" ||
    t === "program" ||
    t === "committee" ||
    t === "lobby_firm" ||
    t === "university" ||
    t === "ffrdc" ||
    t === "trade_assoc" ||
    t === "other"
  );
}

async function processClusters(
  ctx: ScanContext,
  nodes: Record<string, NodeLike>,
  type: "org" | "person"
): Promise<void> {
  const normalizer = type === "org" ? normalizeName : normalizePersonName;
  const groups = new Map<string, Array<{ id: string; node: NodeLike }>>();
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || !node.name) continue;
    if (type === "org" && !isOrgType(node.type)) continue;
    if (type === "person" && node.type !== "person") continue;
    const norm = normalizer(node.name);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push({ id, node });
  }

  for (const [norm, cluster] of groups) {
    if (cluster.length < 2) continue;
    if (type === "org") ctx.result.orgClustersScanned++;
    else ctx.result.personClustersScanned++;

    if (isExcluded(norm, ctx.options)) {
      ctx.result.clustersSkippedByExclude++;
      ctx.log?.info("backfill_node_merge_cluster_excluded", {
        type,
        norm,
        size: cluster.length,
      });
      continue;
    }

    const canonical = pickCanonical(cluster);
    const dups = cluster.filter((c) => c.id !== canonical.id);
    const idMap = new Map<string, string>();
    for (const d of dups) idMap.set(d.id, canonical.id);

    // Build alternate-name union — preserve any name (canonical alternates
    // or dup display names / alternates) that doesn't normalize to the
    // canonical's norm. Dedupe by exact string after normalization-of-norm.
    const altSet = new Set<string>();
    for (const existing of canonical.node.alternateNames || []) {
      if (normalizer(existing) !== norm) altSet.add(existing);
    }
    const newlyAdded: string[] = [];
    const dupDisplayNames: string[] = [];
    for (const d of dups) {
      if (d.node.name) {
        dupDisplayNames.push(d.node.name);
        if (normalizer(d.node.name) !== norm && !altSet.has(d.node.name)) {
          altSet.add(d.node.name);
          newlyAdded.push(d.node.name);
        }
      }
      for (const alt of d.node.alternateNames || []) {
        if (normalizer(alt) !== norm && !altSet.has(alt)) {
          altSet.add(alt);
          newlyAdded.push(alt);
        }
      }
    }
    const mergedAlternateNames = Array.from(altSet);

    // Schedule canonical alternateNames write + dup deletes.
    if (mergedAlternateNames.length > 0) {
      ctx.updates[`${wsPath(ctx.workspaceId, "nodes", canonical.id)}/alternateNames`] = mergedAlternateNames;
    }
    for (const d of dups) {
      ctx.updates[wsPath(ctx.workspaceId, "nodes", d.id)] = null;
    }

    // Rewrite references — count rewrites for telemetry.
    const cluster_refsRewritten = await rewriteReferences(ctx, idMap, nodes);

    ctx.result.dupsDeleted += dups.length;
    ctx.result.totalRefsRewritten += cluster_refsRewritten;
    if (type === "org") ctx.result.orgClustersMerged++;
    else ctx.result.personClustersMerged++;

    ctx.result.clusters.push({
      type,
      norm,
      canonicalId: canonical.id,
      canonicalName: canonical.node.name || norm,
      mergedIds: dups.map((d) => d.id),
      mergedDisplayNames: dupDisplayNames,
      alternateNamesAdded: newlyAdded,
      refsRewritten: cluster_refsRewritten,
    });
  }
}

/** Walk every record that may reference a node id and stage rewrites. */
async function rewriteReferences(
  ctx: ScanContext,
  idMap: Map<string, string>,
  nodes: Record<string, NodeLike>
): Promise<number> {
  let count = 0;

  // ─── nodes.parentOrgId ──────────────────────────────────────────────────
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node?.parentOrgId) continue;
    const replacement = idMap.get(node.parentOrgId);
    if (replacement) {
      ctx.updates[`${wsPath(ctx.workspaceId, "nodes", nodeId)}/parentOrgId`] = replacement;
      count++;
    }
  }

  // ─── awards ─────────────────────────────────────────────────────────────
  const awardsSnap = await db.ref(wsPath(ctx.workspaceId, "awards")).once("value");
  const awards = (awardsSnap.val() as Record<string, Record<string, unknown>> | null) ?? {};
  for (const [awardId, award] of Object.entries(awards)) {
    if (!award) continue;
    const fields = ["primeOrgId", "primeParentOrgId", "customerOrgId", "customerToptierOrgId"];
    for (const field of fields) {
      const v = award[field];
      if (typeof v === "string") {
        const replacement = idMap.get(v);
        if (replacement) {
          ctx.updates[`${wsPath(ctx.workspaceId, "awards", awardId)}/${field}`] = replacement;
          count++;
        }
      }
    }
    // subawards[].subOrgId
    const subs = award.subawards;
    if (Array.isArray(subs)) {
      let mutated = false;
      const nextSubs = subs.map((s) => {
        if (s && typeof s === "object") {
          const sub = s as Record<string, unknown>;
          if (typeof sub.subOrgId === "string") {
            const replacement = idMap.get(sub.subOrgId);
            if (replacement) {
              mutated = true;
              count++;
              return { ...sub, subOrgId: replacement };
            }
          }
        }
        return s;
      });
      if (mutated) {
        ctx.updates[`${wsPath(ctx.workspaceId, "awards", awardId)}/subawards`] = nextSubs;
      }
    }
  }

  // ─── awardsByPrime/{orgId} — merge dup keys into canonical key ──────────
  for (const [dupId, canonicalId] of idMap) {
    const dupSnap = await db.ref(wsPath(ctx.workspaceId, "awardsByPrime", dupId)).once("value");
    const entries = (dupSnap.val() as Record<string, unknown> | null) ?? null;
    if (entries) {
      for (const [awardId, entry] of Object.entries(entries)) {
        ctx.updates[wsPath(ctx.workspaceId, "awardsByPrime", canonicalId, awardId)] = entry;
        count++;
      }
      ctx.updates[wsPath(ctx.workspaceId, "awardsByPrime", dupId)] = null;
    }
    const dupCSnap = await db.ref(wsPath(ctx.workspaceId, "awardsByCustomer", dupId)).once("value");
    const cEntries = (dupCSnap.val() as Record<string, unknown> | null) ?? null;
    if (cEntries) {
      for (const [awardId, entry] of Object.entries(cEntries)) {
        ctx.updates[wsPath(ctx.workspaceId, "awardsByCustomer", canonicalId, awardId)] = entry;
        count++;
      }
      ctx.updates[wsPath(ctx.workspaceId, "awardsByCustomer", dupId)] = null;
    }
  }

  // ─── awardsByPopEnd/{day}/{awardId} — patch in-value primeOrgId ─────────
  const popEndSnap = await db.ref(wsPath(ctx.workspaceId, "awardsByPopEnd")).once("value");
  const popEnd = (popEndSnap.val() as Record<string, Record<string, Record<string, unknown>>> | null) ?? {};
  for (const [day, dayEntries] of Object.entries(popEnd)) {
    if (!dayEntries) continue;
    for (const [awardId, entry] of Object.entries(dayEntries)) {
      if (!entry) continue;
      const prime = entry.primeOrgId;
      if (typeof prime === "string") {
        const replacement = idMap.get(prime);
        if (replacement) {
          ctx.updates[`${wsPath(ctx.workspaceId, "awardsByPopEnd", day, awardId)}/primeOrgId`] = replacement;
          count++;
        }
      }
    }
  }

  // ─── opportunities.customerOrgId ────────────────────────────────────────
  const oppsSnap = await db.ref(wsPath(ctx.workspaceId, "opportunities")).once("value");
  const opps = (oppsSnap.val() as Record<string, Record<string, unknown>> | null) ?? {};
  for (const [oppId, opp] of Object.entries(opps)) {
    if (!opp) continue;
    const v = opp.customerOrgId;
    if (typeof v === "string") {
      const replacement = idMap.get(v);
      if (replacement) {
        ctx.updates[`${wsPath(ctx.workspaceId, "opportunities", oppId)}/customerOrgId`] = replacement;
        count++;
      }
    }
  }

  // ─── signals — subjectIds, relatedIds, attrs (deep tree walk) ───────────
  const sigsSnap = await db.ref(wsPath(ctx.workspaceId, "signals")).once("value");
  const sigs = (sigsSnap.val() as Record<string, Record<string, unknown>> | null) ?? {};
  for (const [sigId, sig] of Object.entries(sigs)) {
    if (!sig) continue;
    for (const arrField of ["subjectIds", "relatedIds"]) {
      const arr = sig[arrField];
      if (Array.isArray(arr)) {
        let mutated = false;
        const next = arr.map((v) => {
          if (typeof v === "string") {
            const replacement = idMap.get(v);
            if (replacement) {
              mutated = true;
              count++;
              return replacement;
            }
          }
          return v;
        });
        if (mutated) {
          ctx.updates[`${wsPath(ctx.workspaceId, "signals", sigId)}/${arrField}`] = next;
        }
      }
    }
    if (sig.attrs && typeof sig.attrs === "object") {
      const { value: nextAttrs, count: attrsCount } = rewriteIdsInTree(sig.attrs, idMap);
      if (attrsCount > 0) {
        ctx.updates[`${wsPath(ctx.workspaceId, "signals", sigId)}/attrs`] = nextAttrs;
        count += attrsCount;
      }
    }
  }

  // ─── edges.source / target ──────────────────────────────────────────────
  const edgesSnap = await db.ref(wsPath(ctx.workspaceId, "edges")).once("value");
  const edges = (edgesSnap.val() as Record<string, Record<string, unknown>> | null) ?? {};
  for (const [edgeId, edge] of Object.entries(edges)) {
    if (!edge) continue;
    for (const endpoint of ["source", "target"]) {
      const v = edge[endpoint];
      if (typeof v === "string") {
        const replacement = idMap.get(v);
        if (replacement) {
          ctx.updates[`${wsPath(ctx.workspaceId, "edges", edgeId)}/${endpoint}`] = replacement;
          count++;
        }
      }
    }
  }

  // ─── orgMergeCandidates / personMergeCandidates — purge stale pairs ────
  //
  // Candidate entries reference deleted dup ids; the operator review UI
  // would 404 on the missing side. Easiest path: delete any candidate
  // entry touching a dup id. The fuzzy emitter will re-surface a fresh
  // candidate against the canonical id on the next sync if the pair is
  // still ambiguous.
  for (const candidatesPath of ["orgMergeCandidates", "personMergeCandidates"]) {
    const candSnap = await db.ref(wsPath(ctx.workspaceId, candidatesPath)).once("value");
    const candidates = (candSnap.val() as Record<string, Record<string, unknown>> | null) ?? {};
    for (const [pairKey, candidate] of Object.entries(candidates)) {
      if (!candidate) continue;
      const idA = typeof candidate.idA === "string" ? candidate.idA : "";
      const idB = typeof candidate.idB === "string" ? candidate.idB : "";
      if (idMap.has(idA) || idMap.has(idB)) {
        ctx.updates[wsPath(ctx.workspaceId, candidatesPath, pairKey)] = null;
        count++;
      }
    }
  }

  return count;
}

export async function backfillOrgMergeForWorkspace(
  workspaceId: string,
  options: BackfillOrgMergeOptions = {},
  log?: Logger
): Promise<BackfillOrgMergeResult> {
  log?.info("backfill_org_merge_started", {
    workspaceId,
    excludeIfNormContains: options.excludeIfNormContains || [],
    dryRun: !!options.dryRun,
  });

  const nodesSnap = await db.ref(wsPath(workspaceId, "nodes")).once("value");
  const nodes = (nodesSnap.val() as Record<string, NodeLike> | null) ?? {};

  const result: BackfillOrgMergeResult = {
    workspaceId,
    dryRun: !!options.dryRun,
    orgClustersScanned: 0,
    personClustersScanned: 0,
    orgClustersMerged: 0,
    personClustersMerged: 0,
    clustersSkippedByExclude: 0,
    dupsDeleted: 0,
    totalRefsRewritten: 0,
    clusters: [],
  };

  const ctx: ScanContext = {
    workspaceId,
    options,
    updates: {},
    log,
    result,
  };

  await processClusters(ctx, nodes, "org");
  await processClusters(ctx, nodes, "person");

  if (!options.dryRun && Object.keys(ctx.updates).length > 0) {
    // RTDB caps multi-location updates at 64MB; chunk if necessary. In
    // practice the 17-cluster workspace fits comfortably under that.
    await db.ref().update(ctx.updates);
    // Bust resolver caches so subsequent syncs see the merged state.
    invalidateOrgCache();
    invalidatePersonCache();
  }

  log?.info("backfill_org_merge_completed", {
    workspaceId,
    dryRun: result.dryRun,
    orgClustersMerged: result.orgClustersMerged,
    personClustersMerged: result.personClustersMerged,
    clustersSkippedByExclude: result.clustersSkippedByExclude,
    dupsDeleted: result.dupsDeleted,
    totalRefsRewritten: result.totalRefsRewritten,
    updateKeys: Object.keys(ctx.updates).length,
  });

  return result;
}

// Re-export types touched in case future callers want to destructure.
export type { Organization, Person };
