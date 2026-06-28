// Phase 8.5.8 Brief Synthesis — shared logic
//
// V1.2 (2026-05-17): adds dismissal feedback + pinning + snoozing per spec
// Part Four. Per-workspace feedback stored at
// workspaces/{wsId}/derivedViews/dailyBrief/feedback/{entityId} as
// { dismissedAt, pinnedAt, snoozedUntil, dismissReason }. Synthesis reads
// this at run-time to filter/sort.
//
// V1.1: relevance scoring + dedupe + whySurfaced (still in place).

import { db, wsPath } from "../framework/rtdb";
import { Logger } from "../framework/logger";
import type { Signal } from "../framework/types/signals";
import type { Award } from "../framework/types/awards";
import type { Opportunity } from "../framework/types/entities";
import {
  type RelevanceComponents,
  type BriefScoringContext,
  scoreSignal,
  scoreAward,
  scoreOpportunity,
  categoryFromRelevance,
  SCORING_WEIGHTS,
} from "./briefSynthesisScoring";

export interface BriefItem {
  id: string;
  kind: "signal" | "award" | "opportunity";
  category: "pursuit" | "adversary" | "customer" | "capability" | "context";
  occurredAt: number;
  title: string;
  subtitle: string;
  source: string;
  link?: string | null;
  entityId: string;
  contextLine?: string;
  /** v1.1: per-component relevance + total */
  relevance?: RelevanceComponents;
  /** v1.1: deduplication consequences */
  dedupNote?: string;
  /** v1.2: pinned to top of category, bypasses soft caps */
  pinned?: boolean;
  /** v1.2: pinned timestamp for sort stability */
  pinnedAt?: number;
  /** P13.170 — trust layer (Sovereign Intelligence audit Critical #6).
   *  Per-item confidence in the extraction or match. 0-1 scale. Pulled
   *  from signal.attrs.confidence / outcomeConfidence / matchConfidence
   *  or award.matchConfidence or opp.reconciliation.matchConfidence.
   *  Client renders "CONF 0.65" chip when below 0.85. Distinguishes
   *  high-confidence verified USAspending from 0.6-confidence DoD News
   *  scrape so the operator can weight Brief signals honestly. */
  confidence?: number | null;
  /** P13.170 — freshness layer (audit Critical #7). When the source
   *  data was last refreshed (signal.source.refreshedAt or
   *  award.source.refreshedAt). Operator sees "data as of Nh ago"
   *  below subtitle. Critical for distinguishing fresh signals from
   *  stale ones especially when cron lag varies by plugin. */
  dataAsOf?: number | null;
  /** P13.170 — parse depth (audit High). secEdgar / DoD News set this
   *  to 'shallow' when deep extraction failed and only metadata
   *  remains. Client renders "metadata only" chip so operator knows
   *  the summary is from raw fields, not LLM-extracted detail. */
  parseStatus?: "deep" | "shallow" | "failed" | null;
}

/** v1.2: per-item operator feedback persisted across Brief regenerations. */
export interface BriefFeedback {
  dismissedAt?: number;
  dismissReason?: string;
  pinnedAt?: number;
  /** ms timestamp — item hidden until this passes */
  snoozedUntil?: number;
}

export type { RelevanceComponents };

/** v1.18: per-adversary entry in the Brief Adversary Activity Rollup. */
export interface AdversaryRollupEntry {
  /** Org id of the adversary. */
  orgId: string;
  /** Best-effort display name (from a touching Signal's source plugin
   *  or null if not derivable). */
  orgName?: string | null;
  /** Total Signal touches within the Brief window. */
  signalCount: number;
  /** Most-recent touching Signal occurredAt. */
  latestSignalAt: number;
  /** Signal ids of the most-recent touches (cap at 8). */
  recentSignalIds: string[];
  /** Distinct source systems contributing touches (e.g., ['sec_edgar',
   *  'gao_protest']). */
  sources: string[];
  /** Sum of relevance.total across all touching Signals — proxies the
   *  "weight of activity" for sorting the rollup. */
  totalRelevance: number;
  /** Active flag — true when the adversary is on a non-terminal pursuit
   *  (matches ctx.activeAdversaryOrgIds), false when only on archived. */
  active: boolean;
  /** v1.22+: highest-relevance touching Signal title for inline preview. */
  topSignalTitle?: string | null;
  /** v1.22+: highest-relevance Signal id (for click-through). */
  topSignalId?: string | null;
  /** v1.22+: relevance.total of the top signal (operator-visible
   *  alongside the title preview). */
  topSignalRelevance?: number | null;
}

/** Per-customer entry in the Brief Customer Activity Rollup. Same shape
 *  as AdversaryRollupEntry but the `active` flag means "customer is on
 *  the operator's current watchlist" rather than "active pursuit". */
export interface CustomerRollupEntry {
  orgId: string;
  orgName?: string | null;
  signalCount: number;
  latestSignalAt: number;
  recentSignalIds: string[];
  sources: string[];
  totalRelevance: number;
  /** True when in ctx.customerOrgIds (active watchlist); false when only
   *  in ctx.customerHistoryOrgIds (historical pursuits). */
  active: boolean;
  /** v1.22+: highest-relevance touching Signal title for inline preview. */
  topSignalTitle?: string | null;
  topSignalId?: string | null;
  topSignalRelevance?: number | null;
}

export interface BriefOutput {
  workspaceId: string;
  generatedAt: number;
  windowHours: number;
  totalItems: number;
  itemsByCategory: {
    pursuit: BriefItem[];
    adversary: BriefItem[];
    customer: BriefItem[];
    capability: BriefItem[];
    context: BriefItem[];
  };
  counts: {
    signals: number;
    awards: number;
    opportunities: number;
    /** v1.1: items suppressed by deduplication */
    suppressedByDedup?: number;
    /** v1.2: active feedback counts (items with dismiss/snooze/pin set) */
    dismissedActive?: number;
    snoozedActive?: number;
    pinnedActive?: number;
    pinnedShown?: number;
    /** v1.3: dismiss-reason aggregate — top reasons + counts for tuning suggestions */
    dismissReasonAggregate?: Array<{ reason: string; count: number }>;
    /** v1.11: count of Signal items that received a cross-source convergence bump */
    crossSourceBumps?: number;
    /** v1.12: subset of crossSourceBumps that hit the tight 72-hour cluster tier */
    tightClusterBumps?: number;
    /** v1.13: count of Signal items bumped because a touched Org had a recent leadership announcement */
    leadershipFluxBumps?: number;
    /** v1.14: count of protest/opportunity_amendment pairs bumped for procurement-reset confluence */
    protestAmendmentBumps?: number;
    /** v1.15: count of Signal items bumped for operator-authored Posture path */
    posturePathBumps?: number;
    /** v1.15: count of Signal items bumped for operator-authored Posture trajectory */
    postureTrajectoryBumps?: number;
    /** v1.16: count of Signal items bumped for mentioning a known budget PE */
    peMentionBumps?: number;
    /** v1.17: count of Signal items bumped for touching an Org with
     *  incoming formerly_at Edges (workspace has registered-lobbyist
     *  Persons who formerly worked there) */
    revolvingDoorTouchBumps?: number;
    /** v1.18: count of Signal items bumped for accumulating ≥3 distinct
     *  bump axes from v1.11-v1.17 (nexus convergence) */
    nexusBumps?: number;
    /** v1.20: count of Signal items bumped for touching a Person with
     *  3+ distinct outbound institutional-role Edges */
    weightyPersonTouchBumps?: number;
    /** v1.21: count of Signal items bumped for touching an Org with
     *  current acting_at Edges (workspace Person is designated acting
     *  at that institution) */
    actingAtTouchBumps?: number;
    /** v1.22: count of Signal items bumped for touching an Org that
     *  shares trade-association memberships with an active adversary */
    coMembershipBumps?: number;
    /** v1.23: count of Signal items bumped for touching an Org whose
     *  this-week touch count is significantly above its trailing
     *  4-week average (temporal momentum — "just got busy") */
    temporalMomentumBumps?: number;
    /** v1.24: count of Signal items bumped for touching an Org that
     *  has >=3 distinct weighty Persons connected via institutional
     *  edges (influence-net density / HUB chip) */
    influenceNetHubBumps?: number;
    /** v1.25: count of Signal items bumped for touching an Org that
     *  receives >=4 distinct Signal types in the Brief window
     *  (cross-Signal-type convergence — DIV chip) */
    typeDiversityBumps?: number;
    /** v1.26: count of Signal items bumped for hitting CONV + DIV +
     *  TIGHT all on the same item (NEXUS-2 second-tier capstone) */
    nexus2Bumps?: number;
    /** v1.27: count of Signal items bumped for touching an Org whose
     *  trailing-12mo obligated dollars >= 1.5x prior-12mo (and >= $1M
     *  trailing) — funding-momentum / FUND chip */
    fundingMomentumBumps?: number;
    /** v1.28: count of Signal items bumped for touching a customer Org
     *  whose trailing-12mo INBOUND obligated dollars (awards where
     *  customerOrgId === org) >= 1.5x prior-12mo (and >= $1M trailing)
     *  — customer-funding flow / CUSTFUND chip */
    customerFundingFlowBumps?: number;
    /** v1.29: count of Signal items bumped for hitting FUND + CUSTFUND
     *  on the same item (bidirectional dollar-flow co-fire / FLOW chip) */
    fundingFlowBumps?: number;
    /** v1.30: count of Signal items bumped for touching an entity
     *  that's currently in an UNRESOLVED merge candidate (DEDUP chip) */
    mergePendingTouchBumps?: number;
    /** v1.31: count of Signal items bumped for touching an Org with
     *  at least one workspace award.lastModifiedAt within last 30
     *  days (recent-award activity — WIN chip) */
    recentAwardTouchBumps?: number;
    /** v1.32: count of Signal items bumped for touching an Org that
     *  received 3+ Signals within a single 24h slice (Org-centric
     *  same-day spike — SPIKE chip) */
    sameDayOrgSpikeBumps?: number;
    /** v1.35: count of Signal items bumped for touching an entity
     *  mentioned in an operator-logged meeting within the past 14
     *  days (meeting-touch — MEET chip) */
    meetingTouchBumps?: number;
    /** v1.33: count of Signal items hit by all three of SPIKE +
     *  NEXUS-2 + FLOW on the same item (APEX triple-capstone chip).
     *  Strongest single-item BD convergence signal. */
    apexBumps?: number;
    /** v1.34: count of Signal items bumped for touching an Org that
     *  sits on a pursuit whose stageEnteredAt is within last 14 days
     *  (pipeline-stage transition — STAGE chip). Degrades gracefully
     *  if stageEnteredAt is empty across the workspace. */
    pipelineStageTransitionBumps?: number;
  };
  /** v1.18 (Adversary Activity Rollup): per-adversary Org summary of
   *  recent touching Signals. The Brief surface can render this as a
   *  dashboard card without re-walking the full Signal corpus. */
  adversaryRollup?: AdversaryRollupEntry[];
  /** Per-customer Org summary of recent touching Signals. Mirrors
   *  adversaryRollup but keyed on the customer watchlist + history. */
  customerRollup?: CustomerRollupEntry[];
  /** v1.1: scoring metadata */
  scoringVersion?: string;
  weightsApplied?: typeof SCORING_WEIGHTS;
}

const SOFT_CAPS = {
  pursuit: 10,
  adversary: 5,
  customer: 5,
  capability: 5,
  context: 3,
};

const HARD_CAPS = {
  pursuit: 20,
  adversary: 10,
  customer: 10,
  capability: 8,
  context: 5,
};

const ARCHIVED_STAGES = new Set(["won", "lost"]);

async function loadWorkspaceContext(workspaceId: string): Promise<BriefScoringContext> {
  const [oppSnap, awardSnap, usaCfgSnap, samCfgSnap, nodesSnap, edgesSnap, personMergeSnap, orgMergeSnap, meetingsSnap] = await Promise.all([
    db.ref(wsPath(workspaceId, "opportunities")).once("value"),
    db.ref(wsPath(workspaceId, "awards")).once("value"),
    db.ref(wsPath(workspaceId, "sources", "usaspending", "config")).once("value"),
    db.ref(wsPath(workspaceId, "sources", "sam_gov", "config")).once("value"),
    db.ref(wsPath(workspaceId, "nodes")).once("value"),
    db.ref(wsPath(workspaceId, "edges")).once("value"),
    db.ref(wsPath(workspaceId, "personMergeCandidates")).once("value"),
    db.ref(wsPath(workspaceId, "orgMergeCandidates")).once("value"),
    db.ref(wsPath(workspaceId, "meetings")).once("value"),
  ]);
  const opps = (oppSnap.val() as Record<string, Opportunity> | null) ?? {};
  const awards = (awardSnap.val() as Record<string, Award> | null) ?? {};
  const usaCfg = (usaCfgSnap.val() as { naics?: string[]; agencies?: string[] } | null) ?? {};
  const samCfg = (samCfgSnap.val() as { naics?: string[]; agencies?: string[] } | null) ?? {};
  const nodes = (nodesSnap.val() as Record<string, { id?: string; posture?: { path?: string; trajectory?: string } }> | null) ?? {};
  const edges = (edgesSnap.val() as Record<string, { source?: string; target?: string; label?: string; dir?: string }> | null) ?? {};

  const activeAdversaryOrgIds = new Set<string>();
  const archivedAdversaryOrgIds = new Set<string>();
  const customerOrgIds = new Set<string>();
  const customerHistoryOrgIds = new Set<string>();
  const pursuitOrgIds = new Set<string>();
  const watchlistNaics = new Set<string>();
  const watchlistPsc = new Set<string>();
  const awardByPiid = new Map<string, string>();

  for (const opp of Object.values(opps)) {
    const isArchived = ARCHIVED_STAGES.has(opp.stage);
    if (opp.posture?.adversaries) {
      for (const a of opp.posture.adversaries) {
        (isArchived ? archivedAdversaryOrgIds : activeAdversaryOrgIds).add(a);
        pursuitOrgIds.add(a);
      }
    }
    if (opp.customerOrgId) {
      customerHistoryOrgIds.add(opp.customerOrgId);
      pursuitOrgIds.add(opp.customerOrgId);
      if (!isArchived) customerOrgIds.add(opp.customerOrgId);
    }
    if (opp.naicsCodes) opp.naicsCodes.forEach((n) => watchlistNaics.add(n));
    if (opp.pscCodes) opp.pscCodes.forEach((p) => watchlistPsc.add(p));
  }
  for (const award of Object.values(awards)) {
    if (award.naics) watchlistNaics.add(award.naics);
    if (award.psc) watchlistPsc.add(award.psc);
    if (award.customerOrgId) customerHistoryOrgIds.add(award.customerOrgId);
    if (award.customerToptierOrgId) customerHistoryOrgIds.add(award.customerToptierOrgId);
    if (award.primeOrgId) pursuitOrgIds.add(award.primeOrgId);
    if (award.piid) awardByPiid.set(award.piid.toUpperCase(), award.id);
  }
  // Pull NAICS from source configs too
  (usaCfg.naics || []).forEach((n) => watchlistNaics.add(n));
  (samCfg.naics || []).forEach((n) => watchlistNaics.add(n));

  // v1.15: build Posture-layer sets from node records. The operator
  // authors Posture data on Person nodes (path / trajectory / per-pursuit
  // position) via the Inspector POSTURE tab. Brief Synthesis v1.15 uses
  // path and trajectory as cross-cutting magnitude axes — operator-tagged
  // adversaries and falling-influence entities deserve attention on every
  // touching Signal.
  const posturePathAdversaryIds = new Set<string>();
  const posturePathLiberatorIds = new Set<string>();
  const postureRisingIds = new Set<string>();
  const postureFallingIds = new Set<string>();
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object") continue;
    const posture = (node as any).posture;
    if (!posture || typeof posture !== "object") continue;
    const path = (posture.path as string | undefined) || "";
    const trajectory = (posture.trajectory as string | undefined) || "";
    const pathLc = path.toLowerCase();
    const trajLc = trajectory.toLowerCase();
    if (pathLc === "adversary") posturePathAdversaryIds.add(nodeId);
    else if (pathLc === "liberator") posturePathLiberatorIds.add(nodeId);
    if (trajLc === "rising") postureRisingIds.add(nodeId);
    else if (trajLc === "falling") postureFallingIds.add(nodeId);
  }

  // v1.17: Map<orgId, count of incoming formerly_at Edges>.
  // v1.21: Map<orgId, count of incoming acting_at Edges>.
  // v1.20: per-Person count of DISTINCT outbound Edge labels.
  // v1.22: Map<companyOrgId, Set<assocOrgId>> — trade_assoc memberships
  //        from industry_assoc member_of Edges (where source = company,
  //        target = trade_assoc Org). Used to compute the cross-Org
  //        association overlap with operator-tagged adversaries.
  // All built in a single edge-walk pass.
  const formerlyAtIncomingCountByOrg = new Map<string, number>();
  const actingAtIncomingCountByOrg = new Map<string, number>();
  const outboundEdgesByPerson = new Map<string, Set<string>>();
  const assocMembershipsByOrg = new Map<string, Set<string>>();
  for (const edge of Object.values(edges)) {
    if (!edge) continue;
    if (edge.label === "formerly_at" && edge.target) {
      formerlyAtIncomingCountByOrg.set(
        edge.target,
        (formerlyAtIncomingCountByOrg.get(edge.target) || 0) + 1
      );
    }
    if (edge.label === "acting_at" && edge.target) {
      actingAtIncomingCountByOrg.set(
        edge.target,
        (actingAtIncomingCountByOrg.get(edge.target) || 0) + 1
      );
    }
    if (edge.source && edge.label && edge.dir !== "from") {
      if (!outboundEdgesByPerson.has(edge.source)) {
        outboundEdgesByPerson.set(edge.source, new Set());
      }
      outboundEdgesByPerson.get(edge.source)!.add(edge.label);
    }
    // v1.22: member_of Edges from industry_assoc — track the target
    // (trade_assoc Org id) per source (company Org id). Filter by edge
    // attrs.sourceSystem === 'industry_assoc' is the cleanest, but
    // member_of is also used by faca + advisory_boards; we accept all
    // member_of Edges here and let the adversary-intersection step
    // filter to relevant associations.
    if (edge.label === "member_of" && edge.source && edge.target) {
      if (!assocMembershipsByOrg.has(edge.source)) {
        assocMembershipsByOrg.set(edge.source, new Set());
      }
      assocMembershipsByOrg.get(edge.source)!.add(edge.target);
    }
  }
  const outboundEdgeLabelCountByPerson = new Map<string, number>();
  for (const [personId, labels] of outboundEdgesByPerson) {
    outboundEdgeLabelCountByPerson.set(personId, labels.size);
  }

  // v1.24: per-Org count of distinct weighty Persons (3+ outbound
  // institutional-role edge labels) connected to that Org via any
  // inbound edge. Captures "this Org is the center of an influence
  // cluster" — a different signal from individual-edge axes (v1.17
  // DOOR / v1.21 ACTING) because it counts distinct INFLUENCE-CARRYING
  // entities, not just incoming edges of one type.
  const weightyPersonIds = new Set<string>();
  for (const [pid, c] of outboundEdgeLabelCountByPerson) {
    if (c >= 3) weightyPersonIds.add(pid);
  }
  const weightyPersonsByOrg = new Map<string, Set<string>>();
  if (weightyPersonIds.size > 0) {
    for (const edge of Object.values(edges)) {
      if (!edge || !edge.source || !edge.target) continue;
      if (!weightyPersonIds.has(edge.source)) continue;
      // Only count "institutional" edge labels that imply real
      // organizational connection. Skip generic relations.
      const lbl = edge.label || "";
      if (
        lbl !== "member_of" &&
        lbl !== "acting_at" &&
        lbl !== "formerly_at" &&
        lbl !== "lobbyist_at"
      ) {
        continue;
      }
      if (!weightyPersonsByOrg.has(edge.target)) {
        weightyPersonsByOrg.set(edge.target, new Set());
      }
      weightyPersonsByOrg.get(edge.target)!.add(edge.source);
    }
  }
  const weightyPersonCountByOrg = new Map<string, number>();
  for (const [orgId, set] of weightyPersonsByOrg) {
    weightyPersonCountByOrg.set(orgId, set.size);
  }

  // v1.22: compute association IDs that any active adversary is a member of
  const adversaryAssocs = new Set<string>();
  for (const advId of activeAdversaryOrgIds) {
    const memberships = assocMembershipsByOrg.get(advId);
    if (!memberships) continue;
    for (const assocId of memberships) adversaryAssocs.add(assocId);
  }
  const sharedAssocsWithAdversaryByOrg = new Map<string, number>();
  if (adversaryAssocs.size > 0) {
    for (const [orgId, memberships] of assocMembershipsByOrg) {
      if (activeAdversaryOrgIds.has(orgId)) continue; // skip adversaries themselves
      let shared = 0;
      for (const assocId of memberships) {
        if (adversaryAssocs.has(assocId)) shared++;
      }
      if (shared > 0) sharedAssocsWithAdversaryByOrg.set(orgId, shared);
    }
  }

  // v1.35: build Set<nodeId> of entities mentioned in operator-logged
  // meetings within the past 14 days. Tying operator workflow to Brief
  // scoring — meetings you log get reflected within hours.
  //
  // Data path: workspaces/{wsId}/meetings is keyed by meeting id.
  // Each meeting has meta.date (string like '2026-05-20') and
  // intel.{keyPeople[],companies[]} with .name fields. We resolve
  // those names against the workspace nodes Map via a lowercase-name
  // index, build the touched-entity Set.
  const meetingTouchedNodeIds = new Set<string>();
  const meetingsRaw = (meetingsSnap.val() as Record<string, {
    meta?: { date?: string };
    intel?: {
      keyPeople?: Array<{ name?: string }>;
      companies?: Array<{ name?: string }>;
    };
  }> | null) ?? {};
  const meetingCutoffMs = Date.now() - 14 * 86400000;
  // Build name → nodeId lookup (case-insensitive). Same shape as the
  // FLiIntel.html autoSyncEnts uses, kept server-side to avoid
  // depending on client-side state.
  const nodeIdByLowerName = new Map<string, string>();
  for (const [nid, node] of Object.entries(nodes)) {
    if (!node) continue;
    const nm = (node as { name?: string }).name;
    if (typeof nm === "string" && nm.trim()) {
      const k = nm.trim().toLowerCase();
      if (!nodeIdByLowerName.has(k)) nodeIdByLowerName.set(k, nid);
    }
    const alts = (node as { alternateNames?: string[] }).alternateNames;
    if (Array.isArray(alts)) {
      for (const alt of alts) {
        if (typeof alt === "string" && alt.trim()) {
          const ak = alt.trim().toLowerCase();
          if (!nodeIdByLowerName.has(ak)) nodeIdByLowerName.set(ak, nid);
        }
      }
    }
  }
  for (const meeting of Object.values(meetingsRaw)) {
    if (!meeting) continue;
    const dateStr = meeting.meta?.date;
    if (!dateStr) continue;
    // Parse YYYY-MM-DD as UTC midnight to be timezone-stable
    const parsed = Date.parse(dateStr + "T00:00:00Z");
    if (!Number.isFinite(parsed) || parsed < meetingCutoffMs) continue;
    const intel = meeting.intel || {};
    const names: string[] = [];
    if (Array.isArray(intel.keyPeople)) {
      for (const p of intel.keyPeople) {
        if (p && typeof p.name === "string" && p.name.trim()) {
          names.push(p.name.trim().toLowerCase());
        }
      }
    }
    if (Array.isArray(intel.companies)) {
      for (const c of intel.companies) {
        if (c && typeof c.name === "string" && c.name.trim()) {
          names.push(c.name.trim().toLowerCase());
        }
      }
    }
    for (const nm of names) {
      const resolvedId = nodeIdByLowerName.get(nm);
      if (resolvedId) meetingTouchedNodeIds.add(resolvedId);
    }
  }

  // v1.30: Set<entityId> for both ids in every UNRESOLVED merge
  // candidate (Person + Org). Used by the merge-pending touch axis
  // (DEDUP chip) to flag items whose touched entity identity is
  // currently ambiguous so the operator clears the dedupe queue
  // before trusting the score.
  const pendingMergeIds = new Set<string>();
  const personMergeRaw = (personMergeSnap.val() as Record<string, { idA?: string; idB?: string; resolved?: string }> | null) ?? {};
  const orgMergeRaw = (orgMergeSnap.val() as Record<string, { idA?: string; idB?: string; resolved?: string }> | null) ?? {};
  for (const candidate of Object.values(personMergeRaw)) {
    if (!candidate || candidate.resolved) continue;
    if (candidate.idA) pendingMergeIds.add(candidate.idA);
    if (candidate.idB) pendingMergeIds.add(candidate.idB);
  }
  for (const candidate of Object.values(orgMergeRaw)) {
    if (!candidate || candidate.resolved) continue;
    if (candidate.idA) pendingMergeIds.add(candidate.idA);
    if (candidate.idB) pendingMergeIds.add(candidate.idB);
  }

  return {
    trackedOppIds: new Set(Object.keys(opps)),
    trackedAwardIds: new Set(Object.keys(awards)),
    pursuitOrgIds,
    activeAdversaryOrgIds,
    archivedAdversaryOrgIds,
    customerOrgIds,
    customerHistoryOrgIds,
    watchlistNaics,
    watchlistPsc,
    opportunities: new Map(Object.entries(opps)),
    awards: new Map(Object.entries(awards)),
    awardByPiid,
    posturePathAdversaryIds,
    posturePathLiberatorIds,
    postureRisingIds,
    postureFallingIds,
    formerlyAtIncomingCountByOrg,
    outboundEdgeLabelCountByPerson,
    actingAtIncomingCountByOrg,
    sharedAssocsWithAdversaryByOrg,
    weightyPersonCountByOrg,
    pendingMergeIds,
    meetingTouchedNodeIds,
  };
}

/** Decode the small set of HTML entities that scraped source text (think-tank
 *  RSS, DoD News, etc.) carries, so titles/subtitles read as clean Unicode in
 *  the Brief view AND the email digest. Handles numeric (&#8212; / &#x2014;) +
 *  the common named set. Deliberately leaves '<' / '>' encoded (codepoints
 *  60/62 skipped, no &lt;/&gt; rules) so decoded text can never inject markup
 *  into an unescaped innerHTML render. &amp; is decoded last. */
export function decodeHtmlEntities(input: string): string {
  if (!input) return input;
  const codept = (c: number, m: string): string =>
    Number.isFinite(c) && c !== 60 && c !== 62 ? String.fromCodePoint(c) : m;
  return input
    .replace(/&#(\d+);/g, (m, n) => codept(parseInt(n, 10), m))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => codept(parseInt(n, 16), m))
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function signalToItem(signal: Signal, category: BriefItem["category"]): BriefItem {
  const attrs = signal.attrs as Record<string, unknown>;
  const sourceMap: Record<string, string> = {
    gao_protest: "GAO",
    sec_edgar: "SEC EDGAR",
    congress_gov: "Congress.gov",
    sam_gov: "SAM.gov",
    usaspending: "USAspending",
    dod_news: "DoD News",
    faca: "FACA",
  };
  // think_tank signals carry the publication name in attrs.tankName
  // ("War on the Rocks", "Defense One"); prefer it over the raw system slug.
  const sourceName =
    sourceMap[signal.source.system] ??
    (typeof attrs.tankName === "string" && attrs.tankName ? (attrs.tankName as string) : signal.source.system);
  let title = "Signal";
  let subtitle = "";
  let link: string | null = signal.source.url ?? null;
  if (signal.type === "protest") {
    title = (attrs.protestorName as string) || "Bid Protest";
    subtitle = String(attrs.title || `Docket ${attrs.docketNumber || ""}`);
  } else if (signal.type === "material_event") {
    title = (attrs.filerName as string) || (attrs.ticker as string) || "8-K filing";
    subtitle = String((attrs.summary as string) || (attrs.itemDescriptions as string[])?.[0] || "Material event");
  } else if (signal.type === "congressional_hearing") {
    title = (attrs.committeeName as string) || "Committee Hearing";
    subtitle = String(attrs.title || "");
  } else if (signal.type === "committee_meeting") {
    title = (attrs.title as string) || "Committee Meeting";
    subtitle = (attrs.location as string) || "FACA committee";
  } else {
    // Generic branch (think_tank analysis_publication, service_news, etc.):
    // the real headline lives in attrs.title/headline — use it rather than the
    // signal type slug ("analysis publication"). Fall back to the slug only
    // when no real title exists.
    title = String((attrs.title as string) || (attrs.headline as string) || signal.type.replace(/_/g, " "));
    subtitle = String((attrs.summary as string) || (attrs.subtitle as string) || "");
  }
  // P13.170 — confidence / dataAsOf / parseStatus surfaced from attrs +
  // source. Plumbing data already computed by parsers but previously
  // dropped at Brief construction.
  const rawConf = (attrs.confidence ?? attrs.outcomeConfidence ?? attrs.matchConfidence ?? attrs.extractionConfidence) as number | undefined;
  const confidence = typeof rawConf === "number" && rawConf >= 0 && rawConf <= 1 ? rawConf : null;
  const dataAsOf = signal.source.refreshedAt || signal.source.fetchedAt || null;
  const rawParse = attrs.parseStatus as string | undefined;
  const parseStatus = (rawParse === "deep" || rawParse === "shallow" || rawParse === "failed") ? rawParse : null;
  return {
    id: signal.id,
    kind: "signal",
    category,
    occurredAt: signal.occurredAt,
    title: decodeHtmlEntities(title),
    subtitle: decodeHtmlEntities(subtitle),
    source: sourceName,
    link,
    entityId: signal.id,
    confidence,
    dataAsOf,
    parseStatus,
  };
}

function awardToItem(award: Award, category: BriefItem["category"]): BriefItem {
  // P13.170 — surface award match confidence + freshness. matchConfidence
  // < 0.85 typically means a DoD News scrape that hasn't been reconciled
  // against the authoritative USAspending record yet. Lives on
  // award.reconciliation per types/awards.ts:75.
  const recon = award.reconciliation;
  const matchConfidence = recon && typeof recon.matchConfidence === "number" ? recon.matchConfidence : null;
  const provisional = award.lifecycleState === "provisional";
  return {
    id: award.id,
    kind: "award",
    category,
    occurredAt: award.awardedAt || award.lastModifiedAt,
    title: award.primeUei || award.piid,
    subtitle: `$${award.obligated?.toLocaleString() || "?"} · NAICS ${award.naics}` +
      (award.lifecycleState === "expiring" ? " · expiring" : "") +
      (provisional ? " · provisional" : ""),
    source: "USAspending",
    link: award.source?.url ?? null,
    entityId: award.id,
    confidence: matchConfidence,
    dataAsOf: award.source?.refreshedAt || award.source?.fetchedAt || null,
  };
}

function opportunityToItem(opp: Opportunity, category: BriefItem["category"]): BriefItem {
  // P13.170 — surface reconciliation confidence on opp items. matchMethod
  // 'fuzzy' with confidence < 0.85 means a soft-match that may be wrong.
  const recon = opp.reconciliation;
  const reconConfidence = recon && typeof recon.matchConfidence === "number" ? recon.matchConfidence : null;
  return {
    id: opp.id,
    kind: "opportunity",
    category,
    occurredAt: opp.samgovPostedDate || (typeof opp.stageEnteredAt === "number" ? opp.stageEnteredAt : Date.now()),
    title: opp.name,
    subtitle: (opp.agency || "") + (opp.samgovBaseType ? " · " + opp.samgovBaseType : "") +
      (recon && recon.matchMethod === "fuzzy" ? " · fuzzy-matched" : ""),
    source: "SAM.gov",
    link: opp.samgovUiLink ?? null,
    entityId: opp.id,
    confidence: reconConfidence,
    dataAsOf: (recon && recon.samgovMatchedAt) || opp.samgovPostedDate || null,
  };
}

/**
 * v1.1: deduplicate items per Part Two §5.
 *
 * Rules implemented:
 *  - 8-K Signal whose attrs reference a PIID matching an Award in workspace → suppress
 *  - Multiple opportunity_amendment signals on same parentNoticeId → keep latest
 *  - Multiple protest signals on same docketNumber → keep most-recent-state
 *  - Multiple committee_meeting signals on same committee+date → keep one
 */
function deduplicate(
  items: BriefItem[],
  signals: Record<string, Signal>,
  ctx: BriefScoringContext
): { kept: BriefItem[]; suppressed: number } {
  let suppressed = 0;
  const keep = new Set<string>(items.map((i) => i.id));

  // 1. 8-K → Award dedup
  for (const item of items) {
    if (item.kind !== "signal") continue;
    const sig = signals[item.entityId];
    if (!sig || sig.type !== "material_event") continue;
    const attrs = sig.attrs as Record<string, unknown>;
    const summary = String(attrs.summary || "");
    // Heuristic: scan summary for PIID-looking tokens, check against awardByPiid
    const piidLike = summary.match(/[A-Z0-9]{4,}-[0-9]{2,}-[A-Z]-[0-9]{4,}/g) || [];
    for (const p of piidLike) {
      if (ctx.awardByPiid.has(p.toUpperCase())) {
        keep.delete(item.id);
        suppressed++;
        break;
      }
    }
  }

  // 2. Per-docket / per-amendment / per-meeting collapse — keep highest-score
  const groups = new Map<string, BriefItem[]>();
  for (const item of items) {
    if (!keep.has(item.id) || item.kind !== "signal") continue;
    const sig = signals[item.entityId];
    if (!sig) continue;
    const attrs = sig.attrs as Record<string, unknown>;
    let key: string | null = null;
    if (sig.type === "protest" && attrs.docketNumber) {
      key = `protest::${attrs.docketNumber}`;
    } else if (sig.type === "opportunity_amendment" && attrs.parentNoticeId) {
      key = `amendment::${attrs.parentNoticeId}`;
    } else if (sig.type === "committee_meeting") {
      const day = Math.floor((sig.occurredAt || 0) / 86400000);
      key = `meeting::${sig.subjectIds?.[0] || ""}::${day}`;
    }
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  for (const cluster of groups.values()) {
    if (cluster.length < 2) continue;
    cluster.sort((a, b) => (b.relevance?.total || 0) - (a.relevance?.total || 0));
    for (let i = 1; i < cluster.length; i++) {
      keep.delete(cluster[i].id);
      suppressed++;
    }
    cluster[0].dedupNote = `Collapsed ${cluster.length - 1} related signal(s) in same group`;
  }

  return { kept: items.filter((i) => keep.has(i.id)), suppressed };
}

async function loadFeedback(workspaceId: string): Promise<Record<string, BriefFeedback>> {
  const snap = await db
    .ref(wsPath(workspaceId, "derivedViews", "dailyBrief", "feedback"))
    .once("value");
  return (snap.val() as Record<string, BriefFeedback> | null) ?? {};
}

/**
 * Synthesize a Brief for one workspace covering the past `windowHours`.
 * v1.2: + dismissal / pinning / snoozing applied via feedback map.
 * v1.1: 6-factor relevance scoring + category-by-threshold + dedup.
 */
export async function synthesizeBrief(
  workspaceId: string,
  windowHours: number = 24,
  log?: Logger
): Promise<BriefOutput> {
  const nowMs = Date.now();
  const cutoff = nowMs - windowHours * 60 * 60 * 1000;
  log?.info("brief_synthesis_started", { workspaceId, windowHours, version: "v1.2" });

  const [ctx, feedback] = await Promise.all([
    loadWorkspaceContext(workspaceId),
    loadFeedback(workspaceId),
  ]);

  // v1.2 helper: apply feedback per item (dismiss-skip, snooze-skip, pin-flag)
  const applyFeedback = (entityId: string, item: BriefItem): BriefItem | null => {
    const fb = feedback[entityId];
    if (!fb) return item;
    if (fb.dismissedAt) return null; // suppress dismissed
    if (fb.snoozedUntil && fb.snoozedUntil > nowMs) return null; // suppress snoozed
    if (fb.pinnedAt) {
      item.pinned = true;
      item.pinnedAt = fb.pinnedAt;
    }
    return item;
  };

  // 1. Collect signals + score
  const sigSnap = await db.ref(wsPath(workspaceId, "signals")).once("value");
  const signals = (sigSnap.val() as Record<string, Signal> | null) ?? {};
  const sigItems: BriefItem[] = [];
  let signalCount = 0;
  for (const sig of Object.values(signals)) {
    if (!sig || !sig.occurredAt || sig.occurredAt < cutoff) continue;
    signalCount++;
    const relevance = scoreSignal(sig, ctx, nowMs);
    const category = categoryFromRelevance(relevance);
    const item = signalToItem(sig, category);
    item.relevance = relevance;
    const kept = applyFeedback(sig.id, item);
    if (kept) sigItems.push(kept);
  }

  // 2. Collect awards + score
  const awardItems: BriefItem[] = [];
  let awardCount = 0;
  for (const award of ctx.awards.values()) {
    const recentTimestamp = award.lastModifiedAt || award.awardedAt;
    if (!recentTimestamp || recentTimestamp < cutoff) continue;
    awardCount++;
    const relevance = scoreAward(award, ctx, nowMs);
    const category = categoryFromRelevance(relevance);
    const item = awardToItem(award, category);
    item.relevance = relevance;
    const kept = applyFeedback(award.id, item);
    if (kept) awardItems.push(kept);
  }

  // 3. Collect opportunities + score
  const oppItems: BriefItem[] = [];
  let oppCount = 0;
  for (const opp of ctx.opportunities.values()) {
    const ts = opp.samgovPostedDate || (typeof opp.stageEnteredAt === "number" ? opp.stageEnteredAt : 0);
    if (!ts || ts < cutoff) continue;
    oppCount++;
    const relevance = scoreOpportunity(opp, ctx, nowMs);
    const category = categoryFromRelevance(relevance);
    const item = opportunityToItem(opp, category);
    item.relevance = relevance;
    const kept = applyFeedback(opp.id, item);
    if (kept) oppItems.push(kept);
  }

  // 3.5. v1.12 — cross-source correlation pass with time-window weighting.
  //
  // Build an index of Org id → Map<sourceSystem, latestOccurredAt[]>. For
  // each Signal item, evaluate two convergence windows:
  //
  //   tight cluster (72-hour window centered on this item's occurredAt):
  //     3+ distinct sources within 72h: +0.15 (strong real-time convergence)
  //     2 distinct sources within 72h:  +0.08
  //
  //   wide cluster (this week's Brief window, v1.11 baseline):
  //     3+ distinct sources:            +0.10
  //     2 distinct sources:             +0.05
  //
  // Each item picks the highest applicable bump (not stacked). Tight-cluster
  // convergence is much stronger BD signal than 30-day-spread convergence —
  // a defense prime appearing in an SEC 8-K + a GAO protest + a Congress.gov
  // hearing all within 72 hours is procurement-grade intelligence; the same
  // touches spread across a month is background noise.
  //
  // SCORING_WEIGHTS.magnitude is 1.0, so the bump applies to total 1:1.
  // Awards and opportunities are not included in the index — both are
  // workspace-internal items that already pin to a specific Org. The cross-
  // source signal we want is *external feeds* converging on the same entity.
  let crossSourceBumps = 0;
  let tightClusterBumps = 0;
  const TIGHT_WINDOW_MS = 72 * 60 * 60 * 1000;
  if (sigItems.length > 0) {
    // Build index: orgId → Map<sourceSystem, occurredAt[]>
    const orgToSourceTimes = new Map<string, Map<string, number[]>>();
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig) continue;
      const sys = sig.source?.system;
      if (!sys) continue;
      const occurred = sig.occurredAt || 0;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      for (const id of allIds) {
        if (!id) continue;
        if (!orgToSourceTimes.has(id)) orgToSourceTimes.set(id, new Map());
        const sysMap = orgToSourceTimes.get(id)!;
        if (!sysMap.has(sys)) sysMap.set(sys, []);
        sysMap.get(sys)!.push(occurred);
      }
    }
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const itemAt = sig.occurredAt || 0;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxWideSources = 1;
      let maxTightSources = 1;
      for (const id of allIds) {
        const sysMap = orgToSourceTimes.get(id);
        if (!sysMap) continue;
        if (sysMap.size > maxWideSources) maxWideSources = sysMap.size;
        // Count systems with at least one touch within ±72h of this item
        let tightCount = 0;
        for (const [, times] of sysMap) {
          for (const t of times) {
            if (Math.abs(t - itemAt) <= TIGHT_WINDOW_MS) {
              tightCount++;
              break; // count system once
            }
          }
        }
        if (tightCount > maxTightSources) maxTightSources = tightCount;
      }
      // Pick highest applicable bump
      let bump = 0;
      let reason = "";
      if (maxTightSources >= 3) {
        bump = 0.15;
        reason = `Tight cross-source cluster — ${maxTightSources} different source systems touched within 72h`;
        tightClusterBumps++;
      } else if (maxWideSources >= 3) {
        bump = 0.10;
        reason = `Cross-source convergence — entity touched by ${maxWideSources} different source systems this week`;
      } else if (maxTightSources >= 2) {
        bump = 0.08;
        reason = `Tight cross-source pair — ${maxTightSources} different source systems touched within 72h`;
        tightClusterBumps++;
      } else if (maxWideSources >= 2) {
        bump = 0.05;
        reason = `Cross-source convergence — entity touched by ${maxWideSources} different source systems this week`;
      }
      if (bump > 0) {
        item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
        item.relevance.total = Math.min(13, item.relevance.total + bump);
        item.relevance.whySurfaced.push(reason);
        crossSourceBumps++;
      }
    }
  }

  // 3.6. v1.13 — leadership-flux bump.
  //
  // When a Signal touches an Org that has received a service_news Signal
  // flagged isLeadershipAnnouncement within the lookback window, that Org's
  // customer landscape is in flux. Any Signal touching it should bump
  // because BD posture against a command undergoing leadership transition
  // is materially different from posture against a stable one.
  //
  // This bump is additive to v1.12 convergence (different axis: convergence
  // is "many feeds talking about this entity"; flux is "this entity's
  // leadership just changed"). Total magnitude stays capped at 1.0.
  let leadershipFluxBumps = 0;
  const LEADERSHIP_FLUX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  if (sigItems.length > 0) {
    // Build index: orgId → most recent leadership announcement timestamp
    const orgToLeadershipAt = new Map<string, number>();
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig) continue;
      if (sig.type !== "service_news") continue;
      const isLeadership = !!(sig.attrs && (sig.attrs as Record<string, unknown>).isLeadershipAnnouncement);
      if (!isLeadership) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      for (const id of allIds) {
        if (!id) continue;
        const prev = orgToLeadershipAt.get(id) ?? 0;
        if (sig.occurredAt > prev) orgToLeadershipAt.set(id, sig.occurredAt);
      }
    }
    if (orgToLeadershipAt.size > 0) {
      for (const item of sigItems) {
        const sig = signals[item.id];
        if (!sig || !item.relevance) continue;
        // Skip the leadership Signal itself — it doesn't bump itself
        if (sig.type === "service_news" && sig.attrs && (sig.attrs as Record<string, unknown>).isLeadershipAnnouncement) continue;
        const itemAt = sig.occurredAt || nowMs;
        const allIds = [
          ...(sig.subjectIds || []),
          ...(sig.relatedIds || []),
        ];
        let mostRecentLeadership = 0;
        for (const id of allIds) {
          const t = orgToLeadershipAt.get(id);
          if (t && t > mostRecentLeadership && itemAt - t <= LEADERSHIP_FLUX_WINDOW_MS) {
            mostRecentLeadership = t;
          }
        }
        if (mostRecentLeadership > 0) {
          const daysAgo = Math.max(0, Math.floor((itemAt - mostRecentLeadership) / (24 * 60 * 60 * 1000)));
          // Tighter recency → larger bump
          const bump = daysAgo <= 7 ? 0.10 : daysAgo <= 14 ? 0.08 : 0.05;
          item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
          item.relevance.total = Math.min(13, item.relevance.total + bump);
          item.relevance.whySurfaced.push(
            `Customer landscape in flux — leadership announcement ${daysAgo === 0 ? "today" : daysAgo + "d ago"} on a touched entity`
          );
          leadershipFluxBumps++;
        }
      }
    }
  }

  // 3.7. v1.14 — protest + opportunity_amendment confluence.
  //
  // When a protest Signal and an opportunity_amendment Signal touch the
  // same Org within ±45 days of each other, both bump. The two together
  // signal "procurement just got reset" — protest decisions correlate with
  // amendment cycles, and operators care more about either Signal in
  // isolation than they care about the confluence (which is a high-signal
  // intervention moment).
  //
  // 45-day window accounts for the typical GAO 100-day decision timeline
  // running against SAM.gov amendment cycles for the affected solicitation.
  // Bump: +0.15 (highest single confluence rule — procurement-reset is
  // operator-actionable in the next-call sense).
  let protestAmendmentBumps = 0;
  const PROTEST_AMENDMENT_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
  if (sigItems.length > 0) {
    // Build per-Org indices of the two types
    const orgToProtest = new Map<string, number[]>();
    const orgToAmendment = new Map<string, number[]>();
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig) continue;
      let bucket: Map<string, number[]> | null = null;
      if (sig.type === "protest") bucket = orgToProtest;
      else if (sig.type === "opportunity_amendment") bucket = orgToAmendment;
      if (!bucket) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      for (const id of allIds) {
        if (!id) continue;
        if (!bucket.has(id)) bucket.set(id, []);
        bucket.get(id)!.push(sig.occurredAt || 0);
      }
    }
    // Apply confluence bump
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      if (sig.type !== "protest" && sig.type !== "opportunity_amendment") continue;
      const myAt = sig.occurredAt || 0;
      const otherBucket =
        sig.type === "protest" ? orgToAmendment : orgToProtest;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let counterpartAt = 0;
      for (const id of allIds) {
        const times = otherBucket.get(id);
        if (!times) continue;
        for (const t of times) {
          if (Math.abs(t - myAt) <= PROTEST_AMENDMENT_WINDOW_MS && t > counterpartAt) {
            counterpartAt = t;
          }
        }
      }
      if (counterpartAt > 0) {
        const bump = 0.15;
        item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
        item.relevance.total = Math.min(13, item.relevance.total + bump);
        const daysApart = Math.max(0, Math.floor(Math.abs(myAt - counterpartAt) / (24 * 60 * 60 * 1000)));
        const counterpartLabel =
          sig.type === "protest" ? "opportunity amendment" : "GAO protest";
        item.relevance.whySurfaced.push(
          `Procurement-reset confluence — a ${counterpartLabel} touched the same entity ${daysApart}d ${myAt < counterpartAt ? "later" : "earlier"}`
        );
        protestAmendmentBumps++;
      }
    }
  }

  // 3.8. v1.15 — Posture-layer integration.
  //
  // The operator authors Posture data on entity nodes via the Inspector
  // POSTURE tab (path: Sovereign/Liberator/Operator/Unaware; trajectory:
  // Rising/Falling/Repositioning/Stable). Brief Synthesis v1.15 wires that
  // operator-authored context into every touching Signal:
  //
  //   path === 'Adversary':  +0.12 (highest single-attribute bump —
  //                                  operator has explicitly tagged this
  //                                  entity as adversary in workspace
  //                                  Posture, distinct from per-pursuit
  //                                  adversary tagging)
  //   path === 'Liberator':  +0.10 (ethically out-of-bounds operators per
  //                                  the doctrine — operator wants visibility)
  //   trajectory === 'Rising':  +0.05 (entity ascending in influence;
  //                                    Signals about them gain BD weight)
  //   trajectory === 'Falling': +0.05 (entity losing pull; symmetric)
  //
  // Bumps stack across attributes — a Falling Adversary would get +0.17
  // total. Magnitude cap at 1.0 protects the upper bound.
  //
  // This is additive on top of v1.11/v1.12/v1.13/v1.14. The Posture layer
  // is operator-authored ground truth; the other bumps are derived signals.
  let posturePathBumps = 0;
  let postureTrajectoryBumps = 0;
  const adversarySet = ctx.posturePathAdversaryIds;
  const liberatorSet = ctx.posturePathLiberatorIds;
  const risingSet = ctx.postureRisingIds;
  const fallingSet = ctx.postureFallingIds;
  if (
    sigItems.length > 0 &&
    ((adversarySet && adversarySet.size > 0) ||
      (liberatorSet && liberatorSet.size > 0) ||
      (risingSet && risingSet.size > 0) ||
      (fallingSet && fallingSet.size > 0))
  ) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let pathBump = 0;
      let pathLabel = "";
      let trajectoryBump = 0;
      let trajectoryLabel = "";
      for (const id of allIds) {
        if (!id) continue;
        if (adversarySet && adversarySet.has(id) && pathBump < 0.12) {
          pathBump = 0.12;
          pathLabel = "Posture path: Adversary";
        } else if (liberatorSet && liberatorSet.has(id) && pathBump < 0.10) {
          pathBump = 0.10;
          pathLabel = "Posture path: Liberator";
        }
        if (risingSet && risingSet.has(id) && trajectoryBump < 0.05) {
          trajectoryBump = 0.05;
          trajectoryLabel = "Posture trajectory: Rising";
        } else if (fallingSet && fallingSet.has(id) && trajectoryBump < 0.05) {
          trajectoryBump = 0.05;
          trajectoryLabel = "Posture trajectory: Falling";
        }
      }
      if (pathBump > 0) {
        item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + pathBump);
        item.relevance.total = Math.min(13, item.relevance.total + pathBump);
        item.relevance.whySurfaced.push(pathLabel);
        posturePathBumps++;
      }
      if (trajectoryBump > 0) {
        item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + trajectoryBump);
        item.relevance.total = Math.min(13, item.relevance.total + trajectoryBump);
        item.relevance.whySurfaced.push(trajectoryLabel);
        postureTrajectoryBumps++;
      }
    }
  }

  // 3.9. v1.16 — cross-source PE-mention confluence.
  //
  // When a non-budget Signal's text fields mention a Program Element
  // number that we also have a budget_change Signal for, bump the
  // mentioning Signal as lateral cross-source convergence. The fact that
  // a Congress.gov hearing transcript or a GAO report mentions PE
  // 0603308D8Z and we ALSO have a DoD Comptroller budget catalog entry
  // for the same PE is real operator-actionable cross-source linkage —
  // shows the PE is appearing in oversight/policy discussions, not just
  // dormant in a budget book.
  //
  // Bump: +0.10 magnitude. Lower than the type-specific confluence rules
  // (v1.14 protest+amendment is +0.15) because PE mentions in narrative
  // text are weaker signals than structured confluence — but +0.10 is
  // still enough to clearly lift mentioned-PE Signals above non-mentioned
  // ones.
  let peMentionBumps = 0;
  const PE_REGEX = /\b(0[1-9]\d{5}[A-Z]{0,3})\b/g;
  if (sigItems.length > 0) {
    // Build Set<peNumber> of PEs we have budget_change Signals for
    const indexedPes = new Set<string>();
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || sig.type !== "budget_change") continue;
      const pe = (sig.attrs as Record<string, unknown> | undefined)?.pe;
      if (typeof pe === "string" && pe) indexedPes.add(pe);
    }
    if (indexedPes.size > 0) {
      for (const item of sigItems) {
        const sig = signals[item.id];
        if (!sig || !item.relevance) continue;
        if (sig.type === "budget_change") continue; // skip self
        // Scan the Signal's attrs for PE mentions via JSON.stringify pass
        // (cheaper than walking each known text field by name)
        let attrsText = "";
        try {
          attrsText = JSON.stringify(sig.attrs || {});
        } catch {
          continue;
        }
        if (attrsText.length === 0) continue;
        const matchedPes = new Set<string>();
        PE_REGEX.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = PE_REGEX.exec(attrsText)) !== null) {
          const candidate = m[1];
          if (indexedPes.has(candidate)) matchedPes.add(candidate);
        }
        if (matchedPes.size === 0) continue;
        const bump = 0.10;
        item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
        item.relevance.total = Math.min(13, item.relevance.total + bump);
        const peList = Array.from(matchedPes).slice(0, 3).join(", ");
        const moreLabel = matchedPes.size > 3 ? ` (+${matchedPes.size - 3} more)` : "";
        item.relevance.whySurfaced.push(
          `Mentions budget PE ${peList}${moreLabel} — cross-source program-element link`
        );
        peMentionBumps++;
      }
    }
  }

  // 3.10. v1.17 — revolving-door touch warning.
  //
  // When a Signal touches an Org that has incoming `formerly_at` Edges
  // (= the workspace has registered-lobbyist Persons who formerly
  // worked at that institution), bump magnitude. The operator should
  // know when external Signals are flowing into customer-side
  // institutions where competitor lobbyists hold institutional history.
  //
  //   1 incoming formerly_at edge:     +0.06 magnitude
  //   2+ incoming formerly_at edges:   +0.10 magnitude
  //
  // Additive to all prior bump passes. Doesn't double-count with
  // v1.15 Posture bumps (those use the operator-tagged adversary set;
  // this uses the lobbyist-Person graph data from senate_lda v1.2).
  let revolvingDoorTouchBumps = 0;
  const formerlyAtIncoming = ctx.formerlyAtIncomingCountByOrg;
  if (
    sigItems.length > 0 &&
    formerlyAtIncoming &&
    formerlyAtIncoming.size > 0
  ) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxIncoming = 0;
      for (const id of allIds) {
        const c = formerlyAtIncoming.get(id) || 0;
        if (c > maxIncoming) maxIncoming = c;
      }
      if (maxIncoming === 0) continue;
      const bump = maxIncoming >= 2 ? 0.10 : 0.06;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Revolving-door touch — ${maxIncoming} lobbyist Person(s) in workspace formerly at a touched institution`
      );
      revolvingDoorTouchBumps++;
    }
  }

  // 3.10d. v1.22 — industry_assoc co-membership with adversary bump.
  //
  // When a Signal touches a company Org that shares trade-association
  // memberships with one or more operator-tagged active adversaries,
  // bump. Co-membership in industry associations (NDIA / AFA / AUSA)
  // signals overlapping institutional positioning — the touched Org
  // competes in the same forum space as a known adversary, which is
  // operator-actionable BD context.
  //
  //   3+ shared associations: +0.10 magnitude (deeply overlapping)
  //   2 shared associations:  +0.07
  //   1 shared association:   +0.04
  //
  // Additive on top of prior bumps. Doesn't apply to adversaries
  // themselves (already covered by the existing pursuit/adversary
  // weight). Capped at magnitude 1.0.
  let coMembershipBumps = 0;
  const sharedAssocCounts = ctx.sharedAssocsWithAdversaryByOrg;
  if (sigItems.length > 0 && sharedAssocCounts && sharedAssocCounts.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxShared = 0;
      for (const id of allIds) {
        const c = sharedAssocCounts.get(id) || 0;
        if (c > maxShared) maxShared = c;
      }
      if (maxShared === 0) continue;
      let bump = 0.04;
      if (maxShared >= 3) bump = 0.10;
      else if (maxShared === 2) bump = 0.07;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Industry-assoc co-membership — touched Org shares ${maxShared} association${maxShared === 1 ? "" : "s"} with active adversary`
      );
      coMembershipBumps++;
    }
  }

  // 3.10h. v1.28 — customer-funding flow bump.
  //
  // Mirror of v1.27 keyed on customerOrgId. When a touched customer Org
  // has trailing-12mo INBOUND obligated dollars (sum of awards where
  // customerOrgId === org) >= 1.5x prior-12mo AND trailing > $1M, bump
  // items touching that Org. Captures "this customer just started
  // spending" — the BD-side complement to v1.27 ("this contractor just
  // started winning"). Distinct from v1.27 because the same dollar
  // figure ramps both customer-side outflow AND contractor-side inflow,
  // but they show up on opposite ends of the BD ecosystem.
  //
  // Tiers (multiplier = trailing / max(prior, 1)):
  //   1.5–2.4x + trailing >= $1M:  +0.06 magnitude
  //   2.5–4.9x + trailing >= $1M:  +0.10
  //   5.0x+ + trailing >= $1M:     +0.14
  //
  // Capped at magnitude 1.0. Uses ctx.awards walk identical to v1.27.
  let customerFundingFlowBumps = 0;
  const customerFundingByOrg = new Map<string, number>();
  if (ctx.awards.size > 0 && sigItems.length > 0) {
    const trailingByCustomer = new Map<string, number>();
    const priorByCustomer = new Map<string, number>();
    const cutoffTrailingMs = nowMs - 365 * 86400000;
    const cutoffPriorMs = nowMs - 730 * 86400000;
    for (const award of ctx.awards.values()) {
      if (!award || !award.customerOrgId) continue;
      const at = award.awardedAt || 0;
      const obl = Number(award.obligated || 0);
      if (!Number.isFinite(obl) || obl <= 0) continue;
      if (at >= cutoffTrailingMs) {
        trailingByCustomer.set(
          award.customerOrgId,
          (trailingByCustomer.get(award.customerOrgId) || 0) + obl
        );
      } else if (at >= cutoffPriorMs) {
        priorByCustomer.set(
          award.customerOrgId,
          (priorByCustomer.get(award.customerOrgId) || 0) + obl
        );
      }
    }
    for (const [orgId, trailing] of trailingByCustomer) {
      if (trailing < 1_000_000) continue;
      const prior = priorByCustomer.get(orgId) || 0;
      const denom = Math.max(prior, 1);
      const ratio = trailing / denom;
      if (ratio >= 1.5) customerFundingByOrg.set(orgId, ratio);
    }
  }
  if (sigItems.length > 0 && customerFundingByOrg.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxRatio = 0;
      for (const id of allIds) {
        const r = customerFundingByOrg.get(id) || 0;
        if (r > maxRatio) maxRatio = r;
      }
      if (maxRatio < 1.5) continue;
      let bump = 0.06;
      if (maxRatio >= 5.0) bump = 0.14;
      else if (maxRatio >= 2.5) bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Customer-funding flow — touched customer Org's trailing 12mo inbound obligated $ ${maxRatio.toFixed(1)}x prior 12mo (>= $1M trailing)`
      );
      customerFundingFlowBumps++;
    }
  }

  // 3.10g. v1.27 — funding-momentum bump.
  //
  // For each touched Org, compute trailing-12-month obligated dollars
  // (sum of award.obligated where awardedAt within last 365d AND
  // primeOrgId === orgId) vs. prior-12-month (days 365-730 ago). When
  // trailing >= 1.5x prior AND trailing > $1M, the Org's dollar volume
  // is meaningfully ramping. Bump items touching that Org.
  //
  // Tiers (multiplier = trailingDollars / max(priorDollars, 1)):
  //   1.5–2.4x + trailing >= $1M:  +0.06 magnitude
  //   2.5–4.9x + trailing >= $1M:  +0.10
  //   5.0x+ + trailing >= $5M:     +0.14
  //
  // Capped at magnitude 1.0. Uses ctx.awards (already loaded). The
  // cost is one Map walk per sync — negligible.
  let fundingMomentumBumps = 0;
  const fundingMomentumByOrg = new Map<string, number>(); // orgId → ratio
  if (ctx.awards.size > 0 && sigItems.length > 0) {
    const trailingByOrg = new Map<string, number>();
    const priorByOrg = new Map<string, number>();
    const cutoffTrailingMs = nowMs - 365 * 86400000;
    const cutoffPriorMs = nowMs - 730 * 86400000;
    for (const award of ctx.awards.values()) {
      if (!award || !award.primeOrgId) continue;
      const at = award.awardedAt || 0;
      const obl = Number(award.obligated || 0);
      if (!Number.isFinite(obl) || obl <= 0) continue;
      if (at >= cutoffTrailingMs) {
        trailingByOrg.set(
          award.primeOrgId,
          (trailingByOrg.get(award.primeOrgId) || 0) + obl
        );
      } else if (at >= cutoffPriorMs) {
        priorByOrg.set(
          award.primeOrgId,
          (priorByOrg.get(award.primeOrgId) || 0) + obl
        );
      }
    }
    for (const [orgId, trailing] of trailingByOrg) {
      if (trailing < 1_000_000) continue;
      const prior = priorByOrg.get(orgId) || 0;
      const denom = Math.max(prior, 1);
      const ratio = trailing / denom;
      if (ratio >= 1.5) fundingMomentumByOrg.set(orgId, ratio);
    }
  }
  if (sigItems.length > 0 && fundingMomentumByOrg.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxRatio = 0;
      for (const id of allIds) {
        const r = fundingMomentumByOrg.get(id) || 0;
        if (r > maxRatio) maxRatio = r;
      }
      if (maxRatio < 1.5) continue;
      let bump = 0.06;
      if (maxRatio >= 5.0) bump = 0.14;
      else if (maxRatio >= 2.5) bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Funding-momentum touch — touched Org's trailing 12mo obligated $ ${maxRatio.toFixed(1)}x prior 12mo (>= $1M trailing)`
      );
      fundingMomentumBumps++;
    }
  }

  // 3.10f. v1.25 — Signal-type diversity touch bump.
  //
  // When a touched Org receives 4+ DISTINCT Signal types within the
  // Brief window, bump items touching that Org. Distinct from v1.11
  // CONV (which counts source SYSTEMS): the same source system can
  // emit multiple signal types — congress_gov fires hearing +
  // nomination + committee_meeting; sec_edgar fires material_event +
  // insider_transaction + periodic_report + proxy_statement. The
  // diversity axis captures "this Org is showing up across many
  // different kinds of activity" which is a different operator
  // signal than "this Org is showing up across many feeds".
  //
  //   4 distinct types: +0.06 magnitude
  //   5 distinct types: +0.10
  //   6+ distinct types: +0.14
  //
  // Capped at magnitude 1.0. Counts only sig items that scored a
  // relevance > 0 (so noise signals don't pad the diversity count).
  let typeDiversityBumps = 0;
  const typesByOrg = new Map<string, Set<string>>();
  if (sigItems.length > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      if (!sig.type) continue;
      if ((item.relevance.total || 0) <= 0) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      for (const id of allIds) {
        if (!id) continue;
        if (!typesByOrg.has(id)) typesByOrg.set(id, new Set());
        typesByOrg.get(id)!.add(sig.type);
      }
    }
  }
  if (sigItems.length > 0 && typesByOrg.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxTypes = 0;
      for (const id of allIds) {
        const set = typesByOrg.get(id);
        const c = set ? set.size : 0;
        if (c > maxTypes) maxTypes = c;
      }
      if (maxTypes < 4) continue;
      let bump = 0.06;
      if (maxTypes >= 6) bump = 0.14;
      else if (maxTypes === 5) bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Signal-type diversity touch — touched Org has ${maxTypes} distinct Signal types in this window`
      );
      typeDiversityBumps++;
    }
  }

  // 3.10e. v1.24 — influence-net density (HUB) bump.
  //
  // When a touched Org has >=3 distinct weighty Persons (each carrying
  // 3+ outbound institutional-role edge labels) connected via inbound
  // member_of / acting_at / formerly_at / lobbyist_at edges, bump.
  // Captures "this Org is the center of an institutional influence
  // cluster" — strict superset of single-axis DOOR/ACTING/WEIGHT cases
  // that compounds on top of them when the same Org has multiple
  // institutional anchors converging.
  //
  //   3 weighty Persons: +0.08 magnitude
  //   4 weighty Persons: +0.12
  //   5+ weighty Persons: +0.15
  //
  // Capped at magnitude 1.0. Doesn't apply to Persons (the v1.20 WEIGHT
  // chip already covers Person-side institutional weight) — this is
  // explicitly the Org-side cluster signal.
  let influenceNetHubBumps = 0;
  const hubCounts = ctx.weightyPersonCountByOrg;
  if (sigItems.length > 0 && hubCounts && hubCounts.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxCount = 0;
      for (const id of allIds) {
        const c = hubCounts.get(id) || 0;
        if (c > maxCount) maxCount = c;
      }
      if (maxCount < 3) continue;
      let bump = 0.08;
      if (maxCount >= 5) bump = 0.15;
      else if (maxCount === 4) bump = 0.12;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Influence-net hub — touched Org has ${maxCount} weighty Persons converging via institutional edges`
      );
      influenceNetHubBumps++;
    }
  }

  // 3.10c. v1.21 — acting_at touch bump.
  //
  // Mirror of the v1.17 revolving-door touch warning, keyed on
  // `acting_at` Edges from plumBook v1.1. When a Signal touches an Org
  // that has a designated-acting Person currently at it, bump because
  // the customer-side leadership is literally in flux right now.
  //
  // 1 incoming acting_at edge:   +0.08 magnitude (single acting role)
  // 2+ incoming acting_at edges: +0.12 (multiple acting officials =
  //                                     deep leadership turnover)
  let actingAtTouchBumps = 0;
  const actingIncoming = ctx.actingAtIncomingCountByOrg;
  if (sigItems.length > 0 && actingIncoming && actingIncoming.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxIncoming = 0;
      for (const id of allIds) {
        const c = actingIncoming.get(id) || 0;
        if (c > maxIncoming) maxIncoming = c;
      }
      if (maxIncoming === 0) continue;
      const bump = maxIncoming >= 2 ? 0.12 : 0.08;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Acting-leadership touch — ${maxIncoming} acting official(s) currently designated at a touched institution`
      );
      actingAtTouchBumps++;
    }
  }

  // 3.10b. v1.20 — high-institutional-weight Person touch bump.
  //
  // When a Signal touches a Person carrying 3+ distinct outbound Edge
  // labels (across lobbyist_at / formerly_at / member_of / acting_at),
  // that Person has institutional weight across multiple BD axes. Bump
  // the Signal so they don't get lost in the long tail.
  //
  // 4+ labels: +0.10 magnitude (rare; very high cross-source presence)
  // 3 labels:  +0.07
  //
  // Doesn't apply to Orgs — the v1.17 revolving-door touch bump already
  // covers Org-side institutional weight. This rule is Person-specific.
  let weightyPersonTouchBumps = 0;
  const weightCounts = ctx.outboundEdgeLabelCountByPerson;
  if (
    sigItems.length > 0 &&
    weightCounts &&
    weightCounts.size > 0
  ) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxLabels = 0;
      for (const id of allIds) {
        const c = weightCounts.get(id) || 0;
        if (c > maxLabels) maxLabels = c;
      }
      if (maxLabels < 3) continue;
      const bump = maxLabels >= 4 ? 0.10 : 0.07;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Institutional-weight Person touched — entity has ${maxLabels} distinct cross-source roles`
      );
      weightyPersonTouchBumps++;
    }
  }

  // 3.11. v1.18 — Adversary Activity Rollup.
  //
  // For each adversary Org (active or archived per the operator's pursuit
  // posture data), summarize this Brief window's Signal touches:
  //   - signalCount, latestSignalAt
  //   - recentSignalIds[] (top 8 most-recent touching Signals)
  //   - sources[] (distinct external feeds contributing touches)
  //   - totalRelevance (sum of relevance.total across all touches —
  //     proxies "weight of activity" and sorts the rollup by intensity)
  //   - active (true when on non-terminal pursuit, false when archived
  //     adversary only)
  //
  // The Brief client can render this as a dashboard card alongside the
  // category buckets without re-walking the full Signal corpus.
  const adversaryUnion = new Set<string>();
  ctx.activeAdversaryOrgIds.forEach((id) => adversaryUnion.add(id));
  ctx.archivedAdversaryOrgIds.forEach((id) => adversaryUnion.add(id));

  const rollupByOrg = new Map<
    string,
    {
      orgId: string;
      orgName: string | null;
      touches: Array<{ sigId: string; at: number; relevance: number; system: string; title: string }>;
      sources: Set<string>;
      active: boolean;
    }
  >();

  // Resolve adversary Org names by reading the workspace nodes once.
  // The display label improves the rollup card readability — opaque
  // Org ids are useless without names.
  const adversaryNameById = new Map<string, string>();
  if (adversaryUnion.size > 0) {
    try {
      const nodesForRollupSnap = await db
        .ref(wsPath(workspaceId, "nodes"))
        .once("value");
      const nodesForRollup =
        (nodesForRollupSnap.val() as Record<string, { name?: string }> | null) ?? {};
      for (const id of adversaryUnion) {
        const n = nodesForRollup[id];
        if (n && typeof n.name === "string" && n.name.trim()) {
          adversaryNameById.set(id, n.name.trim());
        }
      }
    } catch {
      // best-effort; fall through to id-only display
    }
  }

  if (adversaryUnion.size > 0 && sigItems.length > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      const system = sig.source?.system || "unknown";
      for (const id of allIds) {
        if (!adversaryUnion.has(id)) continue;
        if (!rollupByOrg.has(id)) {
          rollupByOrg.set(id, {
            orgId: id,
            orgName: adversaryNameById.get(id) || null,
            touches: [],
            sources: new Set(),
            active: ctx.activeAdversaryOrgIds.has(id),
          });
        }
        const entry = rollupByOrg.get(id)!;
        entry.touches.push({
          sigId: sig.id,
          at: sig.occurredAt || 0,
          relevance: item.relevance.total,
          system,
          title: (item.title || "").slice(0, 160),
        });
        entry.sources.add(system);
      }
    }
  }

  const adversaryRollup: AdversaryRollupEntry[] = [];
  for (const entry of rollupByOrg.values()) {
    if (entry.touches.length === 0) continue;
    entry.touches.sort((a, b) => b.at - a.at);
    const totalRelevance = entry.touches.reduce((s, t) => s + t.relevance, 0);
    // Top signal = highest relevance.total across this Org's touches
    const topTouch = entry.touches.reduce((best, t) =>
      t.relevance > best.relevance ? t : best
    );
    adversaryRollup.push({
      orgId: entry.orgId,
      orgName: entry.orgName,
      signalCount: entry.touches.length,
      latestSignalAt: entry.touches[0].at,
      recentSignalIds: entry.touches.slice(0, 8).map((t) => t.sigId),
      sources: Array.from(entry.sources).sort(),
      totalRelevance: Math.round(totalRelevance * 100) / 100,
      active: entry.active,
      topSignalTitle: topTouch.title || null,
      topSignalId: topTouch.sigId,
      topSignalRelevance: Math.round(topTouch.relevance * 100) / 100,
    });
  }
  // Sort: active first, then totalRelevance desc, then signalCount tiebreak
  adversaryRollup.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const dr = b.totalRelevance - a.totalRelevance;
    if (Math.abs(dr) > 0.01) return dr;
    return b.signalCount - a.signalCount;
  });

  // 3.12. Customer Activity Rollup — mirrors the adversary pass but
  // keyed on customerOrgIds (active watchlist) ∪ customerHistoryOrgIds
  // (historical pursuits). Customer agencies generally see more Signal
  // activity than adversaries because Congress.gov hearings + GAO
  // reports + FACA committees + service news all touch them regularly;
  // the rollup makes "which of my customer agencies is the busiest
  // this week" answerable at a glance.
  const customerUnion = new Set<string>();
  ctx.customerOrgIds.forEach((id) => customerUnion.add(id));
  ctx.customerHistoryOrgIds.forEach((id) => customerUnion.add(id));

  const customerNameById = new Map<string, string>();
  if (customerUnion.size > 0) {
    try {
      const nodesForCustomerSnap = await db
        .ref(wsPath(workspaceId, "nodes"))
        .once("value");
      const nodesForCustomer =
        (nodesForCustomerSnap.val() as Record<string, { name?: string }> | null) ?? {};
      for (const id of customerUnion) {
        const n = nodesForCustomer[id];
        if (n && typeof n.name === "string" && n.name.trim()) {
          customerNameById.set(id, n.name.trim());
        }
      }
    } catch {
      // best-effort; id-only display fallback
    }
  }

  const customerRollupByOrg = new Map<
    string,
    {
      orgId: string;
      orgName: string | null;
      touches: Array<{ sigId: string; at: number; relevance: number; system: string; title: string }>;
      sources: Set<string>;
      active: boolean;
    }
  >();

  if (customerUnion.size > 0 && sigItems.length > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      const system = sig.source?.system || "unknown";
      for (const id of allIds) {
        if (!customerUnion.has(id)) continue;
        if (!customerRollupByOrg.has(id)) {
          customerRollupByOrg.set(id, {
            orgId: id,
            orgName: customerNameById.get(id) || null,
            touches: [],
            sources: new Set(),
            active: ctx.customerOrgIds.has(id),
          });
        }
        const entry = customerRollupByOrg.get(id)!;
        entry.touches.push({
          sigId: sig.id,
          at: sig.occurredAt || 0,
          relevance: item.relevance.total,
          system,
          title: (item.title || "").slice(0, 160),
        });
        entry.sources.add(system);
      }
    }
  }

  const customerRollup: CustomerRollupEntry[] = [];
  for (const entry of customerRollupByOrg.values()) {
    if (entry.touches.length === 0) continue;
    entry.touches.sort((a, b) => b.at - a.at);
    const totalRelevance = entry.touches.reduce((s, t) => s + t.relevance, 0);
    const topTouch = entry.touches.reduce((best, t) =>
      t.relevance > best.relevance ? t : best
    );
    customerRollup.push({
      orgId: entry.orgId,
      orgName: entry.orgName,
      signalCount: entry.touches.length,
      latestSignalAt: entry.touches[0].at,
      recentSignalIds: entry.touches.slice(0, 8).map((t) => t.sigId),
      sources: Array.from(entry.sources).sort(),
      totalRelevance: Math.round(totalRelevance * 100) / 100,
      active: entry.active,
      topSignalTitle: topTouch.title || null,
      topSignalId: topTouch.sigId,
      topSignalRelevance: Math.round(topTouch.relevance * 100) / 100,
    });
  }
  customerRollup.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const dr = b.totalRelevance - a.totalRelevance;
    if (Math.abs(dr) > 0.01) return dr;
    return b.signalCount - a.signalCount;
  });

  // 3.12b. v1.23 — temporal momentum bump.
  //
  // When a touched Org's "this week" touch count (current Brief + 6
  // prior daily Briefs) is significantly above its trailing 4-week
  // average (3 prior weekly windows), bump items touching that Org.
  // Surfaces "this Org just got busy" without operator-side trend
  // analysis. Reads the persisted dailyBrief/{dateKey} rollups, so
  // it costs ~28 RTDB reads (small Brief JSON, parallel).
  //
  //   2.0–3.9x baseline + thisWeek>=3: +0.06 magnitude
  //   4.0–6.9x baseline:               +0.10
  //   7.0x+ baseline (or fresh emerge): +0.14
  //
  // Floor on denominator (0.5) lets fresh-emergence Orgs (no prior
  // history) trigger when this-week touch count is genuinely high
  // (>=3). Capped at magnitude 1.0. Scoped to adversary+customer
  // Orgs only — those are the rollup-tracked Org classes with
  // persisted historical signal-count data.
  let temporalMomentumBumps = 0;
  const momentumRatioByOrg = new Map<string, number>();
  try {
    const today = new Date(nowMs);
    const baseDateMs = today.getTime();
    const priorDateKeys: string[] = [];
    for (let i = 1; i <= 27; i++) {
      const d = new Date(baseDateMs - i * 86400000);
      priorDateKeys.push(d.toISOString().slice(0, 10));
    }
    const priorSnaps = await Promise.all(
      priorDateKeys.map((k) =>
        db.ref(wsPath(workspaceId, "derivedViews", "dailyBrief", k)).once("value")
      )
    );
    const thisWeekByOrg = new Map<string, number>();
    const trailingByOrg = new Map<string, number>(); // sum of days 7-27 ago (3 weeks)
    let trailingDayCount = 0;
    // Seed thisWeek with today's contribution from both rollups.
    for (const r of adversaryRollup) {
      thisWeekByOrg.set(r.orgId, (thisWeekByOrg.get(r.orgId) || 0) + r.signalCount);
    }
    for (const r of customerRollup) {
      thisWeekByOrg.set(r.orgId, (thisWeekByOrg.get(r.orgId) || 0) + r.signalCount);
    }
    for (let pi = 0; pi < priorSnaps.length; pi++) {
      const v = priorSnaps[pi].val() as BriefOutput | null;
      if (!v) continue;
      const daysAgo = pi + 1; // priorDateKeys[0] = 1 day ago
      const inThisWeek = daysAgo <= 6;
      if (!inThisWeek) trailingDayCount++;
      const rollups = [
        ...((v.adversaryRollup as AdversaryRollupEntry[] | undefined) || []),
        ...((v.customerRollup as CustomerRollupEntry[] | undefined) || []),
      ];
      for (const r of rollups) {
        const c = Number(r.signalCount || 0);
        if (c <= 0 || !r.orgId) continue;
        if (inThisWeek) {
          thisWeekByOrg.set(r.orgId, (thisWeekByOrg.get(r.orgId) || 0) + c);
        } else {
          trailingByOrg.set(r.orgId, (trailingByOrg.get(r.orgId) || 0) + c);
        }
      }
    }
    // Weekly average of trailing window. trailingDayCount counts
    // days where we found a Brief snapshot; if none found, baseline
    // stays at 0 → denom floor handles cold start.
    const trailingWeeks = Math.max(trailingDayCount / 7, 0.1);
    for (const [orgId, thisWk] of thisWeekByOrg) {
      if (thisWk < 3) continue;
      const trailingSum = trailingByOrg.get(orgId) || 0;
      const weeklyAvg = trailingSum / Math.max(trailingWeeks, 1);
      const denom = Math.max(weeklyAvg, 0.5);
      const ratio = thisWk / denom;
      if (ratio >= 2.0) momentumRatioByOrg.set(orgId, ratio);
    }
  } catch (err) {
    log?.warn?.("temporal_momentum_baseline_read_failed", {
      message: (err as Error).message,
    });
  }
  if (sigItems.length > 0 && momentumRatioByOrg.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxRatio = 0;
      for (const id of allIds) {
        const r = momentumRatioByOrg.get(id) || 0;
        if (r > maxRatio) maxRatio = r;
      }
      if (maxRatio < 2.0) continue;
      let bump = 0.06;
      if (maxRatio >= 7.0) bump = 0.14;
      else if (maxRatio >= 4.0) bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Temporal momentum — touched Org's this-week touches ${maxRatio.toFixed(1)}x trailing 4-week average`
      );
      temporalMomentumBumps++;
    }
  }

  // 3.13. v1.18 — confluence-of-confluences nexus bump.
  //
  // After all prior bump passes (v1.11-v1.17), count how many distinct
  // scoring axes fired on each Signal item by scanning its whySurfaced[]
  // for axis-anchor prefixes. When ≥3 axes hit on a single item, the
  // operator should know — multi-axis confluence is the strongest
  // single indicator that the platform's signals have converged on
  // one event.
  //
  //   3 axes:  +0.08 magnitude
  //   4 axes:  +0.12
  //   5+ axes: +0.15
  //
  // Caps with the existing magnitude max of 1.0. Adds a single
  // whySurfaced line that names the count + a stable "NEXUS" anchor so
  // the client touch-row chip can detect and render it.
  let nexusBumps = 0;
  if (sigItems.length > 0) {
    const AXIS_PREFIXES = [
      "Cross-source convergence",
      "Tight cross-source",
      "Customer landscape in flux",
      "Procurement-reset confluence",
      "Posture path: Adversary",
      "Posture path: Liberator",
      "Posture trajectory:",
      "Mentions budget PE",
      "Revolving-door touch",
      "Institutional-weight Person touched",
      "Acting-leadership touch",
      "Industry-assoc co-membership",
      "Temporal momentum",
      "Influence-net hub",
      "Signal-type diversity touch",
      "Funding-momentum touch",
      "Customer-funding flow",
      "Funding-flow co-fire",
      "Merge-pending touch",
      "Recent-award touch",
      "Same-day Org spike",
      "Apex triple-capstone",
      "Pipeline-stage transition touch",
      "Meeting-touch",
    ];
    for (const item of sigItems) {
      if (!item.relevance) continue;
      const lines = item.relevance.whySurfaced || [];
      const seenAxes = new Set<string>();
      for (const line of lines) {
        if (typeof line !== "string") continue;
        for (const prefix of AXIS_PREFIXES) {
          if (line.startsWith(prefix)) {
            seenAxes.add(prefix);
            break;
          }
        }
      }
      if (seenAxes.size < 3) continue;
      let bump = 0.08;
      if (seenAxes.size >= 5) bump = 0.15;
      else if (seenAxes.size === 4) bump = 0.12;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Nexus convergence — ${seenAxes.size} scoring axes fired on this item`
      );
      nexusBumps++;
    }
  }

  // 3.13f. v1.34 — pipeline-stage transition touch (STAGE chip).
  //
  // When a touched Org is on an opportunity that has recently changed
  // stage (opp.stageEnteredAt within last 14 days), bump items touching
  // that Org. Captures operator pipeline-velocity signal directly into
  // Brief scoring — your moving deals lift their intel.
  //
  // Org membership defined as any of: opp.customerOrgId, opp.primeOrgId,
  // opp.posture.adversaries[]. A single Org can sit across multiple
  // recently-transitioned opps; we count distinct opps to scale the bump.
  //
  // Tiers (max distinct recent-transition opps per Org):
  //   1 recent transition:   +0.06 magnitude
  //   2-3 transitions:       +0.10
  //   4+ transitions:        +0.14
  //
  // Capped at magnitude 1.0. If stageEnteredAt is missing across the
  // workspace (Phase 6 write-side incomplete, per build-tracker note),
  // the rule degrades gracefully — fires zero times. When Phase 6 lands,
  // the rule activates without further code changes.
  let pipelineStageTransitionBumps = 0;
  const stageTransitionCountByOrg = new Map<string, number>();
  if (ctx.opportunities.size > 0 && sigItems.length > 0) {
    const transitionCutoffMs = nowMs - 14 * 86400000;
    for (const opp of ctx.opportunities.values()) {
      if (!opp) continue;
      const sea = typeof opp.stageEnteredAt === "number" ? opp.stageEnteredAt : 0;
      if (!sea || sea < transitionCutoffMs) continue;
      const orgs: string[] = [];
      if (opp.customerOrgId) orgs.push(opp.customerOrgId);
      if (opp.posture && Array.isArray(opp.posture.adversaries)) {
        for (const a of opp.posture.adversaries) {
          if (typeof a === "string" && a) orgs.push(a);
        }
      }
      // Dedupe within this opp so a single opp counts once per Org
      const seenForThisOpp = new Set<string>();
      for (const o of orgs) {
        if (seenForThisOpp.has(o)) continue;
        seenForThisOpp.add(o);
        stageTransitionCountByOrg.set(o, (stageTransitionCountByOrg.get(o) || 0) + 1);
      }
    }
  }
  if (sigItems.length > 0 && stageTransitionCountByOrg.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxCount = 0;
      for (const id of allIds) {
        const c = stageTransitionCountByOrg.get(id) || 0;
        if (c > maxCount) maxCount = c;
      }
      if (maxCount === 0) continue;
      let bump = 0.06;
      if (maxCount >= 4) bump = 0.14;
      else if (maxCount >= 2) bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Pipeline-stage transition touch — touched Org sits on ${maxCount} pursuit${maxCount === 1 ? "" : "s"} that changed stage in the last 14 days`
      );
      pipelineStageTransitionBumps++;
    }
  }

  // 3.13e. v1.32 — same-day Org spike (SPIKE chip).
  //
  // When 3+ Signals on the same touched Org cluster within a 24h
  // window (any 24h slice containing 3+ touches for that Org), bump
  // items touching that Org. Sharper signal than v1.12 TIGHT — TIGHT
  // is item-centric and uses ±72h around each Signal; SPIKE is
  // Org-centric and uses a 24h slice across the whole Brief window.
  //
  // A protest, an 8-K, and a hearing all landing on Lockheed on the
  // same Tuesday is a different (sharper) signal than the same three
  // events spread across a week.
  //
  // Tiers (max same-day touch count per Org):
  //   3 touches in 24h:  +0.08 magnitude
  //   4-5 touches:       +0.12
  //   6+ touches:        +0.16
  //
  // Capped at magnitude 1.0. Operates only on sigItems where
  // item.relevance.total > 0 to avoid noise Signals padding the count.
  let sameDayOrgSpikeBumps = 0;
  const spikeCountByOrg = new Map<string, number>();
  if (sigItems.length > 0) {
    // Per-Org sorted list of occurredAt timestamps
    const occurredByOrg = new Map<string, number[]>();
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      if ((item.relevance.total || 0) <= 0) continue;
      const at = sig.occurredAt || 0;
      if (!at) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      for (const id of allIds) {
        if (!id) continue;
        if (!occurredByOrg.has(id)) occurredByOrg.set(id, []);
        occurredByOrg.get(id)!.push(at);
      }
    }
    // Sliding 24h window per Org — find max touch count in any 24h slice
    const WINDOW_MS = 24 * 60 * 60 * 1000;
    for (const [orgId, times] of occurredByOrg) {
      if (times.length < 3) continue;
      times.sort((a, b) => a - b);
      let left = 0;
      let maxInWindow = 1;
      for (let right = 1; right < times.length; right++) {
        while (left < right && times[right] - times[left] > WINDOW_MS) left++;
        const inWindow = right - left + 1;
        if (inWindow > maxInWindow) maxInWindow = inWindow;
      }
      if (maxInWindow >= 3) spikeCountByOrg.set(orgId, maxInWindow);
    }
  }
  if (sigItems.length > 0 && spikeCountByOrg.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxCount = 0;
      for (const id of allIds) {
        const c = spikeCountByOrg.get(id) || 0;
        if (c > maxCount) maxCount = c;
      }
      if (maxCount < 3) continue;
      let bump = 0.08;
      if (maxCount >= 6) bump = 0.16;
      else if (maxCount >= 4) bump = 0.12;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Same-day Org spike — ${maxCount} Signals touched this Org within a single 24h window`
      );
      sameDayOrgSpikeBumps++;
    }
  }

  // 3.13d. v1.31 — recent-award touch (WIN chip).
  //
  // When a touched Org has any workspace award with lastModifiedAt
  // within the past 30 days, bump items touching that Org. Captures
  // SHORT-WINDOW event-driven award activity (new modifications,
  // fresh wins, contract option exercises) distinct from v1.27 FUND
  // (12-month obligated-$ rollup) and v1.28 CUSTFUND (customer-side
  // 12mo rollup). Where FUND/CUSTFUND ask 'is this Org's dollar
  // volume trending up?', WIN asks 'is something happening THIS
  // MONTH on this Org's awards?'.
  //
  // Tiers (count = distinct awards in 30d window):
  //   1 recent award:  +0.06 magnitude
  //   2-3 recent:      +0.10
  //   4+ recent:       +0.14
  //
  // Capped at magnitude 1.0. Walks ctx.awards.values() once to
  // bucket per primeOrgId / customerOrgId then bumps via touched
  // entity intersection — same pattern as v1.27/v1.28.
  let recentAwardTouchBumps = 0;
  const recentAwardCountByOrg = new Map<string, number>();
  if (ctx.awards.size > 0 && sigItems.length > 0) {
    const cutoff30dMs = nowMs - 30 * 86400000;
    for (const award of ctx.awards.values()) {
      if (!award) continue;
      const lm = Number(award.lastModifiedAt || award.awardedAt || 0);
      if (!Number.isFinite(lm) || lm < cutoff30dMs) continue;
      // Count on both the prime side AND the customer side — a fresh
      // award is operator-relevant from either direction.
      if (award.primeOrgId) {
        recentAwardCountByOrg.set(
          award.primeOrgId,
          (recentAwardCountByOrg.get(award.primeOrgId) || 0) + 1
        );
      }
      if (award.customerOrgId) {
        recentAwardCountByOrg.set(
          award.customerOrgId,
          (recentAwardCountByOrg.get(award.customerOrgId) || 0) + 1
        );
      }
    }
  }
  if (sigItems.length > 0 && recentAwardCountByOrg.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let maxCount = 0;
      for (const id of allIds) {
        const c = recentAwardCountByOrg.get(id) || 0;
        if (c > maxCount) maxCount = c;
      }
      if (maxCount === 0) continue;
      let bump = 0.06;
      if (maxCount >= 4) bump = 0.14;
      else if (maxCount >= 2) bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Recent-award touch — touched Org has ${maxCount} workspace award${maxCount === 1 ? "" : "s"} with activity in the last 30 days`
      );
      recentAwardTouchBumps++;
    }
  }

  // 3.13g. v1.35 — meeting-touch (MEET chip).
  //
  // When a Signal touches an entity (Org OR Person) that the operator
  // mentioned in a logged meeting within the past 14 days, bump items
  // touching that entity. Ties operator workflow directly into Brief
  // scoring — the meetings you log get reflected within hours, not
  // weeks. The platform learns from operator behavior.
  //
  // Bump policy (count = distinct meeting-touched ids per item):
  //   1 meeting-touched id:  +0.08 magnitude
  //   2-3 meeting-touched:   +0.12
  //   4+ meeting-touched:    +0.16
  //
  // Capped at magnitude 1.0. The +0.08 floor is intentionally higher
  // than DEDUP (+0.05) because meeting-mention is a strong operator
  // signal of attention, not a workflow flag.
  let meetingTouchBumps = 0;
  const meetingTouched = ctx.meetingTouchedNodeIds;
  if (sigItems.length > 0 && meetingTouched && meetingTouched.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let hitCount = 0;
      for (const id of allIds) {
        if (meetingTouched.has(id)) hitCount++;
      }
      if (hitCount === 0) continue;
      let bump = 0.08;
      if (hitCount >= 4) bump = 0.16;
      else if (hitCount >= 2) bump = 0.12;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Meeting-touch — touched entity${hitCount === 1 ? " was" : "ies were"} mentioned in operator meeting${hitCount === 1 ? "" : "s"} within last 14 days (${hitCount} touched id${hitCount === 1 ? "" : "s"})`
      );
      meetingTouchBumps++;
    }
  }

  // 3.13c. v1.30 — merge-pending touch (DEDUP chip).
  //
  // When a Signal touches an entity (Org or Person) that's currently
  // in an UNRESOLVED merge candidate, bump +0.05 magnitude and emit
  // a DEDUP chip. This is a workflow signal more than a relevance
  // signal — it tells the operator "this item's touched entity has
  // an ambiguous identity; clear the dedupe queue before trusting
  // the rest of the score." Conservative bump because it's the
  // weakest of the magnitude axes; the chip is the main payload.
  //
  // Reads ctx.pendingMergeIds (Set<entityId> built from both
  // personMergeCandidates + orgMergeCandidates at workspace load
  // time, filtered to unresolved entries only).
  let mergePendingTouchBumps = 0;
  const pending = ctx.pendingMergeIds;
  if (sigItems.length > 0 && pending && pending.size > 0) {
    for (const item of sigItems) {
      const sig = signals[item.id];
      if (!sig || !item.relevance) continue;
      const allIds = [
        ...(sig.subjectIds || []),
        ...(sig.relatedIds || []),
      ];
      let hitCount = 0;
      for (const id of allIds) {
        if (pending.has(id)) hitCount++;
      }
      if (hitCount === 0) continue;
      const bump = 0.05;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Merge-pending touch — ${hitCount} touched entity${hitCount === 1 ? " is" : "ies are"} in unresolved merge candidate(s); clear dedupe queue to firm up identity`
      );
      mergePendingTouchBumps++;
    }
  }

  // 3.13b. v1.29 — funding-flow co-fire bonus (FLOW chip).
  //
  // When FUND (v1.27, contractor-side trailing-12mo obligated $ ramp)
  // AND CUSTFUND (v1.28, customer-side trailing-12mo INBOUND $ ramp)
  // both fire on the same item, the touched Org pair is at the center
  // of a fresh bidirectional dollar flow. That's the rare signal that
  // a customer is ramping spending on contractors who are themselves
  // ramping wins — usually a fresh major program launch or surge.
  //
  // Bump: +0.10 magnitude on top of the individual FUND + CUSTFUND
  // bumps. Capped at magnitude 1.0. Stacks with NEXUS / NEXUS-2 if
  // those also fire — funding-flow events tend to trigger multiple
  // confluence axes.
  let fundingFlowBumps = 0;
  if (sigItems.length > 0) {
    for (const item of sigItems) {
      if (!item.relevance) continue;
      const lines = item.relevance.whySurfaced || [];
      let hasFund = false;
      let hasCustFund = false;
      for (const line of lines) {
        if (typeof line !== "string") continue;
        if (line.startsWith("Funding-momentum touch")) hasFund = true;
        else if (line.startsWith("Customer-funding flow")) hasCustFund = true;
        if (hasFund && hasCustFund) break;
      }
      if (!(hasFund && hasCustFund)) continue;
      const bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Funding-flow co-fire — both contractor-side AND customer-side trailing-12mo ramps fire on this item`
      );
      fundingFlowBumps++;
    }
  }

  // 3.14. v1.26 — NEXUS-2 second-tier capstone.
  //
  // The v1.18 NEXUS fires when any 3+ axes converge. NEXUS-2 is stricter:
  // fires only when CONV + DIV + TIGHT specifically all hit on the same
  // item. The 3-way "cross-source AND cross-type AND tight-window"
  // confluence is the single highest-confidence quality signal the matrix
  // can produce — multiple feeds AND multiple kinds of activity AND all
  // clustered in time. Stacks on top of the regular NEXUS bump.
  //
  //   CONV + DIV + TIGHT all fire: +0.10 magnitude (in addition to NEXUS)
  //
  // Caps at magnitude 1.0. Doesn't double-count items that didn't already
  // hit NEXUS — but in practice any item with these three will also hit
  // NEXUS, so the two bumps stack to a meaningful total lift.
  let nexus2Bumps = 0;
  if (sigItems.length > 0) {
    for (const item of sigItems) {
      if (!item.relevance) continue;
      const lines = item.relevance.whySurfaced || [];
      let hasConv = false;
      let hasDiv = false;
      let hasTight = false;
      for (const line of lines) {
        if (typeof line !== "string") continue;
        if (line.startsWith("Cross-source convergence")) hasConv = true;
        else if (line.startsWith("Tight cross-source")) hasTight = true;
        else if (line.startsWith("Signal-type diversity touch")) hasDiv = true;
        if (hasConv && hasDiv && hasTight) break;
      }
      if (!(hasConv && hasDiv && hasTight)) continue;
      const bump = 0.10;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Nexus-2 — cross-source + cross-type + tight-window confluence on a single item`
      );
      nexus2Bumps++;
    }
  }

  // 3.15. v1.33 — APEX triple-capstone.
  //
  // Fires only when SPIKE + NEXUS-2 + FLOW all hit on the same item.
  // SPIKE = Org-level 24h burst (3+ Signals on same Org within any
  // 24h slice). NEXUS-2 = cross-source AND cross-type AND tight-
  // window. FLOW = bidirectional funding ramp (FUND + CUSTFUND).
  // The intersection of all three is the rarest possible
  // convergence the matrix produces — and accordingly the
  // strongest single-item BD signal we can emit.
  //
  // Bump: +0.12 magnitude. Stacks on top of the individual SPIKE +
  // NEXUS-2 + FLOW bumps (plus whatever NEXUS already added). Items
  // that hit APEX will typically land near the capped magnitude
  // ceiling of 1.0.
  //
  // Implementation: pure post-process check over the existing
  // whySurfaced records. No additional state.
  let apexBumps = 0;
  if (sigItems.length > 0) {
    for (const item of sigItems) {
      if (!item.relevance) continue;
      const lines = item.relevance.whySurfaced || [];
      let hasSpike = false;
      let hasNexus2 = false;
      let hasFlow = false;
      for (const line of lines) {
        if (typeof line !== "string") continue;
        if (line.startsWith("Same-day Org spike")) hasSpike = true;
        else if (line.startsWith("Nexus-2")) hasNexus2 = true;
        else if (line.startsWith("Funding-flow co-fire")) hasFlow = true;
        if (hasSpike && hasNexus2 && hasFlow) break;
      }
      if (!(hasSpike && hasNexus2 && hasFlow)) continue;
      const bump = 0.12;
      item.relevance.magnitude = Math.min(1.0, item.relevance.magnitude + bump);
      item.relevance.total = Math.min(13, item.relevance.total + bump);
      item.relevance.whySurfaced.push(
        `Apex triple-capstone — SPIKE + NEXUS-2 + FLOW all fired on this item; rarest convergence in the matrix`
      );
      apexBumps++;
    }
  }

  const allItems = [...sigItems, ...awardItems, ...oppItems];

  // 4. Dedupe
  const { kept, suppressed } = deduplicate(allItems, signals, ctx);

  // 5. Sort: pinned first (by pinnedAt desc), then by relevance, then by recency
  kept.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (b.pinned && !a.pinned) return 1;
    if (a.pinned && b.pinned) {
      return (b.pinnedAt || 0) - (a.pinnedAt || 0);
    }
    const dr = (b.relevance?.total || 0) - (a.relevance?.total || 0);
    if (Math.abs(dr) > 0.01) return dr;
    return b.occurredAt - a.occurredAt;
  });

  // 6. Bucket by category. Pinned items bypass soft caps but count toward hard.
  const byCategory: BriefOutput["itemsByCategory"] = {
    pursuit: [],
    adversary: [],
    customer: [],
    capability: [],
    context: [],
  };
  let pinnedShown = 0;
  for (const item of kept) {
    const cap = SOFT_CAPS[item.category];
    const hardCap = HARD_CAPS[item.category];
    const bucket = byCategory[item.category];
    if (item.pinned) {
      if (bucket.length < hardCap) {
        bucket.push(item);
        pinnedShown++;
      }
    } else if (bucket.length < cap) {
      bucket.push(item);
    } else if (bucket.length < hardCap) {
      bucket.push(item);
    }
  }

  // Count feedback stats for transparency
  let dismissedCount = 0;
  let snoozedCount = 0;
  let pinnedTotal = 0;
  const reasonTally: Map<string, number> = new Map();
  for (const fb of Object.values(feedback)) {
    if (fb.dismissedAt) dismissedCount++;
    if (fb.snoozedUntil && fb.snoozedUntil > nowMs) snoozedCount++;
    if (fb.pinnedAt) pinnedTotal++;
    if (fb.dismissedAt && fb.dismissReason) {
      const reason = String(fb.dismissReason).toLowerCase().trim().slice(0, 40);
      reasonTally.set(reason, (reasonTally.get(reason) ?? 0) + 1);
    }
  }
  // Top 5 reasons (descending by count)
  const dismissReasonAggregate = Array.from(reasonTally.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const output: BriefOutput = {
    workspaceId,
    generatedAt: nowMs,
    windowHours,
    totalItems:
      byCategory.pursuit.length +
      byCategory.adversary.length +
      byCategory.customer.length +
      byCategory.capability.length +
      byCategory.context.length,
    itemsByCategory: byCategory,
    counts: {
      signals: signalCount,
      awards: awardCount,
      opportunities: oppCount,
      suppressedByDedup: suppressed,
      dismissedActive: dismissedCount,
      snoozedActive: snoozedCount,
      pinnedActive: pinnedTotal,
      pinnedShown,
      dismissReasonAggregate,
      crossSourceBumps,
      tightClusterBumps,
      leadershipFluxBumps,
      protestAmendmentBumps,
      posturePathBumps,
      postureTrajectoryBumps,
      peMentionBumps,
      revolvingDoorTouchBumps,
      nexusBumps,
      weightyPersonTouchBumps,
      actingAtTouchBumps,
      coMembershipBumps,
      temporalMomentumBumps,
      influenceNetHubBumps,
      typeDiversityBumps,
      nexus2Bumps,
      fundingMomentumBumps,
      customerFundingFlowBumps,
      fundingFlowBumps,
      mergePendingTouchBumps,
      recentAwardTouchBumps,
      sameDayOrgSpikeBumps,
      apexBumps,
      pipelineStageTransitionBumps,
      meetingTouchBumps,
    },
    adversaryRollup,
    customerRollup,
    scoringVersion: "1.36",
    weightsApplied: SCORING_WEIGHTS,
  };

  const dateKey = new Date(nowMs).toISOString().slice(0, 10);
  await db.ref(wsPath(workspaceId, "derivedViews", "dailyBrief", dateKey)).set(output);
  await db.ref(wsPath(workspaceId, "derivedViews", "dailyBrief", "latest")).set(output);

  log?.info("brief_synthesis_completed", {
    workspaceId,
    total: output.totalItems,
    signals: signalCount,
    awards: awardCount,
    opps: oppCount,
    suppressedByDedup: suppressed,
  });

  return output;
}
