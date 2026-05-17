// USAspending API client
//
// REST API at api.usaspending.gov/api/v2/. No authentication required.
// Rate limit per framework spec: 5/sec burst, 1000/hour daily budget.
//
// Primary endpoints used:
//   POST /search/spending_by_award/         — primary search (paginated)
//   GET  /awards/{generated_unique_id}/     — individual award detail
//   GET  /awards/{id}/transactions/         — modification history
//   POST /subawards/                        — FFATA subaward data
//   GET  /recipient/{recipient_hash}/       — recipient detail
//
// For Phase 8.5.4 V1 we use just the search endpoint. Detail / transactions /
// subawards are deferred to a follow-up enhancement.

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
