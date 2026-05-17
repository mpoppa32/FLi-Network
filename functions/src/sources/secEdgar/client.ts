// SEC EDGAR source — HTTP client
//
// Submission history endpoint: data.sec.gov/submissions/CIK{cik}.json
//
// Mandatory User-Agent header per SEC fair-access policy. Strict 10/sec
// rate limit (framework rate limiter enforces).

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { requireSecret } from "../../framework/secrets";
import { Logger } from "../../framework/logger";

const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";

export interface SecRecentFilings {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[];
  fileNumber: string[];
  filmNumber: string[];
  items: string[];
  size: number[];
  isXBRL: number[];
  isInlineXBRL: number[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

export interface SecSubmissionResponse {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  fiscalYearEnd: string;
  stateOfIncorporation: string;
  filings: {
    recent: SecRecentFilings;
    files?: Array<{ name: string; filingFrom: string; filingTo: string; filingCount: number }>;
  };
}

export interface SecFilingRecord {
  cik: string;
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form: string;
  items: string;
  primaryDocument: string;
  primaryDocDescription: string;
  filingDateMs: number;
}

/**
 * Fetch the recent submission history for one CIK.
 */
export async function fetchSubmissions(
  cik: string,
  log?: Logger
): Promise<SecSubmissionResponse> {
  const userAgent = requireSecret("secEdgar").userAgent;
  await acquireTokens("sec_edgar", 1);

  const url = `${SUBMISSIONS_BASE}/CIK${cik}.json`;

  const op = async (): Promise<SecSubmissionResponse> => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
        "Accept-Encoding": "gzip, deflate",
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `SEC EDGAR submissions fetch failed for CIK ${cik}: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return (await response.json()) as SecSubmissionResponse;
  };

  return withRetry(op, { source: "sec_edgar", operationName: "fetch_submissions", log });
}

/**
 * Flatten the "recent" filings array into typed filing records.
 */
export function flattenRecentFilings(submission: SecSubmissionResponse): SecFilingRecord[] {
  const r = submission.filings?.recent;
  if (!r || !r.accessionNumber) return [];
  const count = r.accessionNumber.length;
  const out: SecFilingRecord[] = [];
  for (let i = 0; i < count; i++) {
    const filingDate = r.filingDate?.[i] ?? "";
    const filingDateMs = filingDate ? Date.parse(filingDate) : 0;
    out.push({
      cik: submission.cik,
      accessionNumber: r.accessionNumber[i],
      filingDate,
      reportDate: r.reportDate?.[i] ?? "",
      form: r.form?.[i] ?? "",
      items: r.items?.[i] ?? "",
      primaryDocument: r.primaryDocument?.[i] ?? "",
      primaryDocDescription: r.primaryDocDescription?.[i] ?? "",
      filingDateMs: Number.isFinite(filingDateMs) ? filingDateMs : 0,
    });
  }
  return out;
}

/** Filter filings by form type and minimum date. */
export function filterFilings(
  filings: SecFilingRecord[],
  formTypes: string[],
  sinceMs: number
): SecFilingRecord[] {
  const types = new Set(formTypes);
  return filings.filter(
    (f) => f.filingDateMs >= sinceMs && types.has(f.form)
  );
}

/** Build the document URL for a filing primary document. */
export function buildDocumentUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const accNoDashes = accessionNumber.replace(/-/g, "");
  const cikInt = String(parseInt(cik, 10));
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${primaryDocument}`;
}
