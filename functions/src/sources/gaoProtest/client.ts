// GAO Bid Protest source — HTTP client
//
// GAO doesn't expose a public REST API for the protest docket. Two paths:
//   1. Scrape gao.gov/legal/bid-protests/search HTML
//   2. Use gao.gov RSS feeds (legal-decisions feed)
//
// V1 uses the RSS feed for new decision notifications because it's more
// resilient to HTML structure changes. Decision PDF text extraction is a
// follow-up enhancement.
//
// The Cloud Function egress (us-central1) has different IP reputation than
// residential IPs; if 403s occur, the source health UI will surface them.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const RSS_URL = "https://www.gao.gov/rss/products/legal-decisions";
const FALLBACK_URL = "https://www.gao.gov/legal/bid-protests/search";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface GaoRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  pubDateMs: number;
}

/**
 * Fetch the GAO legal-decisions RSS feed. Returns parsed items.
 */
export async function fetchRssFeed(log?: Logger): Promise<GaoRssItem[]> {
  await acquireTokens("gao_protest", 1);

  const op = async (): Promise<string> => {
    const response = await fetch(RSS_URL, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `GAO RSS fetch failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };

  const xml = await withRetry(op, {
    source: "gao_protest",
    operationName: "fetch_rss_feed",
    log,
  });

  return parseRssFeed(xml);
}

/**
 * Parse RSS XML into structured items. Uses minimal regex-based parsing to
 * avoid a heavy XML dependency. RSS is simple enough that regex is reliable
 * here, and avoids the brittle DOMParser/xmldom dependency tree.
 */
export function parseRssFeed(xml: string): GaoRssItem[] {
  const items: GaoRssItem[] = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const description = extractTag(block, "description");
    const pubDate = extractTag(block, "pubDate");
    const guid = extractTag(block, "guid") || link;
    const pubDateMs = pubDate ? Date.parse(pubDate) : 0;
    if (!title && !link) continue;
    items.push({
      title: title.trim(),
      link: link.trim(),
      description: stripHtml(description),
      pubDate,
      guid,
      pubDateMs: Number.isFinite(pubDateMs) ? pubDateMs : 0,
    });
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  // Support CDATA and plain text
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(pattern);
  if (!m) return "";
  let v = m[1];
  // Strip CDATA wrapping if present
  v = v.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1");
  // Decode minimal entities
  v = v
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return v;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect if a feed item is a bid protest (vs. other GAO decisions like
 * appropriations law). Bid protest decisions have characteristic file
 * numbers starting with "B-".
 */
export function isBidProtest(item: GaoRssItem): boolean {
  // B-XXXXXX or B-XXXXXX.X format in title or guid
  const protestPattern = /\bB-[0-9]{5,7}(?:\.[0-9]+)?\b/;
  return protestPattern.test(item.title) || protestPattern.test(item.guid);
}

/**
 * Extract docket number(s) from a feed item.
 */
export function extractDocketNumbers(item: GaoRssItem): string[] {
  const protestPattern = /\bB-[0-9]{5,7}(?:\.[0-9]+)?\b/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = protestPattern.exec(item.title)) !== null) set.add(m[0]);
  while ((m = protestPattern.exec(item.guid)) !== null) set.add(m[0]);
  while ((m = protestPattern.exec(item.description)) !== null) set.add(m[0]);
  return Array.from(set);
}

/**
 * Resolve a GAO decision page URL to its PDF URL. GAO RSS `<link>` values
 * usually point to an HTML product page (gao.gov/products/B-XXXXXX), not the
 * PDF itself. This walks the HTML to find the PDF link.
 *
 * Strategy:
 *   1. If the URL already ends in .pdf — return as-is.
 *   2. Otherwise fetch the HTML page and scan for href="...{anything}.pdf"
 *      under known GAO asset roots (`/assets/`, `legaldecisions`, etc.).
 *   3. Return the first absolute-resolved PDF link, or null.
 *
 * Returns null on any failure; callers should treat null as "no PDF" and
 * skip extraction rather than fail the sync.
 */
export async function findPdfUrlOnDecisionPage(
  decisionPageUrl: string,
  log?: Logger
): Promise<string | null> {
  if (!decisionPageUrl) return null;
  // Direct PDF link case
  if (/\.pdf($|\?)/i.test(decisionPageUrl)) return decisionPageUrl;

  try {
    await acquireTokens("gao_protest", 1);
    const op = async (): Promise<string> => {
      const r = await fetch(decisionPageUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
          "User-Agent": USER_AGENT,
        },
      });
      if (!r.ok) {
        const err = new Error(
          `GAO decision page fetch failed: HTTP ${r.status} ${decisionPageUrl}`
        );
        (err as any).statusCode = r.status;
        throw err;
      }
      return await r.text();
    };
    const html = await withRetry(op, {
      source: "gao_protest",
      operationName: "fetch_decision_page",
      log,
    });

    const candidates: string[] = [];
    const hrefPattern = /href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefPattern.exec(html)) !== null) {
      candidates.push(m[1]);
    }
    if (candidates.length === 0) return null;

    // Prefer GAO asset URLs / legaldecisions paths over arbitrary PDFs
    candidates.sort((a, b) => {
      const score = (u: string) =>
        (/\/assets\//i.test(u) ? 4 : 0) +
        (/legaldecisions/i.test(u) ? 3 : 0) +
        (/\.gao\.gov/i.test(u) ? 2 : 0) +
        (/^https?:/i.test(u) ? 1 : 0);
      return score(b) - score(a);
    });

    return resolveAbsoluteUrl(decisionPageUrl, candidates[0]);
  } catch (err) {
    log?.warn("gao_pdf_url_lookup_failed", {
      url: decisionPageUrl,
      message: (err as Error).message,
    });
    return null;
  }
}

function resolveAbsoluteUrl(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    if (href.startsWith("/")) {
      try {
        const b = new URL(base);
        return `${b.origin}${href}`;
      } catch {
        return href;
      }
    }
    return href;
  }
}

export { FALLBACK_URL };
