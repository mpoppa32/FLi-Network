// DoD News Contracts — HTML parser
//
// Per award-integration-v1 Part Three §4: extract structured announcement
// fields from the daily Contracts page paragraphs. Regex-based; defensive
// against format variations (modifications, JVs, multi-awards, FMS,
// classified).
//
// Each parsed announcement carries a confidence score 0.0-1.0. If overall
// confidence < CONFIDENCE_FLOOR, the announcement is flagged for operator
// review rather than auto-creating a provisional Award.

export const CONFIDENCE_FLOOR = 0.6;

export interface ParsedAnnouncement {
  /** The full original paragraph text */
  rawText: string;
  /** Service-of-record from the nearest section heading (e.g., "ARMY") */
  serviceOfRecord?: string;
  /** Approximate publication date (parsed from the page heading) */
  publishedDate?: number;
  /** Company name (typically before first comma) */
  companyName: string;
  /** Location (City, State) typically between first comma and ( */
  location?: string;
  /** PIID extracted from parentheses */
  piid: string;
  /** Dollar value extracted from $-prefixed token */
  dollarValue: number;
  /** Free-text description (clause from "for" onward) */
  description: string;
  /** Contracting authority (clause ending "is the contracting activity") */
  contractingAuthority?: string;
  /** Place of performance (clause matching "Work will be performed in {LOCATION}") */
  placeOfPerformance?: string;
  /** Estimated completion date if extractable */
  estimatedCompletionDate?: number;
  /** True if this paragraph announces a modification, not a new award */
  isModification: boolean;
  /** Modification number if isModification (e.g., 'P00012') */
  modificationNumber?: string;
  /** True if this paragraph is one of a multi-award announcement */
  isMultiAward: boolean;
  /** Overall extraction confidence 0.0-1.0 */
  confidence: number;
  /** Flags noting what was uncertain */
  flags: string[];
}

const PIID_REGEX = /\b([A-Z0-9]{2,}-?[A-Z0-9]{1,}-?\d{2}-?[A-Z]-?\d{4,}|[A-Z]{1,}\d{2,}[A-Z]\d{4,})\b/;
const PIID_FALLBACK_REGEX = /\(([A-Z0-9\-]{6,})\)/;
const DOLLAR_REGEX = /\$\s?([0-9][0-9,]*(?:\.\d+)?)\s*(million|billion)?/i;
const MOD_REGEX = /\bmodification\b(?:[^.]*\b([PA]\d{4,5})\b)?/i;
const COMPLETION_REGEX = /(?:expected to be completed|completion date)[^.,]*(?:by|on|in)?\s+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i;
const PLACE_OF_PERFORMANCE_REGEX = /Work will be performed (?:in|at)\s+([^.]+?)(?:\.|,?\s+and is expected)/i;
const CONTRACTING_AUTHORITY_REGEX = /([A-Z][^.]*?)\s+is the contracting activity/i;
const FMS_REGEX = /\bforeign military sales?\b/i;
const CLASSIFIED_REGEX = /\bclassified\b/i;

const SERVICE_HEADINGS = [
  "ARMY",
  "NAVY",
  "AIR FORCE",
  "SPACE FORCE",
  "MARINE CORPS",
  "DEFENSE LOGISTICS AGENCY",
  "MISSILE DEFENSE AGENCY",
  "U.S. SPECIAL OPERATIONS COMMAND",
  "U.S. TRANSPORTATION COMMAND",
  "DEFENSE INFORMATION SYSTEMS AGENCY",
  "DEFENSE ADVANCED RESEARCH PROJECTS AGENCY",
  "DEFENSE HEALTH AGENCY",
  "DEFENSE COUNTERINTELLIGENCE AND SECURITY AGENCY",
  "DEFENSE THREAT REDUCTION AGENCY",
  "DEFENSE FINANCE AND ACCOUNTING SERVICE",
  "WASHINGTON HEADQUARTERS SERVICES",
];

function stripHtml(html: string): string {
  // Conservative tag-strip; preserve paragraph breaks
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h\d|li|tr)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDollarValue(text: string): number {
  const m = text.match(DOLLAR_REGEX);
  if (!m) return 0;
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return 0;
  const unit = (m[2] || "").toLowerCase();
  if (unit === "million") return num * 1_000_000;
  if (unit === "billion") return num * 1_000_000_000;
  return num;
}

function parseCompletionDate(text: string): number | undefined {
  const m = text.match(COMPLETION_REGEX);
  if (!m) return undefined;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : undefined;
}

function parsePiid(text: string): { piid: string; method: "primary" | "fallback" | "none" } {
  // Look inside first parentheses
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inside = parenMatch[1];
    const piidMatch = inside.match(PIID_REGEX);
    if (piidMatch) return { piid: piidMatch[1], method: "primary" };
    // Fallback: if the contents look ID-ish (uppercase + digits + dashes)
    if (/^[A-Z0-9\-]{6,}$/.test(inside.trim())) {
      return { piid: inside.trim(), method: "fallback" };
    }
  }
  // Last resort: any PIID-like token in the paragraph
  const free = text.match(PIID_REGEX);
  if (free) return { piid: free[1], method: "fallback" };
  return { piid: "", method: "none" };
}

function parseModification(text: string): { isModification: boolean; modificationNumber?: string } {
  const m = text.match(MOD_REGEX);
  if (!m) return { isModification: false };
  return { isModification: true, modificationNumber: m[1] };
}

function detectMultiAward(text: string): boolean {
  // Multi-award patterns: "Company1 (PIID1), Company2 (PIID2), and Company3 (PIID3)"
  const piids = text.match(/\([A-Z0-9\-]{6,}\)/g) || [];
  return piids.length >= 2;
}

function parseCompanyAndLocation(text: string): { company: string; location?: string } {
  // First comma splits company from location; first opening paren ends location
  const parenIdx = text.indexOf("(");
  const segment = parenIdx > 0 ? text.slice(0, parenIdx).trim() : text.slice(0, 200);
  const commaIdx = segment.indexOf(",");
  if (commaIdx < 0) {
    return { company: segment.trim().replace(/,$/, "") };
  }
  const company = segment.slice(0, commaIdx).trim();
  const location = segment.slice(commaIdx + 1).trim().replace(/,$/, "");
  return { company, location: location || undefined };
}

/**
 * Parse one paragraph into an Announcement record. Returns null if the
 * paragraph isn't recognizable as an announcement (no dollar value AND
 * no PIID-like token).
 */
export function parseParagraph(
  paragraph: string,
  context: { serviceOfRecord?: string; publishedDate?: number } = {}
): ParsedAnnouncement | null {
  const text = paragraph.trim();
  if (!text || text.length < 40) return null;

  const dollarValue = parseDollarValue(text);
  const { piid, method: piidMethod } = parsePiid(text);

  // If neither dollar nor PIID — not an announcement
  if (dollarValue === 0 && !piid) return null;

  const { isModification, modificationNumber } = parseModification(text);
  const isMultiAward = detectMultiAward(text);
  const { company, location } = parseCompanyAndLocation(text);

  // Description: text after "for " up to next period
  let description = "";
  const forMatch = text.match(/\bfor\s+([^.]+?)\./);
  if (forMatch) description = forMatch[1].trim().slice(0, 500);

  const contractingMatch = text.match(CONTRACTING_AUTHORITY_REGEX);
  const placeMatch = text.match(PLACE_OF_PERFORMANCE_REGEX);

  // Compute confidence — additive
  const flags: string[] = [];
  let confidence = 0;
  if (company) confidence += 0.15; else flags.push("no_company");
  if (location) confidence += 0.10;
  if (piid) {
    confidence += piidMethod === "primary" ? 0.30 : 0.15;
    if (piidMethod === "fallback") flags.push("piid_fallback_match");
  } else {
    flags.push("no_piid");
  }
  if (dollarValue > 0) confidence += 0.20; else flags.push("no_dollar");
  if (description) confidence += 0.15;
  if (contractingMatch) confidence += 0.05;
  if (placeMatch) confidence += 0.05;

  // Penalty for parse hazards
  if (CLASSIFIED_REGEX.test(text)) flags.push("classified_content");
  if (FMS_REGEX.test(text)) flags.push("fms_notification");
  if (isMultiAward) flags.push("multi_award_paragraph");
  if (text.length > 1500) {
    confidence -= 0.1;
    flags.push("unusually_long_paragraph");
  }

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    rawText: text.slice(0, 2000),
    serviceOfRecord: context.serviceOfRecord,
    publishedDate: context.publishedDate,
    companyName: company || "Unknown",
    location,
    piid: piid || "",
    dollarValue,
    description,
    contractingAuthority: contractingMatch ? contractingMatch[1].trim().slice(0, 200) : undefined,
    placeOfPerformance: placeMatch ? placeMatch[1].trim().slice(0, 200) : undefined,
    estimatedCompletionDate: parseCompletionDate(text),
    isModification,
    modificationNumber,
    isMultiAward,
    confidence,
    flags,
  };
}

/**
 * Parse a full DoD News Contracts page. Walks the HTML splitting on
 * paragraph breaks, tracks the current service heading as context,
 * returns all valid announcements found.
 */
export function parsePage(html: string, fallbackPublishedDate?: number): ParsedAnnouncement[] {
  const text = stripHtml(html);
  const paragraphs = text.split(/\n{2,}/);
  let serviceOfRecord: string | undefined;
  let publishedDate: number | undefined = fallbackPublishedDate;

  // Heading like "Contracts for May 16, 2026" or "Contracts For May 16, 2026"
  const headingMatch = text.match(/Contracts\s+[Ff]or\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/);
  if (headingMatch) {
    const t = Date.parse(headingMatch[1]);
    if (Number.isFinite(t)) publishedDate = t;
  }

  const announcements: ParsedAnnouncement[] = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    // Section heading detection
    const upper = trimmed.toUpperCase();
    for (const heading of SERVICE_HEADINGS) {
      if (upper === heading || upper.startsWith(heading + "\n") || (upper.length < heading.length + 6 && upper.includes(heading))) {
        serviceOfRecord = heading;
        break;
      }
    }
    // Skip if it looks like a heading (short, all-caps)
    if (trimmed.length < 80 && /^[A-Z\s.,'\-]+$/.test(trimmed)) continue;

    const parsed = parseParagraph(trimmed, { serviceOfRecord, publishedDate });
    if (parsed) announcements.push(parsed);
  }
  return announcements;
}
