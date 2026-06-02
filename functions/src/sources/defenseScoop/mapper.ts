// Defense BD news — RSS item → Signal mapper
//
// Each news item becomes an analysis_publication Signal (same type
// as think_tank + state_department; downstream consumers treat them
// identically). attrs.publicationKey carries source-of-record.
//
// Body-text resolution mirrors state_department v1.2/v1.3: scan
// title + description for contractor names + program names, resolve
// via orgResolver, accumulate in relatedIds. No DoS-style anchor
// subjectId — news items aren't anchored to a single agency. The
// resolved contractors / programs become the touched-entity surface.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath, stripUndefinedDeep } from "../../framework/rtdb";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { DsRssItem } from "./client";
import type { DefenseScoopPublication } from "./registry";

function signalId(pubKey: string, guid: string): string {
  const safe =
    (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) ||
    String(Date.now());
  return "sig_ds_" + pubKey + "_" + safe;
}

/** Mapper accepts resolved pattern lists from caller (index.ts pulls
 *  them from config). */
export interface DsUpsertPatterns {
  defenseContractors: string[];
  programs: string[];
  maxRelatedPerSignal: number;
}

export async function upsertDsPublicationSignal(
  workspaceId: string,
  publication: DefenseScoopPublication,
  item: DsRssItem,
  patterns: DsUpsertPatterns,
  log?: Logger
): Promise<{
  signalId: string;
  action: "created" | "updated" | "unchanged";
  bodyOrgsResolved: number;
  programMatchesFound: number;
}> {
  const id = signalId(publication.key, item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const title = (item.title || "Untitled").slice(0, 500);
  const summary = (item.description || "").slice(0, 1000);
  // P13.271 — persist a wider window (20KB) of the raw body so the
  // monthly relatedIds backfill can re-match against deep contractor
  // mentions. P13.269 widened the SYNC haystack to full body but stored
  // only the 1000-char summary; legacy signals therefore couldn't
  // re-resolve. bodyText is undefined when the upstream feed only
  // carries a short description (Atom summary, etc.) — no wasted bytes.
  const fullBody = item.description || "";
  const bodyText =
    fullBody.length > summary.length ? fullBody.slice(0, 20000) : undefined;
  const author = item.author || undefined;
  const categories = item.categories || [];

  const hash = hashFields(
    {
      title,
      occurredAt,
      author: author || "",
      link: item.link || "",
      publicationKey: publication.key,
    } as Record<string, unknown>,
    ["title", "occurredAt", "author", "link", "publicationKey"]
  );

  const provenance = externalProvenance(
    "defense_scoop",
    item.guid || item.link,
    item.link || publication.rssUrl,
    hash,
    Date.now()
  );

  // Body-text resolution. Contractors → resolveRecipientOrg.
  // Programs detected via case-insensitive match against the
  // configured pattern list — they don't go through orgResolver
  // (programs aren't Orgs); instead we surface matched program names
  // in attrs.matchedPrograms for downstream filtering / display.
  // P13.269 — match against full item.description (which now prefers
  // <content:encoded> = full article body) rather than the 1000-char
  // `summary`. Storage stays truncated; matching window opens up to
  // catch contractor / program mentions deeper in the article.
  const relatedIds: string[] = [];
  const seenRelated = new Set<string>();
  const matchedPrograms: string[] = [];
  const haystack = (title + " " + (item.description || "")).toLowerCase();
  const maxRelated = Math.max(1, patterns.maxRelatedPerSignal || 6);
  let bodyOrgsResolved = 0;
  for (const name of patterns.defenseContractors) {
    if (relatedIds.length >= maxRelated) break;
    if (!name || haystack.indexOf(name.toLowerCase()) < 0) continue;
    try {
      const r = await resolveRecipientOrg(workspaceId, name, null, {
        autoCreate: true,
        type: "company",
        emitFuzzyCandidates: false,
      });
      if (r.orgId && !seenRelated.has(r.orgId)) {
        seenRelated.add(r.orgId);
        relatedIds.push(r.orgId);
        bodyOrgsResolved++;
      }
    } catch (err) {
      // best-effort
    }
  }
  for (const program of patterns.programs) {
    if (!program) continue;
    if (haystack.indexOf(program.toLowerCase()) >= 0) {
      matchedPrograms.push(program);
    }
  }

  const signal: Signal = {
    id,
    type: "analysis_publication",
    subjectIds: [],
    relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
    occurredAt,
    attrs: {
      publicationKey: publication.key,
      publicationName: publication.name,
      publicationCategory: publication.category,
      title,
      summary,
      bodyText,
      author,
      categories,
      topicTags: publication.topicTags,
      matchedPrograms,
      url: item.link,
    },
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(stripUndefinedDeep(signal));
    log?.debug("defense_scoop_signal_created", {
      id,
      publication: publication.key,
      title: title.slice(0, 80),
      bodyOrgsResolved,
      programMatches: matchedPrograms.length,
    });
    return {
      signalId: id,
      action: "created",
      bodyOrgsResolved,
      programMatchesFound: matchedPrograms.length,
    };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    // P13.271 — opportunistic bodyText backfill: pre-P13.271 signals
    // were created with only attrs.summary (1000-char truncated). On
    // a same-hash refresh, populate attrs.bodyText if missing so the
    // monthly backfill can match against the full body. One-time cost
    // per legacy signal; quick no-op once written.
    const existingAttrs = (existing.attrs as Record<string, unknown>) || {};
    if (!existingAttrs.bodyText && bodyText) {
      await db.ref(`${path}/attrs/bodyText`).set(bodyText);
    }
    return {
      signalId: id,
      action: "unchanged",
      bodyOrgsResolved,
      programMatchesFound: matchedPrograms.length,
    };
  }
  await db.ref(path).set(stripUndefinedDeep(signal));
  return {
    signalId: id,
    action: "updated",
    bodyOrgsResolved,
    programMatchesFound: matchedPrograms.length,
  };
}

export function matchesKeywords(item: DsRssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack =
    ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
