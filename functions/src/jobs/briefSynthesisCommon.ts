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
  };
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
  const [oppSnap, awardSnap, usaCfgSnap, samCfgSnap] = await Promise.all([
    db.ref(wsPath(workspaceId, "opportunities")).once("value"),
    db.ref(wsPath(workspaceId, "awards")).once("value"),
    db.ref(wsPath(workspaceId, "sources", "usaspending", "config")).once("value"),
    db.ref(wsPath(workspaceId, "sources", "sam_gov", "config")).once("value"),
  ]);
  const opps = (oppSnap.val() as Record<string, Opportunity> | null) ?? {};
  const awards = (awardSnap.val() as Record<string, Award> | null) ?? {};
  const usaCfg = (usaCfgSnap.val() as { naics?: string[]; agencies?: string[] } | null) ?? {};
  const samCfg = (samCfgSnap.val() as { naics?: string[]; agencies?: string[] } | null) ?? {};

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
  };
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
  const sourceName = sourceMap[signal.source.system] ?? signal.source.system;
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
    title = signal.type.replace(/_/g, " ");
    subtitle = String((attrs.summary as string) || (attrs.title as string) || "");
  }
  return {
    id: signal.id,
    kind: "signal",
    category,
    occurredAt: signal.occurredAt,
    title,
    subtitle,
    source: sourceName,
    link,
    entityId: signal.id,
  };
}

function awardToItem(award: Award, category: BriefItem["category"]): BriefItem {
  return {
    id: award.id,
    kind: "award",
    category,
    occurredAt: award.awardedAt || award.lastModifiedAt,
    title: award.primeUei || award.piid,
    subtitle: `$${award.obligated?.toLocaleString() || "?"} · NAICS ${award.naics}` +
      (award.lifecycleState === "expiring" ? " · expiring" : ""),
    source: "USAspending",
    link: award.source?.url ?? null,
    entityId: award.id,
  };
}

function opportunityToItem(opp: Opportunity, category: BriefItem["category"]): BriefItem {
  return {
    id: opp.id,
    kind: "opportunity",
    category,
    occurredAt: opp.samgovPostedDate || (typeof opp.stageEnteredAt === "number" ? opp.stageEnteredAt : Date.now()),
    title: opp.name,
    subtitle: (opp.agency || "") + (opp.samgovBaseType ? " · " + opp.samgovBaseType : ""),
    source: "SAM.gov",
    link: opp.samgovUiLink ?? null,
    entityId: opp.id,
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
    },
    scoringVersion: "1.14",
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
