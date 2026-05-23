// DARPA News — RSS client (Phase 8.6.17 v1.0)
//
// Defense Advanced Research Projects Agency publishes program
// announcements, awards, news, and event coverage on its News & Events
// section. DARPA programs are leading 5-10 year indicators of future
// procurement — program awards today become acquisition programs years
// later. Highly relevant for defense BD: surfaces emerging contractors,
// program managers, and capability areas before they appear in
// USAspending / SAM.gov downstream.
//
// Default endpoint is the DARPA News & Events RSS. URL is config-
// overridable (config.rssUrl) so the operator can swap to a different
// feed (e.g., DARPA blog, BAA announcements) if needed.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

export const DEFAULT_RSS_URL = "https://www.darpa.mil/rss/news_events.rss";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface DarpaNewsRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  pubDateMs: number;
  categories?: string[];
}

function extractTag(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(pattern);
  if (!m) return "";
  let v = m[1];
  v = v.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1");
  v = v
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return v.trim();
}

function extractAllTags(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(xml)) !== null) {
    let v = m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1");
    v = v
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (v) out.push(v);
  }
  return out;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDarpaFeed(xml: string): DarpaNewsRssItem[] {
  const items: DarpaNewsRssItem[] = [];
  const itemPattern = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemPattern.exec(xml)) !== null) {
    const block = m[1];
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) {
      const hrefMatch = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      if (hrefMatch) link = hrefMatch[1];
    }
    const description = extractTag(block, "description") || extractTag(block, "summary");
    const pubDate =
      extractTag(block, "pubDate") || extractTag(block, "updated") || extractTag(block, "published");
    const guid = extractTag(block, "guid") || extractTag(block, "id") || link;
    const categories = extractAllTags(block, "category");
    const pubDateMs = pubDate ? Date.parse(pubDate) : 0;
    if (!title && !link) continue;
    items.push({
      title: title.trim(),
      link: link.trim(),
      description: stripHtml(description),
      pubDate,
      guid,
      pubDateMs: Number.isFinite(pubDateMs) ? pubDateMs : 0,
      categories: categories.length ? categories : undefined,
    });
  }
  return items;
}

export async function fetchDarpaFeed(rssUrl: string, log?: Logger): Promise<DarpaNewsRssItem[]> {
  await acquireTokens("darpa_news", 1);
  const op = async (): Promise<string> => {
    const response = await fetch(rssUrl, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `DARPA RSS fetch failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };
  const xml = await withRetry(op, {
    source: "darpa_news",
    operationName: "fetch_darpa_news",
    log,
  });
  return parseDarpaFeed(xml);
}

/** Classify item kind from title + categories to give the operator
 *  faster signal triage. Heuristic — title-based classification. */
export function classifyDarpaItemKind(
  item: DarpaNewsRssItem
): "program_announcement" | "award" | "demonstration" | "event" | "leadership" | "other" {
  const haystack = (
    (item.title || "") +
    " " +
    (item.categories || []).join(" ")
  ).toLowerCase();
  if (/\b(award|contract|otap|prototype)\b/.test(haystack)) return "award";
  if (/\b(demonstration|demo|flight test|trial|exercise)\b/.test(haystack)) return "demonstration";
  if (/\b(launches|kicks off|launches|new program|seeks proposals|baa|program announcement)\b/.test(haystack))
    return "program_announcement";
  if (/\b(director|appointment|nominat|joins|leadership)\b/.test(haystack)) return "leadership";
  if (/\b(workshop|symposium|conference|webinar|industry day)\b/.test(haystack)) return "event";
  return "other";
}
