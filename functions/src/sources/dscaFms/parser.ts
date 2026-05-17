// DSCA FMS — HTML parser
//
// Per tier2-previews-v1 T2-2: extracts FMS notification entries from the
// dsca.mil major-arms-sales listing page. Each notification typically has:
//   - Country (foreign purchaser)
//   - Platform/system name
//   - Dollar value (sometimes range)
//   - Prime contractor
//   - MDE (Major Defense Equipment) designation
//   - Notification date
//   - Transmittal number (T-N format)
//   - Article URL
//
// The HTML structure varies; we use a defensive regex-based extractor.
// Each parsed notification carries a confidence score; low-confidence
// entries are flagged for operator review rather than auto-creating
// Signals.

export const CONFIDENCE_FLOOR = 0.55;

export interface ParsedFmsNotification {
  rawText: string;
  /** Transmittal number (e.g., "23-50") if extractable */
  transmittalNumber?: string;
  /** Notification date (epoch ms) if extractable */
  notificationDate?: number;
  /** Foreign country (purchaser) */
  country: string;
  /** Platform name (system/equipment) */
  platform: string;
  /** Dollar value in USD; 0 if not extractable */
  dollarValue: number;
  /** Prime contractor name */
  primeContractor?: string;
  /** Major Defense Equipment designation */
  isMde?: boolean;
  /** Deep-link URL to the notification's detail page */
  detailUrl?: string;
  /** Overall extraction confidence 0.0-1.0 */
  confidence: number;
  flags: string[];
}

const DOLLAR_REGEX = /\$\s?([0-9][0-9,]*(?:\.\d+)?)\s*(million|billion)?/i;
const TRANSMITTAL_REGEX = /\bTransmittal\s+(?:No\.?|Number)?\s*([0-9]{2}-[0-9]{1,3})\b/i;
const DATE_REGEX = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i;
const MDE_REGEX = /\bmajor\s+defense\s+equipment\b/i;

const KNOWN_COUNTRIES = [
  "Australia","Austria","Bahrain","Bangladesh","Belgium","Brazil","Bulgaria","Canada","Chile","Colombia","Croatia",
  "Czech Republic","Denmark","Egypt","Estonia","Finland","France","Germany","Greece","Hungary","India","Indonesia",
  "Iraq","Ireland","Israel","Italy","Japan","Jordan","Kazakhstan","Korea","Kuwait","Latvia","Lithuania","Luxembourg",
  "Malaysia","Mexico","Morocco","Netherlands","New Zealand","Norway","Oman","Pakistan","Peru","Philippines","Poland",
  "Portugal","Qatar","Romania","Saudi Arabia","Serbia","Singapore","Slovakia","Slovenia","South Korea","Spain",
  "Sweden","Switzerland","Taiwan","Thailand","Tunisia","Turkey","Ukraine","United Arab Emirates","United Kingdom","Vietnam"
];

const COMMON_PRIMES = [
  "Lockheed Martin","Boeing","Raytheon","Northrop Grumman","General Dynamics","L3Harris","RTX","Sikorsky","BAE Systems",
  "United Technologies","Pratt & Whitney","Rolls-Royce","Textron","Bell","General Atomics","Kratos","Aerojet Rocketdyne",
  "Honeywell","Collins Aerospace","Leidos","SAIC","Booz Allen","DRS","Elbit","CACI","ManTech","Palantir"
];

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h\d|li|tr|article|section)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
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

function parseDate(text: string): number | undefined {
  const m = text.match(DATE_REGEX);
  if (!m) return undefined;
  const t = Date.parse(m[0]);
  return Number.isFinite(t) ? t : undefined;
}

function detectCountry(text: string): string | null {
  for (const c of KNOWN_COUNTRIES) {
    const re = new RegExp(`\\b${c.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(text)) return c;
  }
  return null;
}

function detectPrime(text: string): string | null {
  for (const p of COMMON_PRIMES) {
    if (text.indexOf(p) >= 0) return p;
  }
  return null;
}

/**
 * Parse a single notification block (typically corresponds to one article
 * or list entry). Returns null if not recognizably an FMS notification.
 */
export function parseNotificationBlock(html: string, blockUrl?: string): ParsedFmsNotification | null {
  const text = stripHtml(html);
  if (!text || text.length < 80) return null;

  const dollarValue = parseDollarValue(text);
  const country = detectCountry(text);
  const transMatch = text.match(TRANSMITTAL_REGEX);
  const dateMs = parseDate(text);
  const isMde = MDE_REGEX.test(text);
  const primeContractor = detectPrime(text) || undefined;

  // Skip blocks without country + dollar — likely not an FMS announcement
  if (!country && dollarValue === 0) return null;

  // Heuristic: platform is often before "for" or in the title-like opening
  let platform = "(unspecified platform)";
  const platformMatch = text.match(/(?:notif(?:ication|ied)|approved|approval|sale of|for the (?:procurement|purchase) of)\s+([^.]{4,80})/i);
  if (platformMatch) platform = platformMatch[1].trim().slice(0, 200);

  const flags: string[] = [];
  let confidence = 0;
  if (country) confidence += 0.30; else flags.push("no_country");
  if (dollarValue > 0) confidence += 0.25; else flags.push("no_dollar");
  if (transMatch) confidence += 0.15;
  if (dateMs) confidence += 0.10;
  if (primeContractor) confidence += 0.10;
  if (platform !== "(unspecified platform)") confidence += 0.10;
  if (isMde) flags.push("mde_designated");

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    rawText: text.slice(0, 2000),
    transmittalNumber: transMatch ? transMatch[1] : undefined,
    notificationDate: dateMs,
    country: country || "(unspecified country)",
    platform,
    dollarValue,
    primeContractor,
    isMde,
    detailUrl: blockUrl,
    confidence,
    flags,
  };
}

/**
 * Parse the full listing page, extracting per-article snippets where
 * possible. DSCA's HTML pattern uses article/section elements containing
 * link summaries; we extract each link's surrounding paragraph as one
 * notification block.
 */
export function parseListingPage(html: string): ParsedFmsNotification[] {
  const items: ParsedFmsNotification[] = [];

  // Try to extract per-article blocks. Look for article/div wrappers with
  // links to /press-media/major-arms-sales/ paths.
  const articlePattern = /<(?:article|div|li)[^>]*>([\s\S]*?)<\/(?:article|div|li)>/gi;
  let m: RegExpExecArray | null;
  const seenKeys = new Set<string>();

  while ((m = articlePattern.exec(html)) !== null) {
    const block = m[1];
    // Heuristic: block must mention "Major Arms" / "Foreign Military" / a country
    const lc = block.toLowerCase();
    if (
      lc.indexOf("major arms") < 0 &&
      lc.indexOf("foreign military") < 0 &&
      !KNOWN_COUNTRIES.some((c) => lc.indexOf(c.toLowerCase()) >= 0)
    ) {
      continue;
    }
    // Find link href in the block
    const hrefMatch = block.match(/href=["']([^"']+major-arms-sales[^"']+)["']/i);
    const url = hrefMatch
      ? hrefMatch[1].startsWith("http")
        ? hrefMatch[1]
        : "https://www.dsca.mil" + hrefMatch[1]
      : undefined;
    const parsed = parseNotificationBlock(block, url);
    if (!parsed) continue;
    const key = `${parsed.transmittalNumber || ""}::${parsed.country}::${parsed.dollarValue}::${parsed.platform.slice(0,40)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    items.push(parsed);
  }

  // Fallback: if article-pattern returned nothing, treat the full page as
  // one block (low-confidence but better than nothing)
  if (items.length === 0) {
    const single = parseNotificationBlock(html);
    if (single) items.push(single);
  }
  return items;
}
