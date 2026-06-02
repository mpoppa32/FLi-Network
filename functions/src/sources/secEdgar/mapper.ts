// SEC EDGAR — Filing → Signal mapper
//
// V1 scope: 8-K material events. v1.1 added 10-K/Q + Form 4 + DEF 14A as
// metadata-only Signals with deepParsingPending:true. v1.2 lifts the
// deepParsingPending flag for Form 4 by fetching the filing XML and parsing
// out insider name/title/transaction-code/shares/price/value/sharesOwnedAfter.
// 10-K/Q + DEF 14A deep parsing is still v1.2-pending in this commit.

import { db, wsPath, stripUndefinedDeep } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import { hashFields } from "../../framework/hashing";
import { Logger } from "../../framework/logger";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Signal } from "../../framework/types/signals";
import {
  buildDocumentUrl,
  fetchFilingDoc,
  type SecFilingRecord,
  type SecSubmissionResponse,
} from "./client";
import { parseForm4Xml, type ParsedForm4 } from "./form4Parser";
import {
  parsePeriodicReportHtml,
  type ParsedPeriodicReport,
} from "./periodicReportParser";
import {
  parseProxyStatementHtml,
  type ParsedProxyStatement,
} from "./proxyStatementParser";

/** 8-K item code → human-readable description.
 *  Per SEC Form 8-K spec. Items split by comma in the API response. */
const ITEM_DESCRIPTIONS: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "1.04": "Mine Safety - Reporting of Shutdowns",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03": "Creation of a Direct Financial Obligation",
  "2.04": "Triggering Events That Accelerate or Increase Obligations",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01": "Notice of Delisting or Failure to Satisfy Listing Rule",
  "3.02": "Unregistered Sales of Equity Securities",
  "3.03": "Material Modification to Rights of Security Holders",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "4.02": "Non-Reliance on Previously Issued Financial Statements",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure/Election/Appointment of Officers",
  "5.03": "Amendments to Articles or Bylaws",
  "5.04": "Temporary Suspension of Trading",
  "5.05": "Amendments to Code of Ethics",
  "5.06": "Change in Shell Company Status",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "5.08": "Shareholder Director Nominations",
  "6.01": "ABS Informational and Computational Material",
  "6.02": "Change of Servicer or Trustee",
  "6.03": "Change in Credit Enhancement",
  "6.04": "Failure to Make Required Distribution",
  "6.05": "Securities Act Updating Disclosure",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

export function describeItems(itemsString: string): { codes: string[]; descriptions: string[] } {
  const codes = itemsString
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const descriptions = codes.map((c) => ITEM_DESCRIPTIONS[c] || `Item ${c}`);
  return { codes, descriptions };
}

/**
 * Map a single 8-K filing record to a Signal.
 */
export async function mapEightKToSignal(
  workspaceId: string,
  filing: SecFilingRecord,
  submission: SecSubmissionResponse
): Promise<Signal> {
  const filerName = submission.name;
  const ticker = submission.tickers?.[0];
  const { orgId: filerOrgId } = await resolveRecipientOrg(workspaceId, filerName, null, {
    autoCreate: true,
    type: "company",
  });

  const { codes, descriptions } = describeItems(filing.items);
  const documentUrl = buildDocumentUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);

  const occurredAt = filing.filingDateMs || Date.now();
  const signalId = "sg_sec_" + filing.accessionNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const hash = hashFields(
    { accessionNumber: filing.accessionNumber, form: filing.form, items: filing.items },
    ["accessionNumber", "form", "items"]
  );

  const signal: Signal = {
    id: signalId,
    type: "material_event",
    subjectIds: [filerOrgId],
    relatedIds: [],
    occurredAt,
    attrs: {
      cik: filing.cik,
      ticker: ticker || null,
      filerName,
      accessionNumber: filing.accessionNumber,
      formType: filing.form,
      items: codes,
      itemDescriptions: descriptions,
      summary: descriptions[0] || `${filing.form} filing`,
      documentUrl,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      primaryDocDescription: filing.primaryDocDescription,
    },
    source: externalProvenance(
      "sec_edgar",
      filing.accessionNumber,
      documentUrl,
      hash,
      Date.now()
    ),
  };

  return signal;
}

/** Idempotent upsert of a SEC Signal. */
export async function upsertSignal(
  workspaceId: string,
  signal: Signal
): Promise<{ action: "created" | "updated" | "unchanged"; signalId: string }> {
  const path = wsPath(workspaceId, "signals", signal.id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(stripUndefinedDeep(signal));
    return { action: "created", signalId: signal.id };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash && existing.source.hash === signal.source.hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", signalId: signal.id };
  }
  await db.ref(path).set(stripUndefinedDeep(signal));
  return { action: "updated", signalId: signal.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.1 — Additional filing types (metadata-only; deep doc parsing deferred)
// ─────────────────────────────────────────────────────────────────────────────

export interface PeriodicReportMapOptions {
  /** v1.2.1: fetch + parse the HTML doc. */
  extractDeep?: boolean;
  /** v1.2.1: HTML fetch timeout (ms). */
  timeoutMs?: number;
  /** v1.2.1: max MD&A snippet chars to retain. */
  maxMdaChars?: number;
  /** v1.2.1: max risk-factors snippet chars to retain. */
  maxRiskFactorsChars?: number;
}

export interface PeriodicReportMapMetrics {
  attempted: boolean;
  succeeded: boolean;
  mdaCharsExtracted: number;
  riskFactorsCharsExtracted: number;
  backlogMentionsCount: number;
  defenseSegmentMentionsCount: number;
  backlogTotalUSD: number | null;
  backlogDefenseUSD: number | null;
  parseFlags: string[];
  errorMessage?: string;
}

export interface PeriodicReportMapResult {
  signal: Signal;
  metrics: PeriodicReportMapMetrics;
}

/**
 * 10-K / 10-Q — annual/quarterly periodic reports.
 *
 * v1.1: filing metadata only (deepParsingPending:true).
 * v1.2.1: when options.extractDeep is set, fetches the HTML body, parses
 *   out MD&A snippet, risk factors snippet, defense-segment snippet,
 *   backlog mentions with parsed USD values, defense-segment-name list.
 *   `attrs.extractedSections` populated per PeriodicReportAttrs schema.
 */
export async function mapPeriodicReportToSignal(
  workspaceId: string,
  filing: SecFilingRecord,
  submission: SecSubmissionResponse,
  options: PeriodicReportMapOptions = {},
  log?: Logger
): Promise<PeriodicReportMapResult> {
  const filerName = submission.name;
  const ticker = submission.tickers?.[0];
  const { orgId: filerOrgId } = await resolveRecipientOrg(workspaceId, filerName, null, {
    autoCreate: true,
    type: "company",
  });
  const documentUrl = buildDocumentUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);
  const reportDate = filing.reportDate ? Date.parse(filing.reportDate) : 0;
  const occurredAt = filing.filingDateMs || Date.now();
  const signalId = "sg_sec_" + filing.accessionNumber.replace(/[^A-Za-z0-9_-]/g, "_");

  const metrics: PeriodicReportMapMetrics = {
    attempted: false,
    succeeded: false,
    mdaCharsExtracted: 0,
    riskFactorsCharsExtracted: 0,
    backlogMentionsCount: 0,
    defenseSegmentMentionsCount: 0,
    backlogTotalUSD: null,
    backlogDefenseUSD: null,
    parseFlags: [],
  };

  const attrs: Record<string, unknown> = {
    cik: filing.cik,
    ticker: ticker || null,
    filerName,
    accessionNumber: filing.accessionNumber,
    formType: filing.form,
    reportDate: Number.isFinite(reportDate) ? reportDate : 0,
    documentUrl,
    extractedSections: {},
    filingDate: filing.filingDate,
    primaryDocDescription: filing.primaryDocDescription,
    deepParsingPending: true,
  };

  let parsed: ParsedPeriodicReport | null = null;
  if (options.extractDeep) {
    metrics.attempted = true;
    try {
      const html = await fetchFilingDoc(
        documentUrl,
        { timeoutMs: options.timeoutMs ?? 30_000 },
        log
      );
      parsed = parsePeriodicReportHtml(html, filing.form, {
        maxMdaChars: options.maxMdaChars,
        maxRiskFactorsChars: options.maxRiskFactorsChars,
      });
      metrics.parseFlags = parsed.flags;
      // Treat as success if we got *anything* useful — MD&A snippet or
      // a backlog mention. Pure failure (both null + empty) is a deep
      // parse fail.
      if (parsed.mdaSnippet || parsed.backlogMentions.length > 0) {
        metrics.succeeded = true;
      } else {
        metrics.errorMessage = "parse_yielded_no_data";
      }
    } catch (err) {
      metrics.errorMessage = (err as Error).message;
      log?.warn("sec_edgar_periodic_fetch_or_parse_failed", {
        accession: filing.accessionNumber,
        form: filing.form,
        message: (err as Error).message,
      });
    }
  }

  if (parsed && metrics.succeeded) {
    delete attrs.deepParsingPending;
    metrics.mdaCharsExtracted = parsed.mdaLength;
    metrics.riskFactorsCharsExtracted = parsed.riskFactorsSnippet ? parsed.riskFactorsSnippet.length : 0;
    metrics.backlogMentionsCount = parsed.backlogMentions.length;
    metrics.defenseSegmentMentionsCount = parsed.defenseSegmentMentions.length;
    metrics.backlogTotalUSD = parsed.backlogTotalUSD;
    metrics.backlogDefenseUSD = parsed.backlogDefenseUSD;

    const extractedSections: Record<string, unknown> = {};
    if (parsed.mdaSnippet) extractedSections.mdaSnippet = parsed.mdaSnippet;
    if (parsed.riskFactorsSnippet) extractedSections.riskFactorsSnippet = parsed.riskFactorsSnippet;
    if (parsed.defenseSegmentSnippet) extractedSections.defenseSegment = parsed.defenseSegmentSnippet;
    if (parsed.backlogTotalUSD !== null) extractedSections.backlogTotal = parsed.backlogTotalUSD;
    if (parsed.backlogDefenseUSD !== null) extractedSections.backlogDefense = parsed.backlogDefenseUSD;
    attrs.extractedSections = extractedSections;

    if (parsed.backlogMentions.length > 0) attrs.backlogMentions = parsed.backlogMentions;
    if (parsed.defenseSegmentMentions.length > 0) attrs.defenseSegmentMentions = parsed.defenseSegmentMentions;
    if (parsed.flags.length > 0) attrs.parseFlags = parsed.flags;
    attrs.deepParsedAt = Date.now();
    attrs.deepParseVersion = "1.2.1";
  } else if (options.extractDeep) {
    attrs.deepParseFailed = true;
    attrs.deepParseError = metrics.errorMessage || "unknown";
  }

  const hash = hashFields(
    {
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      reportDate: filing.reportDate || "",
      backlogTotalUSD: metrics.backlogTotalUSD ?? 0,
      backlogDefenseUSD: metrics.backlogDefenseUSD ?? 0,
      mdaCharsExtracted: metrics.mdaCharsExtracted,
    } as Record<string, unknown>,
    ["accessionNumber", "form", "reportDate", "backlogTotalUSD", "backlogDefenseUSD", "mdaCharsExtracted"]
  );

  const signal: Signal = {
    id: signalId,
    type: "periodic_report",
    subjectIds: [filerOrgId],
    relatedIds: [],
    occurredAt,
    attrs,
    source: externalProvenance(
      "sec_edgar",
      filing.accessionNumber,
      documentUrl,
      hash,
      Date.now()
    ),
  };

  return { signal, metrics };
}

export interface Form4MapOptions {
  /** v1.2: fetch + parse the XML doc. When false, fall back to v1.1
   *  metadata-only Signal. Default false (orchestrator decides). */
  extractDeep?: boolean;
  /** v1.2: per-fetch timeout (ms). */
  timeoutMs?: number;
}

export interface Form4MapMetrics {
  attempted: boolean;
  succeeded: boolean;
  parseFlags: string[];
  insidersResolved: number;
  transactionsParsed: number;
  totalValue: number;
  netSignedValue: number;
  primaryCode: string | null;
  errorMessage?: string;
}

export interface Form4MapResult {
  signal: Signal;
  metrics: Form4MapMetrics;
}

/**
 * Form 4 — insider transaction. v1.2 fetches the XML doc when
 * `options.extractDeep` is set, parses out insider + transaction detail,
 * and resolves the insider as a Corsair entity. Falls back to v1.1
 * metadata-only behavior when fetch/parse fails or extractDeep is false.
 */
export async function mapForm4ToSignal(
  workspaceId: string,
  filing: SecFilingRecord,
  submission: SecSubmissionResponse,
  options: Form4MapOptions = {},
  log?: Logger
): Promise<Form4MapResult> {
  const filerName = submission.name;
  const ticker = submission.tickers?.[0];
  const { orgId: filerOrgId } = await resolveRecipientOrg(workspaceId, filerName, null, {
    autoCreate: true,
    type: "company",
  });
  const documentUrl = buildDocumentUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);
  const occurredAt = filing.filingDateMs || Date.now();
  const signalId = "sg_sec_" + filing.accessionNumber.replace(/[^A-Za-z0-9_-]/g, "_");

  const metrics: Form4MapMetrics = {
    attempted: false,
    succeeded: false,
    parseFlags: [],
    insidersResolved: 0,
    transactionsParsed: 0,
    totalValue: 0,
    netSignedValue: 0,
    primaryCode: null,
  };

  // ─── v1.1 baseline attrs (used when deep parse fails or is off) ────────
  const attrs: Record<string, unknown> = {
    cik: filing.cik,
    insiderCik: filing.cik,
    insiderName: filing.primaryDocDescription || "(see filing document)",
    insiderTitle: "(parse pending)",
    transactionCode: "(parse pending)",
    transactionType: "(parse pending)",
    shares: 0,
    documentUrl,
    ticker: ticker || null,
    filerName,
    accessionNumber: filing.accessionNumber,
    formType: filing.form,
    filingDate: filing.filingDate,
    deepParsingPending: true,
  };
  const subjectIds: string[] = [filerOrgId];
  const relatedIds: string[] = [];

  // ─── v1.2 deep extraction ──────────────────────────────────────────────
  let parsed: ParsedForm4 | null = null;
  if (options.extractDeep) {
    metrics.attempted = true;
    try {
      const xml = await fetchFilingDoc(
        documentUrl,
        { timeoutMs: options.timeoutMs ?? 30_000 },
        log
      );
      parsed = parseForm4Xml(xml);
      metrics.parseFlags = parsed.flags;
      // If parse didn't find any transactions AND no reporting owner, treat as failure
      if (parsed.transactions.length === 0 && parsed.reportingOwners.length === 0) {
        metrics.errorMessage = "parse_yielded_no_data";
      } else {
        metrics.succeeded = true;
      }
    } catch (err) {
      metrics.errorMessage = (err as Error).message;
      log?.warn("sec_edgar_form4_fetch_or_parse_failed", {
        accession: filing.accessionNumber,
        message: (err as Error).message,
      });
    }
  }

  if (parsed && metrics.succeeded) {
    // Pull out the parsed data and turn it into structured attrs
    const primary = parsed.primaryTransaction;
    const primaryOwner = parsed.reportingOwners[0];

    // Resolve insider as Corsair entity (using "other" type per congressGov
    // mapper precedent — orgResolver doesn't natively distinguish Persons,
    // but stores them as nodes addressable for cross-source touches).
    let insiderOrgId: string | null = null;
    if (primaryOwner && primaryOwner.name) {
      try {
        const { orgId } = await resolveRecipientOrg(
          workspaceId,
          primaryOwner.name,
          null,
          { autoCreate: true, type: "other" }
        );
        insiderOrgId = orgId;
        metrics.insidersResolved++;
        if (!subjectIds.includes(orgId)) subjectIds.push(orgId);
      } catch (e) {
        log?.debug("sec_edgar_insider_resolve_failed", {
          accession: filing.accessionNumber,
          insiderName: primaryOwner.name,
        });
      }
    }

    metrics.transactionsParsed = parsed.transactions.length;
    metrics.totalValue = parsed.totalValue;
    metrics.netSignedValue = parsed.netSignedValue;
    metrics.primaryCode = primary?.transactionCode ?? null;

    // Replace v1.1 placeholders with parsed values
    delete attrs.deepParsingPending;
    if (primaryOwner) {
      attrs.insiderCik = primaryOwner.cik || filing.cik;
      attrs.insiderName = primaryOwner.name || attrs.insiderName;
      attrs.insiderTitle = primaryOwner.derivedTitle;
      attrs.insiderIsDirector = primaryOwner.isDirector;
      attrs.insiderIsOfficer = primaryOwner.isOfficer;
      attrs.insiderIsTenPercentOwner = primaryOwner.isTenPercentOwner;
      if (insiderOrgId) attrs.insiderOrgId = insiderOrgId;
    }
    attrs.issuerCik = parsed.issuer.cik;
    attrs.issuerName = parsed.issuer.name;
    attrs.issuerTradingSymbol = parsed.issuer.tradingSymbol;
    if (primary) {
      attrs.transactionCode = primary.transactionCode;
      attrs.transactionCodeLabel = primary.transactionCodeLabel;
      attrs.transactionType = primary.acquiredDisposed === "A" ? "acquired" : "disposed";
      attrs.transactionDate = primary.transactionDate;
      attrs.shares = primary.shares;
      attrs.pricePerShare = primary.pricePerShare;
      attrs.totalValue = primary.value;
      attrs.signedValue = primary.signedValue;
      attrs.sharesOwnedAfter = primary.sharesOwnedFollowing;
      attrs.acquiredDisposed = primary.acquiredDisposed;
      attrs.directOrIndirect = primary.directOrIndirect;
      attrs.securityTitle = primary.securityTitle;
    }
    // Full transaction list — operator can drill down
    attrs.transactions = parsed.transactions.map((t) => ({
      kind: t.kind,
      date: t.transactionDate,
      code: t.transactionCode,
      label: t.transactionCodeLabel,
      shares: t.shares,
      price: t.pricePerShare,
      value: t.value,
      signedValue: t.signedValue,
      acquiredDisposed: t.acquiredDisposed,
      sharesOwnedFollowing: t.sharesOwnedFollowing,
      directOrIndirect: t.directOrIndirect,
      securityTitle: t.securityTitle,
    }));
    attrs.transactionsCount = parsed.transactions.length;
    attrs.aggregateValue = parsed.totalValue;
    attrs.netSignedValue = parsed.netSignedValue;
    attrs.uniqueCodes = parsed.uniqueCodes;
    attrs.periodOfReport = parsed.periodOfReport;
    attrs.deepParsedAt = Date.now();
    attrs.deepParseVersion = "1.2";
  } else if (options.extractDeep) {
    // attempted but failed — note this on the Signal so operator can see
    attrs.deepParseFailed = true;
    attrs.deepParseError = metrics.errorMessage || "unknown";
  }

  const hash = hashFields(
    {
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      // Include deep-parsed fields so re-runs after a successful parse
      // update the existing Signal cleanly.
      transactionCode: attrs.transactionCode || "",
      shares: attrs.shares || 0,
      pricePerShare: attrs.pricePerShare || 0,
      insiderName: attrs.insiderName || "",
      transactionsCount: attrs.transactionsCount || 0,
    },
    ["accessionNumber", "form", "transactionCode", "shares", "pricePerShare", "insiderName", "transactionsCount"]
  );

  const signal: Signal = {
    id: signalId,
    type: "insider_transaction",
    subjectIds,
    relatedIds,
    occurredAt,
    attrs,
    source: externalProvenance(
      "sec_edgar",
      filing.accessionNumber,
      documentUrl,
      hash,
      Date.now()
    ),
  };

  return { signal, metrics };
}

export interface ProxyMapOptions {
  /** v1.2.2: fetch + parse the HTML doc. */
  extractDeep?: boolean;
  /** v1.2.2: HTML fetch timeout (ms). */
  timeoutMs?: number;
  /** v1.2.2: max executive rows to retain. */
  maxExecutives?: number;
}

export interface ProxyMapMetrics {
  attempted: boolean;
  succeeded: boolean;
  executivesParsed: number;
  ceoTotalComp: number | null;
  top5TotalComp: number;
  shareholderProposalCount: number;
  hasSayOnPay: boolean;
  parseFlags: string[];
  errorMessage?: string;
}

export interface ProxyMapResult {
  signal: Signal;
  metrics: ProxyMapMetrics;
}

/**
 * DEF 14A — proxy statement.
 *
 * v1.1: filing metadata only (deepParsingPending:true).
 * v1.2.2: when options.extractDeep is set, fetches the HTML body, parses
 *   out the Summary Compensation Table (CEO + top NEOs with salary /
 *   bonus / stock / option / non-equity / other / total), shareholder
 *   proposal count, say-on-pay vote mention.
 */
export async function mapProxyStatementToSignal(
  workspaceId: string,
  filing: SecFilingRecord,
  submission: SecSubmissionResponse,
  options: ProxyMapOptions = {},
  log?: Logger
): Promise<ProxyMapResult> {
  const filerName = submission.name;
  const ticker = submission.tickers?.[0];
  const { orgId: filerOrgId } = await resolveRecipientOrg(workspaceId, filerName, null, {
    autoCreate: true,
    type: "company",
  });
  const documentUrl = buildDocumentUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);
  const occurredAt = filing.filingDateMs || Date.now();
  const signalId = "sg_sec_" + filing.accessionNumber.replace(/[^A-Za-z0-9_-]/g, "_");

  const metrics: ProxyMapMetrics = {
    attempted: false,
    succeeded: false,
    executivesParsed: 0,
    ceoTotalComp: null,
    top5TotalComp: 0,
    shareholderProposalCount: 0,
    hasSayOnPay: false,
    parseFlags: [],
  };

  const attrs: Record<string, unknown> = {
    cik: filing.cik,
    ticker: ticker || null,
    filerName,
    accessionNumber: filing.accessionNumber,
    formType: filing.form,
    documentUrl,
    filingDate: filing.filingDate,
    primaryDocDescription: filing.primaryDocDescription,
    deepParsingPending: true,
  };

  let parsed: ParsedProxyStatement | null = null;
  if (options.extractDeep) {
    metrics.attempted = true;
    try {
      const html = await fetchFilingDoc(
        documentUrl,
        { timeoutMs: options.timeoutMs ?? 30_000 },
        log
      );
      parsed = parseProxyStatementHtml(html, { maxExecutives: options.maxExecutives });
      metrics.parseFlags = parsed.flags;
      // Treat as success if we extracted any executive rows OR meaningful
      // governance signals (say-on-pay, shareholder proposals)
      if (
        parsed.executiveCompensation.length > 0 ||
        parsed.shareholderProposalCount > 0 ||
        parsed.hasSayOnPay
      ) {
        metrics.succeeded = true;
      } else {
        metrics.errorMessage = "parse_yielded_no_data";
      }
    } catch (err) {
      metrics.errorMessage = (err as Error).message;
      log?.warn("sec_edgar_proxy_fetch_or_parse_failed", {
        accession: filing.accessionNumber,
        message: (err as Error).message,
      });
    }
  }

  if (parsed && metrics.succeeded) {
    delete attrs.deepParsingPending;
    metrics.executivesParsed = parsed.executiveCompensation.length;
    metrics.ceoTotalComp = parsed.ceoTotalComp;
    metrics.top5TotalComp = parsed.top5TotalComp;
    metrics.shareholderProposalCount = parsed.shareholderProposalCount;
    metrics.hasSayOnPay = parsed.hasSayOnPay;

    if (parsed.executiveCompensation.length > 0) {
      attrs.executiveCompensation = parsed.executiveCompensation;
    }
    if (parsed.ceoName) attrs.ceoName = parsed.ceoName;
    if (parsed.ceoTotalComp !== null) attrs.ceoTotalComp = parsed.ceoTotalComp;
    if (parsed.top5TotalComp > 0) attrs.top5TotalComp = parsed.top5TotalComp;
    attrs.shareholderProposalCount = parsed.shareholderProposalCount;
    attrs.hasSayOnPay = parsed.hasSayOnPay;
    attrs.hasBoardDeclassification = parsed.hasBoardDeclassification;
    if (parsed.flags.length > 0) attrs.parseFlags = parsed.flags;
    attrs.deepParsedAt = Date.now();
    attrs.deepParseVersion = "1.2.2";
  } else if (options.extractDeep) {
    attrs.deepParseFailed = true;
    attrs.deepParseError = metrics.errorMessage || "unknown";
  }

  const hash = hashFields(
    {
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      ceoTotalComp: metrics.ceoTotalComp ?? 0,
      executivesParsed: metrics.executivesParsed,
      shareholderProposalCount: metrics.shareholderProposalCount,
    } as Record<string, unknown>,
    ["accessionNumber", "form", "ceoTotalComp", "executivesParsed", "shareholderProposalCount"]
  );

  const signal: Signal = {
    id: signalId,
    type: "proxy_statement",
    subjectIds: [filerOrgId],
    relatedIds: [],
    occurredAt,
    attrs,
    source: externalProvenance(
      "sec_edgar",
      filing.accessionNumber,
      documentUrl,
      hash,
      Date.now()
    ),
  };

  return { signal, metrics };
}

export interface DispatchOptions {
  /** v1.2: pass-through to mapForm4ToSignal. */
  form4?: Form4MapOptions;
  /** v1.2.1: pass-through to mapPeriodicReportToSignal. */
  periodicReport?: PeriodicReportMapOptions;
  /** v1.2.2: pass-through to mapProxyStatementToSignal. */
  proxy?: ProxyMapOptions;
}

export interface DispatchResult {
  signal: Signal | null;
  /** Populated only when the filing was a Form 4 with deep-parse attempted. */
  form4Metrics?: Form4MapMetrics;
  /** Populated only when the filing was a 10-K/Q with deep-parse attempted. */
  periodicReportMetrics?: PeriodicReportMapMetrics;
  /** Populated only when the filing was a DEF 14A with deep-parse attempted. */
  proxyMetrics?: ProxyMapMetrics;
}

/**
 * v1.2.1 dispatcher — choose the right mapper for a given form type.
 * Returns null signal if the form type isn't recognized (orchestrator
 * should skip). Form 4 + 10-K/Q mappers additionally return extraction
 * metrics so the orchestrator can budget HTTP fetches and surface per-
 * sync stats.
 */
export async function mapFilingToSignal(
  workspaceId: string,
  filing: SecFilingRecord,
  submission: SecSubmissionResponse,
  options: DispatchOptions = {},
  log?: Logger
): Promise<DispatchResult> {
  const form = (filing.form || "").trim().toUpperCase();
  if (form === "8-K") {
    const s = await mapEightKToSignal(workspaceId, filing, submission);
    return { signal: s };
  }
  if (form === "10-K" || form === "10-Q" || form === "10-K/A" || form === "10-Q/A") {
    const r = await mapPeriodicReportToSignal(
      workspaceId,
      filing,
      submission,
      options.periodicReport || {},
      log
    );
    return { signal: r.signal, periodicReportMetrics: r.metrics };
  }
  if (form === "4" || form === "4/A") {
    const r = await mapForm4ToSignal(workspaceId, filing, submission, options.form4 || {}, log);
    return { signal: r.signal, form4Metrics: r.metrics };
  }
  if (form === "DEF 14A" || form === "DEFM14A" || form === "PRE 14A") {
    const r = await mapProxyStatementToSignal(
      workspaceId,
      filing,
      submission,
      options.proxy || {},
      log
    );
    return { signal: r.signal, proxyMetrics: r.metrics };
  }
  return { signal: null };
}
