// GAO Reports — RSS item → Signal mapper
//
// Per tier2-previews-v1 T2-14: each report → Signal type='oversight_finding'.
// v1 captures title/summary/URL/reportId/pubDate; PDF deep-parsing
// (extracting specific contractor + program references) deferred to v1.1.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { GaoReportRssItem } from "./client";
import { extractGaoReportId } from "./client";

function signalId(guid: string): string {
  const safe = (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) || String(Date.now());
  return "sig_gao_report_" + safe;
}

export async function upsertGaoReportSignal(
  workspaceId: string,
  item: GaoReportRssItem,
  log?: Logger
): Promise<{ signalId: string; action: "created" | "updated" | "unchanged" }> {
  const id = signalId(item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const reportId = extractGaoReportId(item);
  const title = (item.title || "Untitled GAO Report").slice(0, 500);
  const summary = (item.description || "").slice(0, 1500);

  const hash = hashFields(
    {
      title,
      occurredAt,
      reportId: reportId || "",
      link: item.link || "",
    } as Record<string, unknown>,
    ["title", "occurredAt", "reportId", "link"]
  );

  const provenance = externalProvenance(
    "gao_reports",
    reportId || item.guid || item.link,
    item.link || "https://www.gao.gov/reports-testimonies",
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "oversight_finding",
    subjectIds: [],
    occurredAt,
    attrs: {
      reportId,
      title,
      summary,
      url: item.link,
      categories: item.categories,
      // v1.1 will add: extractedContractors[], extractedPrograms[], findings[]
      deepParsingPending: true,
    },
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("gao_report_signal_created", { id, reportId, title: title.slice(0, 80) });
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

export function matchesKeywords(item: GaoReportRssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
