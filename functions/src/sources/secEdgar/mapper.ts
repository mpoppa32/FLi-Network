// SEC EDGAR — Filing → Signal mapper
//
// V1 scope: 8-K material events. Maps each filing to a Signal with type
// 'material_event' and item-code attributes. Filer Organization resolved
// (or auto-created) per orgResolver.

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import { hashFields } from "../../framework/hashing";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Signal } from "../../framework/types/signals";
import { buildDocumentUrl, type SecFilingRecord, type SecSubmissionResponse } from "./client";

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
    await db.ref(path).set(signal);
    return { action: "created", signalId: signal.id };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash && existing.source.hash === signal.source.hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", signalId: signal.id };
  }
  await db.ref(path).set(signal);
  return { action: "updated", signalId: signal.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.1 — Additional filing types (metadata-only; deep doc parsing deferred)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 10-K / 10-Q — annual/quarterly periodic reports. v1.1 stores the filing
 * metadata; v1.2 will add extractedSections (MD&A snippet, risk factors,
 * defense segment backlog) via document fetch + parse.
 */
export async function mapPeriodicReportToSignal(
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
  const documentUrl = buildDocumentUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);
  const reportDate = filing.reportDate ? Date.parse(filing.reportDate) : 0;
  const occurredAt = filing.filingDateMs || Date.now();
  const signalId = "sg_sec_" + filing.accessionNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const hash = hashFields(
    { accessionNumber: filing.accessionNumber, form: filing.form, reportDate: filing.reportDate || "" },
    ["accessionNumber", "form", "reportDate"]
  );
  return {
    id: signalId,
    type: "periodic_report",
    subjectIds: [filerOrgId],
    relatedIds: [],
    occurredAt,
    attrs: {
      cik: filing.cik,
      ticker: ticker || null,
      filerName,
      accessionNumber: filing.accessionNumber,
      formType: filing.form,
      reportDate: Number.isFinite(reportDate) ? reportDate : 0,
      documentUrl,
      extractedSections: {
        // v1.2 will populate these via doc fetch + parse
      },
      filingDate: filing.filingDate,
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
}

/**
 * Form 4 — insider transaction. v1.1 stores filing metadata; v1.2 will
 * parse the XML doc for insider name/title/shares/price.
 */
export async function mapForm4ToSignal(
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
  const documentUrl = buildDocumentUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);
  const occurredAt = filing.filingDateMs || Date.now();
  const signalId = "sg_sec_" + filing.accessionNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const hash = hashFields(
    { accessionNumber: filing.accessionNumber, form: filing.form },
    ["accessionNumber", "form"]
  );
  return {
    id: signalId,
    type: "insider_transaction",
    subjectIds: [filerOrgId],
    relatedIds: [],
    occurredAt,
    attrs: {
      cik: filing.cik,
      // v1.1: insider metadata not yet parsed (deferred to v1.2)
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
    },
    source: externalProvenance(
      "sec_edgar",
      filing.accessionNumber,
      documentUrl,
      hash,
      Date.now()
    ),
  };
}

/**
 * DEF 14A — proxy statement. v1.1 stores filing metadata; future v1.2 will
 * extract executive compensation tables and shareholder proposals.
 */
export async function mapProxyStatementToSignal(
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
  const documentUrl = buildDocumentUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);
  const occurredAt = filing.filingDateMs || Date.now();
  const signalId = "sg_sec_" + filing.accessionNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const hash = hashFields(
    { accessionNumber: filing.accessionNumber, form: filing.form },
    ["accessionNumber", "form"]
  );
  return {
    id: signalId,
    type: "proxy_statement",
    subjectIds: [filerOrgId],
    relatedIds: [],
    occurredAt,
    attrs: {
      cik: filing.cik,
      ticker: ticker || null,
      filerName,
      accessionNumber: filing.accessionNumber,
      formType: filing.form,
      documentUrl,
      filingDate: filing.filingDate,
      primaryDocDescription: filing.primaryDocDescription,
      deepParsingPending: true,
    },
    source: externalProvenance(
      "sec_edgar",
      filing.accessionNumber,
      documentUrl,
      hash,
      Date.now()
    ),
  };
}

/**
 * v1.1 dispatcher — choose the right mapper for a given form type.
 * Returns null if the form type isn't recognized (orchestrator should skip).
 */
export async function mapFilingToSignal(
  workspaceId: string,
  filing: SecFilingRecord,
  submission: SecSubmissionResponse
): Promise<Signal | null> {
  const form = (filing.form || "").trim().toUpperCase();
  if (form === "8-K") return await mapEightKToSignal(workspaceId, filing, submission);
  if (form === "10-K" || form === "10-Q" || form === "10-K/A" || form === "10-Q/A") {
    return await mapPeriodicReportToSignal(workspaceId, filing, submission);
  }
  if (form === "4" || form === "4/A") return await mapForm4ToSignal(workspaceId, filing, submission);
  if (form === "DEF 14A" || form === "DEFM14A" || form === "PRE 14A") {
    return await mapProxyStatementToSignal(workspaceId, filing, submission);
  }
  return null;
}
