// Think tank — RSS item → Signal mapper
//
// Per tier2-previews-v1 T2-6: each publication becomes a Signal with type
// 'analysis_publication'. Author resolution into a Person record happens
// when the byline is identifiable; otherwise just attached as attrs.author.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { ThinkTankSource } from "./registry";
import type { RssItem } from "./client";

function signalId(tankKey: string, guid: string): string {
  const safe = (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) || String(Date.now());
  return "sig_tt_" + tankKey + "_" + safe;
}

/**
 * Map one RSS item to a Signal. Idempotent: same item produces same hash;
 * subsequent runs bump refreshedAt but don't rewrite.
 */
export async function upsertPublicationSignal(
  workspaceId: string,
  tank: ThinkTankSource,
  item: RssItem,
  log?: Logger
): Promise<{ signalId: string; action: "created" | "updated" | "unchanged" }> {
  const id = signalId(tank.key, item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const title = (item.title || "Untitled").slice(0, 500);
  const summary = (item.description || "").slice(0, 1000);
  const author = item.author || undefined;
  const categories = item.categories || [];

  const hash = hashFields(
    {
      title,
      occurredAt,
      author: author || "",
      link: item.link || "",
    } as Record<string, unknown>,
    ["title", "occurredAt", "author", "link"]
  );

  const provenance = externalProvenance(
    "think_tank",
    item.guid || item.link,
    item.link || tank.websiteUrl,
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "analysis_publication",
    subjectIds: [],
    occurredAt,
    attrs: {
      tankKey: tank.key,
      tankName: tank.name,
      tankCategory: tank.category,
      title,
      summary,
      author,
      categories,
      topicTags: tank.topicTags,
      url: item.link,
    },
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("think_tank_signal_created", { id, tank: tank.key, title: title.slice(0, 80) });
    return { signalId: id, action: "created" };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { signalId: id, action: "unchanged" };
  }
  await db.ref(path).set(signal);
  return { signalId: id, action: "updated" };
}

/**
 * Apply keyword filter (case-insensitive substring on title + summary).
 * Empty keyword array = no filter.
 */
export function matchesKeywords(item: RssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
