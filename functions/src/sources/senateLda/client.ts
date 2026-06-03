// Senate LDA API client
//
// REST API at lda.senate.gov/api/v1/. Keyless v1.0; rate-limited to ~60/hour
// per IP. The framework token bucket bound to "senate_lda" enforces a polite
// pace below the cap.
//
// Filings endpoint returns paginated JSON: { count, next, previous, results }.
// Each result is a Filing record with nested registrant, client, and
// lobbying_activities arrays.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const BASE_URL = "https://lda.senate.gov/api/v1";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface LdaRegistrant {
  id: number;
  name: string;
  description?: string | null;
  country_name?: string | null;
  house_registrant_id?: string | null;
  address_1?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface LdaClient {
  id: number;
  name: string;
  general_description?: string | null;
  country_name?: string | null;
  state_or_local_government?: string | null;
}

export interface LdaGovernmentEntity {
  id: number;
  name: string;
}

export interface LdaLobbyistRef {
  id?: number;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  prefix_display?: string | null;
  suffix_display?: string | null;
}

export interface LdaLobbyistEntry {
  lobbyist: LdaLobbyistRef;
  covered_position?: string | null;
  new?: boolean;
}

export interface LdaLobbyingActivity {
  general_issue_code?: string | null;
  general_issue_code_display?: string | null;
  description?: string | null;
  foreign_entity_issues?: string | null;
  government_entities?: LdaGovernmentEntity[];
  lobbyists?: LdaLobbyistEntry[];
}

export interface LdaFiling {
  filing_uuid: string;
  url?: string;
  filing_type: string;
  filing_type_display?: string;
  filing_year: number;
  filing_period?: string;
  filing_period_display?: string;
  filing_date?: string;
  dt_posted?: string;
  income?: string | null;
  expenses?: string | null;
  income_less_than_5000?: boolean;
  expenses_less_than_5000?: boolean;
  posted_by_name?: string | null;
  registrant: LdaRegistrant;
  client: LdaClient;
  lobbying_activities?: LdaLobbyingActivity[];
}

export interface LdaFilingsResponse {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: LdaFiling[];
}

async function fetchJson<T>(url: string, log?: Logger): Promise<T> {
  await acquireTokens("senate_lda", 1);
  const op = async (): Promise<T> => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `Senate LDA fetch failed: HTTP ${response.status} ${url} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return (await response.json()) as T;
  };
  return withRetry(op, {
    source: "senate_lda",
    operationName: "fetch_filings",
    log,
  });
}

export interface ListFilingsOptions {
  /** filing_year filter. Omit to fetch across years. */
  filingYear?: number;
  /** filing_type filter (Q1/Q2/Q3/Q4/MY/YE/RR/RA). Omit for all. */
  filingType?: string;
  /** general_issue_code filter on lobbying_activities. e.g., "DEF". */
  generalIssueCode?: string;
  /** dt_posted after this ISO datetime. */
  postedAfter?: string;
  /** Page (1-indexed). */
  page?: number;
  /** Page size, max 25. */
  pageSize?: number;
  /** Ordering — default "-dt_posted" (newest first). */
  ordering?: string;
}

export async function listFilings(
  options: ListFilingsOptions = {},
  log?: Logger
): Promise<LdaFilingsResponse> {
  const params = new URLSearchParams();
  if (options.filingYear) params.set("filing_year", String(options.filingYear));
  if (options.filingType) params.set("filing_type", options.filingType);
  if (options.generalIssueCode) {
    params.set(
      "filing_specific_lobbying_issues__general_issue_code",
      options.generalIssueCode
    );
  }
  if (options.postedAfter) params.set("dt_posted_after", options.postedAfter);
  // P13.294 — DO NOT send `page`. Verified 2026-06-03 via direct probe:
  // lda.senate.gov/api/v1/filings now returns HTTP 400 ("must pass at least
  // one query string parameter to filter the results and be able to
  // paginate") for ANY request carrying a `page` param — including page=1,
  // and including the API's OWN `next` URL (which embeds page=2 and then
  // 400s when followed). The first page (no `page` param) returns cleanly.
  // page_size is also capped at 25 server-side regardless of requested
  // value (tested 50/100 — both return 25). Net: this source is
  // single-page-only until the upstream API bug is fixed; we take the 25
  // newest filings per issue code per sync. The mapper dedupes by
  // filing_uuid so weekly re-ingestion of overlapping windows is a no-op.
  params.set("page_size", String(Math.min(25, options.pageSize ?? 25)));
  params.set("ordering", options.ordering ?? "-dt_posted");
  const url = `${BASE_URL}/filings/?${params.toString()}`;
  return fetchJson<LdaFilingsResponse>(url, log);
}

/** Format a Date as the ISO timestamp lda.senate.gov accepts for
 *  dt_posted_after (e.g., "2026-02-01T00:00:00Z"). */
export function ldaPostedAfter(d: Date): string {
  return new Date(d.getTime()).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Compose a full LDA filing URL from a UUID. */
export function ldaFilingPublicUrl(uuid: string): string {
  return `https://lda.senate.gov/filings/public/filing/${uuid}/`;
}
