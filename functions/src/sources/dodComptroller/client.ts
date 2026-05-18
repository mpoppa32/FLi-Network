// DoD Comptroller — budget materials index walker
//
// comptroller.defense.gov/Budget-Materials/ is a SharePoint-rendered index
// linking to service-specific budget-justification PDF collections. The
// page layout follows DoD's standard DefenseLink template: a content area
// with grouped <a href> elements, each pointing at either a PDF (book) or
// a sub-folder (a service's collection).
//
// v1.0 walks the index, classifies each link by:
//   - file extension (".pdf" => candidate book)
//   - filename pattern (looks for R-2 / R-2A / R-3 / P-1 / P-5 / P-40 /
//     O-1 / M-1 substrings; rejects non-budget PDFs like Volume-I
//     summaries — those are v1.1 narrative-only sources)
//   - service marker in filename / URL (army / navy / af / usmc / sf /
//     defense-wide patterns)
//   - fiscal year (looks for "fy20XX", "fy_20XX", "PB20XX", "PB_20XX",
//     "PB-20XX")
//
// PE-level extraction happens in budgetParser.ts on the fetched PDF text.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";
import type { BudgetBookType, ServiceSlug } from "./config";

const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";
const SOURCE_KEY = "dod_comptroller";

export interface BudgetBookCandidate {
  url: string;
  filename: string;
  bookType: BudgetBookType | null;
  service: ServiceSlug | null;
  fiscalYear: string | null;
  /** Anchor text as shown on the index, useful for human display when
   *  filename is opaque. */
  anchorText: string;
}

async function fetchHtml(url: string, log?: Logger): Promise<string> {
  await acquireTokens(SOURCE_KEY, 1);
  const op = async (): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
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
          `DoD Comptroller index fetch failed: HTTP ${r.status} ${url}`
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
    operationName: "fetch_budget_index",
    log,
  });
}

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

/** Detect book type from filename or anchor text. Order matters — R-2A
 *  is more specific than R-2, so check it first. */
function detectBookType(text: string): BudgetBookType | null {
  const u = text.toUpperCase();
  if (/\bR-?2A\b/.test(u) || /\bR2A\b/.test(u)) return "R-2A";
  if (/\bR-?3\b/.test(u) || /\bR3\b/.test(u)) return "R-3";
  if (/\bR-?2\b/.test(u) || /\bR2\b/.test(u)) return "R-2";
  if (/\bP-?40\b/.test(u) || /\bP40\b/.test(u)) return "P-40";
  if (/\bP-?5\b/.test(u) || /\bP5\b/.test(u)) return "P-5";
  if (/\bP-?1\b/.test(u) || /\bP1\b/.test(u)) return "P-1";
  if (/\bO-?1\b/.test(u) || /\bO1\b/.test(u)) return "O-1";
  if (/\bM-?1\b/.test(u) || /\bM1\b/.test(u)) return "M-1";
  return null;
}

function detectService(text: string): ServiceSlug | null {
  const u = text.toLowerCase();
  // Order: more specific first (marine_corps before navy if "marine" in name)
  if (/(marine[\s_-]?corps|usmc)/.test(u)) return "marine_corps";
  if (/(space[\s_-]?force|usspace|\bsf[\s_-])/.test(u)) return "space_force";
  if (/(air[\s_-]?force|usaf|\baf[\s_-]|\bdaf[\s_-])/.test(u)) return "air_force";
  if (/\bnavy\b|\bdon[\s_-]|\busn[\s_-]|department[\s_-]of[\s_-]the[\s_-]navy/.test(u)) return "navy";
  if (/\barmy\b|\bda[\s_-]|\busa[\s_-]|department[\s_-]of[\s_-]the[\s_-]army/.test(u)) return "army";
  if (/(defense[\s_-]?wide|osd|darpa|\bmda\b|\bdla\b|\bdisa\b|\bdtra\b|defense[\s_-]health)/.test(u)) return "defense_wide";
  return null;
}

function detectFiscalYear(text: string): string | null {
  // PB2026, PB_2026, PB-2026, FY2026, FY_2026, FY-2026
  const m = text.match(/\b(?:PB|FY|Budget)[\s_-]*(20\d{2})\b/i);
  if (m) return m[1];
  // Loose 4-digit year anywhere
  const m2 = text.match(/\b(20[2-3]\d)\b/);
  return m2 ? m2[1] : null;
}

const PDF_ANCHOR_RE = /<a\b([^>]*?)href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']([^>]*)>([\s\S]*?)<\/a>/gi;
const SUBINDEX_ANCHOR_RE = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;

/**
 * Parse PDF candidates out of an index HTML page. Returns one entry per
 * unique PDF anchor, classified by book type / service / FY.
 */
export function parseBudgetIndex(html: string, baseUrl: string): BudgetBookCandidate[] {
  const out: BudgetBookCandidate[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  PDF_ANCHOR_RE.lastIndex = 0;
  while ((m = PDF_ANCHOR_RE.exec(html)) !== null) {
    const href = m[2];
    if (!href) continue;
    const absHref = absolutize(href, baseUrl);
    if (!absHref || seen.has(absHref)) continue;
    seen.add(absHref);
    const anchorText = stripHtml(m[4]).slice(0, 300);
    // Filename = last path segment (without query string)
    let filename = "";
    try {
      const u = new URL(absHref);
      filename = u.pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      filename = absHref.split("/").filter(Boolean).pop() || "";
    }
    const classifyText = filename + " " + anchorText + " " + absHref;
    const bookType = detectBookType(classifyText);
    const service = detectService(classifyText);
    const fiscalYear = detectFiscalYear(classifyText);
    out.push({
      url: absHref,
      filename,
      bookType,
      service,
      fiscalYear,
      anchorText,
    });
  }
  return out;
}

/**
 * Find sub-index page URLs (links to service-specific landing pages that
 * link to the actual PDFs). The DoD Comptroller portal sometimes splits
 * R-2 books across per-service sub-pages.
 */
export function parseSubIndexLinks(
  html: string,
  baseUrl: string,
  maxDepth: number = 1
): string[] {
  if (maxDepth <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  SUBINDEX_ANCHOR_RE.lastIndex = 0;
  while ((m = SUBINDEX_ANCHOR_RE.exec(html)) !== null) {
    const href = m[2];
    if (!href) continue;
    if (/^(?:javascript:|mailto:|#|tel:)/i.test(href)) continue;
    if (/\.pdf(?:\?|$)/i.test(href)) continue; // PDFs handled separately
    if (!/(budget|comptroller|fy20|pb20|budget-materials)/i.test(href)) continue;
    const absHref = absolutize(href, baseUrl);
    if (!absHref || seen.has(absHref)) continue;
    // Don't follow external domains
    try {
      const u = new URL(absHref);
      if (!/comptroller\.defense\.gov$/i.test(u.hostname)) continue;
    } catch {
      continue;
    }
    seen.add(absHref);
    out.push(absHref);
  }
  return out;
}

export async function fetchBudgetIndex(
  url: string,
  log?: Logger
): Promise<BudgetBookCandidate[]> {
  const html = await fetchHtml(url, log);
  return parseBudgetIndex(html, url);
}

export async function fetchSubIndexLinks(
  url: string,
  log?: Logger
): Promise<string[]> {
  const html = await fetchHtml(url, log);
  return parseSubIndexLinks(html, url);
}

/**
 * Resolve the "latest" fiscal year on an index page by scanning all detected
 * PDFs + sub-index links and returning the highest 4-digit FY found.
 */
export function resolveLatestFiscalYear(candidates: BudgetBookCandidate[]): string | null {
  let max = 0;
  for (const c of candidates) {
    if (c.fiscalYear) {
      const n = parseInt(c.fiscalYear, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max > 0 ? String(max) : null;
}
