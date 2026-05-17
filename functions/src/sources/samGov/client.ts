// SAM.gov source — HTTP client
//
// REST API at api.sam.gov/opportunities/v2/search. Free API key required.
// Rate limit: 1000/hour, 10/sec burst.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { requireSecret } from "../../framework/secrets";
import { Logger } from "../../framework/logger";

const BASE_URL = "https://api.sam.gov/opportunities/v2/search";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface SamSearchParams {
  api_key: string;
  limit?: number;
  offset?: number;
  postedFrom?: string; // MM/DD/YYYY
  postedTo?: string;
  ncode?: string; // NAICS, comma-separated
  classificationCode?: string; // PSC, comma-separated
  ptype?: string; // notice type code(s), comma-separated
  typeOfSetAside?: string;
  state?: string;
  deptname?: string;
  organizationName?: string;
  responseDeadLineFrom?: string;
  responseDeadLineTo?: string;
  active?: "Yes" | "No";
}

export interface SamOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  fullParentPathCode?: string;
  postedDate?: string;
  type?: string;
  baseType?: string;
  archiveType?: string;
  archiveDate?: string;
  typeOfSetAsideDescription?: string;
  typeOfSetAside?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  naicsCodes?: string[];
  classificationCode?: string;
  active?: string;
  award?: unknown | null;
  pointOfContact?: Array<{
    fax?: string | null;
    type?: string;
    email?: string;
    phone?: string;
    title?: string;
    fullName?: string;
  }>;
  description?: string;
  organizationType?: string;
  officeAddress?: {
    zipcode?: string;
    city?: string;
    countryCode?: string;
    state?: string;
  };
  placeOfPerformance?: {
    streetAddress?: string | null;
    city?: { code?: string; name?: string };
    state?: { code?: string; name?: string };
    zip?: string;
    country?: { code?: string; name?: string };
  };
  additionalInfoLink?: string | null;
  uiLink?: string;
  links?: Array<{ rel: string; href: string }>;
  resourceLinks?: string[];
  relatedNotices?: Array<{ noticeId: string; type: string }>;
}

export interface SamSearchResponse {
  totalRecords: number;
  limit: number;
  offset: number;
  opportunitiesData: SamOpportunity[];
  links?: unknown[];
}

/** Format Date as MM/DD/YYYY for SAM.gov filters. */
export function formatDateForApi(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const y = d.getUTCFullYear();
  return `${m}/${day}/${y}`;
}

/** Execute one SAM.gov search request. */
export async function searchOpportunities(
  params: Omit<SamSearchParams, "api_key">,
  log?: Logger
): Promise<SamSearchResponse> {
  const apiKey = requireSecret("samgov").apiKey;
  await acquireTokens("sam_gov", 1);

  const query = new URLSearchParams();
  query.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    query.set(k, String(v));
  }
  query.set("limit", String(params.limit ?? 100));

  const op = async (): Promise<SamSearchResponse> => {
    const response = await fetch(`${BASE_URL}?${query.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `SAM.gov search failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return (await response.json()) as SamSearchResponse;
  };

  return withRetry(op, {
    source: "sam_gov",
    operationName: "search_opportunities",
    log,
  });
}

/** Iterate pages, capped by maxRecords. */
export async function searchAllPages(
  params: Omit<SamSearchParams, "api_key">,
  maxRecords: number = 500,
  log?: Logger
): Promise<SamOpportunity[]> {
  const all: SamOpportunity[] = [];
  let offset = params.offset ?? 0;
  const limit = params.limit ?? 100;
  while (all.length < maxRecords) {
    const response = await searchOpportunities({ ...params, offset, limit }, log);
    all.push(...response.opportunitiesData);
    log?.debug("samgov_page_fetched", { offset, returned: response.opportunitiesData.length, total: all.length });
    if (all.length >= response.totalRecords) break;
    if (response.opportunitiesData.length === 0) break;
    offset += limit;
    if (offset > 10000) {
      log?.warn("samgov_pagination_cap", { offset, maxRecords });
      break;
    }
  }
  return all.slice(0, maxRecords);
}
