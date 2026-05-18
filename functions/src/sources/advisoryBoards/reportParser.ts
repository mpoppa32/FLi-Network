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

  if (findings.length === 0 && recommendations.length === 0 && text.length > 500) {
    flags.push("no_findings_or_recommendations_detected");
  }
  if (programs.length === 0 && contractors.length === 0) {
    flags.push("no_program_or_contractor_matches");
  }
  if (!boardSelfReference) flags.push("no_board_self_reference");

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
    flags,
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
