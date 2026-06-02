// Service-branch news — RSS item → Signal mapper
//
// Per tier2-previews-v1 T2-5:
//   Article → Signal type='service_news'
//   Leadership announcements flagged via attrs.isLeadershipAnnouncement
//
// v1: just flags; v2 would create position_held Edge transitions per
// extracted role/officer detail.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath, stripUndefinedDeep } from "../../framework/rtdb";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { ServiceNewsSource } from "./registry";
import { isLeadershipAnnouncement } from "./registry";
import type { RssItem } from "./client";

function signalId(serviceKey: string, guid: string): string {
  const safe = (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) || String(Date.now());
  return "sig_sn_" + serviceKey + "_" + safe;
}

// P13.266 — subjectIds resolver wiring. Service-branch news pieces
// frequently name defense contractors; resolving them into relatedIds
// (a) categorizes touching signals into adversary/customer in the
// Brief and (b) feeds Brief v1.13 leadership-flux bumps, which depend
// on service_news touched-Org indexing.
export interface ServiceNewsUpsertPatterns {
  defenseContractors: string[];
  maxRelatedPerSignal: number;
}

export async function upsertServiceNewsSignal(
  workspaceId: string,
  service: ServiceNewsSource,
  item: RssItem,
  patterns: ServiceNewsUpsertPatterns,
  log?: Logger
): Promise<{
  signalId: string;
  action: "created" | "updated" | "unchanged";
  leadership: boolean;
  bodyOrgsResolved: number;
}> {
  const id = signalId(service.key, item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const title = (item.title || "Untitled").slice(0, 500);
  const summary = (item.description || "").slice(0, 1000);
  const leadership = isLeadershipAnnouncement(title + " " + summary);

  const hash = hashFields(
    {
      title,
      occurredAt,
      link: item.link || "",
    } as Record<string, unknown>,
    ["title", "occurredAt", "link"]
  );

  const provenance = externalProvenance(
    "service_news",
    item.guid || item.link,
    item.link || service.websiteUrl,
    hash,
    Date.now()
  );

  // P13.266 — body-text contractor resolution (same shape as
  // defenseScoop + thinkTanks). Best-effort per pattern.
  //
  // P13.269 — match against full item.description (content:encoded or
  // description) rather than the 1000-char `summary`. Storage stays
  // truncated; matching window opens up to full body.
  const relatedIds: string[] = [];
  const seenRelated = new Set<string>();
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

  const signal: Signal = {
    id,
    type: "service_news",
    subjectIds: [],
    relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
    occurredAt,
    attrs: {
      serviceKey: service.key,
      serviceName: service.name,
      service: service.service,
      title,
      summary,
      url: item.link,
      author: item.author,
      isLeadershipAnnouncement: leadership,
      categories: item.categories,
    },
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(stripUndefinedDeep(signal));
    log?.debug("service_news_signal_created", {
      id,
      service: service.key,
      leadership,
      bodyOrgsResolved,
    });
    return { signalId: id, action: "created", leadership, bodyOrgsResolved };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { signalId: id, action: "unchanged", leadership, bodyOrgsResolved };
  }
  await db.ref(path).set(stripUndefinedDeep(signal));
  return { signalId: id, action: "updated", leadership, bodyOrgsResolved };
}

export function matchesKeywords(item: RssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
