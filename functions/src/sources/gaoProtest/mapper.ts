// GAO Bid Protest source — RSS item → Signal mapper
//
// Per signal-sources-v1 Part One: Signal entity with type 'protest'.
// Subjects = protestor + awardee Organizations (when resolvable).
// V1 scope: RSS-derived basic Signals. Decision PDF text extraction is a
// follow-up enhancement.

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import { hashFields } from "../../framework/hashing";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Signal } from "../../framework/types/signals";
import type { GaoRssItem } from "./client";
import { extractDocketNumbers } from "./client";

/** Try to extract the protestor name from a GAO decision title.
 *  Common formats:
 *    "Lockheed Martin Corp., B-420123"
 *    "Matter of Lockheed Martin Corp.; File B-420123"
 *    "B-420123, Lockheed Martin Corporation"
 */
export function extractProtestorName(title: string): string | null {
  // Pattern A: "Matter of {NAME}; File B-..."
  let m = title.match(/Matter\s+of\s+([^;]+?)(?:;|,)/i);
  if (m && m[1]) return m[1].trim();
  // Pattern B: "{NAME}, B-..."
  m = title.match(/^([^,]+?),\s*B-\d/i);
  if (m && m[1]) return m[1].trim();
  // Pattern C: "B-..., {NAME}"
  m = title.match(/B-\d{5,7}(?:\.\d+)?,\s*(.+?)(?:[:;]|$)/i);
  if (m && m[1]) return m[1].trim();
  // Fallback: title minus the docket
  const docketStripped = title.replace(/B-\d{5,7}(?:\.\d+)?/g, "").replace(/^\W+|\W+$/g, "");
  if (docketStripped.length > 3 && docketStripped.length < 120) return docketStripped;
  return null;
}

/**
 * Map a GAO RSS item to a Signal entity.
 * Resolves protestor Organization (best-effort; falls back to name string).
 */
export async function mapRssItemToSignal(
  workspaceId: string,
  item: GaoRssItem
): Promise<Signal | null> {
  const dockets = extractDocketNumbers(item);
  if (dockets.length === 0) return null; // not a bid protest

  const primaryDocket = dockets[0];
  const protestorName = extractProtestorName(item.title);

  const subjectIds: string[] = [];
  if (protestorName) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, protestorName, null, {
        autoCreate: true,
        type: "company",
      });
      subjectIds.push(orgId);
    } catch (e) {
      // resolution failed; keep going with the name string in attrs
    }
  }

  const occurredAt = item.pubDateMs || Date.now();
  const hash = hashFields(
    { docket: primaryDocket, title: item.title, link: item.link },
    ["docket", "title", "link"]
  );

  const signalId =
    "sg_gao_" +
    primaryDocket.replace(/[^A-Za-z0-9_.-]/g, "_") +
    (dockets.length > 1 ? "_multi" : "");

  const signal: Signal = {
    id: signalId,
    type: "protest",
    subjectIds,
    relatedIds: dockets.length > 1 ? dockets.slice(1).map((d) => `gao_docket:${d}`) : [],
    occurredAt,
    attrs: {
      docketNumber: primaryDocket,
      allDocketNumbers: dockets,
      protestorName: protestorName || undefined,
      title: item.title,
      decisionUrl: item.link,
      decisionSummary: item.description.slice(0, 800),
      pubDate: item.pubDate,
      status: "decided", // RSS feed only carries decisions, not filings
    },
    source: externalProvenance(
      "gao_protest",
      item.guid || item.link || primaryDocket,
      item.link,
      hash,
      Date.now()
    ),
  };

  return signal;
}

/**
 * Idempotent upsert of a Signal. Skip write if existing record's hash matches.
 */
export async function upsertSignal(
  workspaceId: string,
  signal: Signal
): Promise<{ action: "created" | "updated" | "unchanged"; signalId: string }> {
  const path = wsPath(workspaceId, "signals", signal.id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    return { action: "created", signalId: signal.id };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash && existing.source.hash === signal.source.hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", signalId: signal.id };
  }
  // Merge: preserve any operator-edited attrs on existing
  const merged: Signal = {
    ...signal,
    attrs: { ...signal.attrs, ...(existing.attrs || {}) },
  };
  await db.ref(path).set(merged);
  return { action: "updated", signalId: signal.id };
}
