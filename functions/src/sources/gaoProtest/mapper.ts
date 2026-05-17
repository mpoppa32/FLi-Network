// GAO Bid Protest source — RSS item → Signal mapper
//
// Per signal-sources-v1 Part One: Signal entity with type 'protest'.
// Subjects = protestor + awardee Organizations (when resolvable).
//
// v1.0 → v1.1: decision PDF text extraction. When `extractPdf` is enabled,
// the mapper fetches the GAO decision PDF and parses out outcome / awardee /
// agency / solicitation + contract numbers / corrective action. These get
// merged into ProtestAttrs (the schema declares them; v1.0 just left them
// empty). Awardee + agency are resolved to Corsair Organizations and added
// to subjectIds / relatedIds.

import { createHash } from "crypto";

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import { hashFields } from "../../framework/hashing";
import { Logger } from "../../framework/logger";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Signal } from "../../framework/types/signals";
import type { GaoRssItem } from "./client";
import { extractDocketNumbers, findPdfUrlOnDecisionPage } from "./client";
import { fetchAndExtractPdf } from "./pdfExtractor";
import { parseDecisionText, type ParsedDecision } from "./decisionParser";

/** Try to extract the protestor name from a GAO decision title.
 *  Common formats:
 *    "Lockheed Martin Corp., B-420123"
 *    "Matter of Lockheed Martin Corp.; File B-420123"
 *    "B-420123, Lockheed Martin Corporation"
 */
export function extractProtestorName(title: string): string | null {
  // Pattern A: "Matter of {NAME}; File B-..."
  let m = title.match(/Matter\s+of\s+([^;]+?)(?:;|,)/i);
  if (m && m[1]) return m[1].trim();
  // Pattern B: "{NAME}, B-..."
  m = title.match(/^([^,]+?),\s*B-\d/i);
  if (m && m[1]) return m[1].trim();
  // Pattern C: "B-..., {NAME}"
  m = title.match(/B-\d{5,7}(?:\.\d+)?,\s*(.+?)(?:[:;]|$)/i);
  if (m && m[1]) return m[1].trim();
  // Fallback: title minus the docket
  const docketStripped = title.replace(/B-\d{5,7}(?:\.\d+)?/g, "").replace(/^\W+|\W+$/g, "");
  if (docketStripped.length > 3 && docketStripped.length < 120) return docketStripped;
  return null;
}

export interface MapRssOptions {
  /** v1.1: fetch and parse the decision PDF. */
  extractPdf?: boolean;
  /** v1.1: max chars of decision text to retain on the Signal. */
  maxDecisionTextChars?: number;
  /** v1.1: max bytes of PDF to download. */
  maxPdfBytes?: number;
  /** v1.1: PDF fetch + extract timeout. */
  pdfExtractionTimeoutMs?: number;
}

export interface MapRssMetrics {
  pdfAttempted: boolean;
  pdfSucceeded: boolean;
  pdfBytes: number;
  pdfPages: number;
  pdfTextLength: number;
  parseFlags: string[];
  fieldsLifted: number; // count of non-null fields the parser pulled
  durationMs: number;
  errorMessage?: string;
}

export interface MapRssResult {
  signal: Signal | null;
  metrics: MapRssMetrics;
}

/**
 * Map a GAO RSS item to a Signal entity.
 * Resolves protestor Organization (best-effort; falls back to name string).
 * v1.1: when `options.extractPdf` is true, also fetches the decision PDF,
 * parses key fields, resolves awardee + agency Orgs, and stores the
 * extracted text fragment on attrs.
 */
export async function mapRssItemToSignal(
  workspaceId: string,
  item: GaoRssItem,
  options: MapRssOptions = {},
  log?: Logger
): Promise<MapRssResult> {
  const startedAt = Date.now();
  const metrics: MapRssMetrics = {
    pdfAttempted: false,
    pdfSucceeded: false,
    pdfBytes: 0,
    pdfPages: 0,
    pdfTextLength: 0,
    parseFlags: [],
    fieldsLifted: 0,
    durationMs: 0,
  };

  const dockets = extractDocketNumbers(item);
  if (dockets.length === 0) {
    metrics.durationMs = Date.now() - startedAt;
    return { signal: null, metrics };
  }

  const primaryDocket = dockets[0];
  const protestorName = extractProtestorName(item.title);

  const subjectIds: string[] = [];
  let protestorOrgId: string | null = null;
  if (protestorName) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, protestorName, null, {
        autoCreate: true,
        type: "company",
      });
      protestorOrgId = orgId;
      subjectIds.push(orgId);
    } catch (e) {
      // resolution failed; keep going with the name string in attrs
    }
  }

  const occurredAt = item.pubDateMs || Date.now();

  // ─── v1.0 base attrs ────────────────────────────────────────────────────
  const attrs: Record<string, unknown> = {
    docketNumber: primaryDocket,
    allDocketNumbers: dockets,
    protestorName: protestorName || undefined,
    protestorOrgId: protestorOrgId || undefined,
    title: item.title,
    decisionUrl: item.link,
    decisionSummary: item.description.slice(0, 800),
    pubDate: item.pubDate,
    status: "decided",
  };

  const relatedIds: string[] = dockets.length > 1
    ? dockets.slice(1).map((d) => `gao_docket:${d}`)
    : [];

  // ─── v1.1: decision PDF extraction ─────────────────────────────────────
  let parsed: ParsedDecision | null = null;
  let decisionText = "";
  let decisionPdfUrl: string | null = null;

  if (options.extractPdf && item.link) {
    metrics.pdfAttempted = true;
    try {
      decisionPdfUrl = await findPdfUrlOnDecisionPage(item.link, log);
      if (decisionPdfUrl) {
        const extraction = await fetchAndExtractPdf(
          decisionPdfUrl,
          {
            maxBytes: options.maxPdfBytes,
            timeoutMs: options.pdfExtractionTimeoutMs,
            maxTextChars: Math.max(options.maxDecisionTextChars || 60_000, 60_000),
          },
          log
        );
        metrics.pdfBytes = extraction.bytes;
        metrics.pdfPages = extraction.pages;
        metrics.pdfTextLength = extraction.textLength;
        decisionText = extraction.text;
        parsed = parseDecisionText(decisionText);
        metrics.parseFlags = parsed.flags;
        metrics.fieldsLifted =
          (parsed.outcome ? 1 : 0) +
          (parsed.awardeeName ? 1 : 0) +
          (parsed.agencyName ? 1 : 0) +
          (parsed.solicitationNum ? 1 : 0) +
          (parsed.contractNum ? 1 : 0) +
          (parsed.filedAt ? 1 : 0) +
          (parsed.decidedAt ? 1 : 0) +
          (parsed.correctiveAction ? 1 : 0) +
          (parsed.reconsiderationOf ? 1 : 0);
        metrics.pdfSucceeded = true;
      } else {
        metrics.errorMessage = "no_pdf_url_found";
      }
    } catch (err) {
      metrics.errorMessage = (err as Error).message;
      log?.warn("gao_pdf_extraction_failed", {
        docket: primaryDocket,
        url: item.link,
        message: (err as Error).message,
      });
    }
  }

  if (parsed) {
    // Apply parsed fields to attrs (overwrite v1.0 defaults where stronger).
    if (parsed.outcome) {
      attrs.outcome = parsed.outcome;
      attrs.outcomeConfidence = parsed.outcomeConfidence;
      // Map outcome to ProtestAttrs.status enum
      if (parsed.outcome === "withdrawn") attrs.status = "withdrawn";
      else if (parsed.outcome === "settled") attrs.status = "settled";
      else if (parsed.outcome === "dismissed_full" || parsed.outcome === "dismissed_partial") {
        attrs.status = "dismissed";
      } else attrs.status = "decided";
    }
    if (parsed.solicitationNum) attrs.solicitationNum = parsed.solicitationNum;
    if (parsed.contractNum) attrs.contractNum = parsed.contractNum;
    if (parsed.filedAt) attrs.filedAt = parsed.filedAt;
    if (parsed.decidedAt) attrs.decidedAt = parsed.decidedAt;
    if (parsed.correctiveAction) attrs.correctiveAction = parsed.correctiveAction;
    if (parsed.reconsiderationOf) attrs.reconsiderationOf = parsed.reconsiderationOf;

    // Resolve awardee → Organization, push to subjectIds
    if (parsed.awardeeName) {
      attrs.awardeeName = parsed.awardeeName;
      try {
        const { orgId } = await resolveRecipientOrg(
          workspaceId,
          parsed.awardeeName,
          null,
          { autoCreate: true, type: "company" }
        );
        attrs.awardeeOrgId = orgId;
        if (!subjectIds.includes(orgId)) subjectIds.push(orgId);
      } catch (e) {
        log?.debug("gao_awardee_resolve_failed", {
          docket: primaryDocket,
          name: parsed.awardeeName,
        });
      }
    }

    // Resolve agency → Organization (type: government), push to relatedIds
    if (parsed.agencyName) {
      attrs.agency = parsed.agencyName;
      try {
        const { orgId } = await resolveRecipientOrg(
          workspaceId,
          parsed.agencyName,
          null,
          { autoCreate: true, type: "government" }
        );
        attrs.agencyOrgId = orgId;
        if (!relatedIds.includes(orgId)) relatedIds.push(orgId);
      } catch (e) {
        log?.debug("gao_agency_resolve_failed", {
          docket: primaryDocket,
          name: parsed.agencyName,
        });
      }
    }
  }

  // PDF-related metadata on attrs
  if (decisionPdfUrl) attrs.decisionPdfUrl = decisionPdfUrl;
  if (decisionText) {
    const maxText = options.maxDecisionTextChars ?? 60_000;
    const stored = decisionText.slice(0, maxText);
    attrs.decisionText = stored;
    attrs.decisionTextLength = decisionText.length;
    attrs.decisionTextTruncated = decisionText.length > stored.length;
    attrs.decisionTextHash = createHash("sha256").update(decisionText).digest("hex");
  }
  if (metrics.parseFlags && metrics.parseFlags.length > 0) {
    attrs.parseFlags = metrics.parseFlags;
  }

  // ─── Hash + ID + provenance ────────────────────────────────────────────
  const hash = hashFields(
    {
      docket: primaryDocket,
      title: item.title,
      link: item.link,
      // Include extraction-derived fields so updated PDF parses re-write
      outcome: attrs.outcome || null,
      awardeeName: attrs.awardeeName || null,
      decisionTextHash: attrs.decisionTextHash || null,
    },
    ["docket", "title", "link", "outcome", "awardeeName", "decisionTextHash"]
  );

  const signalId =
    "sg_gao_" +
    primaryDocket.replace(/[^A-Za-z0-9_.-]/g, "_") +
    (dockets.length > 1 ? "_multi" : "");

  const signal: Signal = {
    id: signalId,
    type: "protest",
    subjectIds,
    relatedIds,
    occurredAt,
    attrs,
    source: externalProvenance(
      "gao_protest",
      item.guid || item.link || primaryDocket,
      item.link,
      hash,
      Date.now()
    ),
  };

  metrics.durationMs = Date.now() - startedAt;
  return { signal, metrics };
}

/**
 * Idempotent upsert of a Signal. Skip write if existing record's hash matches.
 */
export async function upsertSignal(
  workspaceId: string,
  signal: Signal
): Promise<{ action: "created" | "updated" | "unchanged"; signalId: string }> {
  const path = wsPath(workspaceId, "signals", signal.id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    return { action: "created", signalId: signal.id };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash && existing.source.hash === signal.source.hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", signalId: signal.id };
  }
  // Merge: preserve any operator-edited attrs on existing
  const merged: Signal = {
    ...signal,
    attrs: { ...signal.attrs, ...(existing.attrs || {}) },
  };
  await db.ref(path).set(merged);
  return { action: "updated", signalId: signal.id };
}
