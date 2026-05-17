// GAO Reports — RSS client (program-level reports, distinct from Bid Protests)
//
// Per tier2-previews-v1 T2-14: GAO publishes a /reports-testimonies RSS feed
// with all audit + evaluation reports. v1 stores title + summary + URL +
// publication date; PDF deep-parsing is a v1.1 enhancement.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const RSS_URL = "https://www.gao.gov/rss/reports";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface GaoReportRssItem {
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

export function parseGaoReportsFeed(xml: string): GaoReportRssItem[] {
  const items: GaoReportRssItem[] = [];
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
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "updated") || extractTag(block, "published");
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

export async function fetchGaoReportsFeed(log?: Logger): Promise<GaoReportRssItem[]> {
  await acquireTokens("gao_reports", 1);
  const op = async (): Promise<string> => {
    const response = await fetch(RSS_URL, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `GAO reports RSS fetch failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };
  const xml = await withRetry(op, {
    source: "gao_reports",
    operationName: "fetch_gao_reports",
    log,
  });
  return parseGaoReportsFeed(xml);
}

/** Extract GAO report ID (e.g., "GAO-25-106543") from title or guid. */
export function extractGaoReportId(item: GaoReportRssItem): string | null {
  const pattern = /\bGAO-\d{2}-\d{4,7}[A-Z]?\b/;
  const m = item.title.match(pattern) || item.guid.match(pattern) || item.link.match(pattern);
  return m ? m[0] : null;
}
