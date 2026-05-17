// GAO Bid Protest source — decision text parser (v1.1)
//
// GAO decision PDFs follow a fairly stable structure:
//   - First page header: "B-XXXXXX[.X]" + "Matter of: {protestor}" + "File:"
//   - Solicitation block: "Solicitation No. XYZ" or "RFP No." / "RFQ No."
//   - "DIGEST" / "DECISION" section: the holding
//   - Findings discussing the awardee company by name
//   - Conclusion: "The protest is sustained / denied / dismissed"
//
// This parser uses defensive regexes against the normalized text from
// pdfExtractor.normalizeText. Each field returns null when not found.
// Outcomes / dates / corrective-action statements are the highest-value
// extractions for the BD operator; we surface confidence on each.

export type ProtestOutcome =
  | "sustained"
  | "denied"
  | "dismissed_full"
  | "dismissed_partial"
  | "withdrawn"
  | "settled"
  | null;

export interface ParsedDecision {
  outcome: ProtestOutcome;
  outcomeConfidence: number; // 0.0-1.0
  awardeeName: string | null;
  agencyName: string | null;
  solicitationNum: string | null;
  contractNum: string | null;
  filedAt: number | null;
  decidedAt: number | null;
  correctiveAction: string | null;
  reconsiderationOf: string | null;
  flags: string[];
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function parseDecisionText(text: string): ParsedDecision {
  const flags: string[] = [];

  if (text.length < 200) {
    flags.push("text_too_short");
  }

  const outcome = detectOutcome(text);
  const awardeeName = extractAwardee(text);
  const agencyName = extractAgency(text);
  const solicitationNum = extractSolicitationNumber(text);
  const contractNum = extractContractNumber(text);
  const filedAt = extractFiledDate(text);
  const decidedAt = extractDecisionDate(text);
  const correctiveAction = extractCorrectiveAction(text);
  const reconsiderationOf = extractReconsiderationOf(text);

  if (!outcome.outcome) flags.push("no_outcome_detected");
  if (!solicitationNum && !contractNum) flags.push("no_solicitation_or_contract_number");

  return {
    outcome: outcome.outcome,
    outcomeConfidence: outcome.confidence,
    awardeeName,
    agencyName,
    solicitationNum,
    contractNum,
    filedAt,
    decidedAt,
    correctiveAction,
    reconsiderationOf,
    flags,
  };
}

/**
 * Outcome detection: scan the last ~3000 chars (where the conclusion lives)
 * for distinctive verbs. Returns the strongest match with a confidence
 * scaled by signal strength.
 */
function detectOutcome(text: string): { outcome: ProtestOutcome; confidence: number } {
  const tail = text.slice(Math.max(0, text.length - 4000)).toLowerCase();
  const head = text.slice(0, 2000).toLowerCase();
  const all = text.toLowerCase();

  // Strong sustained signals
  if (
    /\bthe protest is sustained\b/.test(tail) ||
    /\bwe sustain the protest\b/.test(tail) ||
    /\bsustain (?:the )?protest\b/.test(tail)
  ) {
    return { outcome: "sustained", confidence: 0.95 };
  }
  // Sometimes partial sustains
  if (/\bsustained in part(?: and denied in part)?\b/.test(tail)) {
    return { outcome: "sustained", confidence: 0.85 };
  }
  // Withdrawn
  if (
    /\bthe protest is withdrawn\b/.test(tail) ||
    /\bprotest(?:er|or)?\s+withdrew\s+(?:its|the)\s+protest\b/.test(all)
  ) {
    return { outcome: "withdrawn", confidence: 0.9 };
  }
  // Settled / corrective action moot dismissals
  if (
    /\bdismissed as academic\b/.test(tail) ||
    /\brender(?:ed|s) the protest academic\b/.test(tail) ||
    /\bmoot in light of\b/.test(tail)
  ) {
    return { outcome: "settled", confidence: 0.85 };
  }
  // Dismissed (partial vs full)
  if (/\bdismissed in part(?: and denied in part)?\b/.test(tail)) {
    return { outcome: "dismissed_partial", confidence: 0.85 };
  }
  if (
    /\bthe protest is dismissed\b/.test(tail) ||
    /\bwe dismiss the protest\b/.test(tail) ||
    /\bprotest is dismissed\b/.test(tail)
  ) {
    return { outcome: "dismissed_full", confidence: 0.9 };
  }
  // Denied (most common GAO outcome historically)
  if (
    /\bthe protest is denied\b/.test(tail) ||
    /\bwe deny the protest\b/.test(tail) ||
    /\bdeny the protest\b/.test(tail)
  ) {
    return { outcome: "denied", confidence: 0.9 };
  }
  // Weaker fallbacks scanned over whole doc
  if (/\bprotest sustained\b/.test(all)) return { outcome: "sustained", confidence: 0.6 };
  if (/\bprotest denied\b/.test(all)) return { outcome: "denied", confidence: 0.6 };
  if (/\bprotest dismissed\b/.test(all)) return { outcome: "dismissed_full", confidence: 0.6 };
  // Head-of-doc digest signal
  if (/\bdigest\b/.test(head)) {
    // Sometimes the digest reveals the outcome
    if (/\bsustain\w*/.test(head.slice(0, 1500))) return { outcome: "sustained", confidence: 0.55 };
    if (/\bdeni\w*/.test(head.slice(0, 1500))) return { outcome: "denied", confidence: 0.55 };
    if (/\bdismiss\w*/.test(head.slice(0, 1500))) return { outcome: "dismissed_full", confidence: 0.55 };
  }
  return { outcome: null, confidence: 0 };
}

/**
 * The awardee company is usually named in the digest and in the findings.
 * Common phrasing: "X, of {city}, {state}, the awardee", "in favor of X",
 * "to award the contract to X", "X (awardee)".
 */
function extractAwardee(text: string): string | null {
  // Pattern A: "the awardee, X" or "X, the awardee"
  let m = text.match(/\bthe awardee,?\s+([A-Z][A-Za-z0-9 &.,'\-]{2,80}?)(?:[,.]|\s+of\s+)/);
  if (m && m[1]) return cleanCompanyName(m[1]);
  m = text.match(/\b([A-Z][A-Za-z0-9 &.,'\-]{2,80}?)\s*,?\s*the awardee\b/);
  if (m && m[1]) return cleanCompanyName(m[1]);
  // Pattern B: "award to X" / "awarded the contract to X"
  m = text.match(/\bawarded?\s+(?:a |the )?(?:contract|task order|delivery order)\s+to\s+([A-Z][A-Za-z0-9 &.,'\-]{2,80}?)(?:[,.;]|\s+(?:of|under)\b)/);
  if (m && m[1]) return cleanCompanyName(m[1]);
  // Pattern C: "made award to X"
  m = text.match(/\bmade award to\s+([A-Z][A-Za-z0-9 &.,'\-]{2,80}?)(?:[,.;]|\s+of\b)/);
  if (m && m[1]) return cleanCompanyName(m[1]);
  // Pattern D: "X was selected for award"
  m = text.match(/\b([A-Z][A-Za-z0-9 &.,'\-]{2,80}?)\s+was selected for award\b/);
  if (m && m[1]) return cleanCompanyName(m[1]);
  return null;
}

/**
 * Agency is usually in the digest or right at the top under "Procuring Agency"
 * or appears as "Department of X" / "{branch}" / etc.
 */
function extractAgency(text: string): string | null {
  // Pattern A: "Procuring Agency: X" (sometimes appears in a header table)
  let m = text.match(/Procuring Agency[:\-\s]+([A-Z][A-Za-z0-9 &.,'\-]{3,100}?)(?:\n|;|\.|,\s+(?:by|of))/);
  if (m && m[1]) return cleanAgencyName(m[1]);
  // Pattern B: "issued by the {Agency}" — common in solicitation references
  m = text.match(/\bissued by the\s+((?:Department|Office|Bureau|Defense|Naval|Army|Air Force|Marine Corps|Space Force|Coast Guard)[^.,;\n]{3,120}?)(?:[.,;\n])/);
  if (m && m[1]) return cleanAgencyName(m[1]);
  // Pattern C: explicit DoD branches
  m = text.match(/\b(Department of (?:Defense|the Army|the Navy|the Air Force|Veterans Affairs|Homeland Security|State|Energy|Justice|Health and Human Services|Commerce|Transportation|the Interior|the Treasury|Agriculture|Education|Housing and Urban Development|Labor))\b/);
  if (m && m[1]) return m[1];
  m = text.match(/\b(Defense (?:Logistics Agency|Information Systems Agency|Threat Reduction Agency|Health Agency|Intelligence Agency|Counterintelligence and Security Agency|Contract Management Agency|Finance and Accounting Service))\b/);
  if (m && m[1]) return m[1];
  m = text.match(/\b(General Services Administration|National Aeronautics and Space Administration|Federal Aviation Administration|Federal Bureau of Investigation|Central Intelligence Agency|National Security Agency)\b/);
  if (m && m[1]) return m[1];
  return null;
}

/**
 * Solicitation number patterns vary widely. Common forms:
 *   "Solicitation No. W912DY-24-R-0023"
 *   "RFP No. N00024-25-R-1234"
 *   "RFQ No. SP4701-23-Q-9999"
 *   "Request for Proposals No. ..."
 */
function extractSolicitationNumber(text: string): string | null {
  const patterns = [
    /\b(?:Solicitation|RFP|RFQ|IFB|Request for Proposals|Request for Quotations|Request for Quotes|Request for Information)\s*(?:Nos?\.?|number)\s*([A-Z0-9][A-Z0-9\-\.]{4,40}[A-Z0-9])/i,
    /\bsolicitation\s+([A-Z0-9]{2,}[A-Z0-9\-]{5,40})\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].replace(/[.,]$/, "").trim();
  }
  return null;
}

/**
 * Contract number patterns:
 *   "Contract No. N00024-23-C-5500"
 *   "task order TO-23-001"
 */
function extractContractNumber(text: string): string | null {
  const patterns = [
    /\bContract\s*(?:Nos?\.?|number)\s*([A-Z0-9][A-Z0-9\-\.]{4,40}[A-Z0-9])/i,
    /\bTask Order\s*(?:Nos?\.?|number)?\s*([A-Z0-9][A-Z0-9\-\.]{2,40}[A-Z0-9])/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].replace(/[.,]$/, "").trim();
  }
  return null;
}

/**
 * Filed-date phrasing: "filed a protest on Month Day, Year"
 */
function extractFiledDate(text: string): number | null {
  const m = text.match(/\bfiled (?:a |the |its )?protest(?:\s+(?:with (?:our|this) Office|with GAO))?\s+on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
  if (m && m[1]) return parseLongDate(m[1]);
  const m2 = text.match(/\bprotest (?:was )?filed (?:with [A-Za-z ]+ )?on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
  if (m2 && m2[1]) return parseLongDate(m2[1]);
  return null;
}

/**
 * Decision-date phrasing: GAO decisions are commonly dated at the very top
 * of the document as "Decided: Month Day, Year" or appear in the header
 * block with the docket number.
 */
function extractDecisionDate(text: string): number | null {
  const head = text.slice(0, 1500);
  const m = head.match(/\bDecided[:\s]+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
  if (m && m[1]) return parseLongDate(m[1]);
  // Some decisions just have the date below the docket line
  const m2 = head.match(/\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/);
  if (m2 && m2[1]) return parseLongDate(m2[1]);
  return null;
}

/**
 * Corrective action: typically a one-sentence statement of what the agency
 * agreed to do. Worth surfacing verbatim (operator can act on it).
 */
function extractCorrectiveAction(text: string): string | null {
  // Pattern A: "agency took corrective action" + the following sentence(s)
  const m = text.match(
    /\b(?:agency|Agency|agency\s+\w+)\s+(?:took|takes|advised|notified|will take|has taken)\s+corrective action[^.]{0,400}\./
  );
  if (m && m[0]) return collapseWhitespace(m[0]).slice(0, 600);
  // Pattern B: "we recommend that the agency"
  const m2 = text.match(/\bwe recommend that the agency[^.]{5,400}\./);
  if (m2 && m2[0]) return collapseWhitespace(m2[0]).slice(0, 600);
  return null;
}

/**
 * Reconsideration / supplemental protests reference the parent docket
 * (e.g., "B-420123.2" reconsiders "B-420123").
 */
function extractReconsiderationOf(text: string): string | null {
  const m = text.match(
    /\b(?:reconsideration of|reconsider(?:ing|ation)\s+(?:of\s+)?(?:our|the))[^.]*?\b(B-\d{5,7})\b/i
  );
  if (m && m[1]) return m[1];
  return null;
}

function parseLongDate(s: string): number | null {
  const parts = s.replace(",", "").trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const monthIdx = MONTH_NAMES.indexOf(parts[0].toLowerCase());
  if (monthIdx < 0) return null;
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;
  const d = new Date(Date.UTC(year, monthIdx, day));
  return d.getTime();
}

function cleanCompanyName(s: string): string {
  return collapseWhitespace(s)
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9.\-)]+$/, "")
    .slice(0, 120);
}

function cleanAgencyName(s: string): string {
  return collapseWhitespace(s)
    .replace(/[.,;]\s*$/, "")
    .slice(0, 120);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
