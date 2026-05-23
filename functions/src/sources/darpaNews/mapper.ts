// DARPA News — RSS item → Signal mapper
//
// v1.0 scope:
//   - Emit analysis_publication Signal (same type as defense_scoop /
//     think_tank / state_department; downstream consumers handle them
//     identically).
//   - attrs.publisher = "darpa_news" so the operator can distinguish
//     DARPA primary-source from trade-press summaries when both touch
//     the same Org.
//   - itemKind classification (program_announcement / award /
//     demonstration / event / leadership / other) for fast triage.
//   - Body-text contractor + program resolution. Programs are
//     first-class for DARPA — every announcement is about a program.
//
// v1.1 will add program-manager Person extraction (DARPA announcements
// frequently name the PM: "DARPA's Dr. Jane Smith said…"). PM resolution
// requires named-entity recognition or pattern-list matching against
// known DARPA personnel.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { type DarpaNewsRssItem, classifyDarpaItemKind } from "./client";

function signalId(guid: string): string {
  const safe =
    (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) || String(Date.now());
  return "sig_darpa_" + safe;
}

export interface DarpaNewsUpsertPatterns {
  contractors: string[];
  programs: string[];
  maxRelatedPerSignal: number;
  resolveBodyOrgs: boolean;
}

export interface DarpaNewsUpsertResult {
  signalId: string;
  action: "created" | "updated" | "unchanged";
  itemKind: string;
  contractorsResolved: number;
  programsMatched: number;
}

export async function upsertDarpaNewsSignal(
  workspaceId: string,
  item: DarpaNewsRssItem,
  patterns: DarpaNewsUpsertPatterns,
  log?: Logger
): Promise<DarpaNewsUpsertResult> {
  const id = signalId(item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const itemKind = classifyDarpaItemKind(item);
  const title = (item.title || "Untitled DARPA News").slice(0, 500);
  const summary = (item.description || "").slice(0, 1500);

  const relatedIds: string[] = [];
  const seenOrgIds = new Set<string>();
  const matchedPrograms: string[] = [];
  const matchedContractors: string[] = [];
  const haystack = (title + " " + summary).toLowerCase();
  const maxRelated = Math.max(1, patterns.maxRelatedPerSignal || 6);
  if (patterns.resolveBodyOrgs) {
    for (const name of patterns.contractors) {
      if (relatedIds.length >= maxRelated) break;
      if (!name || haystack.indexOf(name.toLowerCase()) < 0) continue;
      matchedContractors.push(name);
      try {
        const r = await resolveRecipientOrg(workspaceId, name, null, {
          autoCreate: true,
          type: "company",
          emitFuzzyCandidates: false,
        });
        if (r.orgId && !seenOrgIds.has(r.orgId)) {
          seenOrgIds.add(r.orgId);
          relatedIds.push(r.orgId);
        }
      } catch (err) {
        // best-effort
      }
    }
  }
  for (const program of patterns.programs) {
    if (!program) continue;
    if (haystack.indexOf(program.toLowerCase()) >= 0) {
      matchedPrograms.push(program);
    }
  }

  const attrs: Record<string, unknown> = {
    publisher: "darpa_news",
    publisherDisplayName: "DARPA",
    itemKind,
    title,
    summary,
    url: item.link,
    categories: item.categories,
    matchedContractors,
    matchedPrograms,
  };

  const hash = hashFields(
    {
      title,
      occurredAt,
      itemKind,
      link: item.link || "",
      contractorsCount: relatedIds.length,
      programsCount: matchedPrograms.length,
    } as Record<string, unknown>,
    ["title", "occurredAt", "itemKind", "link", "contractorsCount", "programsCount"]
  );

  const provenance = externalProvenance(
    "darpa_news",
    item.guid || item.link,
    item.link || "https://www.darpa.mil/news-events/",
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "analysis_publication",
    subjectIds: [],
    relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
    occurredAt,
    attrs,
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("darpa_news_signal_created", {
      id,
      itemKind,
      title: title.slice(0, 80),
      contractorsResolved: relatedIds.length,
      programsMatched: matchedPrograms.length,
    });
    return {
      signalId: id,
      action: "created",
      itemKind,
      contractorsResolved: relatedIds.length,
      programsMatched: matchedPrograms.length,
    };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return {
      signalId: id,
      action: "unchanged",
      itemKind,
      contractorsResolved: relatedIds.length,
      programsMatched: matchedPrograms.length,
    };
  }
  await db.ref(path).set(signal);
  return {
    signalId: id,
    action: "updated",
    itemKind,
    contractorsResolved: relatedIds.length,
    programsMatched: matchedPrograms.length,
  };
}

export function matchesKeywords(item: DarpaNewsRssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
