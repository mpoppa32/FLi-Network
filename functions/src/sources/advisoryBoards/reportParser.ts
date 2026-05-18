// Advisory Boards — report PDF text parser (v1.0)
//
// DSB / DBB / DIB reports share a loose structural template but no
// SEC-mandated headings (unlike GAO audit reports). The parser is
// best-effort against the conventions these boards actually use:
//   - Cover page: title + date + board name + sometimes "Report of the ..."
//   - Executive Summary / Findings section
//   - Recommendations (often numbered: "Recommendation 1:", "We recommend that ...")
//   - Programs mentioned by name (curated keyword list, shared with gaoReports
//     pattern)
//   - Defense contractors mentioned (curated prime list)
//   - Members listed on the cover or in an appendix (Person resolution
//     deferred to v1.1 — name extraction is noisier than program/contractor
//     extraction)

const PROGRAM_KEYWORDS = [
  // Air Force / Space
  "F-35", "F-22", "F-15EX", "B-21", "B-2", "B-52", "KC-46", "KC-135",
  "C-17", "C-130", "T-7", "CCA", "NGAD", "Sentinel", "Minuteman III",
  "ICBM", "GBSD", "SBIRS", "GPS III", "Next Generation OPIR",
  // Navy
  "Columbia", "Virginia-class", "Ohio-class", "Ford-class",
  "Constellation", "DDG-51", "DDG(X)", "FFG(X)", "SSN(X)",
  "Trident II", "Tomahawk", "Standard Missile", "AEGIS",
  // Army
  "M1 Abrams", "Stryker", "Bradley", "Paladin", "AMPV", "OMFV", "ITEP",
  "FLRAA", "FARA", "Patriot", "THAAD", "IFPC", "JLTV", "Apache",
  // Joint / multi-service / advisory-board frequent topics
  "JADC2", "ABMS", "Project Convergence", "Project Overmatch",
  "Hypersonic", "Long Range Hypersonic Weapon", "LRHW",
  "Replicator", "CCA Increment 1", "Loyal Wingman",
  "DARPA", "DIU", "AFWERX", "SOFWERX", "NavalX",
  // Capability themes these boards explicitly own
  "industrial base", "supply chain", "software acquisition",
  "AI", "machine learning", "autonomous systems",
  "directed energy", "directed-energy weapons",
  "quantum", "biotechnology", "microelectronics",
  "5G", "open architecture", "modular open systems",
  "JCIDS", "PPBE", "PPBE reform", "middle tier acquisition",
];

const CONTRACTOR_PATTERNS = [
  /\bLockheed Martin\b/i,
  /\bNorthrop Grumman\b/i,
  /\bRaytheon(?: Technologies)?\b/i,
  /\bRTX\b/,
  /\bGeneral Dynamics\b/i,
  /\bBoeing\b/i,
  /\bL3Harris\b/i,
  /\bLeidos\b/i,
  /\bBooz Allen( Hamilton)?\b/i,
  /\bCACI(?: International)?\b/i,
  /\bSAIC\b/,
  /\bParsons\b/i,
  /\bKBR\b/,
  /\bManTech\b/i,
  /\bPalantir\b/i,
  /\bKratos\b/i,
  /\bAeroVironment\b/i,
  /\bHII\b/,
  /\bHuntington Ingalls(?: Industries)?\b/i,
  /\bBAE Systems\b/i,
  /\bGeneral Atomics\b/i,
  /\bAnduril\b/i,
  /\bShield AI\b/i,
  /\bSpaceX\b/i,
  /\bRocket Lab\b/i,
  /\bSierra Nevada(?: Corporation)?\b/i,
  /\bPeraton\b/i,
  /\bScience Applications International\b/i,
];

export type AdvisoryReportKind = "study" | "memo" | "annual_report" | "letter" | "report";

/** v1.1: detected board member with best-effort honorific + role split. */
export interface ParsedAdvisoryBoardMember {
  /** Cleaned display name (no honorifics). */
  name: string;
  /** Honorific from the source line if present ("Dr.", "Hon.", "Gen.",
   *  "Adm.", "Amb.", "RDML", "Lt Gen", etc.). */
  honorific: string | null;
  /** Role/title clause when the source line carries one ("Chair",
   *  "Vice Chair", "Member", "Task Force Lead"). */
  role: string | null;
  /** Affiliation parsed from the source line ("Lockheed Martin",
   *  "Brookings Institution", "MIT") when it appears after a comma or
   *  dash. */
  affiliation: string | null;
}

export interface ParsedAdvisoryReport {
  title: string | null;
  reportKind: AdvisoryReportKind;
  /** Best-effort date pulled from the cover page. */
  decidedAt: number | null;
  /** Board self-reference detected in the body — "Defense Science Board",
   *  "Defense Business Board", "Defense Innovation Board". */
  boardSelfReference: string | null;
  /** Bullets/findings extracted from an Executive Summary / Findings section. */
  findings: string[];
  /** Numbered or labeled "Recommendation N:" passages. */
  recommendations: string[];
  /** Program/system mentions matched against the curated keyword list. */
  programs: string[];
  /** Defense contractor mentions matched against the curated prime list. */
  contractors: string[];
  /** Federal entity mentions (DoD / service branches / OSD components). */
  agencyMentions: string[];
  /** Free-text executive summary if the section anchor was found. */
  executiveSummary: string | null;
  /** v1.1: detected board members from membership / roster sections. */
  members: ParsedAdvisoryBoardMember[];
  flags: string[];
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export function parseAdvisoryReportText(text: string): ParsedAdvisoryReport {
  const flags: string[] = [];
  if (text.length < 200) flags.push("text_too_short");

  const title = extractTitle(text);
  const reportKind = detectKind(text);
  const decidedAt = extractDate(text);
  const boardSelfReference = detectBoardSelfReference(text);
  const executiveSummary = extractExecutiveSummary(text);
  const findings = extractFindings(text);
  const recommendations = extractRecommendations(text);
  const programs = extractMatchingKeywords(text, PROGRAM_KEYWORDS);
  const contractors = extractContractorMentions(text);
  const agencyMentions = extractAgencyMentions(text);
  const members = extractBoardMembers(text);

  if (findings.length === 0 && recommendations.length === 0 && text.length > 500) {
    flags.push("no_findings_or_recommendations_detected");
  }
  if (programs.length === 0 && contractors.length === 0) {
    flags.push("no_program_or_contractor_matches");
  }
  if (!boardSelfReference) flags.push("no_board_self_reference");
  if (members.length === 0) flags.push("no_members_detected");

  return {
    title,
    reportKind,
    decidedAt,
    boardSelfReference,
    findings,
    recommendations,
    programs,
    contractors,
    agencyMentions,
    executiveSummary,
    members,
    flags,
  };
}

// ─── v1.1: board member roster extraction ─────────────────────────────────
//
// DSB / DBB / DIB reports typically list members in one of these locations:
//   - Cover page or page 2: bare list of names, sometimes with affiliations
//   - "Task Force Membership" / "Board Members" appendix
//   - "Members of the Board" or "Membership" front matter section
//
// We anchor on a roster header and walk forward parsing each line as a
// candidate member entry. Stop conditions: empty paragraph break, next
// section header, max 80 candidates (cap on roster length to avoid
// runaway parsing).
//
// Per-line patterns we accept:
//   "Dr. Jane A. Smith"
//   "Dr. Jane A. Smith, Chair"
//   "Dr. Jane A. Smith, Chair, Brookings Institution"
//   "The Honorable Robert F. Hale, Hon."
//   "Gen Mark A. Welsh III, USAF (Ret.)"
//   "Lt Gen Lori J. Robinson, USAF (Ret.)"
//   "ADM Sandy Winnefeld, USN (Ret.)"
//
// Per-line filters (reject):
//   - Lines shorter than 6 chars or longer than 200
//   - Lines starting with a digit (page number, footnote)
//   - Lines that look like dates ("January 15, 2026")
//   - Lines without at least 2 capitalized words (name heuristic)
//   - Stop words: "Page", "Table", "Figure", "Appendix", "Chapter"

const ROSTER_HEADER_RE = /(?:^|\n)\s*(?:Task\s+Force\s+Membership|Board\s+Members|Membership|Members\s+of\s+the\s+(?:Board|Task\s+Force|Committee|Panel)|Defense\s+(?:Science|Business|Innovation)\s+Board\s+(?:Members|Membership))\b[:.\s]*(?:\r?\n)/i;

const HONORIFIC_RE = /^(Dr\.|Mr\.|Mrs\.|Ms\.|Hon\.|The\s+Honorable|Gen\.?|Lt\s+Gen\.?|Maj\s+Gen\.?|Brig\s+Gen\.?|LTG|MG|BG|CSM|Adm\.?|VAdm\.?|RDML|ADM|VADM|RADM|Capt\.?|Col\.?|LtCol\.?|Maj\.?|Sgt\.?|Amb\.?|Prof\.?|Sen\.?|Rep\.?)\s+/i;

const STOP_HEADER_RE = /^(?:Appendix|Chapter|Section|Conclusion|References|Acknowledgments|Annex|Acknowledgements|Acronyms|Glossary|Background|Charter)\b/i;

const NAME_LIKE_RE = /^[A-Z][a-zA-Z'\-\.]+(?:\s+[A-Z][a-zA-Z'\-\.]+){1,4}(?:\s+(?:Jr\.?|Sr\.?|III|II|IV))?$/;

function extractBoardMembers(text: string): ParsedAdvisoryBoardMember[] {
  const header = text.match(ROSTER_HEADER_RE);
  if (!header || header.index === undefined) return [];
  const startOffset = header.index + header[0].length;
  // Scan up to ~6000 chars forward looking for member lines, stopping at
  // a clear section break.
  const window = text.slice(startOffset, Math.min(text.length, startOffset + 6000));
  const lines = window.split(/\r?\n/);

  const out: ParsedAdvisoryBoardMember[] = [];
  const seenNames = new Set<string>();
  let consecutiveBlank = 0;

  for (const rawLine of lines) {
    if (out.length >= 80) break;
    const line = rawLine.trim();
    if (!line) {
      consecutiveBlank++;
      // Two+ blanks in a row = section ended
      if (consecutiveBlank >= 2 && out.length > 0) break;
      continue;
    }
    consecutiveBlank = 0;

    // Stop at a new section header
    if (STOP_HEADER_RE.test(line)) break;
    // Skip page numbers / footnotes
    if (/^\d+\s*$/.test(line)) continue;
    if (/^Page\s+\d/i.test(line)) continue;
    // Skip dates
    if (/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/.test(line)) continue;
    if (line.length < 6 || line.length > 200) continue;

    const member = parseMemberLine(line);
    if (!member) continue;
    const key = member.name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    out.push(member);
  }
  return out;
}

function parseMemberLine(line: string): ParsedAdvisoryBoardMember | null {
  // Strip a leading honorific
  let working = line;
  let honorific: string | null = null;
  const honMatch = working.match(HONORIFIC_RE);
  if (honMatch) {
    honorific = honMatch[1].trim().replace(/\s+/g, " ");
    working = working.slice(honMatch[0].length).trim();
  }

  // Split on comma → [name, ...rest]
  const parts = working.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let namePart = parts[0];
  // Strip trailing "(Ret.)" suffix and military branch suffix from name
  namePart = namePart
    .replace(/\s+\(Ret\.?\)\s*$/i, "")
    .replace(/\s+USA[F]?\s*\(?Ret\.?\)?\s*$/i, "")
    .replace(/\s+USN\s*\(?Ret\.?\)?\s*$/i, "")
    .replace(/\s+USMC\s*\(?Ret\.?\)?\s*$/i, "")
    .replace(/\s+USCG\s*\(?Ret\.?\)?\s*$/i, "")
    .replace(/\s+USSF\s*\(?Ret\.?\)?\s*$/i, "")
    .trim();

  if (!NAME_LIKE_RE.test(namePart)) return null;
  // Reject obvious non-names (one-word "Membership", "Acknowledgments", etc.)
  const wordCount = namePart.split(/\s+/).length;
  if (wordCount < 2) return null;

  // Role detection from subsequent parts — short clauses near the front
  // tend to be roles ("Chair", "Vice Chair", "Member"), longer clauses
  // tend to be affiliations.
  let role: string | null = null;
  let affiliation: string | null = null;
  const ROLE_RE = /^(Chair|Co-?Chair|Vice\s+Chair|Member|Task\s+Force\s+Lead|Lead|Sub-?Committee\s+(?:Chair|Member)|Ex-?Officio)$/i;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (!role && ROLE_RE.test(p)) {
      role = p;
      continue;
    }
    if (!affiliation && p.length >= 4 && p.length <= 100) {
      affiliation = p;
    }
  }

  return {
    name: namePart,
    honorific,
    role,
    affiliation,
  };
}

// ─── Field extractors ────────────────────────────────────────────────────

function detectKind(text: string): AdvisoryReportKind {
  const head = text.slice(0, 4000).toLowerCase();
  if (/\bannual report\b/.test(head)) return "annual_report";
  if (/\bmemo(?:randum)?\s+for\b/.test(head)) return "memo";
  if (/\bletter\s+(?:to|of)\b/.test(head) && /\bdear\s/.test(head)) return "letter";
  if (/\b(?:final\s+)?study(?:\s+report)?\b/.test(head)) return "study";
  return "report";
}

function extractTitle(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 60);
  for (const line of lines) {
    if (line.length < 20 || line.length > 300) continue;
    if (/^\d+$/.test(line) || /^page \d+/i.test(line)) continue;
    if (/^(defense (?:science|business|innovation) board|department of defense|office of the secretary)$/i.test(line)) continue;
    return collapseWhitespace(line).slice(0, 300);
  }
  return null;
}

function extractDate(text: string): number | null {
  const head = text.slice(0, 3000);
  const m2 = head.match(/\b([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (m2) {
    const monthIdx = MONTH_NAMES.indexOf(m2[1].toLowerCase());
    const day = parseInt(m2[2], 10);
    const year = parseInt(m2[3], 10);
    if (monthIdx >= 0 && Number.isFinite(day) && Number.isFinite(year)) {
      return new Date(Date.UTC(year, monthIdx, day)).getTime();
    }
  }
  const m = head.match(/\b([A-Z][a-z]+)\s+(\d{4})\b/);
  if (m) {
    const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
    const year = parseInt(m[2], 10);
    if (monthIdx >= 0 && Number.isFinite(year)) {
      return new Date(Date.UTC(year, monthIdx, 1)).getTime();
    }
  }
  return null;
}

function detectBoardSelfReference(text: string): string | null {
  const head = text.slice(0, 8000);
  if (/\bDefense\s+Science\s+Board\b/i.test(head)) return "Defense Science Board";
  if (/\bDefense\s+Business\s+Board\b/i.test(head)) return "Defense Business Board";
  if (/\bDefense\s+Innovation\s+Board\b/i.test(head)) return "Defense Innovation Board";
  return null;
}

function extractExecutiveSummary(text: string): string | null {
  const m = text.match(
    /(?:^|\n)\s*Executive\s+Summary\b[:.\s]*\n([\s\S]{40,4000}?)(?=\n\s*(?:Introduction\b|Background\b|Findings\b|Recommendations\b|Chapter\s+1\b|1\.\s+Introduction|Acknowledgments\b)|$)/i
  );
  if (!m || !m[1]) return null;
  return collapseWhitespace(m[1]).slice(0, 3000);
}

function extractFindings(text: string): string[] {
  return extractSectionBullets(
    text,
    /(?:^|\n)\s*(?:Findings|Key\s+Findings|Principal\s+Findings|Major\s+Findings)\b[:.\s]*\n([\s\S]{0,8000}?)(?=\n\s*(?:Recommendations\b|Conclusions\b|Appendix\b|References\b|Chapter\b)|$)/i
  );
}

function extractRecommendations(text: string): string[] {
  // First try a Recommendations section
  const sectionBullets = extractSectionBullets(
    text,
    /(?:^|\n)\s*(?:Recommendations|Recommendations\s+for\s+the\s+(?:Secretary|Department|Joint\s+Force))\b[:.\s]*\n([\s\S]{0,10000}?)(?=\n\s*(?:Findings\b|Conclusions\b|Appendix\b|References\b|Acknowledgments\b)|$)/i
  );

  // Also scan for "Recommendation N:" or "We recommend that..." passages
  // sprinkled through the body (common in advisory-body reports)
  const labeled = extractLabeledRecommendations(text);

  // Dedupe by lower-cased first 80 chars
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...sectionBullets, ...labeled]) {
    const norm = s.toLowerCase().slice(0, 80);
    if (seen.has(norm)) continue;
    seen.add(norm);
    merged.push(s);
  }
  return merged.slice(0, 16);
}

function extractLabeledRecommendations(text: string): string[] {
  const out: string[] = [];
  // "Recommendation 1: ..."
  const re1 = /\bRecommendation\s+\d+\b\s*[:.—\-]\s*([^\n]{30,800})/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) {
    out.push(collapseWhitespace(m[1]));
  }
  // "We recommend that..."
  const re2 = /\b(?:We|The\s+Board)\s+recommend(?:s|ed)?\s+that\b([^\.]{20,500}\.)/gi;
  while ((m = re2.exec(text)) !== null) {
    out.push(collapseWhitespace("Recommend that " + m[1].trim()));
  }
  return out.slice(0, 16);
}

function extractAgencyMentions(text: string): string[] {
  const patterns = [
    /\bDepartment of (?:Defense|the Army|the Navy|the Air Force|Homeland Security|Veterans Affairs|State|Energy|Justice|Health and Human Services|Commerce|Treasury)\b/g,
    /\b(?:U\.S\.\s+)?(?:Army|Navy|Air Force|Marine Corps|Space Force|Coast Guard)\b/g,
    /\b(?:DoD|DOD|DHS|DOJ|DOE|VA|HHS|GSA|NASA|FAA|NSA|CIA|FBI|ODNI|OUSD|OSD)\b/g,
    /\bDefense (?:Logistics Agency|Information Systems Agency|Threat Reduction Agency|Health Agency|Intelligence Agency|Counterintelligence and Security Agency|Contract Management Agency|Finance and Accounting Service|Advanced Research Projects Agency|Innovation Unit)\b/g,
    /\b(?:Office of the )?Secretary of Defense\b/g,
    /\bMissile Defense Agency\b/g,
    /\bChairman of the Joint Chiefs of Staff\b/g,
    /\bJoint Chiefs of Staff\b/g,
    /\bUnder Secretary of Defense for (?:Acquisition and Sustainment|Research and Engineering|Policy|Personnel and Readiness|Intelligence and Security|Comptroller)\b/g,
  ];
  const set = new Set<string>();
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) set.add(m[0]);
  }
  return Array.from(set).slice(0, 40);
}

function extractMatchingKeywords(text: string, keywords: string[]): string[] {
  const set = new Set<string>();
  for (const k of keywords) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    if (re.test(text)) set.add(k);
  }
  return Array.from(set).slice(0, 40);
}

function extractContractorMentions(text: string): string[] {
  const set = new Set<string>();
  for (const p of CONTRACTOR_PATTERNS) {
    const m = text.match(p);
    if (m && m[0]) set.add(canonicalizeContractor(m[0]));
  }
  return Array.from(set).slice(0, 40);
}

function canonicalizeContractor(name: string): string {
  return collapseWhitespace(name)
    .replace(/Raytheon Technologies/i, "RTX")
    .replace(/Huntington Ingalls Industries/i, "HII");
}

function extractSectionBullets(text: string, sectionRe: RegExp): string[] {
  const m = text.match(sectionRe);
  if (!m || !m[1]) return [];
  const body = m[1].trim();
  if (!body) return [];
  const parts: string[] = [];
  const bulletRe = /(?:[•·●▪◆\-\*–—]|\d+[\.)])\s+/g;
  if (bulletRe.test(body)) {
    bulletRe.lastIndex = 0;
    const split = body.split(bulletRe).map((s) => collapseWhitespace(s)).filter(Boolean);
    for (const s of split) {
      if (s.length < 20 || s.length > 800) continue;
      parts.push(s);
    }
  }
  if (parts.length === 0) {
    const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const s of sentences) {
      const c = collapseWhitespace(s);
      if (c.length < 30 || c.length > 800) continue;
      parts.push(c);
    }
  }
  return parts.slice(0, 16);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
