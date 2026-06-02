// Corsair — company domain enrichment via SAM.gov entity-information API.
//
// Companion to enrichEntityDomainsCore.ts (v1). v1 derived gov-org domains
// from samgovPocs aggregation (pure-graph). v2 derives company domains by
// looking up each company.uei against SAM.gov's entity-information API,
// extracting coreData.entityInformation.entityURL.
//
// Probe results (2026-06-02):
//   652 company nodes total
//   472 have uei populated (72.4%)
//   0 have domain populated  (0.0%)
//
// Rate budget:
//   SAM.gov: 10/sec burst, 1000/hour. Refill 0.278 tokens/sec via the
//   shared sam_gov token bucket (rateLimit.ts:23). acquireTokens blocks
//   until tokens refill; sustained pace ≈ 0.278 calls/sec = 1000/hour.
//   472 calls at this pace = ~28 minutes — exceeds Cloud Function timeout
//   (540s = 9 min). Solution: time-bounded chunked processing. Each run
//   handles whatever fits within `deadlineMs`; idempotent on re-run
//   because we skip nodes that already have node.domain.
//
// Algorithm:
//   1. Load /workspaces/{ws}/nodes
//   2. Filter: type=company AND uei AND !domain.
//   3. For each (until deadline OR maxRecords):
//        a. fetchEntityByUei(uei)
//        b. If totalRecords=0 → record skipNoEntity (UEI not in SAM.gov
//           or not publicly displayed). Stage node.domainFetchAttemptAt
//           so we don't keep re-fetching dead UEIs.
//        c. Extract entityURL → deriveDomainFromUrl. If empty → record
//           skipNoUrl. Stage node.domainFetchAttemptAt.
//        d. Compute confidence by name similarity:
//             HIGH   — Jaro-Winkler(legalBusinessName, node.name) >= 0.85
//             MEDIUM — 0.70 <= JW < 0.85, OR dbaName JW >= 0.85
//             LOW    — JW < 0.70 (still write; matcher confidence chip
//                                   will surface for operator review)
//        e. Stage write: node.domain = derived, node.domainSource =
//           "samgov_entity", node.domainConfidence = tier,
//           node.domainObservedAt = now, node.domainNameMatch = jw score.
//   4. Atomic flush every CHUNK_SIZE nodes.
//   5. Skip nodes with node.domainFetchAttemptAt set if it's < REFRESH_MS old.
//
// Idempotent. Never overwrites existing node.domain. Safe to re-run as
// often as the operator wants — paced by the sam_gov token bucket.
//
// See `corsair-entity-domain-enrichment.md` for design + v1/v2/v3 scope.

import { Logger } from "../framework/logger";
import { db, wsPath } from "../framework/rtdb";
import { fetchEntityByUei, deriveDomainFromUrl } from "../sources/samGov/entityClient";
import { jaroWinklerSimilarity } from "../framework/similarity";
import { normalizeName } from "../sources/usaSpending/orgResolver";

export type CompanyDomainConfidenceTier = "high" | "medium" | "low";

export interface EnrichCompanyDomainsByUeiOptions {
  /** If true, scan and report but skip every write. */
  dryRun?: boolean;
  /** Max nodes to process this run. Default 1000 (effectively unbounded
   *  within deadline). The deadline is the dominant constraint. */
  maxRecords?: number;
  /** Wall-clock budget in ms. Default 450000 (7.5 min) — leaves 90s
   *  safety margin from the 540s Cloud Function timeout. */
  deadlineMs?: number;
  /** Refresh window for previously-attempted-but-unresolved UEIs. Default
   *  90 days. UEIs whose last fetch attempt is younger than this are
   *  skipped to avoid burning rate budget on persistent dead-ends. */
  refreshMs?: number;
}

export interface EnrichedCompany {
  nodeId: string;
  nodeName: string;
  uei: string;
  topDomain: string;
  legalBusinessName?: string;
  jaroWinklerScore: number;
  tier: CompanyDomainConfidenceTier;
}

export interface EnrichCompanyDomainsByUeiResult {
  workspaceId: string;
  dryRun: boolean;
  totalCompanies: number;
  candidatesEligible: number;
  candidatesAttempted: number;
  enriched: EnrichedCompany[];
  skipNoEntity: Array<{ nodeId: string; nodeName: string; uei: string }>;
  skipNoUrl: Array<{ nodeId: string; nodeName: string; uei: string; legalBusinessName?: string }>;
  apiErrors: Array<{ nodeId: string; uei: string; message: string }>;
  tierCounts: { high: number; medium: number; low: number };
  writeCount: number;
  deadlineHit: boolean;
  maxRecordsHit: boolean;
  elapsedMs: number;
}

interface NodeLike {
  id?: string;
  type?: string;
  name?: string;
  domain?: string;
  uei?: string;
  domainFetchAttemptAt?: number;
}

const CHUNK_SIZE = 25;

function pickTier(jw: number): CompanyDomainConfidenceTier {
  if (jw >= 0.85) return "high";
  if (jw >= 0.7) return "medium";
  return "low";
}

export async function enrichCompanyDomainsByUeiForWorkspace(
  workspaceId: string,
  options: EnrichCompanyDomainsByUeiOptions = {},
  log?: Logger
): Promise<EnrichCompanyDomainsByUeiResult> {
  const dryRun = options.dryRun === true;
  const maxRecords = options.maxRecords ?? 1000;
  const deadlineMs = options.deadlineMs ?? 450_000;
  const refreshMs = options.refreshMs ?? 90 * 24 * 60 * 60 * 1000;
  const startedAt = Date.now();
  const deadline = startedAt + deadlineMs;

  const nodesSnap = await db.ref(wsPath(workspaceId, "nodes")).once("value");
  const nodes = (nodesSnap.val() as Record<string, NodeLike> | null) ?? {};

  // Collect eligible candidates
  const candidates: Array<{ id: string; node: NodeLike }> = [];
  let totalCompanies = 0;
  for (const [id, n] of Object.entries(nodes)) {
    if (!n || n.type !== "company") continue;
    totalCompanies++;
    if (!n.uei) continue;
    if (n.domain) continue;
    if (
      typeof n.domainFetchAttemptAt === "number" &&
      startedAt - n.domainFetchAttemptAt < refreshMs
    ) {
      continue;
    }
    candidates.push({ id, node: n });
  }

  const result: EnrichCompanyDomainsByUeiResult = {
    workspaceId,
    dryRun,
    totalCompanies,
    candidatesEligible: candidates.length,
    candidatesAttempted: 0,
    enriched: [],
    skipNoEntity: [],
    skipNoUrl: [],
    apiErrors: [],
    tierCounts: { high: 0, medium: 0, low: 0 },
    writeCount: 0,
    deadlineHit: false,
    maxRecordsHit: false,
    elapsedMs: 0,
  };

  let pendingUpdates: Record<string, unknown> = {};
  let pendingCount = 0;

  async function flushUpdates() {
    if (dryRun || pendingCount === 0) {
      pendingUpdates = {};
      pendingCount = 0;
      return;
    }
    await db.ref().update(pendingUpdates);
    pendingUpdates = {};
    pendingCount = 0;
  }

  for (const { id, node } of candidates) {
    if (Date.now() >= deadline) {
      result.deadlineHit = true;
      break;
    }
    if (result.candidatesAttempted >= maxRecords) {
      result.maxRecordsHit = true;
      break;
    }

    result.candidatesAttempted++;
    const uei = String(node.uei || "");
    const nodeName = String(node.name || "");
    let entity = null as Awaited<ReturnType<typeof fetchEntityByUei>> | null;
    try {
      entity = await fetchEntityByUei(uei, log);
    } catch (err) {
      const e = err as Error;
      result.apiErrors.push({ nodeId: id, uei, message: e.message ?? String(err) });
      log?.warn("enrichment_api_error", { nodeId: id, uei, message: e.message });
      // Don't stage domainFetchAttemptAt on API errors — re-attempt next run.
      continue;
    }

    const observedAt = Date.now();
    const base = wsPath(workspaceId, "nodes", id);

    if (!entity) {
      result.skipNoEntity.push({ nodeId: id, nodeName, uei });
      if (!dryRun) {
        pendingUpdates[`${base}/domainFetchAttemptAt`] = observedAt;
        pendingCount++;
      }
      if (pendingCount >= CHUNK_SIZE) await flushUpdates();
      continue;
    }

    const entityURL = entity.coreData?.entityInformation?.entityURL || "";
    const derived = deriveDomainFromUrl(entityURL);
    const legalName = entity.entityRegistration?.legalBusinessName || "";
    const dbaName = entity.entityRegistration?.dbaName || "";

    if (!derived) {
      result.skipNoUrl.push({ nodeId: id, nodeName, uei, legalBusinessName: legalName });
      if (!dryRun) {
        pendingUpdates[`${base}/domainFetchAttemptAt`] = observedAt;
        pendingCount++;
      }
      if (pendingCount >= CHUNK_SIZE) await flushUpdates();
      continue;
    }

    // Confidence — Jaro-Winkler on normalized names.
    const nodeNorm = normalizeName(nodeName);
    const legalNorm = normalizeName(legalName);
    const dbaNorm = normalizeName(dbaName);
    const jwLegal = legalNorm ? jaroWinklerSimilarity(nodeNorm, legalNorm) : 0;
    const jwDba = dbaNorm ? jaroWinklerSimilarity(nodeNorm, dbaNorm) : 0;
    const jw = Math.max(jwLegal, jwDba);
    const tier = pickTier(jw);

    result.enriched.push({
      nodeId: id,
      nodeName,
      uei,
      topDomain: derived,
      legalBusinessName: legalName || undefined,
      jaroWinklerScore: Number(jw.toFixed(3)),
      tier,
    });
    result.tierCounts[tier]++;
    result.writeCount++;

    if (!dryRun) {
      pendingUpdates[`${base}/domain`] = derived;
      pendingUpdates[`${base}/domainSource`] = "samgov_entity";
      pendingUpdates[`${base}/domainConfidence`] = tier;
      pendingUpdates[`${base}/domainNameMatch`] = Number(jw.toFixed(3));
      pendingUpdates[`${base}/domainObservedAt`] = observedAt;
      pendingUpdates[`${base}/domainFetchAttemptAt`] = observedAt;
      pendingCount++;
      if (pendingCount >= CHUNK_SIZE) await flushUpdates();
    }
  }

  await flushUpdates();
  result.elapsedMs = Date.now() - startedAt;

  log?.info("company_uei_enrichment_completed", {
    workspaceId,
    dryRun,
    totalCompanies,
    candidatesEligible: result.candidatesEligible,
    candidatesAttempted: result.candidatesAttempted,
    writes: result.writeCount,
    high: result.tierCounts.high,
    medium: result.tierCounts.medium,
    low: result.tierCounts.low,
    skipNoEntity: result.skipNoEntity.length,
    skipNoUrl: result.skipNoUrl.length,
    apiErrors: result.apiErrors.length,
    deadlineHit: result.deadlineHit,
    maxRecordsHit: result.maxRecordsHit,
    elapsedMs: result.elapsedMs,
  });

  return result;
}
