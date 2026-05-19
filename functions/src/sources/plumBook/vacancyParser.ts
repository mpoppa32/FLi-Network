// Plum Book / FVRA — vacancy report PDF parser (v1.0)
//
// GAO Federal Vacancies Reform Act reports list Senate-confirmable
// positions with their vacancy state. Typical row layout (after PDF text
// reflow):
//
//   Department of Defense
//   Under Secretary of Defense for Acquisition and Sustainment
//     Vacant since: March 15, 2024
//     Acting: Jane A. Doe
//     Days vacant: 154
//     Past statutory limit: No
//
// OR the report may use a table form:
//   Agency | Position | Vacancy Date | Acting Official | Days | Past Limit
//
// v1.0 is conservative — anchors on position titles (Senate-confirmable
// PAS positions follow a recognizable pattern: "Under Secretary of …",
// "Assistant Secretary of …", "Director of …", "Inspector General",
// "Chief Financial Officer", etc.) and extracts the surrounding window
// for vacancy state.
//
// Best-effort by design. Operator validation will tune the parser when
// run against actual GAO PDFs.

const POSITION_TITLE_PATTERNS = [
  /(?:Under|Assistant|Deputy)\s+Secretary\s+of\s+[A-Z][a-zA-Z]+/g,
  /Secretary\s+of\s+(?:Defense|the\s+Army|the\s+Navy|the\s+Air\s+Force|State|Energy|Homeland\s+Security|Veterans\s+Affairs|Commerce|Treasury|Education|Labor|Transportation|Agriculture|Interior|Justice|Health\s+and\s+Human\s+Services|Housing\s+and\s+Urban\s+Development)/g,
  /(?:Deputy\s+)?Director\s+of\s+(?:National\s+Intelligence|the\s+Central\s+Intelligence\s+Agency|the\s+Federal\s+Bureau\s+of\s+Investigation|the\s+Office\s+of\s+Management\s+and\s+Budget|the\s+Office\s+of\s+Personnel\s+Management|the\s+Defense\s+Intelligence\s+Agency|the\s+National\s+Security\s+Agency)/g,
  /Inspector\s+General(?:\s+(?:of|for)\s+[A-Z][a-zA-Z\s]+){0,1}/g,
  /(?:Chief\s+(?:Financial|Information|Operating|Technology|Acquisition)\s+Officer)(?:\s+(?:of|for)\s+[A-Z][a-zA-Z\s]+){0,1}/g,
  /(?:U\.S\.|United\s+States)\s+Ambassador\s+to\s+[A-Z][a-zA-Z\s]+/g,
  /Administrator\s+of\s+(?:NASA|the\s+(?:Federal\s+Aviation\s+Administration|Small\s+Business\s+Administration|Environmental\s+Protection\s+Agency|National\s+Aeronautics\s+and\s+Space\s+Administration|Drug\s+Enforcement\s+Administration))/g,
  /Commissioner\s+of\s+(?:Internal\s+Revenue|Customs\s+and\s+Border\s+Protection|Social\s+Security)/g,
];

const AGENCY_HEADER_PATTERNS = [
  /(Department\s+of\s+(?:Defense|the\s+Army|the\s+Navy|the\s+Air\s+Force|State|Energy|Homeland\s+Security|Veterans\s+Affairs|Commerce|Treasury|Education|Labor|Transportation|Agriculture|Interior|Justice|Health\s+and\s+Human\s+Services|Housing\s+and\s+Urban\s+Development))\b/i,
  /(Executive\s+Office\s+of\s+the\s+President)\b/i,
  /(Office\s+of\s+the\s+Director\s+of\s+National\s+Intelligence)\b/i,
  /(Central\s+Intelligence\s+Agency)\b/i,
  /(Federal\s+Bureau\s+of\s+Investigation)\b/i,
  /(National\s+(?:Security|Aeronautics\s+and\s+Space)\s+(?:Agency|Administration))\b/i,
  /(Environmental\s+Protection\s+Agency)\b/i,
  /(Small\s+Business\s+Administration)\b/i,
];

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export interface ParsedVacancy {
  /** Position title verbatim from the PDF. */
  position: string;
  /** Best-effort agency name (parsed from the most recent section header
   *  encountered before this position). */
  agency: string | null;
  /** Best-effort vacancy start date in ms. null when not detected. */
  vacantSinceMs: number | null;
  /** Acting official name if designated. */
  actingOfficial: string | null;
  /** Days vacant if the report stated it. */
  daysVacant: number | null;
  /** True if the report flagged this position as past statutory limit. */
  pastStatutoryLimit: boolean;
  /** Char offset in source text (debug only). */
  offset: number;
}

export interface ParsedVacancyReport {
  /** Best-effort report date detected from the document head. */
  reportDate: number | null;
  /** All detected vacancy entries (capped via options). */
  vacancies: ParsedVacancy[];
  /** Diagnostic flags. */
  flags: string[];
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseDateFromText(text: string): number | null {
  // "Month D, YYYY"
  const m1 = text.match(/\b([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (m1) {
    const monthIdx = MONTH_NAMES.indexOf(m1[1].toLowerCase());
    const day = parseInt(m1[2], 10);
    const year = parseInt(m1[3], 10);
    if (monthIdx >= 0 && Number.isFinite(day) && Number.isFinite(year)) {
      return Date.UTC(year, monthIdx, day);
    }
  }
  // "Month YYYY"
  const m2 = text.match(/\b([A-Z][a-z]+)\s+(\d{4})\b/);
  if (m2) {
    const monthIdx = MONTH_NAMES.indexOf(m2[1].toLowerCase());
    const year = parseInt(m2[2], 10);
    if (monthIdx >= 0 && Number.isFinite(year)) {
      return Date.UTC(year, monthIdx, 1);
    }
  }
  return null;
}

function detectReportDateFromHead(text: string): number | null {
  const head = text.slice(0, 4000);
  return parseDateFromText(head);
}

/** Find the most recent agency-header section above a given offset. */
function findAgencyForOffset(text: string, offset: number): string | null {
  const lookback = text.slice(Math.max(0, offset - 1200), offset);
  let bestMatch: { agency: string; pos: number } | null = null;
  for (const pat of AGENCY_HEADER_PATTERNS) {
    pat.lastIndex = 0;
    const m = pat.exec(lookback);
    if (m && m[1]) {
      // Take the last (rightmost) agency-header occurrence
      const pos = lookback.lastIndexOf(m[1]);
      if (!bestMatch || pos > bestMatch.pos) {
        bestMatch = { agency: m[1], pos };
      }
    }
  }
  return bestMatch ? bestMatch.agency : null;
}

/** Within ~600 chars after a position-title hit, parse vacancy attrs. */
function extractVacancyAttrs(text: string, offset: number, posLength: number): {
  vacantSinceMs: number | null;
  actingOfficial: string | null;
  daysVacant: number | null;
  pastStatutoryLimit: boolean;
} {
  const window = text.slice(offset + posLength, Math.min(text.length, offset + posLength + 800));

  let vacantSinceMs: number | null = null;
  const vacM = window.match(/Vacant\s+(?:since|as\s+of|from)\s*[:\-—]?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|[A-Z][a-z]+\s+\d{4})/i);
  if (vacM && vacM[1]) {
    vacantSinceMs = parseDateFromText(vacM[1]);
  }

  let actingOfficial: string | null = null;
  const actM = window.match(/Acting(?:\s+Official)?\s*[:\-—]\s*([A-Z][a-zA-Z'\-\.]+(?:\s+[A-Z][a-zA-Z'\-\.]+){1,4})/);
  if (actM && actM[1]) {
    actingOfficial = collapseWhitespace(actM[1]);
  }

  let daysVacant: number | null = null;
  const daysM = window.match(/Days\s+vacant\s*[:\-—]?\s*(\d{1,4})/i);
  if (daysM && daysM[1]) {
    const n = parseInt(daysM[1], 10);
    if (Number.isFinite(n) && n >= 0 && n < 10000) daysVacant = n;
  }

  let pastStatutoryLimit = false;
  if (/Past\s+(?:statutory\s+)?limit\s*[:\-—]?\s*Yes\b/i.test(window)) {
    pastStatutoryLimit = true;
  } else if (/exceeded\s+the\s+(?:statutory\s+)?(?:210|300)-day/i.test(window)) {
    pastStatutoryLimit = true;
  }

  return { vacantSinceMs, actingOfficial, daysVacant, pastStatutoryLimit };
}

export function parseVacancyReportText(
  text: string,
  options: { maxVacanciesPerBook?: number } = {}
): ParsedVacancyReport {
  const flags: string[] = [];
  if (text.length < 200) flags.push("text_too_short");

  const reportDate = detectReportDateFromHead(text);
  const maxVacancies = options.maxVacanciesPerBook ?? 200;

  const seenPositions = new Set<string>();
  const vacancies: ParsedVacancy[] = [];

  for (const pat of POSITION_TITLE_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      if (vacancies.length >= maxVacancies) {
        flags.push("max_vacancies_cap_hit");
        break;
      }
      const positionRaw = collapseWhitespace(m[0]);
      const offset = m.index;
      const agency = findAgencyForOffset(text, offset);
      // Dedupe on (agency, position) — the same position name might appear
      // across multiple agencies (e.g., "Inspector General")
      const dedupeKey = ((agency || "_unknown_") + ":" + positionRaw).toLowerCase();
      if (seenPositions.has(dedupeKey)) continue;
      seenPositions.add(dedupeKey);

      const attrs = extractVacancyAttrs(text, offset, m[0].length);
      vacancies.push({
        position: positionRaw,
        agency,
        vacantSinceMs: attrs.vacantSinceMs,
        actingOfficial: attrs.actingOfficial,
        daysVacant: attrs.daysVacant,
        pastStatutoryLimit: attrs.pastStatutoryLimit,
        offset,
      });
    }
    if (vacancies.length >= maxVacancies) break;
  }

  if (vacancies.length === 0 && text.length > 1000) {
    flags.push("no_vacancy_entries_detected");
  }

  return { reportDate, vacancies, flags };
}
