// USAspending API client
//
// REST API at api.usaspending.gov/api/v2/. No authentication required.
// Rate limit per framework spec: 5/sec burst, 1000/hour daily budget.
//
// Endpoints implemented (Phase 8.5.4 v1.1):
//   POST /search/spending_by_award/         — primary search (paginated)
//   GET  /awards/{generated_unique_id}/     — individual award detail
//   POST /awards/{id}/transactions/         — modification history
//   POST /subawards/                        — FFATA subaward data

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const BASE_URL = "https://api.usaspending.gov/api/v2";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface UsaSpendingSearchFilters {
  award_type_codes?: string[];
  time_period?: Array<{ start_date: string; end_date: string }>;
  agencies?: Array<{ type: "awarding" | "funding"; tier: "toptier" | "subtier"; name: string }>;
  naics_codes?: string[];
  psc_codes?: string[];
  recipient_search_text?: string[];
  place_of_performance_locations?: Array<{ country: string; state?: string }>;
  set_aside_type_codes?: string[];
  award_amounts?: Array<{ lower_bound?: number; upper_bound?: number }>;
}

export interface UsaSpendingSearchRequest {
  filters: UsaSpendingSearchFilters;
  fields?: string[];
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
  subawards?: boolean;
}

export interface UsaSpendingSearchResult {
  internal_id: number;
  generated_internal_id: string;
  "Award ID": string;
  "Recipient Name": string;
  "Recipient UEI"?: string;
  "Recipient DUNS"?: string;
  "Awarding Agency": string;
  "Awarding Sub Agency": string;
  "Award Amount": number;
  "Total Outlays"?: number;
  NAICS: string;
  PSC?: string;
  "Period of Performance Start Date"?: string;
  "Period of Performance Current End Date"?: string;
  Description?: string;
  "Place of Performance"?: { state_code?: string; country_code?: string; city_name?: string };
  "Type of Set Aside"?: string;
  "Last Modified Date"?: string;
  award_type?: string;
}

export interface UsaSpendingSearchResponse {
  results: UsaSpendingSearchResult[];
  page_metadata: {
    page: number;
    next?: number | null;
    previous?: number | null;
    hasNext: boolean;
    hasPrevious: boolean;
    last_record_unique_id?: string | null;
    last_record_sort_value?: string | null;
  };
  messages?: string[];
  spending_level?: string;
  limit?: number;
}

/** Default fields the search endpoint returns (we ask explicitly so we get them all). */
export const DEFAULT_SEARCH_FIELDS = [
  "Award ID",
  "generated_internal_id",
  "Recipient Name",
  "Recipient UEI",
  "Recipient DUNS",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Award Amount",
  "Total Outlays",
  "NAICS",
  "PSC",
  "Period of Performance Start Date",
  "Period of Performance Current End Date",
  "Description",
  "Place of Performance",
  "Type of Set Aside",
  "Last Modified Date",
  "award_type",
];

/**
 * Execute one USAspending search request. Returns the parsed response.
 */
export async function searchAwards(
  request: UsaSpendingSearchRequest,
  log?: Logger
): Promise<UsaSpendingSearchResponse> {
  await acquireTokens("usaspending", 1);

  const body = JSON.stringify({
    fields: DEFAULT_SEARCH_FIELDS,
    page: 1,
    limit: 100,
    sort: "Award Amount",
    order: "desc",
    subawards: false,
    ...request,
  });

  const op = async (): Promise<UsaSpendingSearchResponse> => {
    const response = await fetch(`${BASE_URL}/search/spending_by_award/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `USAspending search failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }

    return (await response.json()) as UsaSpendingSearchResponse;
  };

  return withRetry(op, {
    source: "usaspending",
    operationName: "search_awards",
    log,
  });
}

/**
 * Iterate through all pages of a search query. Returns flat array of all
 * results. Bounded by `maxRecords` to prevent runaway.
 */
export async function searchAllPages(
  request: UsaSpendingSearchRequest,
  maxRecords: number = 1000,
  log?: Logger
): Promise<UsaSpendingSearchResult[]> {
  const all: UsaSpendingSearchResult[] = [];
  let page = request.page ?? 1;
  const limit = request.limit ?? 100;

  while (all.length < maxRecords) {
    const response = await searchAwards(
      { ...request, page, limit },
      log
    );
    all.push(...response.results);
    log?.debug("usaspending_page_fetched", {
      page,
      pageResults: response.results.length,
      totalSoFar: all.length,
    });
    if (!response.page_metadata.hasNext) break;
    page++;
    if (page > 500) {
      log?.warn("usaspending_pagination_cap", { page, maxRecords });
      break;
    }
  }

  return all.slice(0, maxRecords);
}

/**
 * Format a Date as YYYY-MM-DD for USAspending filters.
 */
export function formatDateForApi(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// v1.1: Transactions endpoint (modification history)
// ---------------------------------------------------------------------------

export interface UsaSpendingTransaction {
  id?: string | number;
  type?: string;
  type_description?: string;
  action_date: string;
  action_type?: string;
  action_type_description?: string;
  modification_number?: string;
  federal_action_obligation?: number;
  face_value_loan_guarantee?: number | null;
  original_loan_subsidy_cost?: number | null;
  description?: string | null;
}

export interface UsaSpendingTransactionsResponse {
  results: UsaSpendingTransaction[];
  page_metadata: { page: number; next?: number | null; hasNext: boolean };
}

/**
 * Fetch all transactions (modifications) for one award.
 * Endpoint is POST despite being a read — USAspending uses POST for paginated
 * list endpoints with filters. Returns flat array across all pages, capped at
 * `maxPages` to bound runaway.
 */
export async function fetchAwardTransactions(
  generatedUniqueAwardId: string,
  maxPages: number = 5,
  log?: Logger
): Promise<UsaSpendingTransaction[]> {
  const all: UsaSpendingTransaction[] = [];
  let page = 1;
  while (page <= maxPages) {
    await acquireTokens("usaspending", 1);
    const body = JSON.stringify({
      award_id: generatedUniqueAwardId,
      page,
      limit: 100,
      sort: "action_date",
      order: "asc",
    });
    const op = async (): Promise<UsaSpendingTransactionsResponse> => {
      const response = await fetch(`${BASE_URL}/transactions/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "<no body>");
        const err = new Error(
          `USAspending transactions failed: HTTP ${response.status} — ${text.slice(0, 200)}`
        );
        (err as any).statusCode = response.status;
        throw err;
      }
      return (await response.json()) as UsaSpendingTransactionsResponse;
    };
    const response = await withRetry(op, {
      source: "usaspending",
      operationName: "fetch_transactions",
      log,
    });
    all.push(...(response.results ?? []));
    if (!response.page_metadata?.hasNext) break;
    page++;
  }
  return all;
}

// ---------------------------------------------------------------------------
// v1.1: Subawards endpoint (FFATA)
// ---------------------------------------------------------------------------

export interface UsaSpendingSubaward {
  internal_id?: number | string;
  subaward_number?: string;
  subaward_amount?: number;
  amount?: number;
  sub_action_date?: string;
  subaward_action_date?: string;
  recipient_name?: string;
  sub_recipient_name?: string;
  recipient_uei?: string;
  sub_recipient_unique_id?: string;
  description?: string;
  subaward_description?: string;
  naics_code?: string;
  naics?: string;
  // Some responses use prime_award_recipient_id; others award_id
  prime_award_internal_id?: string | number;
  prime_award_generated_internal_id?: string;
}

export interface UsaSpendingSubawardsResponse {
  results: UsaSpendingSubaward[];
  page_metadata: { page: number; next?: number | null; hasNext: boolean };
}

/**
 * Fetch FFATA-reported subawards for one prime award.
 * Endpoint accepts award_id (the generated_unique_award_id). Returns flat
 * array across pages, capped at `maxPages`.
 */
export async function fetchAwardSubawards(
  generatedUniqueAwardId: string,
  maxPages: number = 5,
  log?: Logger
): Promise<UsaSpendingSubaward[]> {
  const all: UsaSpendingSubaward[] = [];
  let page = 1;
  while (page <= maxPages) {
    await acquireTokens("usaspending", 1);
    const body = JSON.stringify({
      award_id: generatedUniqueAwardId,
      page,
      limit: 100,
      sort: "subaward_amount",
      order: "desc",
    });
    const op = async (): Promise<UsaSpendingSubawardsResponse> => {
      const response = await fetch(`${BASE_URL}/subawards/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "<no body>");
        const err = new Error(
          `USAspending subawards failed: HTTP ${response.status} — ${text.slice(0, 200)}`
        );
        (err as any).statusCode = response.status;
        throw err;
      }
      return (await response.json()) as UsaSpendingSubawardsResponse;
    };
    const response = await withRetry(op, {
      source: "usaspending",
      operationName: "fetch_subawards",
      log,
    });
    all.push(...(response.results ?? []));
    if (!response.page_metadata?.hasNext) break;
    page++;
  }
  return all;
}

// ---------------------------------------------------------------------------
// v1.1: Award detail endpoint
// ---------------------------------------------------------------------------

export interface UsaSpendingAwardDetail {
  id?: number;
  generated_unique_award_id?: string;
  piid?: string;
  parent_award_piid?: string | null;
  type?: string;
  type_description?: string;
  category?: string;
  description?: string | null;
  total_obligation?: number;
  base_and_all_options_value?: number;
  date_signed?: string;
  period_of_performance?: {
    start_date?: string;
    end_date?: string;
    last_modified_date?: string;
  };
  recipient?: {
    recipient_hash?: string;
    recipient_name?: string;
    recipient_unique_id?: string;
    parent_recipient_unique_id?: string;
  };
  awarding_agency?: {
    toptier_agency?: { name?: string; code?: string };
    subtier_agency?: { name?: string; code?: string };
    office_agency_name?: string;
  };
  place_of_performance?: { state_code?: string; city_name?: string; country_code?: string };
  latest_transaction_contract_data?: {
    modification_number?: string;
    action_date?: string;
    action_type_description?: string;
  };
}

/**
 * Fetch full detail for one award by generated_unique_award_id.
 * Used for parent-award lookups (IDV → task order) and richer reconciliation.
 */
export async function fetchAwardDetail(
  generatedUniqueAwardId: string,
  log?: Logger
): Promise<UsaSpendingAwardDetail> {
  await acquireTokens("usaspending", 1);
  const op = async (): Promise<UsaSpendingAwardDetail> => {
    const response = await fetch(
      `${BASE_URL}/awards/${encodeURIComponent(generatedUniqueAwardId)}/`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `USAspending detail failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return (await response.json()) as UsaSpendingAwardDetail;
  };
  return withRetry(op, {
    source: "usaspending",
    operationName: "fetch_award_detail",
    log,
  });
}
