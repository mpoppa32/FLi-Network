// Advisory Boards — index item → Signal mapper
//
// v1.0: HTML index walk surfaces title + URL + best-effort date; PDF deep
// parse lifts findings, recommendations, programs, contractors, and agency
// mentions into the Signal attrs. Resolves contractor mentions as company
// Orgs (subjectIds[]) and primary agency mentions as government Orgs
// (relatedIds[]). The board itself is resolved as a government Org and
// pushed onto relatedIds[] so the cross-source touches popover surfaces
// every advisory body report a given agency or contractor appears in.
//
// Signal type: "advisory_body_report" (declared in framework/types/signals.ts).
// Provenance: source key "advisory_boards"; ref id derived from board + URL.

import { createHash } from "crypto";

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import { resolvePersonByName } from "../../framework/personResolver";
import { fetchAndExtractPdf } from "../../framework/pdfExtractor";
import { findPdfUrlOnReportPage } from "./client";
import {
  parseAdvisoryReportText,
  type ParsedAdvisoryReport,
  type ParsedAdvisoryBoardMember,
} from "./reportParser";
import type { AdvisoryBoardIndexItem } from "./client";
import { BOARD_REGISTRY } from "./config";

interface AdvisoryEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  dir: "to" | "from" | "both";
  attrs?: Record<string, unknown>;
}

function signalId(guid: string): string {
  const hash = createHash("sha1").update(guid).digest("hex").slice(0, 24);
  return "sig_advisory_" + hash;
}

export interface AdvisoryReportUpsertOptions {
  extractPdf?: boolean;
  maxPdfBytes?: number;
  maxReportTextChars?: number;
  pdfExtractionTimeoutMs?: number;
}

export interface AdvisoryReportUpsertMetrics {
  pdfAttempted: boolean;
  pdfSucceeded: boolean;
  pdfBytes: number;
  pdfPages: number;
  pdfTextLength: number;
  findingsExtracted: number;
  recommendationsExtracted: number;
  programsMatched: number;
  contractorsMatched: number;
  agencyMentionsExtracted: number;
  /** v1.1: member roster parse + Person resolution. */
  membersDetected: number;
  membersPersonsCreated: number;
  membersPersonsMatched: number;
  memberEdgesUpserted: number;
  reportKind: string | null;
  parseFlags: string[];
  durationMs: number;
  errorMessage?: string;
}

export interface AdvisoryReportUpsertResult {
  signalId: string;
  action: "created" | "updated" | "unchanged";
  metrics: AdvisoryReportUpsertMetrics;
}

export async function upsertAdvisoryReportSignal(
  workspaceId: string,
  item: AdvisoryBoardIndexItem,
  log?: Logger,
  options: AdvisoryReportUpsertOptions = {}
): Promise<AdvisoryReportUpsertResult> {
  const startedAt = Date.now();
  const metrics: AdvisoryReportUpsertMetrics = {
    pdfAttempted: false,
    pdfSucceeded: false,
    pdfBytes: 0,
    pdfPages: 0,
    pdfTextLength: 0,
    findingsExtracted: 0,
    recommendationsExtracted: 0,
    programsMatched: 0,
    contractorsMatched: 0,
    agencyMentionsExtracted: 0,
    membersDetected: 0,
    membersPersonsCreated: 0,
    membersPersonsMatched: 0,
    memberEdgesUpserted: 0,
    reportKind: null,
    parseFlags: [],
    durationMs: 0,
  };

  const id = signalId(item.guid);
  const boardSpec = BOARD_REGISTRY[item.board];
  const occurredAt = item.pubDateMs || Date.now();
  const title = (item.title || `Untitled ${boardSpec.label} Report`).slice(0, 500);

  // ─── v1.0 baseline attrs ───────────────────────────────────────────────
  const attrs: Record<string, unknown> = {
    board: item.board,
    boardLabel: boardSpec.label,
    boardFullName: boardSpec.fullName,
    title,
    url: item.link,
    deepParsingPending: true,
  };

  const subjectIds: string[] = [];
  const relatedIds: string[] = [];

  // ─── Resolve the board itself as a government Org (relatedIds) ─────────
  // v1.2: pass the board acronym as an alternateName so FACA committee
  // Orgs for the same body (e.g., FACA's "Defense Science Board"
  // committee record) collapse to a single node rather than two parallel
  // Orgs. The orgResolver also matches incoming names against existing
  // node.alternateNames, so this works in either direction.
  let boardOrgId: string | null = null;
  try {
    const r = await resolveRecipientOrg(
      workspaceId,
      boardSpec.fullName,
      null,
      {
        autoCreate: true,
        type: "government",
        alternateNames: [boardSpec.label, boardSpec.label.toUpperCase()],
      }
    );
    boardOrgId = r.orgId;
    if (!relatedIds.includes(boardOrgId)) relatedIds.push(boardOrgId);
    attrs.boardOrgId = boardOrgId;
  } catch (e) {
    log?.debug("advisory_boards_board_org_resolve_failed", {
      board: item.board,
      message: (e as Error).message,
    });
  }

  // ─── v1.0: PDF text extraction ────────────────────────────────────────
  let parsed: ParsedAdvisoryReport | null = null;
  let pdfUrl: string | null = null;
  let extractedText = "";
  if (options.extractPdf && item.link) {
    metrics.pdfAttempted = true;
    try {
      pdfUrl = await findPdfUrlOnReportPage(item.link, log);
      if (pdfUrl) {
        const extraction = await fetchAndExtractPdf(
          pdfUrl,
          {
            source: "advisory_boards",
            maxBytes: options.maxPdfBytes,
            timeoutMs: options.pdfExtractionTimeoutMs,
            maxTextChars: Math.max(options.maxReportTextChars || 100_000, 100_000),
          },
          log
        );
        metrics.pdfBytes = extraction.bytes;
        metrics.pdfPages = extraction.pages;
        metrics.pdfTextLength = extraction.textLength;
        extractedText = extraction.text;
        parsed = parseAdvisoryReportText(extractedText);
        metrics.parseFlags = parsed.flags;
        metrics.findingsExtracted = parsed.findings.length;
        metrics.recommendationsExtracted = parsed.recommendations.length;
        metrics.programsMatched = parsed.programs.length;
        metrics.contractorsMatched = parsed.contractors.length;
        metrics.agencyMentionsExtracted = parsed.agencyMentions.length;
        metrics.reportKind = parsed.reportKind;
        metrics.pdfSucceeded = true;
      } else {
        metrics.errorMessage = "no_pdf_url_found";
      }
    } catch (err) {
      metrics.errorMessage = (err as Error).message;
      log?.warn("advisory_boards_pdf_extraction_failed", {
        board: item.board,
        link: item.link,
        message: (err as Error).message,
      });
    }
  }

  // ─── Augment attrs with parsed fields + resolve Orgs ───────────────────
  if (parsed && metrics.pdfSucceeded) {
    delete attrs.deepParsingPending;
    if (parsed.title && parsed.title.length > title.length) {
      attrs.titleParsed = parsed.title;
    }
    if (parsed.reportKind) attrs.reportKind = parsed.reportKind;
    if (parsed.decidedAt) attrs.decidedAt = parsed.decidedAt;
    if (parsed.boardSelfReference) attrs.boardSelfReference = parsed.boardSelfReference;
    if (parsed.findings.length) attrs.findings = parsed.findings;
    if (parsed.recommendations.length) attrs.recommendations = parsed.recommendations;
    if (parsed.programs.length) attrs.programs = parsed.programs;
    if (parsed.contractors.length) attrs.contractors = parsed.contractors;
    if (parsed.agencyMentions.length) attrs.agencyMentions = parsed.agencyMentions;
    if (parsed.executiveSummary) attrs.executiveSummary = parsed.executiveSummary;

    // Resolve contractor mentions → company Orgs, push to subjectIds[]
    for (const name of parsed.contractors) {
      try {
        const { orgId } = await resolveRecipientOrg(workspaceId, name, null, {
          autoCreate: true,
          type: "company",
        });
        if (!subjectIds.includes(orgId)) subjectIds.push(orgId);
      } catch (e) {
        // continue
      }
    }
    // Resolve primary agency mention → government Org, push to relatedIds[]
    const primaryAgency = parsed.agencyMentions[0];
    if (primaryAgency) {
      try {
        const { orgId } = await resolveRecipientOrg(workspaceId, primaryAgency, null, {
          autoCreate: true,
          type: "government",
        });
        if (!relatedIds.includes(orgId)) relatedIds.push(orgId);
      } catch (e) {
        // continue
      }
    }

    // v1.1: upsert Person + member_of Edge for each detected board member.
    // Members stay attached to the board Org regardless of which specific
    // report surfaced them — boards have stable rosters; a single member
    // appearing on N reports collapses to one Person + one Edge.
    if (boardOrgId && parsed.members.length > 0) {
      metrics.membersDetected = parsed.members.length;
      const memberSummaries: Array<{
        name: string;
        honorific: string | null;
        role: string | null;
        affiliation: string | null;
        personId: string;
      }> = [];
      for (const member of parsed.members) {
        try {
          const r = await upsertAdvisoryBoardMember(
            workspaceId,
            member,
            boardOrgId,
            boardSpec.fullName,
            item.board,
            item.guid,
            log
          );
          if (r.personAction === "created") metrics.membersPersonsCreated++;
          else if (r.personAction === "matched") metrics.membersPersonsMatched++;
          if (r.edgeUpserted) metrics.memberEdgesUpserted++;
          memberSummaries.push({
            name: member.name,
            honorific: member.honorific,
            role: member.role,
            affiliation: member.affiliation,
            personId: r.personId,
          });
        } catch (e) {
          log?.debug("advisory_boards_member_resolve_failed", {
            name: member.name,
            message: (e as Error).message,
          });
        }
      }
      if (memberSummaries.length > 0) {
        attrs.members = memberSummaries;
      }
    }
  } else if (options.extractPdf) {
    attrs.deepParseFailed = true;
    attrs.deepParseError = metrics.errorMessage || "unknown";
  }

  if (pdfUrl) attrs.reportPdfUrl = pdfUrl;
  if (extractedText) {
    const maxText = options.maxReportTextChars ?? 100_000;
    const stored = extractedText.slice(0, maxText);
    attrs.reportText = stored;
    attrs.reportTextLength = extractedText.length;
    attrs.reportTextTruncated = extractedText.length > stored.length;
    attrs.reportTextHash = createHash("sha256").update(extractedText).digest("hex");
  }
  if (metrics.parseFlags && metrics.parseFlags.length) {
    attrs.parseFlags = metrics.parseFlags;
  }

  const hash = hashFields(
    {
      board: item.board,
      title,
      occurredAt,
      link: item.link || "",
      findingsCount: parsed ? parsed.findings.length : 0,
      recommendationsCount: parsed ? parsed.recommendations.length : 0,
      contractorsCount: parsed ? parsed.contractors.length : 0,
      programsCount: parsed ? parsed.programs.length : 0,
      membersCount: parsed ? parsed.members.length : 0,
      reportTextHash: (attrs.reportTextHash as string) || "",
    } as Record<string, unknown>,
    [
      "board",
      "title",
      "occurredAt",
      "link",
      "findingsCount",
      "recommendationsCount",
      "contractorsCount",
      "programsCount",
      "membersCount",
      "reportTextHash",
    ]
  );

  const provenance = externalProvenance(
    "advisory_boards",
    item.guid,
    item.link || boardSpec.indexUrl,
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "advisory_body_report",
    subjectIds,
    relatedIds,
    occurredAt,
    attrs,
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  let action: "created" | "updated" | "unchanged";
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("advisory_boards_signal_created", {
      id,
      board: item.board,
      title: title.slice(0, 80),
    });
    action = "created";
  } else {
    const existing = snap.val() as Signal;
    if (existing.source?.hash === hash) {
      await db.ref(`${path}/source/refreshedAt`).set(Date.now());
      action = "unchanged";
    } else {
      await db.ref(path).set(signal);
      action = "updated";
    }
  }

  metrics.durationMs = Date.now() - startedAt;
  return { signalId: id, action, metrics };
}

// ─── v1.1: board-member Person + Edge upsert ─────────────────────────────

function advisoryMemberPersonId(boardKey: string, name: string): string {
  // No stable external id (PDF-parsed text); dedupe by board + normalized
  // name. Same Person across multiple reports for the same board collapses
  // cleanly. Operator can manually merge if a member transitions between
  // boards (e.g., resigns from DSB and joins DIB) — that's a low-frequency
  // case best handled by operator review.
  const norm = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `pers_advboard_${boardKey}_${norm || String(Date.now())}`;
}

function advisoryMemberEdgeId(personId: string, boardOrgId: string): string {
  return "edge_advboard_member_" + personId.slice(0, 30) + "__" + boardOrgId.slice(0, 24);
}

/**
 * v1.1: upsert a Person record for a detected board member + a member_of
 * Edge from that Person to the board Org. Idempotent across reports: the
 * same member appearing on N reports for the same board collapses to one
 * Person + one Edge (with lastSeenOnReport bumped each time).
 *
 * Honorific stripped from the Person.name (it lives in attrs.honorific
 * on the Person source provenance for traceability). Role stored on the
 * Edge attrs since membership role can change report-to-report.
 *
 * Operator_manual Persons are respected — never overwritten.
 */
async function upsertAdvisoryBoardMember(
  workspaceId: string,
  member: ParsedAdvisoryBoardMember,
  boardOrgId: string,
  boardFullName: string,
  boardKey: string,
  reportGuid: string,
  log?: Logger
): Promise<{
  personId: string;
  personAction: "created" | "matched" | "updated";
  edgeUpserted: boolean;
}> {
  // v1.3: Person upsert via framework/personResolver for cross-source
  // dedupe. A board member who also appears in faca / senate_lda
  // collapses to one Person node carrying member_of, lobbyist_at, and
  // formerly_at Edges across sources.
  const now = Date.now();
  const provenance = externalProvenance(
    "advisory_boards",
    `${boardKey}:member:${member.name}`,
    null,
    null,
    now
  );
  const role = member.honorific
    ? `${member.honorific} — ${boardFullName} member`
    : `${boardFullName} member`;
  // Pass honorific-prefixed variant as an alternateName for stronger
  // cross-source dedupe (faca members are typically stored without
  // honorifics; senate_lda lobbyists likewise).
  const alternateNames = member.honorific
    ? [`${member.honorific} ${member.name}`]
    : undefined;
  const r = await resolvePersonByName(workspaceId, member.name, {
    autoCreate: true,
    preferredId: advisoryMemberPersonId(boardKey, member.name),
    alternateNames,
    role,
    org: member.affiliation || undefined,
    provenance,
  });
  const pId = r.personId;
  const personAction: "created" | "matched" | "updated" = r.created
    ? "created"
    : "matched";
  if (r.created) {
    log?.debug("advisory_boards_member_person_created", {
      personId: pId,
      name: member.name,
      board: boardKey,
    });
  } else {
    log?.debug("advisory_boards_member_person_matched", {
      personId: pId,
      name: member.name,
      board: boardKey,
      matchedVia: r.matchedVia,
    });
  }

  // Upsert member_of Edge
  const eId = advisoryMemberEdgeId(pId, boardOrgId);
  const edgePath = wsPath(workspaceId, "edges", eId);
  const edgeAttrs: Record<string, unknown> = {
    role: member.role || "Member",
    affiliation: member.affiliation || undefined,
    honorific: member.honorific || undefined,
    lastSeenOnReport: reportGuid,
    lastSeenAt: now,
    boardKey,
  };
  const edge: AdvisoryEdge = {
    id: eId,
    source: pId,
    target: boardOrgId,
    label: "member_of",
    dir: "to",
    attrs: edgeAttrs,
  };
  const edgeSnap = await db.ref(edgePath).once("value");
  let edgeUpserted = false;
  if (!edgeSnap.exists()) {
    await db.ref(edgePath).set(edge);
    edgeUpserted = true;
  } else {
    const existing = edgeSnap.val() as AdvisoryEdge;
    const mergedAttrs = { ...(existing.attrs || {}), ...edgeAttrs };
    await db.ref(edgePath).set({ ...existing, attrs: mergedAttrs });
    edgeUpserted = true;
  }

  return { personId: pId, personAction, edgeUpserted };
}
