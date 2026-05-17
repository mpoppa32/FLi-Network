// GAO Reports — report PDF text parser (v1.1)
//
// GAO audit + evaluation reports follow a structured format:
//   1. Cover page: title, report number, date, agency
//   2. Highlights box: "What GAO Found" / "What GAO Recommends" /
//      "Why GAO Did This Study"
//   3. Body: methodology + findings + recommendations
//   4. Appendices: agency response (concur / partial / non-concur)
//
// v1.1 extraction targets the BD-operator-relevant facts:
//   - Defense programs mentioned (matches a curated keyword list)
//   - Defense contractors mentioned (matches a curated prime list)
//   - "What GAO Found" bullet points (the headline findings)
//   - "Recommendations" GAO made
//   - Agency concur/non-concur posture
//   - Report kind (audit / evaluation / testimony / decision)
//
// Heuristic regex parser — keeps zero new dependencies, consistent with the
// existing parsers in this codebase.

const PROGRAM_KEYWORDS = [
  // Air Force
  "F-35", "F-22", "F-15EX", "B-21", "B-2", "B-52", "KC-46", "KC-135",
  "C-17", "C-130", "T-7", "T-X", "T-38", "CCA", "NGAD", "Sentinel",
  "Minuteman III", "ICBM", "GBSD",
  // Navy
  "Columbia", "Virginia-class", "Ohio-class", "Ford-class", "Constellation",
  "DDG-51", "DDG(X)", "FFG(X)", "SSN(X)", "Block IV", "Block V",
  "Trident II", "Tomahawk", "Standard Missile", "AEGIS",
  // Army
  "M1 Abrams", "Stryker", "Bradley", "Paladin", "AMPV", "OMFV", "ITEP",
  "FLRAA", "FARA", "Patriot", "THAAD", "IFPC", "JLTV", "Apache",
  // Space
  "SBIRS", "GPS III", "Next Generation OPIR", "DEEP", "MEO",
  "Resilient GPS", "PNT", "Space Development Agency",
  // Joint / multi-service
  "JADC2", "ABMS", "Project Convergence", "Project Overmatch",
  "Hypersonic", "Long Range Hypersonic Weapon", "LRHW",
  // Programs/orgs commonly audited
  "FMS", "Foreign Military Sales", "TRANSCOM", "SOCOM",
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
  /\bMaximus\b/i,
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
];

export type GaoReportKind = "audit" | "evaluation" | "testimony" | "decision" | "report";

export interface ParsedGaoReport {
  reportId: string | null;
  reportKind: GaoReportKind;
  title: string | null;
  decidedAt: number | null;
  agencyMentions: string[];
  programs: string[];
  contractors: string[];
  findings: string[];
  recommendations: string[];
  agencyResponse: "concur" | "partial_concur" | "non_concur" | null;
  agencyResponseConfidence: number;
  whyGaoDidThis: string | null;
  flags: string[];
}

const MONTH_NAMES = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];

export function parseGaoReportText(text: string): ParsedGaoReport {
  const flags: string[] = [];
  if (text.length < 200) flags.push("text_too_short");

  const reportId = extractReportId(text);
  const reportKind = detectKind(text);
  const title = extractTitle(text);
  const decidedAt = extractDate(text);
  const agencyMentions = extractAgencyMentions(text);
  const programs = extractMatchingKeywords(text, PROGRAM_KEYWORDS);
  const contractors = extractContractorMentions(text);
  const findings = extractFindings(text);
  const recommendations = extractRecommendations(text);
  const responseDetection = detectAgencyResponse(text);
  const whyGaoDidThis = extractWhyGaoDidThis(text);

  if (findings.length === 0 && text.length > 500) flags.push("no_findings_detected");
  if (programs.length === 0 && contractors.length === 0) flags.push("no_program_or_contractor_matches");

  return {
    reportId,
    reportKind,
    title,
    decidedAt,
    agencyMentions,
    programs,
    contractors,
    findings,
    recommendations,
    agencyResponse: responseDetection.value,
    agencyResponseConfidence: responseDetection.confidence,
    whyGaoDidThis,
    flags,
  };
}

// ─── Field extractors ────────────────────────────────────────────────────

function extractReportId(text: string): string | null {
  const m = text.match(/\bGAO-\d{2}-\d{4,7}[A-Z]?\b/);
  return m ? m[0] : null;
}

function detectKind(text: string): GaoReportKind {
  const head = text.slice(0, 4000).toLowerCase();
  if (/\btestimony\s+(?:before|of)\b/.test(head)) return "testimony";
  if (/\bdecision\s+matter of\b/.test(head)) return "decision";
  if (/\bevaluation\b/.test(head) && !/\baudit\b/.test(head)) return "evaluation";
  if (/\baudit\b/.test(head)) return "audit";
  return "report";
}

function extractTitle(text: string): string | null {
  // Typical layout: report ID line, then a blank, then the title (often all-caps)
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 40);
  // Skip header-noise lines, find the first reasonable-length line
  for (const line of lines) {
    if (/^GAO[-\s]\d/.test(line)) continue;
    if (line.length < 15 || line.length > 200) continue;
    // Skip dates / page numbers
    if (/^\d+$/.test(line) || /^Page \d+/.test(line)) continue;
    return collapseWhitespace(line).slice(0, 200);
  }
  return null;
}

function extractDate(text: string): number | null {
  // GAO reports typically print "Month YYYY" near the top
  const head = text.slice(0, 2000);
  const m = head.match(/\b([A-Z][a-z]+)\s+(\d{4})\b/);
  if (m) {
    const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
    const year = parseInt(m[2], 10);
    if (monthIdx >= 0 && Number.isFinite(year)) {
      return new Date(Date.UTC(year, monthIdx, 1)).getTime();
    }
  }
  // Full date "Month Day, Year"
  const m2 = head.match(/\b([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (m2) {
    const monthIdx = MONTH_NAMES.indexOf(m2[1].toLowerCase());
    const day = parseInt(m2[2], 10);
    const year = parseInt(m2[3], 10);
    if (monthIdx >= 0 && Number.isFinite(day) && Number.isFinite(year)) {
      return new Date(Date.UTC(year, monthIdx, day)).getTime();
    }
  }
  return null;
}

function extractAgencyMentions(text: string): string[] {
  const patterns = [
    /\bDepartment of (?:Defense|the Army|the Navy|the Air Force|Homeland Security|Veterans Affairs|State|Energy|Justice|Health and Human Services)\b/g,
    /\b(?:Army|Navy|Air Force|Marine Corps|Space Force|Coast Guard)\b/g,
    /\b(?:DoD|DOD|DHS|DOJ|DOE|VA|HHS|GSA|NASA|FAA|NSA|CIA|FBI)\b/g,
    /\bDefense (?:Logistics Agency|Information Systems Agency|Threat Reduction Agency|Health Agency|Intelligence Agency|Counterintelligence and Security Agency|Contract Management Agency|Finance and Accounting Service)\b/g,
    /\b(?:Office of the )?Secretary of Defense\b/g,
    /\bMissile Defense Agency\b/g,
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
    // Word-boundary case-insensitive match; some keywords have hyphens (F-35)
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
  // Normalize common variants — operator searches for one canonical form
  return collapseWhitespace(name)
    .replace(/Raytheon Technologies/i, "RTX")
    .replace(/Huntington Ingalls Industries/i, "HII")
    .replace(/Booz Allen Hamilton/i, "Booz Allen Hamilton")
    .replace(/General Atomics/i, "General Atomics");
}

/**
 * "What GAO Found" bullets — typically follow that heading verbatim and
 * end at the next heading (Why / Recommendations / What We Did).
 */
function extractFindings(text: string): string[] {
  return extractSectionBullets(
    text,
    /(?:^|\n)\s*What GAO Found\b[:.\s]*\n([\s\S]{0,8000}?)(?=\n\s*(?:What GAO Recommends|Why GAO Did This Study|Recommendations\b|How GAO Did This Study)|$)/i
  );
}

/**
 * "What GAO Recommends" + "Recommendations" sections.
 */
function extractRecommendations(text: string): string[] {
  const a = extractSectionBullets(
    text,
    /(?:^|\n)\s*What GAO Recommends\b[:.\s]*\n([\s\S]{0,6000}?)(?=\n\s*(?:Why GAO Did This Study|How GAO Did This Study|Findings\b|Agency Comments|Recommendations\b)|$)/i
  );
  const b = extractSectionBullets(
    text,
    /(?:^|\n)\s*Recommendations(?:\s+for Executive Action)?\b[:.\s]*\n([\s\S]{0,8000}?)(?=\n\s*(?:Agency Comments|Conclusions|Appendix|Why GAO)|$)/i
  );
  // Dedupe
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...a, ...b]) {
    const norm = s.toLowerCase().slice(0, 80);
    if (seen.has(norm)) continue;
    seen.add(norm);
    merged.push(s);
  }
  return merged.slice(0, 12);
}

function extractSectionBullets(text: string, sectionRe: RegExp): string[] {
  const m = text.match(sectionRe);
  if (!m || !m[1]) return [];
  const body = m[1].trim();
  if (!body) return [];
  // Bullet patterns: "•", "·", "—", "–", a leading numeric like "1." or "(1)",
  // or simply paragraph breaks for prose.
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
  // Fallback: split into sentences if bullet-based split yielded nothing useful
  if (parts.length === 0) {
    const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const s of sentences) {
      const c = collapseWhitespace(s);
      if (c.length < 30 || c.length > 800) continue;
      parts.push(c);
    }
  }
  return parts.slice(0, 12);
}

function detectAgencyResponse(text: string): {
  value: "concur" | "partial_concur" | "non_concur" | null;
  confidence: number;
} {
  const tail = text.slice(Math.max(0, text.length - 6000)).toLowerCase();
  if (/\bdid not concur(?:\s+with)?\b/.test(tail) || /\bdoes not concur\b/.test(tail) || /\bnon-?concur(?:rence)?\b/.test(tail)) {
    return { value: "non_concur", confidence: 0.85 };
  }
  if (/\bpartially concur(?:red)?\b/.test(tail) || /\bconcur in part\b/.test(tail) || /\bagrees with in part\b/.test(tail)) {
    return { value: "partial_concur", confidence: 0.85 };
  }
  if (/\bconcur(?:red|s)?\s+(?:with )?(?:all|the recommendations|gao)/.test(tail) || /\bagrees with (?:all of )?gao/.test(tail)) {
    return { value: "concur", confidence: 0.85 };
  }
  if (/\bconcur(?:red|s)?\b/.test(tail)) {
    return { value: "concur", confidence: 0.55 };
  }
  return { value: null, confidence: 0 };
}

function extractWhyGaoDidThis(text: string): string | null {
  const m = text.match(
    /(?:^|\n)\s*Why GAO Did This Study\b[:.\s]*\n([\s\S]{20,2000}?)(?=\n\s*(?:What GAO Found|What GAO Recommends|How GAO Did This Study|Recommendations\b)|$)/i
  );
  if (!m || !m[1]) return null;
  return collapseWhitespace(m[1]).slice(0, 1000);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
