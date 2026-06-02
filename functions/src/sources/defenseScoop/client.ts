// Defense BD news RSS client.
//
// Same RSS-parsing shape as state_department + think_tank, with a
// distinct rate-limit/retry source key ('defense_scoop') so a noisy
// outlet doesn't burn the others' buckets.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface DsRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  pubDateMs: number;
  author?: string;
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

export function parseRssFeed(xml: string): DsRssItem[] {
  const items: DsRssItem[] = [];
  const itemPattern = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) {
      const hrefMatch = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      if (hrefMatch) link = hrefMatch[1];
    }
    // P13.269 — prefer <content:encoded>. DefenseScoop, Defense News,
    // Defense One all ship multi-KB body in this field while their
    // <description> is 12-180 chars. Empirically lifts orgResolver
    // hit rate without an extra HTTP fetch per item.
    const description =
      extractTag(block, "content:encoded") ||
      extractTag(block, "description") ||
      extractTag(block, "summary") ||
      extractTag(block, "content");
    const pubDate =
      extractTag(block, "pubDate") ||
      extractTag(block, "updated") ||
      extractTag(block, "published");
    const guid = extractTag(block, "guid") || extractTag(block, "id") || link;
    const author =
      extractTag(block, "dc:creator") ||
      extractTag(block, "author") ||
      extractTag(block, "name");
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
      author: author || undefined,
      categories: categories.length ? categories : undefined,
    });
  }
  return items;
}

export async function fetchDsFeed(
  rssUrl: string,
  log?: Logger
): Promise<DsRssItem[]> {
  await acquireTokens("defense_scoop", 1);
  const op = async (): Promise<string> => {
    const response = await fetch(rssUrl, {
      headers: {
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `Defense Scoop RSS fetch failed: HTTP ${response.status} ${rssUrl} — ${text.slice(0, 160)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };
  const xml = await withRetry(op, {
    source: "defense_scoop",
    operationName: "fetch_ds_feed",
    log,
  });
  return parseRssFeed(xml);
}
