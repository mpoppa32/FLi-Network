// DoD OIG — RSS client (Phase 8.6.16 v1.0)
//
// Department of Defense Office of Inspector General publishes audit
// reports, evaluations, investigations, and inspections. These are
// internal-audit findings (parallel to GAO reports, which are external
// to DoD). Highly relevant for defense BD: audit findings drive
// procurement changes and contractor reputation shifts.
//
// Default endpoint is the public Audit Reports RSS. URL is config-
// overridable (config.rssUrl) so operator can swap if the path changes.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

export const DEFAULT_RSS_URL = "https://www.dodig.mil/Reports/Audit-Reports/RSS/";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface DodOigRssItem {
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

export function parseDodOigFeed(xml: string): DodOigRssItem[] {
  const items: DodOigRssItem[] = [];
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

export async function fetchDodOigFeed(rssUrl: string, log?: Logger): Promise<DodOigRssItem[]> {
  await acquireTokens("dod_oig", 1);
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
        `DoD OIG RSS fetch failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as any).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };
  const xml = await withRetry(op, {
    source: "dod_oig",
    operationName: "fetch_dod_oig",
    log,
  });
  return parseDodOigFeed(xml);
}

/** Extract DoD IG report number (e.g., "DODIG-2024-105") from title/guid/link. */
export function extractDodOigReportId(item: DodOigRssItem): string | null {
  const pattern = /\bDODIG-\d{4}-\d{2,4}[A-Z]?\b/i;
  const m = item.title.match(pattern) || item.guid.match(pattern) || item.link.match(pattern);
  return m ? m[0].toUpperCase() : null;
}

/** Classify report kind from title/categories. */
export function classifyReportKind(item: DodOigRssItem):
  | "audit"
  | "evaluation"
  | "investigation"
  | "inspection"
  | "other" {
  const haystack = (
    (item.title || "") +
    " " +
    (item.categories || []).join(" ")
  ).toLowerCase();
  if (haystack.indexOf("audit") >= 0) return "audit";
  if (haystack.indexOf("evaluation") >= 0) return "evaluation";
  if (haystack.indexOf("investigation") >= 0) return "investigation";
  if (haystack.indexOf("inspection") >= 0) return "inspection";
  return "other";
}
