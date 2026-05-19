// Plum Book / FVRA — index page HTML walker
//
// The GAO FVRA index page (https://www.gao.gov/legal/other-legal-work/
// federal-vacancies-reform-act) links to annual + interim vacancy reports
// as PDF anchors. v1.0 walks the anchors, classifies each by filename
// pattern, and returns candidate report records for the orchestrator to
// fetch + parse.
//
// Pattern C (PDF-heavy extraction) — reuses framework/pdfExtractor.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";
const SOURCE_KEY = "plum_book";

export interface VacancyReportCandidate {
  /** Absolute URL of the PDF. */
  url: string;
  /** Filename (last path segment). */
  filename: string;
  /** Anchor text as it appears on the index page. */
  anchorText: string;
  /** Best-effort detected report date (publication or coverage start). */
  reportDateMs: number;
  /** Heuristic: does the title look like a vacancy report (vs. a
   *  thematic FVRA legal opinion or congressional testimony)? */
  isVacancyReport: boolean;
  /** Stable id for hash + dedupe. */
  guid: string;
}

async function fetchHtml(url: string, log?: Logger): Promise<string> {
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
          `Plum Book/FVRA index fetch failed: HTTP ${r.status} ${url}`
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
    operationName: "fetch_plum_book_index",
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

/** Detect whether the anchor looks like a vacancy report vs. a thematic
 *  FVRA legal opinion. Vacancy reports usually carry keywords like
 *  "Vacancies", "Vacant Positions", "Acting Officials", or a year. */
function looksLikeVacancyReport(text: string): boolean {
  const lc = text.toLowerCase();
  if (/\bvacant\s+positions?\b/.test(lc)) return true;
  if (/\bacting\s+officials?\b/.test(lc)) return true;
  if (/\bdesignated\s+acting\b/.test(lc)) return true;
  if (/\bvacancies\s+(?:list|report|in)\b/.test(lc)) return true;
  if (/\bfederal\s+vacancies\b/.test(lc)) return true;
  // Year suffix typical of annual reports
  if (/\bfvra\s+20\d{2}\b/.test(lc)) return true;
  return false;
}

/** Best-effort report date detection. Annual reports usually carry their
 *  year prominently in the title. */
function detectReportDate(text: string): number {
  // "Month YYYY"
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (m) {
    const ms = Date.parse(`${m[1]} 1, ${m[2]} UTC`);
    if (Number.isFinite(ms)) return ms;
  }
  // "YYYY" alone — anchor to Jan 1
  const m2 = text.match(/\b(20\d{2})\b/);
  if (m2) {
    return Date.UTC(parseInt(m2[1], 10), 0, 1);
  }
  return 0;
}

const PDF_ANCHOR_RE = /<a\b([^>]*?)href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']([^>]*)>([\s\S]*?)<\/a>/gi;

export function parseIndex(html: string, baseUrl: string): VacancyReportCandidate[] {
  const out: VacancyReportCandidate[] = [];
  const seenUrls = new Set<string>();
  PDF_ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PDF_ANCHOR_RE.exec(html)) !== null) {
    const href = m[2];
    const inner = m[4];
    if (!href) continue;
    const absHref = absolutize(href, baseUrl);
    if (!absHref || seenUrls.has(absHref)) continue;
    seenUrls.add(absHref);
    const anchorText = stripHtml(inner);
    let filename = "";
    try {
      const u = new URL(absHref);
      filename = u.pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      filename = absHref.split("/").filter(Boolean).pop() || "";
    }
    const classifyText = filename + " " + anchorText;
    const isVacancyReport = looksLikeVacancyReport(classifyText);
    const reportDateMs = detectReportDate(classifyText);
    out.push({
      url: absHref,
      filename,
      anchorText: anchorText.slice(0, 300),
      reportDateMs,
      isVacancyReport,
      guid: "plum_book:" + absHref,
    });
  }
  return out;
}

export async function fetchIndex(
  url: string,
  log?: Logger
): Promise<VacancyReportCandidate[]> {
  const html = await fetchHtml(url, log);
  return parseIndex(html, url);
}
