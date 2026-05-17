// USAspending v1.1 — Server-side Recompete Watch derived view
//
// Per award-integration-v1 Part Seven: the marquee operator deliverable.
// Awards in lifecycleState 'expiring' (popEnd within 18 months) ordered by
// urgency, with the urgency tier classification computed once on the server
// rather than re-derived on every client render.
//
// Writes to: workspaces/{wsId}/derivedViews/recompeteWatch/latest
// Client reads this path directly — much cheaper than scanning all awards.
//
// Tier thresholds (urgency days-to-popEnd):
//   imminent  ≤ 90 days
//   near      ≤ 180 days
//   mid       ≤ 365 days
//   far       ≤ 540 days (18 months)
//
// Each entry is a small Award projection (NOT the full Award) — the client
// fetches the full Award lazily when the operator clicks through.

import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Award } from "../../framework/types/awards";

export type RecompeteUrgencyTier = "imminent" | "near" | "mid" | "far";

export interface RecompeteEntry {
  awardId: string;
  piid: string;
  primeOrgId: string;
  customerOrgId: string;
  customerToptierOrgId: string;
  obligated: number;
  baseAndAllOptionsValue: number;
  naics: string;
  psc: string;
  popEnd: number;
  daysUntilPopEnd: number;
  urgencyTier: RecompeteUrgencyTier;
  lifecycleState: Award["lifecycleState"];
  description: string;
  dismissed: boolean;
  modsCount: number;
  subawardsCount: number;
  lastModifiedAt: number;
}

export interface RecompeteWatchView {
  workspaceId: string;
  generatedAt: number;
  horizonDays: number;
  totals: {
    all: number;
    imminent: number;
    near: number;
    mid: number;
    far: number;
    totalObligated: number;
  };
  byTier: {
    imminent: RecompeteEntry[];
    near: RecompeteEntry[];
    mid: RecompeteEntry[];
    far: RecompeteEntry[];
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function classifyUrgency(daysUntilPopEnd: number): RecompeteUrgencyTier {
  if (daysUntilPopEnd <= 90) return "imminent";
  if (daysUntilPopEnd <= 180) return "near";
  if (daysUntilPopEnd <= 365) return "mid";
  return "far";
}

function awardToEntry(award: Award, nowMs: number): RecompeteEntry {
  const daysUntilPopEnd = Math.round(((award.popEnd ?? 0) - nowMs) / DAY_MS);
  return {
    awardId: award.id,
    piid: award.piid,
    primeOrgId: award.primeOrgId,
    customerOrgId: award.customerOrgId,
    customerToptierOrgId: award.customerToptierOrgId,
    obligated: award.obligated ?? 0,
    baseAndAllOptionsValue: award.baseAndAllOptionsValue ?? award.obligated ?? 0,
    naics: award.naics ?? "",
    psc: award.psc ?? "",
    popEnd: award.popEnd ?? 0,
    daysUntilPopEnd,
    urgencyTier: classifyUrgency(daysUntilPopEnd),
    lifecycleState: award.lifecycleState,
    description: (award.description ?? "").slice(0, 300),
    dismissed: Boolean(award.recompeteWatchDismissed),
    modsCount: (award.modifications ?? []).length,
    subawardsCount: (award.subawards ?? []).length,
    lastModifiedAt: award.lastModifiedAt ?? 0,
  };
}

/**
 * Build the Recompete Watch derived view for one workspace.
 *
 * Scans all awards; includes those with lifecycleState in {active, expiring}
 * and popEnd within `horizonDays` (default 540 = 18mo). Excludes
 * recompeteWatchDismissed.
 *
 * Writes to derivedViews/recompeteWatch/latest and a date-keyed snapshot.
 */
export async function buildRecompeteWatchView(
  workspaceId: string,
  options: { horizonDays?: number } = {},
  log?: Logger
): Promise<RecompeteWatchView> {
  const horizonDays = options.horizonDays ?? 540;
  const now = Date.now();
  const cutoffPopEnd = now + horizonDays * DAY_MS;

  log?.info("recompete_watch_build_started", { workspaceId, horizonDays });

  const snap = await db.ref(wsPath(workspaceId, "awards")).once("value");
  const awards = (snap.val() as Record<string, Award> | null) ?? {};

  const entries: RecompeteEntry[] = [];
  let totalObligated = 0;
  for (const award of Object.values(awards)) {
    if (!award || award.recompeteWatchDismissed) continue;
    const state = award.lifecycleState;
    if (state !== "active" && state !== "expiring") continue;
    if (!award.popEnd || award.popEnd < now) continue;
    if (award.popEnd > cutoffPopEnd) continue;
    const entry = awardToEntry(award, now);
    entries.push(entry);
    totalObligated += entry.obligated;
  }

  // Sort: most urgent (smallest popEnd) first
  entries.sort((a, b) => a.popEnd - b.popEnd);

  const byTier: RecompeteWatchView["byTier"] = {
    imminent: [],
    near: [],
    mid: [],
    far: [],
  };
  for (const e of entries) byTier[e.urgencyTier].push(e);

  const view: RecompeteWatchView = {
    workspaceId,
    generatedAt: now,
    horizonDays,
    totals: {
      all: entries.length,
      imminent: byTier.imminent.length,
      near: byTier.near.length,
      mid: byTier.mid.length,
      far: byTier.far.length,
      totalObligated,
    },
    byTier,
  };

  const dateKey = new Date(now).toISOString().slice(0, 10);
  const updates: Record<string, unknown> = {
    [`${wsPath(workspaceId, "derivedViews", "recompeteWatch", "latest")}`]: view,
    [`${wsPath(workspaceId, "derivedViews", "recompeteWatch", "history", dateKey)}`]: {
      generatedAt: now,
      totals: view.totals,
    },
  };
  await db.ref().update(updates);

  log?.info("recompete_watch_build_completed", {
    workspaceId,
    total: entries.length,
    imminent: byTier.imminent.length,
    totalObligated,
  });

  return view;
}
