// Phase 8.5.8 Brief Synthesis — shared logic
//
// V1 scope per brief-synthesis-v1.md Part Two:
//   1. Collect signals/awards/opportunities from last 24h
//   2. Categorize into 5 buckets (pursuit / adversary / customer / capability / context)
//   3. Soft caps per category
//   4. Write to workspaces/{wsId}/derivedViews/dailyBrief/{date}
//
// V1 omissions (deferred to v1.1):
//   - Relevance scoring algorithm (Part Two §2-3)
//   - Cross-source deduplication (Part Two §5)
//   - Dismissal feedback loop (Part Four)
//   - Pinning / snoozing

import { db, wsPath } from "../framework/rtdb";
import { Logger } from "../framework/logger";
import type { Signal } from "../framework/types/signals";
import type { Award } from "../framework/types/awards";
import type { Opportunity } from "../framework/types/entities";

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
  };
}

const SOFT_CAPS = {
  pursuit: 10,
  adversary: 5,
  customer: 5,
  capability: 5,
  context: 3,
};

interface WorkspaceContext {
  adversaryOrgIds: Set<string>;
  trackedPursuitOrgIds: Set<string>; // Organizations linked to active pursuits
  tracked: { opportunities: Map<string, Opportunity>; awards: Map<string, Award> };
}

async function loadWorkspaceContext(workspaceId: string): Promise<WorkspaceContext> {
  const [oppSnap, awardSnap] = await Promise.all([
    db.ref(wsPath(workspaceId, "opportunities")).once("value"),
    db.ref(wsPath(workspaceId, "awards")).once("value"),
  ]);
  const opps = (oppSnap.val() as Record<string, Opportunity> | null) ?? {};
  const awards = (awardSnap.val() as Record<string, Award> | null) ?? {};
  const adversaryOrgIds = new Set<string>();
  const trackedPursuitOrgIds = new Set<string>();
  for (const opp of Object.values(opps)) {
    if (opp.posture?.adversaries) {
      for (const a of opp.posture.adversaries) adversaryOrgIds.add(a);
    }
    if (opp.customerOrgId) trackedPursuitOrgIds.add(opp.customerOrgId);
  }
  return {
    adversaryOrgIds,
    trackedPursuitOrgIds,
    tracked: { opportunities: new Map(Object.entries(opps)), awards: new Map(Object.entries(awards)) },
  };
}

function categorizeItem(
  item: { subjectIds?: string[]; relatedIds?: string[]; primeOrgId?: string; customerOrgId?: string },
  ctx: WorkspaceContext
): BriefItem["category"] {
  const allIds = new Set<string>([
    ...(item.subjectIds ?? []),
    ...(item.relatedIds ?? []),
    ...(item.primeOrgId ? [item.primeOrgId] : []),
    ...(item.customerOrgId ? [item.customerOrgId] : []),
  ]);

  // Pursuit: touches any tracked Opportunity or Award entity directly
  for (const id of allIds) {
    if (ctx.tracked.opportunities.has(id) || ctx.tracked.awards.has(id)) {
      return "pursuit";
    }
  }
  // Adversary: org is in any active pursuit's posture.adversaries
  for (const id of allIds) {
    if (ctx.adversaryOrgIds.has(id)) return "adversary";
  }
  // Customer: org is a tracked customer agency
  for (const id of allIds) {
    if (ctx.trackedPursuitOrgIds.has(id)) return "customer";
  }
  // Capability vs context: hard to distinguish in V1; default to capability
  // (broader segment relevance). Context reserved for items the operator
  // has explicitly dismissed or marked low-priority (V1.1).
  return "capability";
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
 * Synthesize a Brief for one workspace covering the past `windowHours`.
 */
export async function synthesizeBrief(
  workspaceId: string,
  windowHours: number = 24,
  log?: Logger
): Promise<BriefOutput> {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  log?.info("brief_synthesis_started", { workspaceId, windowHours });

  const ctx = await loadWorkspaceContext(workspaceId);

  // Collect from signals
  const sigSnap = await db.ref(wsPath(workspaceId, "signals")).once("value");
  const signals = (sigSnap.val() as Record<string, Signal> | null) ?? {};
  const sigItems: BriefItem[] = [];
  let signalCount = 0;
  for (const sig of Object.values(signals)) {
    if (!sig || !sig.occurredAt || sig.occurredAt < cutoff) continue;
    signalCount++;
    const category = categorizeItem(sig, ctx);
    sigItems.push(signalToItem(sig, category));
  }

  // Collect from awards (created or modified recently)
  const awardItems: BriefItem[] = [];
  let awardCount = 0;
  for (const award of ctx.tracked.awards.values()) {
    const recentTimestamp = award.lastModifiedAt || award.awardedAt;
    if (!recentTimestamp || recentTimestamp < cutoff) continue;
    awardCount++;
    const category = categorizeItem(award, ctx);
    awardItems.push(awardToItem(award, category));
  }

  // Collect from opportunities (posted recently)
  const oppItems: BriefItem[] = [];
  let oppCount = 0;
  for (const opp of ctx.tracked.opportunities.values()) {
    const ts = opp.samgovPostedDate || (typeof opp.stageEnteredAt === "number" ? opp.stageEnteredAt : 0);
    if (!ts || ts < cutoff) continue;
    oppCount++;
    const category = categorizeItem(
      { customerOrgId: opp.customerOrgId, subjectIds: opp.customerOrgId ? [opp.customerOrgId] : [] },
      ctx
    );
    oppItems.push(opportunityToItem(opp, category));
  }

  // Combine, sort by occurredAt desc, bucket by category, cap by soft cap
  const all = [...sigItems, ...awardItems, ...oppItems].sort((a, b) => b.occurredAt - a.occurredAt);
  const byCategory: BriefOutput["itemsByCategory"] = {
    pursuit: [],
    adversary: [],
    customer: [],
    capability: [],
    context: [],
  };
  for (const item of all) {
    const cap = SOFT_CAPS[item.category];
    if (byCategory[item.category].length < cap) {
      byCategory[item.category].push(item);
    }
  }

  const output: BriefOutput = {
    workspaceId,
    generatedAt: Date.now(),
    windowHours,
    totalItems:
      byCategory.pursuit.length +
      byCategory.adversary.length +
      byCategory.customer.length +
      byCategory.capability.length +
      byCategory.context.length,
    itemsByCategory: byCategory,
    counts: { signals: signalCount, awards: awardCount, opportunities: oppCount },
  };

  // Write to derived views path
  const dateKey = new Date().toISOString().slice(0, 10);
  await db.ref(wsPath(workspaceId, "derivedViews", "dailyBrief", dateKey)).set(output);
  // Also keep a "latest" pointer for easy client access
  await db.ref(wsPath(workspaceId, "derivedViews", "dailyBrief", "latest")).set(output);

  log?.info("brief_synthesis_completed", {
    workspaceId,
    total: output.totalItems,
    signals: signalCount,
    awards: awardCount,
    opps: oppCount,
  });

  return output;
}
