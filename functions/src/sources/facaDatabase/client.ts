// FACA (Federal Advisory Committee) Database — HTTP client
//
// Per tier2-previews-v1 T2-1: facadatabase.gov provides JSON endpoints for
// committees, members, meetings. Keyless. Polite use; weekly cadence in v1.
//
// Endpoint base is configurable to absorb API-path variation. The default
// targets the public REST surface; an operator can override via the
// per-workspace config if facadatabase.gov restructures.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

export const FACA_DEFAULT_API_BASE = "https://www.facadatabase.gov/api/v1";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface FacaCommitteeRecord {
  committeeId?: string | number;
  id?: string | number;
  name?: string;
  acronym?: string;
  agencyName?: string;
  agencyAbbreviation?: string;
  committeeUrl?: string;
  charter?: string;
  charterUrl?: string;
  establishedDate?: string;
  terminationDate?: string | null;
  status?: string;
  meetingFrequency?: string;
  description?: string;
  // Defensive: pass through any extra fields verbatim
  [key: string]: unknown;
}

export interface FacaMemberRecord {
  memberId?: string | number;
  id?: string | number;
  committeeId?: string | number;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  appointmentType?: string;
  startDate?: string;
  endDate?: string | null;
  affiliation?: string;
  occupation?: string;
  [key: string]: unknown;
}

export interface FacaMeetingRecord {
  meetingId?: string | number;
  id?: string | number;
  committeeId?: string | number;
  meetingDate?: string;
  title?: string;
  location?: string;
  agendaUrl?: string;
  minutesUrl?: string;
  openToPublic?: boolean;
  status?: string;
  [key: string]: unknown;
}

interface FacaListResponse<T> {
  results?: T[];
  data?: T[];
  items?: T[];
  count?: number;
  next?: string | null;
  [key: string]: unknown;
}

function extractList<T>(resp: FacaListResponse<T>): T[] {
  return (resp.results ?? resp.data ?? resp.items ?? []) as T[];
}

async function fetchJson<T>(
  url: string,
  log?: Logger,
  operationName: string = "faca_fetch"
): Promise<T> {
  await acquireTokens("faca", 1);
  const op = async (): Promise<T> => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `FACA fetch failed: HTTP ${response.status} ${url} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return (await response.json()) as T;
  };
  return withRetry(op, {
    source: "faca",
    operationName,
    log,
  });
}

/**
 * Search committees by name (substring). FACA Database expects a query
 * parameter; the most common naming is `?name=`, with `?search=` as a fallback
 * on some deployments.
 */
export async function searchCommittees(
  query: string,
  apiBase: string = FACA_DEFAULT_API_BASE,
  log?: Logger
): Promise<FacaCommitteeRecord[]> {
  const url = `${apiBase.replace(/\/+$/, "")}/Committee?name=${encodeURIComponent(query)}`;
  const data = await fetchJson<FacaListResponse<FacaCommitteeRecord>>(url, log, "search_committees");
  return extractList(data);
}

/**
 * Fetch full committee detail by ID.
 */
export async function getCommittee(
  committeeId: string | number,
  apiBase: string = FACA_DEFAULT_API_BASE,
  log?: Logger
): Promise<FacaCommitteeRecord | null> {
  try {
    const url = `${apiBase.replace(/\/+$/, "")}/Committee/${encodeURIComponent(String(committeeId))}`;
    return await fetchJson<FacaCommitteeRecord>(url, log, "get_committee");
  } catch (err) {
    if ((err as any).statusCode === 404) return null;
    throw err;
  }
}

/**
 * List members for a committee. v1: fetch all current members; the
 * mapper layer marks end-dated members as historical.
 */
export async function getCommitteeMembers(
  committeeId: string | number,
  apiBase: string = FACA_DEFAULT_API_BASE,
  log?: Logger
): Promise<FacaMemberRecord[]> {
  const url = `${apiBase.replace(/\/+$/, "")}/Committee/${encodeURIComponent(String(committeeId))}/CommitteeMembership`;
  try {
    const data = await fetchJson<FacaListResponse<FacaMemberRecord>>(url, log, "get_members");
    return extractList(data);
  } catch (err) {
    if ((err as any).statusCode === 404) return [];
    throw err;
  }
}

/**
 * List meetings for a committee. v1: fetch meetings since `sinceMs`
 * (defaults to all). Each meeting becomes a Signal of type committee_meeting.
 */
export async function getCommitteeMeetings(
  committeeId: string | number,
  apiBase: string = FACA_DEFAULT_API_BASE,
  log?: Logger
): Promise<FacaMeetingRecord[]> {
  const url = `${apiBase.replace(/\/+$/, "")}/Committee/${encodeURIComponent(String(committeeId))}/CommitteeMeeting`;
  try {
    const data = await fetchJson<FacaListResponse<FacaMeetingRecord>>(url, log, "get_meetings");
    return extractList(data);
  } catch (err) {
    if ((err as any).statusCode === 404) return [];
    throw err;
  }
}

/**
 * Operator-facing probe: tries the default endpoints, returns reachability
 * info per endpoint so the operator can verify connectivity and we can
 * confirm endpoint-path correctness in the field.
 */
export async function probeFacaApi(
  apiBase: string = FACA_DEFAULT_API_BASE,
  log?: Logger
): Promise<{
  apiBase: string;
  searchOk: boolean;
  searchSampleCount: number;
  errorMessage?: string;
}> {
  try {
    const sample = await searchCommittees("Defense Business Board", apiBase, log);
    return {
      apiBase,
      searchOk: true,
      searchSampleCount: sample.length,
    };
  } catch (err) {
    return {
      apiBase,
      searchOk: false,
      searchSampleCount: 0,
      errorMessage: (err as Error).message,
    };
  }
}
