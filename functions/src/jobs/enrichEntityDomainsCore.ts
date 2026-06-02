// Corsair — entity domain enrichment from SAM.gov POC emails.
//
// The matcher (capture/matcher.ts) loads node.domain into companyByDomain
// for every company- and government-typed node. On Atlas at deploy time
// (2026-06-02): 0/951 nodes have an explicit domain — every inbound email
// flows through the SLD-fuzzy fallback. Probe results:
//
//   238 government orgs have customerOrgId-linked solicitations whose
//   samgovPocs[].email values are derivable to a single dominant domain.
//   ≥3 confirming: 57 orgs. ≥5: 28. ≥10: 10. Dominance ≥0.8 on virtually
//   every multi-poc org (single-domain-per-org is the typical shape).
//
// Algorithm (v1):
//   1. Load /workspaces/{ws}/opportunities + /workspaces/{ws}/nodes.
//   2. Per opp with customerOrgId AND samgovPocs[]: for each valid POC
//      email, increment counter[customerOrgId][domain].
//   3. Per customerOrgId, pick top-frequency domain. Confidence tier:
//        HIGH   if topCount >= 3 AND dominance >= 0.8
//        MEDIUM if topCount >= 2 AND dominance >= 0.8
//        LOW    if topCount === 1 (single POC; no conflict possible)
//        SKIP   if multi-POC with dominance < 0.8 (genuine ambiguity)
//   4. For each (orgId, topDomain, tier) NOT SKIP: write node.domain
//      ONLY IF the node currently has no explicit domain. Explicit >
//      inferred — operator-set values survive re-runs.
//
// All writes batch into a single db.ref().update(updates) for atomicity.
// Pure-graph derivation — no external API calls, no secrets, no rate-limit.
// Idempotent: re-running after new SAM.gov syncs adds only newly-derivable
// orgs; never overwrites existing domain values.
//
// Doctrine alignment:
//   - Public/consented data only (SAM.gov POC emails are public solicitation
//     contact data).
//   - Provenance: node.domainSource = "samgov_pocs".
//   - Honest confidence: HIGH/MEDIUM/LOW per derivation strength.
//   - No automated outreach, no surveillance.
//
// See `corsair-entity-domain-enrichment.md` for design + Phase 0 probe
// results + v2/v3 backlog scope.

import { Logger } from "../framework/logger";
import { db, wsPath } from "../framework/rtdb";

export type DomainConfidenceTier = "high" | "medium" | "low";

export interface EnrichEntityDomainsOptions {
  /** If true, scan and report but skip every write. Default false. */
  dryRun?: boolean;
}

export interface EnrichedOrg {
  orgId: string;
  orgName?: string;
  topDomain: string;
  topCount: number;
  totalEmails: number;
  dominance: number;
  tier: DomainConfidenceTier;
  reason: "written" | "skipped_existing" | "skipped_missing_node";
}

export interface AmbiguousOrg {
  orgId: string;
  orgName?: string;
  topDomain: string;
  topCount: number;
  totalEmails: number;
  dominance: number;
}

export interface EnrichEntityDomainsResult {
  workspaceId: string;
  dryRun: boolean;
  oppsScanned: number;
  oppsWithCustomerAndPocs: number;
  pocEmailsScanned: number;
  validPocEmails: number;
  customerOrgsConsidered: number;
  ambiguousSkipped: AmbiguousOrg[];
  enriched: EnrichedOrg[];
  tierCounts: { high: number; medium: number; low: number };
  writeCount: number;
  preExistingDomainSkipped: number;
  missingNodeSkipped: number;
}

interface NodeLike {
  id?: string;
  type?: string;
  name?: string;
  domain?: string;
}

interface PocLike {
  email?: string;
}

interface OppLike {
  id?: string;
  customerOrgId?: string;
  samgovPocs?: PocLike[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pickTier(topCount: number, dominance: number): DomainConfidenceTier | "skip" {
  if (topCount >= 3 && dominance >= 0.8) return "high";
  if (topCount >= 2 && dominance >= 0.8) return "medium";
  if (topCount === 1) return "low";
  return "skip";
}

export async function enrichEntityDomainsForWorkspace(
  workspaceId: string,
  options: EnrichEntityDomainsOptions = {},
  log?: Logger
): Promise<EnrichEntityDomainsResult> {
  const dryRun = options.dryRun === true;
  const observedAt = Date.now();

  const [oppsSnap, nodesSnap] = await Promise.all([
    db.ref(wsPath(workspaceId, "opportunities")).once("value"),
    db.ref(wsPath(workspaceId, "nodes")).once("value"),
  ]);

  const opps = (oppsSnap.val() as Record<string, OppLike> | null) ?? {};
  const nodes = (nodesSnap.val() as Record<string, NodeLike> | null) ?? {};

  const result: EnrichEntityDomainsResult = {
    workspaceId,
    dryRun,
    oppsScanned: 0,
    oppsWithCustomerAndPocs: 0,
    pocEmailsScanned: 0,
    validPocEmails: 0,
    customerOrgsConsidered: 0,
    ambiguousSkipped: [],
    enriched: [],
    tierCounts: { high: 0, medium: 0, low: 0 },
    writeCount: 0,
    preExistingDomainSkipped: 0,
    missingNodeSkipped: 0,
  };

  // Phase 1 — aggregate domain frequencies per customer org.
  const domainsByOrg = new Map<string, Map<string, number>>();
  for (const [, opp] of Object.entries(opps)) {
    if (!opp) continue;
    result.oppsScanned++;
    const orgId = String(opp.customerOrgId || "").trim();
    const pocs = Array.isArray(opp.samgovPocs) ? opp.samgovPocs : [];
    if (!orgId || pocs.length === 0) continue;
    result.oppsWithCustomerAndPocs++;
    for (const p of pocs) {
      result.pocEmailsScanned++;
      const email = String(p?.email || "").trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) continue;
      const dom = email.split("@")[1];
      if (!dom) continue;
      result.validPocEmails++;
      if (!domainsByOrg.has(orgId)) domainsByOrg.set(orgId, new Map());
      const m = domainsByOrg.get(orgId)!;
      m.set(dom, (m.get(dom) || 0) + 1);
    }
  }

  result.customerOrgsConsidered = domainsByOrg.size;

  // Phase 2 — pick top domain per org, tier, stage write.
  const updates: Record<string, unknown> = {};
  for (const [orgId, doms] of domainsByOrg) {
    const sorted = [...doms.entries()].sort((a, b) => b[1] - a[1]);
    const [topDomain, topCount] = sorted[0];
    const totalEmails = [...doms.values()].reduce((s, n) => s + n, 0);
    const dominance = totalEmails > 0 ? topCount / totalEmails : 0;
    const tier = pickTier(topCount, dominance);

    const node = nodes[orgId];
    const orgName = node?.name;

    if (tier === "skip") {
      result.ambiguousSkipped.push({
        orgId,
        orgName,
        topDomain,
        topCount,
        totalEmails,
        dominance: Number(dominance.toFixed(3)),
      });
      continue;
    }

    if (!node) {
      result.missingNodeSkipped++;
      log?.warn("enrichment_missing_node", { orgId, topDomain, tier });
      continue;
    }

    const existing = String(node.domain || "").trim();
    if (existing) {
      result.preExistingDomainSkipped++;
      result.enriched.push({
        orgId,
        orgName,
        topDomain,
        topCount,
        totalEmails,
        dominance: Number(dominance.toFixed(3)),
        tier,
        reason: "skipped_existing",
      });
      continue;
    }

    result.enriched.push({
      orgId,
      orgName,
      topDomain,
      topCount,
      totalEmails,
      dominance: Number(dominance.toFixed(3)),
      tier,
      reason: "written",
    });
    result.tierCounts[tier]++;
    result.writeCount++;

    if (!dryRun) {
      const base = wsPath(workspaceId, "nodes", orgId);
      updates[`${base}/domain`] = topDomain;
      updates[`${base}/domainSource`] = "samgov_pocs";
      updates[`${base}/domainConfidence`] = tier;
      updates[`${base}/domainObservedCount`] = topCount;
      updates[`${base}/domainObservedAt`] = observedAt;
    }
  }

  // Phase 3 — atomic write.
  if (!dryRun && Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  log?.info("enrichment_completed", {
    workspaceId,
    dryRun,
    customerOrgsConsidered: result.customerOrgsConsidered,
    ambiguousSkipped: result.ambiguousSkipped.length,
    writes: result.writeCount,
    high: result.tierCounts.high,
    medium: result.tierCounts.medium,
    low: result.tierCounts.low,
    preExistingDomainSkipped: result.preExistingDomainSkipped,
    missingNodeSkipped: result.missingNodeSkipped,
  });

  return result;
}
