// DoD OIG — RSS item → Signal mapper
//
// v1.0 scope:
//   - Emit oversight_finding Signal (same type as gao_reports; downstream
//     consumers like Brief Synthesis treat them identically).
//   - attrs.publisher = "dod_oig" so the operator can distinguish DoD IG
//     from GAO when both have audit findings on the same Org.
//   - Body-text contractor + program resolution from title + description.
//   - reportId extraction (DODIG-YYYY-NNN) + reportKind classification.
//
// v1.1 will add PDF fetch + deep parsing (findings, recommendations,
// management response), mirroring gao_reports v1.1.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import {
  type DodOigRssItem,
  extractDodOigReportId,
  classifyReportKind,
} from "./client";

function signalId(guid: string): string {
  const safe =
    (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) || String(Date.now());
  return "sig_dod_oig_" + safe;
}

export interface DodOigUpsertPatterns {
  contractors: string[];
  programs: string[];
  maxRelatedPerSignal: number;
  resolveBodyOrgs: boolean;
}

export interface DodOigUpsertResult {
  signalId: string;
  action: "created" | "updated" | "unchanged";
  reportId: string | null;
  reportKind: string;
  contractorsResolved: number;
  programsMatched: number;
}

export async function upsertDodOigSignal(
  workspaceId: string,
  item: DodOigRssItem,
  patterns: DodOigUpsertPatterns,
  log?: Logger
): Promise<DodOigUpsertResult> {
  const id = signalId(item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const reportId = extractDodOigReportId(item);
  const reportKind = classifyReportKind(item);
  const title = (item.title || "Untitled DoD IG Report").slice(0, 500);
  const summary = (item.description || "").slice(0, 1500);

  // ─── Body-text resolution ──────────────────────────────────────────────
  const subjectIds: string[] = [];
  const relatedIds: string[] = [];
  const seenOrgIds = new Set<string>();
  const matchedPrograms: string[] = [];
  const matchedContractors: string[] = [];
  const haystack = (title + " " + summary).toLowerCase();
  const maxRelated = Math.max(1, patterns.maxRelatedPerSignal || 6);
  if (patterns.resolveBodyOrgs) {
    for (const name of patterns.contractors) {
      if (subjectIds.length >= maxRelated) break;
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
          subjectIds.push(r.orgId);
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
    publisher: "dod_oig",
    reportId,
    reportKind,
    title,
    summary,
    url: item.link,
    categories: item.categories,
    matchedContractors,
    matchedPrograms,
    deepParsingPending: true,
  };

  const hash = hashFields(
    {
      title,
      occurredAt,
      reportId: reportId || "",
      reportKind,
      link: item.link || "",
      contractorsCount: subjectIds.length,
      programsCount: matchedPrograms.length,
    } as Record<string, unknown>,
    [
      "title",
      "occurredAt",
      "reportId",
      "reportKind",
      "link",
      "contractorsCount",
      "programsCount",
    ]
  );

  const provenance = externalProvenance(
    "dod_oig",
    reportId || item.guid || item.link,
    item.link || "https://www.dodig.mil/Reports/",
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "oversight_finding",
    subjectIds,
    relatedIds,
    occurredAt,
    attrs,
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("dod_oig_signal_created", {
      id,
      reportId,
      reportKind,
      title: title.slice(0, 80),
      contractorsResolved: subjectIds.length,
      programsMatched: matchedPrograms.length,
    });
    return {
      signalId: id,
      action: "created",
      reportId,
      reportKind,
      contractorsResolved: subjectIds.length,
      programsMatched: matchedPrograms.length,
    };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return {
      signalId: id,
      action: "unchanged",
      reportId,
      reportKind,
      contractorsResolved: subjectIds.length,
      programsMatched: matchedPrograms.length,
    };
  }
  await db.ref(path).set(signal);
  return {
    signalId: id,
    action: "updated",
    reportId,
    reportKind,
    contractorsResolved: subjectIds.length,
    programsMatched: matchedPrograms.length,
  };
}

export function matchesKeywords(item: DodOigRssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
