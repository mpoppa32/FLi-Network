// GAO Reports — RSS item → Signal mapper
//
// v1.0: title/summary/URL/reportId/pubDate from RSS only (deepParsingPending:true).
// v1.1: fetch the report PDF, parse out findings, recommendations, programs,
// contractors, agency response posture. Resolves contractors + agencies to
// Corsair Orgs and pushes them to relatedIds so the cross-source touches
// popover surfaces every GAO report that mentions a given entity.

import { createHash } from "crypto";

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import { fetchAndExtractPdf } from "../../framework/pdfExtractor";
import { findPdfUrlOnDecisionPage } from "../gaoProtest/client";
import { parseGaoReportText, type ParsedGaoReport } from "./reportParser";
import type { GaoReportRssItem } from "./client";
import { extractGaoReportId } from "./client";

function signalId(guid: string): string {
  const safe = (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) || String(Date.now());
  return "sig_gao_report_" + safe;
}

export interface GaoReportUpsertOptions {
  /** v1.1: fetch and parse the report PDF. */
  extractPdf?: boolean;
  maxPdfBytes?: number;
  maxReportTextChars?: number;
  pdfExtractionTimeoutMs?: number;
}

export interface GaoReportUpsertMetrics {
  pdfAttempted: boolean;
  pdfSucceeded: boolean;
  pdfBytes: number;
  pdfPages: number;
  pdfTextLength: number;
  findingsExtracted: number;
  recommendationsExtracted: number;
  programsMatched: number;
  contractorsMatched: number;
  agencyResponse: string | null;
  parseFlags: string[];
  durationMs: number;
  errorMessage?: string;
}

export interface GaoReportUpsertResult {
  signalId: string;
  action: "created" | "updated" | "unchanged";
  metrics: GaoReportUpsertMetrics;
}

export async function upsertGaoReportSignal(
  workspaceId: string,
  item: GaoReportRssItem,
  log?: Logger,
  options: GaoReportUpsertOptions = {}
): Promise<GaoReportUpsertResult> {
  const startedAt = Date.now();
  const metrics: GaoReportUpsertMetrics = {
    pdfAttempted: false,
    pdfSucceeded: false,
    pdfBytes: 0,
    pdfPages: 0,
    pdfTextLength: 0,
    findingsExtracted: 0,
    recommendationsExtracted: 0,
    programsMatched: 0,
    contractorsMatched: 0,
    agencyResponse: null,
    parseFlags: [],
    durationMs: 0,
  };

  const id = signalId(item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const reportId = extractGaoReportId(item);
  const title = (item.title || "Untitled GAO Report").slice(0, 500);
  const summary = (item.description || "").slice(0, 1500);

  // ─── v1.0 baseline attrs ───────────────────────────────────────────────
  const attrs: Record<string, unknown> = {
    reportId,
    title,
    summary,
    url: item.link,
    categories: item.categories,
    deepParsingPending: true,
  };

  const subjectIds: string[] = [];
  const relatedIds: string[] = [];

  // ─── v1.1: PDF text extraction ────────────────────────────────────────
  let parsed: ParsedGaoReport | null = null;
  let pdfUrl: string | null = null;
  let extractedText = "";
  if (options.extractPdf && item.link) {
    metrics.pdfAttempted = true;
    try {
      // For GAO reports, item.link is usually a product page URL; sometimes
      // the RSS already points directly at a PDF. findPdfUrlOnDecisionPage
      // handles both cases (returns the URL unchanged if it ends in .pdf).
      pdfUrl = await findPdfUrlOnDecisionPage(item.link, log, "gao_reports");
      if (pdfUrl) {
        const extraction = await fetchAndExtractPdf(
          pdfUrl,
          {
            source: "gao_reports",
            maxBytes: options.maxPdfBytes,
            timeoutMs: options.pdfExtractionTimeoutMs,
            maxTextChars: Math.max(options.maxReportTextChars || 80_000, 80_000),
          },
          log
        );
        metrics.pdfBytes = extraction.bytes;
        metrics.pdfPages = extraction.pages;
        metrics.pdfTextLength = extraction.textLength;
        extractedText = extraction.text;
        parsed = parseGaoReportText(extractedText);
        metrics.parseFlags = parsed.flags;
        metrics.findingsExtracted = parsed.findings.length;
        metrics.recommendationsExtracted = parsed.recommendations.length;
        metrics.programsMatched = parsed.programs.length;
        metrics.contractorsMatched = parsed.contractors.length;
        metrics.agencyResponse = parsed.agencyResponse;
        metrics.pdfSucceeded = true;
      } else {
        metrics.errorMessage = "no_pdf_url_found";
      }
    } catch (err) {
      metrics.errorMessage = (err as Error).message;
      log?.warn("gao_report_pdf_extraction_failed", {
        reportId: reportId || "",
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
    if (parsed.findings.length) attrs.findings = parsed.findings;
    if (parsed.recommendations.length) attrs.recommendations = parsed.recommendations;
    if (parsed.whyGaoDidThis) attrs.whyGaoDidThis = parsed.whyGaoDidThis;
    if (parsed.agencyResponse) {
      attrs.agencyResponse = parsed.agencyResponse;
      attrs.agencyResponseConfidence = parsed.agencyResponseConfidence;
    }
    if (parsed.programs.length) attrs.programs = parsed.programs;
    if (parsed.contractors.length) attrs.contractors = parsed.contractors;
    if (parsed.agencyMentions.length) attrs.agencyMentions = parsed.agencyMentions;

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
    // Resolve a primary agency mention → government Org, push to relatedIds[]
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
    const maxText = options.maxReportTextChars ?? 80_000;
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
      title,
      occurredAt,
      reportId: reportId || "",
      link: item.link || "",
      findingsCount: parsed ? parsed.findings.length : 0,
      contractorsCount: parsed ? parsed.contractors.length : 0,
      programsCount: parsed ? parsed.programs.length : 0,
      reportTextHash: (attrs.reportTextHash as string) || "",
    } as Record<string, unknown>,
    ["title", "occurredAt", "reportId", "link", "findingsCount", "contractorsCount", "programsCount", "reportTextHash"]
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
    log?.debug("gao_report_signal_created", { id, reportId, title: title.slice(0, 80) });
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

export function matchesKeywords(item: GaoReportRssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
