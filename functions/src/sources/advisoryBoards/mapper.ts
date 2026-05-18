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
import { fetchAndExtractPdf } from "../../framework/pdfExtractor";
import { findPdfUrlOnReportPage } from "./client";
import { parseAdvisoryReportText, type ParsedAdvisoryReport } from "./reportParser";
import type { AdvisoryBoardIndexItem } from "./client";
import { BOARD_REGISTRY } from "./config";

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
  try {
    const { orgId: boardOrgId } = await resolveRecipientOrg(
      workspaceId,
      boardSpec.fullName,
      null,
      { autoCreate: true, type: "government" }
    );
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
