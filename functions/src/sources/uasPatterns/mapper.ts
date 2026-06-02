// uas-patterns DDG Tracker — payload → Signal mapper
//
// Two signal types emitted per scrape:
//
//   ddg_status_change   — one per DDG vendor present in the workspace
//                         as an Org node. attrs.score, .winProb,
//                         .scores.{mfg,supply,ndaa,flight,funding,team},
//                         .phase2, .description, .g1well, .g1poor.
//                         subjectIds = [vendor org id].
//
//   ddg_prediction      — one per analyst prediction (forward-looking).
//                         subjectIds empty; relatedIds via mention scan
//                         against vendor map.
//
// Vendor resolution: exact normalize-name match first, then a baked-in
// alias map for the three DDG vendors whose canonical display name
// diverges from their Atlas Org node ("Neros" → "Neros Technologies",
// "Auterion Government Solutions" → "Auterion", "Napatree Technology"
// → "Napatree"). Vendors absent from the workspace (e.g. UDD) are
// dropped — per audit, this plugin only emits against tracked Orgs.
//
// Hash strategy: per-vendor hash over rank + score + winProb +
// status + per-dim scores. Reruns produce 'unchanged' until the
// curator updates the page; the maintainer's monthly cadence keeps
// re-emits sparse.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath, stripUndefinedDeep } from "../../framework/rtdb";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { DdgCompetitor, DdgPrediction } from "./client";

/** DDG vendor display names that don't normalize cleanly to an Atlas
 *  Org node — supply alternateNames so orgResolver finds the existing
 *  customer node instead of auto-creating a parallel one. Verified
 *  against workspace 1777435779676 nodes. */
const VENDOR_ALIASES: Record<string, string[]> = {
  Neros: ["Neros Technologies"],
  "Auterion Government Solutions": ["Auterion"],
  "Napatree Technology": ["Napatree"],
};

function vendorSignalId(competitorName: string): string {
  const safe = competitorName
    .replace(/[^A-Za-z0-9]/g, "_")
    .slice(0, 60)
    .replace(/_+$/, "");
  return "sig_uap_ddg_" + safe;
}

function predictionSignalId(prediction: DdgPrediction): string {
  // Stable id from title + timeframe so the curator can re-order /
  // re-score predictions without orphaning prior ones.
  const safe = (prediction.title || "untitled")
    .replace(/[^A-Za-z0-9]/g, "_")
    .slice(0, 60)
    .replace(/_+$/, "");
  return "sig_uap_pred_" + safe;
}

function competitorHash(c: DdgCompetitor): string {
  const payload = {
    rank: c.rank,
    score: c.score ?? 0,
    winProb: c.winProb ?? 0,
    status: c.status || "",
    mfg: c.scores?.mfg?.v ?? 0,
    supply: c.scores?.supply?.v ?? 0,
    ndaa: c.scores?.ndaa?.v ?? 0,
    flight: c.scores?.flight?.v ?? 0,
    funding: c.scores?.funding?.v ?? 0,
    team: c.scores?.team?.v ?? 0,
    phase2pos: c.phase2pos || "",
    phase2risk: c.phase2risk || "",
  };
  return hashFields(
    payload as unknown as Record<string, unknown>,
    Object.keys(payload)
  );
}

function predictionHash(p: DdgPrediction): string {
  const payload = {
    title: p.title,
    prob: p.prob,
    timeframe: p.timeframe || "",
    impact: p.impact || "",
    summary: (p.summary || "").slice(0, 500),
  };
  return hashFields(
    payload as unknown as Record<string, unknown>,
    Object.keys(payload)
  );
}

export interface UasPatternsUpsertResult {
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  vendorsSkippedNoOrg: number;
  predictionsCreated: number;
  predictionsUpdated: number;
  predictionsUnchanged: number;
}

export async function upsertCompetitorSignals(
  workspaceId: string,
  competitors: DdgCompetitor[],
  pageUrl: string,
  fetchedAt: number,
  confidence: number,
  log?: Logger
): Promise<UasPatternsUpsertResult> {
  const result: UasPatternsUpsertResult = {
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    vendorsSkippedNoOrg: 0,
    predictionsCreated: 0,
    predictionsUpdated: 0,
    predictionsUnchanged: 0,
  };

  for (const c of competitors) {
    if (!c.name) continue;
    const alternateNames = VENDOR_ALIASES[c.name];
    let orgId: string | null = null;
    try {
      const r = await resolveRecipientOrg(workspaceId, c.name, null, {
        autoCreate: false,
        emitFuzzyCandidates: false,
        alternateNames,
      });
      orgId = r.orgId;
    } catch {
      result.vendorsSkippedNoOrg++;
      log?.debug("uas_patterns_vendor_not_in_workspace", { vendor: c.name });
      continue;
    }
    if (!orgId) continue;

    const id = vendorSignalId(c.name);
    const hash = competitorHash(c);
    const provenance = externalProvenance(
      "uas_patterns",
      c.name,
      pageUrl,
      hash,
      fetchedAt
    );

    const signal: Signal = {
      id,
      type: "ddg_status_change",
      subjectIds: [orgId],
      occurredAt: fetchedAt,
      attrs: {
        ddgRank: c.rank,
        ddgScore: c.score,
        ddgStatus: c.status,
        platform: c.platform,
        platformTypes: c.type,
        winProb: c.winProb,
        winRationale: c.winRationale,
        description: c.description,
        g1what: c.g1what,
        g1well: c.g1well,
        g1poor: c.g1poor,
        phase2outlook: c.phase2,
        phase2position: c.phase2pos,
        phase2risk: c.phase2risk,
        scores: c.scores,
        costLow: c.costLow,
        costHigh: c.costHigh,
        costNote: c.costNote,
        location: c.sub,
        title: `${c.name} — DDG rank #${c.rank} (${c.score ?? "—"} pts)`,
        confidence,
        sourceUrl: pageUrl,
      },
      source: provenance,
    };

    const path = wsPath(workspaceId, "signals", id);
    const snap = await db.ref(path).once("value");
    if (!snap.exists()) {
      await db.ref(path).set(stripUndefinedDeep(signal));
      result.signalsCreated++;
      log?.debug("uas_patterns_vendor_signal_created", {
        id,
        vendor: c.name,
        rank: c.rank,
      });
      continue;
    }
    const existing = snap.val() as Signal;
    if (existing.source?.hash === hash) {
      await db.ref(`${path}/source/refreshedAt`).set(fetchedAt);
      result.signalsUnchanged++;
      continue;
    }
    await db.ref(path).set(stripUndefinedDeep(signal));
    result.signalsUpdated++;
    log?.debug("uas_patterns_vendor_signal_updated", {
      id,
      vendor: c.name,
      rank: c.rank,
    });
  }

  return result;
}

export async function upsertPredictionSignals(
  workspaceId: string,
  predictions: DdgPrediction[],
  pageUrl: string,
  fetchedAt: number,
  confidence: number,
  log?: Logger,
  vendorOrgIdsByName?: Map<string, string>
): Promise<{ created: number; updated: number; unchanged: number }> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const p of predictions) {
    if (!p.title) continue;
    const id = predictionSignalId(p);
    const hash = predictionHash(p);
    const haystack = (
      (p.title || "") +
      " " +
      (p.summary || "") +
      " " +
      (p.derivation || "")
    ).toLowerCase();
    const relatedIds: string[] = [];
    if (vendorOrgIdsByName) {
      const seen = new Set<string>();
      for (const [vendorName, orgId] of vendorOrgIdsByName) {
        if (
          haystack.indexOf(vendorName.toLowerCase()) >= 0 &&
          !seen.has(orgId)
        ) {
          seen.add(orgId);
          relatedIds.push(orgId);
          if (relatedIds.length >= 6) break;
        }
      }
    }

    const provenance = externalProvenance(
      "uas_patterns",
      p.title,
      pageUrl,
      hash,
      fetchedAt
    );

    const signal: Signal = {
      id,
      type: "ddg_prediction",
      subjectIds: [],
      relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
      occurredAt: fetchedAt,
      attrs: {
        title: p.title,
        probability: p.prob,
        timeframe: p.timeframe,
        impact: p.impact,
        summary: p.summary,
        derivation: p.derivation,
        confidence,
        sourceUrl: pageUrl,
      },
      source: provenance,
    };

    const path = wsPath(workspaceId, "signals", id);
    const snap = await db.ref(path).once("value");
    if (!snap.exists()) {
      await db.ref(path).set(stripUndefinedDeep(signal));
      created++;
      continue;
    }
    const existing = snap.val() as Signal;
    if (existing.source?.hash === hash) {
      await db.ref(`${path}/source/refreshedAt`).set(fetchedAt);
      unchanged++;
      continue;
    }
    await db.ref(path).set(stripUndefinedDeep(signal));
    updated++;
  }

  return { created, updated, unchanged };
}

/** Helper: build a vendor-name → orgId map by re-running the same
 *  resolver passes used in upsertCompetitorSignals. Used to power
 *  prediction.relatedIds without re-doing the lookup work. */
export async function resolveVendorOrgMap(
  workspaceId: string,
  competitors: DdgCompetitor[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const c of competitors) {
    if (!c.name) continue;
    const alternateNames = VENDOR_ALIASES[c.name];
    try {
      const r = await resolveRecipientOrg(workspaceId, c.name, null, {
        autoCreate: false,
        emitFuzzyCandidates: false,
        alternateNames,
      });
      if (r.orgId) map.set(c.name, r.orgId);
    } catch {
      // unresolved — skip
    }
  }
  return map;
}
