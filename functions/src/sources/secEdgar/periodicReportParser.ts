// SEC EDGAR — 10-K / 10-Q periodic report HTML parser (v1.2.1)
//
// SEC mandates section structure for periodic reports:
//   Part I — Item 1: Business
//          — Item 1A: Risk Factors
//          — Item 7: Management's Discussion and Analysis (MD&A)
//          — Item 7A: Quantitative and Qualitative Disclosures About Market Risk
//   Part II — Item 9A: Controls and Procedures
//   ...
//
// 10-Q filings use slightly different Item numbering but share the MD&A
// header pattern. We anchor on these mandated headings, then capture the
// first N paragraphs that follow.
//
// SEC documents are large (typical 10-K is 200-500KB of HTML; XBRL-tagged
// inline filings can exceed 1MB). The fetchFilingDoc caller is responsible
// for the 8MB cap; this parser trusts the input to be a reasonable size.
//
// HTML strip: SEC filings use <font> + <p> + <div> + sometimes inline-XBRL
// <ix:*> tags. We strip all tags conservatively — losing formatting is fine
// for the regex extractors. Tables (backlog disclosures) are converted to
// pipe-separated text so the dollar-amount regexes still hit.

const DEFENSE_BACKLOG_KEYWORDS = [
  "defense",
  "Defense Systems",
  "Defense and Space",
  "Defense Solutions",
  "National Security",
  "Space Systems",
  "Aeronautics",
  "Aerospace",
  "Mission Systems",
  "Intelligence",
];

export interface ParsedPeriodicReport {
  formType: string;
  mdaSnippet: string | null;
  mdaLength: number;
  riskFactorsSnippet: string | null;
  defenseSegmentSnippet: string | null;
  /** All extracted backlog mentions: snippet + numeric value + unit. */
  backlogMentions: Array<{
    snippet: string;
    valueUSD: number;
    isDefense: boolean;
  }>;
  /** Best-effort total backlog (largest "total backlog" hit). */
  backlogTotalUSD: number | null;
  /** Largest backlog mention tagged as defense. */
  backlogDefenseUSD: number | null;
  /** Distinct defense-related segment labels mentioned in MD&A. */
  defenseSegmentMentions: string[];
  flags: string[];
}

export interface PeriodicReportParseOptions {
  /** Max MD&A snippet chars. Default 4000. */
  maxMdaChars?: number;
  /** Max risk-factors snippet chars. Default 3000. */
  maxRiskFactorsChars?: number;
}

export function parsePeriodicReportHtml(
  html: string,
  formType: string,
  options: PeriodicReportParseOptions = {}
): ParsedPeriodicReport {
  const flags: string[] = [];
  const maxMda = options.maxMdaChars ?? 4000;
  const maxRf = options.maxRiskFactorsChars ?? 3000;

  if (html.length < 1000) {
    flags.push("doc_too_short");
  }

  // Normalize: strip XBRL inline tags, then all HTML tags, decode entities,
  // collapse whitespace but preserve paragraph breaks so section regexes hit.
  const text = normalizeHtml(html);

  const mda = extractMda(text, maxMda);
  const rf = extractRiskFactors(text, maxRf);
  const defenseSegment = extractDefenseSegment(text);
  const backlogMentions = extractBacklogMentions(text);
  const defenseSegmentMentions = extractDefenseSegmentMentions(text);

  if (!mda) flags.push("no_mda_section");
  if (backlogMentions.length === 0) flags.push("no_backlog_mention");

  // Aggregate: largest total + largest defense-tagged
  let backlogTotalUSD: number | null = null;
  let backlogDefenseUSD: number | null = null;
  for (const m of backlogMentions) {
    if (m.isDefense) {
      if (backlogDefenseUSD === null || m.valueUSD > backlogDefenseUSD) {
        backlogDefenseUSD = m.valueUSD;
      }
    } else {
      if (backlogTotalUSD === null || m.valueUSD > backlogTotalUSD) {
        backlogTotalUSD = m.valueUSD;
      }
    }
  }

  return {
    formType,
    mdaSnippet: mda,
    mdaLength: mda ? mda.length : 0,
    riskFactorsSnippet: rf,
    defenseSegmentSnippet: defenseSegment,
    backlogMentions,
    backlogTotalUSD,
    backlogDefenseUSD,
    defenseSegmentMentions,
    flags,
  };
}

/**
 * Strip HTML to plain text, preserving paragraph structure. Inline XBRL
 * tags (ix:nonNumeric, ix:nonFraction, etc.) are unwrapped — their
 * displayed text content survives.
 */
function normalizeHtml(html: string): string {
  let s = html;

  // Drop scripts + styles entirely
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

  // Convert <br> and </p> to newlines BEFORE stripping tags
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/div>/gi, "\n");
  s = s.replace(/<\/tr>/gi, "\n");
  s = s.replace(/<\/td>/gi, " | ");
  s = s.replace(/<\/h\d>/gi, "\n\n");

  // Strip all remaining tags
  s = s.replace(/<[^>]+>/g, " ");

  // Decode common entities
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));

  // Collapse whitespace
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/(?:[ \t]*\n[ \t]*){2,}/g, "\n\n");
  return s.trim();
}

/**
 * Extract MD&A section. Looks for "Item 7. Management's Discussion and
 * Analysis" or variants and grabs the body until the next Item heading.
 */
function extractMda(text: string, maxChars: number): string | null {
  // Try multiple heading variants
  const headingPatterns = [
    /\bItem\s*7\.?\s*Management(?:['’]s)?\s+Discussion\s+and\s+Analysis[^.\n]{0,200}/i,
    /\bManagement(?:['’]s)?\s+Discussion\s+and\s+Analysis\s+of\s+(?:Financial Condition|Operations)/i,
    /\bMD&A\b/i,
  ];

  for (const p of headingPatterns) {
    const m = p.exec(text);
    if (!m) continue;
    const startIdx = m.index + m[0].length;
    // Stop at the next Item heading (Item 7A, Item 8, Item 9, etc.)
    const stopPattern = /\bItem\s*(?:7A|8|9|9A|10|11|12)\b\.?/i;
    const tail = text.slice(startIdx);
    const stopMatch = stopPattern.exec(tail);
    let body = stopMatch ? tail.slice(0, stopMatch.index) : tail.slice(0, maxChars * 3);
    body = collapseWhitespace(body);
    if (body.length < 50) continue;
    if (body.length > maxChars) body = body.slice(0, maxChars).replace(/\s+\S*$/, "") + "…";
    return body;
  }
  return null;
}

/**
 * Extract Risk Factors snippet (Item 1A).
 */
function extractRiskFactors(text: string, maxChars: number): string | null {
  const headingPattern = /\bItem\s*1A\.?\s*Risk\s+Factors\b/i;
  const m = headingPattern.exec(text);
  if (!m) return null;
  const startIdx = m.index + m[0].length;
  const stopPattern = /\bItem\s*(?:1B|2|3|4|5|6|7)\b\.?/i;
  const tail = text.slice(startIdx);
  const stopMatch = stopPattern.exec(tail);
  let body = stopMatch ? tail.slice(0, stopMatch.index) : tail.slice(0, maxChars * 3);
  body = collapseWhitespace(body);
  if (body.length < 50) return null;
  if (body.length > maxChars) body = body.slice(0, maxChars).replace(/\s+\S*$/, "") + "…";
  return body;
}

/**
 * Find a defense-segment-related paragraph in the MD&A. Many defense
 * primes have a "Defense" / "Mission Systems" / "Defense Solutions"
 * named segment with quarterly numbers. This grabs the first ~1500 chars
 * surrounding a defense-keyword hit within the MD&A.
 */
function extractDefenseSegment(text: string): string | null {
  // Find MD&A region first
  const mdaMatch = /\bItem\s*7\b.*?\bMD&A\b|\bItem\s*7\.\s*Management/i.exec(text);
  const region = mdaMatch ? text.slice(mdaMatch.index, Math.min(text.length, mdaMatch.index + 60_000)) : text.slice(0, 60_000);
  for (const kw of DEFENSE_BACKLOG_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b[^.\\n]{20,1200}`, "i");
    const m = re.exec(region);
    if (m && m[0]) {
      return collapseWhitespace(m[0]).slice(0, 1500);
    }
  }
  return null;
}

/**
 * Extract backlog mentions with parsed dollar amounts.
 *
 * Common phrasings:
 *   "Total backlog at December 31, 2024 was $164.3 billion"
 *   "Backlog as of the end of the period was $42.5B"
 *   "Funded backlog: $12.3 billion"
 *   "Defense backlog stood at $89.4 billion"
 *
 * Returns each match + parsed USD value (always in dollars, not millions).
 */
function extractBacklogMentions(text: string): Array<{
  snippet: string;
  valueUSD: number;
  isDefense: boolean;
}> {
  const out: Array<{ snippet: string; valueUSD: number; isDefense: boolean }> = [];
  // Window-based scanner: find "backlog" hits, look ~250 chars around for
  // a dollar figure
  const backlogRe = /\bbacklog\b/gi;
  let m: RegExpExecArray | null;
  const seenValues = new Set<string>();
  while ((m = backlogRe.exec(text)) !== null) {
    const windowStart = Math.max(0, m.index - 100);
    const windowEnd = Math.min(text.length, m.index + 250);
    const window = text.slice(windowStart, windowEnd);
    const dollarMatch = window.match(
      /\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion|trillion|M|B|T)\b/i
    );
    if (!dollarMatch) continue;
    const num = parseFloat(dollarMatch[1].replace(/,/g, ""));
    const unit = dollarMatch[2].toLowerCase();
    let multiplier = 1;
    if (unit.startsWith("b")) multiplier = 1e9;
    else if (unit.startsWith("t")) multiplier = 1e12;
    else multiplier = 1e6;
    const valueUSD = num * multiplier;
    if (!Number.isFinite(valueUSD) || valueUSD <= 0) continue;
    const isDefense = /\b(?:defense|mission systems|space systems|national security|intelligence|aeronautics|aerospace)\b/i.test(window);
    const snippet = collapseWhitespace(window).slice(0, 280);
    const key = `${Math.round(valueUSD)}-${snippet.slice(0, 40)}`;
    if (seenValues.has(key)) continue;
    seenValues.add(key);
    out.push({ snippet, valueUSD, isDefense });
    if (out.length >= 8) break;
  }
  return out;
}

function extractDefenseSegmentMentions(text: string): string[] {
  const found = new Set<string>();
  const segmentPatterns = [
    /\b(Defense\s+(?:and\s+Space|Systems|Solutions|Electronics|Services|Operations))\b/g,
    /\b(Mission\s+Systems)\b/g,
    /\b(Space\s+Systems)\b/g,
    /\b(Aeronautics(?:\s+Systems)?)\b/g,
    /\b(Aerospace\s+(?:Systems|Solutions))\b/g,
    /\b(Maritime\s+Systems)\b/g,
    /\b(Sensors\s+(?:and\s+)?Effects)\b/g,
    /\b(Communication\s+Systems)\b/g,
    /\b(Land\s+Systems)\b/g,
    /\b(National\s+Security\s+(?:Group|Sector|Solutions))\b/g,
  ];
  for (const p of segmentPatterns) {
    let mm: RegExpExecArray | null;
    while ((mm = p.exec(text)) !== null) {
      if (mm[1]) found.add(collapseWhitespace(mm[1]));
      if (found.size >= 15) break;
    }
  }
  return Array.from(found);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
