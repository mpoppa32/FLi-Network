// State Department — RSS item → Signal mapper
//
// Each State publication becomes a Signal with type 'analysis_publication'
// (same shape as think_tank publications; downstream consumers don't
// distinguish, but attrs.feedKey + attrs.feedCategory carry the
// state-specific provenance for filtering).
//
// Subject: every Signal is anchored to the Department of State Org via
// resolveAgencyOrg so the Brief Synthesis Customer side picks it up
// when State is on the operator's watchlist. Additional Org / Person
// resolution from the title + description is intentionally deferred to
// v1.1 — v1.0 keeps the mapper conservative.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import { resolveAgencyOrg } from "../usaSpending/orgResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { StateRssItem } from "./client";
import type { StateDepartmentFeed } from "./registry";

function signalId(feedKey: string, guid: string): string {
  const safe =
    (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) ||
    String(Date.now());
  return "sig_st_" + feedKey + "_" + safe;
}

/**
 * Map one RSS item to a Signal. Idempotent — same item produces same
 * hash; subsequent runs bump refreshedAt but don't rewrite.
 */
export async function upsertStatePublicationSignal(
  workspaceId: string,
  feed: StateDepartmentFeed,
  item: StateRssItem,
  log?: Logger
): Promise<{
  signalId: string;
  action: "created" | "updated" | "unchanged";
  agencyOrgResolved: boolean;
}> {
  const id = signalId(feed.key, item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const title = (item.title || "Untitled").slice(0, 500);
  const summary = (item.description || "").slice(0, 1000);
  const author = item.author || undefined;
  const categories = item.categories || [];

  // Resolve Department of State as the anchor Org. Same name every run
  // → resolves to a stable Org id after first sync.
  let stateOrgId: string | null = null;
  let agencyOrgResolved = false;
  try {
    const r = await resolveAgencyOrg(workspaceId, "Department of State");
    stateOrgId = r.orgId;
    agencyOrgResolved = true;
  } catch (err) {
    log?.warn?.("state_department_agency_resolve_failed", {
      message: (err as Error).message,
    });
  }

  const hash = hashFields(
    {
      title,
      occurredAt,
      author: author || "",
      link: item.link || "",
      feedKey: feed.key,
    } as Record<string, unknown>,
    ["title", "occurredAt", "author", "link", "feedKey"]
  );

  const provenance = externalProvenance(
    "state_department",
    item.guid || item.link,
    item.link || feed.rssUrl,
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "analysis_publication",
    subjectIds: stateOrgId ? [stateOrgId] : [],
    occurredAt,
    attrs: {
      feedKey: feed.key,
      feedName: feed.name,
      feedCategory: feed.category,
      title,
      summary,
      author,
      categories,
      topicTags: feed.topicTags,
      url: item.link,
    },
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("state_department_signal_created", {
      id,
      feed: feed.key,
      title: title.slice(0, 80),
    });
    return { signalId: id, action: "created", agencyOrgResolved };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { signalId: id, action: "unchanged", agencyOrgResolved };
  }
  await db.ref(path).set(signal);
  return { signalId: id, action: "updated", agencyOrgResolved };
}

/** Case-insensitive substring match against title + description. Empty
 *  keyword list = no filter (every item passes). */
export function matchesKeywords(item: StateRssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack =
    ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}

/** Sanctions feed gate: when feed.category === 'sanctions', only items
 *  with sanctions / designation language pass. Avoids the press_releases
 *  alias feed (which shares the same RSS URL) emitting non-sanctions
 *  items twice. */
export function matchesSanctionsGate(
  feed: StateDepartmentFeed,
  item: StateRssItem
): boolean {
  if (feed.category !== "sanctions") return true;
  const haystack =
    ((item.title || "") + " " + (item.description || "")).toLowerCase();
  const triggers = [
    "sanction",
    "designat",
    "ofac",
    "sdgt",
    "fto",
    "export control",
    "entity list",
    "denied party",
  ];
  for (const t of triggers) {
    if (haystack.indexOf(t) >= 0) return true;
  }
  return false;
}
