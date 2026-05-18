// Advisory Boards — HTML index walker
//
// DSB / DBB / DIB each publish reports as PDFs linked from a public report
// index page. Unlike GAO Reports (RSS feed) and gaoProtest (per-decision
// product page), these sites have no machine feed. We fetch the index HTML,
// scan for <a href> pointing to a PDF or to a report product page, extract
// the anchor text as the title, and harvest any nearby date string as the
// pub-date.
//
// The heuristic walker is intentionally board-agnostic: it pulls every
// PDF-ish or report-ish anchor and lets the orchestrator filter by lookback
// + keyword. v1.0 keeps the parsing forgiving — board sites can change
// markup without breaking the sync, at the cost of occasional non-report
// anchors slipping through.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";
import {
  AdvisoryBoardKey,
  AdvisoryBoardsConfig,
  BOARD_REGISTRY,
  resolveIndexUrl,
} from "./config";

const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";
const SOURCE_KEY = "advisory_boards";

export interface AdvisoryBoardIndexItem {
  /** Board this report came from. */
  board: AdvisoryBoardKey;
  /** Board display label (DSB / DBB / DIB). */
  boardLabel: string;
  /** Anchor text (the report title as it appears on the index). */
  title: string;
  /** Absolute URL to the report page or directly to the PDF. */
  link: string;
  /** Best-effort published date parsed from text near the anchor. */
  pubDateMs: number;
  /** Stable identifier built from board + URL. */
  guid: string;
}

/**
 * Fetch the index HTML for one board.
 *
 * Polite-scrape: rate-limited via the framework token bucket bound to
 * "advisory_boards", 30s timeout, follows redirects.
 */
async function fetchIndexHtml(
  url: string,
  log?: Logger
): Promise<string> {
  await acquireTokens(SOURCE_KEY, 1);
  const op = async (): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const r = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });
      if (!r.ok) {
        const err = new Error(
          `Advisory board index fetch failed: HTTP ${r.status} ${url}`
        );
        (err as any).statusCode = r.status;
        throw err;
      }
      return await r.text();
    } finally {
      clearTimeout(timer);
    }
  };
  return await withRetry(op, {
    source: SOURCE_KEY,
    operationName: "fetch_advisory_index",
    log,
  });
}

/**
 * Make a relative URL absolute against an index URL.
 */
function absolutize(href: string, baseUrl: string): string {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a date out of free text near an anchor. Handles "Month YYYY",
 * "Month D, YYYY", "M/D/YYYY", "YYYY-MM-DD". Returns 0 if none found.
 */
function parseDateFromContext(text: string): number {
  if (!text) return 0;
  // "Month D, YYYY"
  const m1 = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (m1) {
    const ms = Date.parse(`${m1[1]} ${m1[2]}, ${m1[3]} UTC`);
    if (Number.isFinite(ms)) return ms;
  }
  // "Month YYYY"
  const m2 = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (m2) {
    const ms = Date.parse(`${m2[1]} 1, ${m2[2]} UTC`);
    if (Number.isFinite(ms)) return ms;
  }
  // "YYYY-MM-DD"
  const m3 = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m3) {
    const y = parseInt(m3[1], 10);
    const mo = parseInt(m3[2], 10);
    const d = parseInt(m3[3], 10);
    if (y > 1990 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return Date.UTC(y, mo - 1, d);
    }
  }
  // "M/D/YYYY"
  const m4 = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m4) {
    const mo = parseInt(m4[1], 10);
    const d = parseInt(m4[2], 10);
    const y = parseInt(m4[3], 10);
    if (y > 1990 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return Date.UTC(y, mo - 1, d);
    }
  }
  // Year only (last resort) — anchor to January 1
  const m5 = text.match(/\b(20\d{2})\b/);
  if (m5) {
    const y = parseInt(m5[1], 10);
    if (y > 2000 && y < 2100) return Date.UTC(y, 0, 1);
  }
  return 0;
}

const ANCHOR_RE = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;

/**
 * Walk an index page and return all anchors that look like report links.
 *
 * "Looks like a report link" =
 *   - href ends in .pdf, OR
 *   - href contains "/report", "/reports", "/publication", "/library",
 *     "/Documents/", "/Portals/" (defense.gov asset paths)
 *   - anchor text is at least 12 chars and not all whitespace
 *
 * Title = anchor inner text stripped to plain text. pubDate = parsed from
 * text in the ~400 chars surrounding the anchor.
 */
export function parseIndexHtml(
  html: string,
  baseUrl: string,
  board: AdvisoryBoardKey
): AdvisoryBoardIndexItem[] {
  const out: AdvisoryBoardIndexItem[] = [];
  const seenUrls = new Set<string>();
  const reportLinkRe = /\.(pdf|html?|aspx)(?:$|\?|#)|\/(?:report|reports|publication|publications|library|documents|portals|media)/i;
  const skipRe = /^(?:javascript:|mailto:|#|tel:)/i;

  let m: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const href = m[2];
    const inner = m[4];
    if (!href || skipRe.test(href)) continue;
    if (!reportLinkRe.test(href)) continue;
    const title = stripHtml(inner);
    if (!title || title.length < 12) continue;
    // Filter generic navigation anchors
    const titleLc = title.toLowerCase();
    if (
      titleLc === "read more" ||
      titleLc === "download" ||
      titleLc === "read the report" ||
      titleLc.startsWith("more info") ||
      titleLc === "view publication" ||
      titleLc === "library" ||
      titleLc === "reports"
    ) continue;
    const absoluteHref = absolutize(href, baseUrl);
    if (!absoluteHref || seenUrls.has(absoluteHref)) continue;
    seenUrls.add(absoluteHref);

    // Look at ~400 chars around the anchor for a date string
    const anchorStart = m.index;
    const anchorEnd = anchorStart + m[0].length;
    const ctxStart = Math.max(0, anchorStart - 200);
    const ctxEnd = Math.min(html.length, anchorEnd + 200);
    const ctxText = stripHtml(html.slice(ctxStart, ctxEnd));
    const pubDateMs = parseDateFromContext(ctxText);

    const guidBasis = `${board}:${absoluteHref}`;
    out.push({
      board,
      boardLabel: BOARD_REGISTRY[board].label,
      title: title.slice(0, 400),
      link: absoluteHref,
      pubDateMs,
      guid: guidBasis,
    });
  }
  return out;
}

export async function fetchBoardIndex(
  board: AdvisoryBoardKey,
  config: AdvisoryBoardsConfig,
  log?: Logger
): Promise<AdvisoryBoardIndexItem[]> {
  const url = resolveIndexUrl(config, board);
  const html = await fetchIndexHtml(url, log);
  const items = parseIndexHtml(html, url, board);
  log?.debug("advisory_boards_index_parsed", {
    board,
    url,
    itemCount: items.length,
  });
  return items;
}

/**
 * For an item whose link points to a product page (not a direct PDF), find
 * the PDF on that page. Returns the URL unchanged if already a PDF, null if
 * no PDF anchor is found.
 *
 * Polite-scrape: rate-limited via the same advisory_boards bucket so the
 * board's webserver doesn't see a burst.
 */
export async function findPdfUrlOnReportPage(
  reportPageUrl: string,
  log?: Logger
): Promise<string | null> {
  if (!reportPageUrl) return null;
  if (/\.pdf($|\?|#)/i.test(reportPageUrl)) return reportPageUrl;

  try {
    await acquireTokens(SOURCE_KEY, 1);
    const op = async (): Promise<string> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const r = await fetch(reportPageUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
            "User-Agent": USER_AGENT,
          },
          signal: controller.signal,
        });
        if (!r.ok) {
          const err = new Error(
            `advisory board page fetch failed: HTTP ${r.status} ${reportPageUrl}`
          );
          (err as any).statusCode = r.status;
          throw err;
        }
        return await r.text();
      } finally {
        clearTimeout(timer);
      }
    };
    const html = await withRetry(op, {
      source: SOURCE_KEY,
      operationName: "fetch_advisory_report_page",
      log,
    });
    // Walk anchors on the product page; first .pdf href wins.
    const pdfHrefRe = /<a\b[^>]*?href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/i;
    const m = html.match(pdfHrefRe);
    if (m && m[1]) {
      return absolutize(m[1], reportPageUrl);
    }
    return null;
  } catch (err) {
    log?.warn("advisory_board_pdf_lookup_failed", {
      url: reportPageUrl,
      message: (err as Error).message,
    });
    return null;
  }
}

export function matchesKeywords(
  item: AdvisoryBoardIndexItem,
  keywords: string[]
): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = item.title.toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
