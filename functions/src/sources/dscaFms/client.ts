// DSCA FMS Notifications — HTTP client
//
// Per tier2-previews-v1 T2-2: scrapes dsca.mil/major-arms-sales pages.
// Public, keyless. Polite rate (matches DoD News: 0.5 req/sec).
//
// DSCA publishes major-arms-sales notifications irregularly (weekly to
// monthly depending on congressional cycle). We scrape the current-year
// listing page.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const BASE_URL = "https://www.dsca.mil/press-media/major-arms-sales";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface DscaPageFetch {
  url: string;
  fetchedAt: number;
  html: string;
  status: number;
}

/**
 * Fetch the major-arms-sales listing page. Returns raw HTML.
 */
export async function fetchMajorArmsSalesListing(log?: Logger): Promise<DscaPageFetch> {
  await acquireTokens("dsca_fms", 1);
  const op = async (): Promise<DscaPageFetch> => {
    const response = await fetch(BASE_URL, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`DSCA fetch failed: HTTP ${response.status}`);
      (err as any).statusCode = response.status;
      throw err;
    }
    return { url: BASE_URL, fetchedAt: Date.now(), html: text, status: response.status };
  };
  return withRetry(op, {
    source: "dsca_fms",
    operationName: "fetch_major_arms_sales",
    log,
  });
}

/**
 * Fetch one specific notification page if URL is known (deep-link from list).
 */
export async function fetchNotificationDetail(
  url: string,
  log?: Logger
): Promise<DscaPageFetch> {
  await acquireTokens("dsca_fms", 1);
  const op = async (): Promise<DscaPageFetch> => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`DSCA detail fetch failed: HTTP ${response.status}`);
      (err as any).statusCode = response.status;
      throw err;
    }
    return { url, fetchedAt: Date.now(), html: text, status: response.status };
  };
  return withRetry(op, {
    source: "dsca_fms",
    operationName: "fetch_notification_detail",
    log,
  });
}
