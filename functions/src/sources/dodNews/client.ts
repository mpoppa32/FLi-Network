// DoD News Contracts — HTTP client
//
// Per award-integration-v1 Part Three §3: fetches the daily DoD News
// Contracts page at defense.gov/News/Contracts/. Public, keyless. Polite
// rate (1 req per 2s per framework spec).
//
// The endpoint returns full HTML; parser.ts extracts announcement
// paragraphs. v1 fetches the listing page (today + recent days).

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const BASE_URL = "https://www.defense.gov/News/Contracts";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface DodNewsPageFetch {
  url: string;
  fetchedAt: number;
  html: string;
  status: number;
}

/**
 * Fetch the current Contracts listings page. The page presents the most
 * recent days of announcements; the parser handles multi-day extraction.
 */
export async function fetchContractsListing(log?: Logger): Promise<DodNewsPageFetch> {
  await acquireTokens("dod_news", 1);
  const op = async (): Promise<DodNewsPageFetch> => {
    const response = await fetch(`${BASE_URL}/`, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`DoD News fetch failed: HTTP ${response.status}`);
      (err as any).statusCode = response.status;
      throw err;
    }
    return {
      url: `${BASE_URL}/`,
      fetchedAt: Date.now(),
      html: text,
      status: response.status,
    };
  };
  return withRetry(op, {
    source: "dod_news",
    operationName: "fetch_contracts_listing",
    log,
  });
}

/**
 * Fetch a specific archived article. Defense.gov uses /News/Contracts/Contract/Article/{id}/
 * for individual day archives.
 */
export async function fetchContractsArticle(
  articleId: string | number,
  log?: Logger
): Promise<DodNewsPageFetch> {
  await acquireTokens("dod_news", 1);
  const url = `${BASE_URL}/Contract/Article/${encodeURIComponent(String(articleId))}/`;
  const op = async (): Promise<DodNewsPageFetch> => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`DoD News article fetch failed: HTTP ${response.status}`);
      (err as any).statusCode = response.status;
      throw err;
    }
    return { url, fetchedAt: Date.now(), html: text, status: response.status };
  };
  return withRetry(op, {
    source: "dod_news",
    operationName: "fetch_contracts_article",
    log,
  });
}
