// Think tank RSS client — reuses GAO Protest's RSS parsing pattern
//
// One generic fetcher; per-tank URLs come from registry.ts.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  pubDateMs: number;
  /** Author from <dc:creator> or <author> tag if present */
  author?: string;
  /** Categories/tags from <category> tags */
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

export function parseRssFeed(xml: string): RssItem[] {
  const items: RssItem[] = [];
  // RSS uses <item>, Atom uses <entry>. Handle both.
  const itemPattern = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    // Atom: <link href="..."/>
    if (!link) {
      const hrefMatch = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      if (hrefMatch) link = hrefMatch[1];
    }
    // P13.269 — prefer <content:encoded> (WordPress/Drupal RSS extension)
    // when present; carries full article body. Falls back to RSS
    // description / Atom summary / Atom content. DefenseScoop, Defense
    // News, Defense One all ship 12-180 char descriptions but multi-KB
    // content:encoded with the company-naming lead paragraphs — taking
    // content:encoded multiplies orgResolver hit rate without an extra
    // HTTP fetch per item.
    const description = extractTag(block, "content:encoded") || extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content");
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "updated") || extractTag(block, "published");
    const guid = extractTag(block, "guid") || extractTag(block, "id") || link;
    const author = extractTag(block, "dc:creator") || extractTag(block, "author") || extractTag(block, "name");
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

export async function fetchTankFeed(rssUrl: string, log?: Logger): Promise<RssItem[]> {
  await acquireTokens("think_tank", 1);
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
        `Think tank RSS fetch failed: HTTP ${response.status} ${rssUrl} — ${text.slice(0, 160)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };
  const xml = await withRetry(op, {
    source: "think_tank",
    operationName: "fetch_tank_feed",
    log,
  });
  return parseRssFeed(xml);
}
