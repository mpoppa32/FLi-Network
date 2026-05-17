// Congress.gov API client
//
// REST API at api.congress.gov/v3/. API key required (free registration).
// Rate limit: 5000/hour, ~5/sec sustainable.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { requireSecret } from "../../framework/secrets";
import { Logger } from "../../framework/logger";

const BASE_URL = "https://api.congress.gov/v3";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface CommitteeMeetingListItem {
  chamber: string;
  congress: number;
  eventId: number;
  type?: string;
  url: string;
  updateDate: string;
}

export interface CommitteeMeetingResponse {
  committeeMeetings: CommitteeMeetingListItem[];
  pagination: { count: number; next?: string };
}

export interface CommitteeMeetingDetail {
  committeeMeeting: {
    chamber: string;
    congress: number;
    eventId: number;
    title?: string;
    meetingStatus?: string;
    type?: string;
    date?: string;
    committees?: Array<{ name: string; systemCode: string; chamber: string }>;
    witnesses?: Array<{
      name: string;
      position?: string;
      organization?: string;
    }>;
    location?: { building?: string; room?: string };
    related?: { bills?: Array<{ congress: number; type: string; number: number }> };
    videos?: Array<{ name: string; url: string }>;
  };
}

async function fetchJson<T>(url: string, log?: Logger): Promise<T> {
  const apiKey = requireSecret("congressgov").apiKey;
  await acquireTokens("congress_gov", 1);
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${sep}api_key=${encodeURIComponent(apiKey)}&format=json`;
  const op = async (): Promise<T> => {
    const response = await fetch(fullUrl, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `Congress.gov fetch failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return (await response.json()) as T;
  };
  return withRetry(op, { source: "congress_gov", operationName: "fetch", log });
}

/**
 * List committee meetings for a specific committee in a specific congress.
 * Note: API endpoint structure is /committee-meeting/{congress}/{chamber}
 * but committee-specific filtering requires additional filter parameters.
 */
export async function listCommitteeMeetings(
  congress: number,
  chamber: "house" | "senate",
  options: { fromDateTime?: string; toDateTime?: string; limit?: number; offset?: number } = {},
  log?: Logger
): Promise<CommitteeMeetingResponse> {
  const params = new URLSearchParams();
  if (options.fromDateTime) params.set("fromDateTime", options.fromDateTime);
  if (options.toDateTime) params.set("toDateTime", options.toDateTime);
  params.set("limit", String(options.limit ?? 100));
  if (options.offset) params.set("offset", String(options.offset));
  const url = `${BASE_URL}/committee-meeting/${congress}/${chamber}?${params.toString()}`;
  return fetchJson<CommitteeMeetingResponse>(url, log);
}

/** Fetch one committee meeting's detail. */
export async function fetchCommitteeMeetingDetail(
  congress: number,
  chamber: "house" | "senate",
  eventId: number,
  log?: Logger
): Promise<CommitteeMeetingDetail> {
  const url = `${BASE_URL}/committee-meeting/${congress}/${chamber}/${eventId}`;
  return fetchJson<CommitteeMeetingDetail>(url, log);
}

/** Determine current congress (119 for 2025-2026, 120 for 2027-2028). */
export function currentCongress(): number {
  const year = new Date().getUTCFullYear();
  // Congress N starts in odd year N*2 + 1789 — close enough; current is 119 (2025-2026)
  if (year >= 2025 && year <= 2026) return 119;
  if (year >= 2027 && year <= 2028) return 120;
  // Fallback calculation: Congress 1 = 1789, each congress = 2 years
  return Math.floor((year - 1789) / 2) + 1;
}
