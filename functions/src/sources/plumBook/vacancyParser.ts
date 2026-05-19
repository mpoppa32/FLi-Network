// Plum Book / FVRA — vacancy report PDF parser (v1.0 text path + v1.2 positional)
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
//
// v1.2 (opt-in via config.usePositionalExtraction) adds a positional
// table-row reconstruction path. The GAO occasionally publishes the
// FVRA tracker as a tabular layout where text-reflow shuffles row data
// into a single linear string and the regex-anchor approach breaks. The
// positional parser uses pdfjs item x/y coordinates (captured by
// framework/pdfExtractor.fetchAndExtractPdfWithPositional) to group
// items into Y-banded rows then slot into column buckets by X.

import type { PositionalPdfItem } from "../../framework/pdfExtractor";

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

// ─── v1.2: positional table-row reconstruction ──────────────────────────

/**
 * v1.2: parse FVRA vacancies from positional pdfjs items by reconstructing
 * table rows. Works when GAO publishes the tracker as a real table where
 * text-reflow loses row boundaries. Returns [] when no header row can be
 * located on any page — caller should then fall back to the text-anchor
 * regex path.
 */
export function parseVacancyReportPositional(
  positionalItems: PositionalPdfItem[],
  options: { maxVacanciesPerBook?: number; reportDate?: number | null } = {}
): ParsedVacancyReport {
  const flags: string[] = [];
  const vacancies: ParsedVacancy[] = [];
  const maxV = options.maxVacanciesPerBook ?? 200;
  if (!positionalItems || positionalItems.length === 0) {
    flags.push("no_positional_items");
    return { reportDate: options.reportDate ?? null, vacancies, flags };
  }

  const byPage = new Map<number, PositionalPdfItem[]>();
  for (const it of positionalItems) {
    if (!it || typeof it.str !== "string") continue;
    const arr = byPage.get(it.pageNum) || [];
    arr.push(it);
    byPage.set(it.pageNum, arr);
  }

  let currentAgency: string | null = null;
  let headerColsCarry: ColumnBounds | null = null;

  for (const [pageNum, items] of byPage) {
    if (vacancies.length >= maxV) break;
    const rows = clusterPositionalRows(items);
    if (rows.length === 0) continue;

    let cols: ColumnBounds | null = headerColsCarry;
    for (let ri = 0; ri < rows.length; ri++) {
      if (vacancies.length >= maxV) break;
      const row = rows[ri];
      const rowText = row.map((it) => it.str).join(" ").trim();
      if (!rowText) continue;

      // Detect agency section header (single-cell, agency-pattern match)
      const agencyMatch = matchAgencyText(rowText);
      if (agencyMatch && row.length <= 3) {
        currentAgency = agencyMatch;
        continue;
      }

      // Detect column header row
      const detected = detectColumnHeader(row);
      if (detected) {
        cols = detected;
        headerColsCarry = detected;
        continue;
      }
      if (!cols) continue;

      // Data row — slot items into columns
      const cells = sliceRowIntoCells(row, cols);
      if (cells.length < cols.bounds.length) continue;
      const positionText = collapseWhitespace(cells[cols.positionIdx] || "");
      if (!positionText || positionText.length < 6) continue;
      if (!looksLikePositionTitle(positionText)) continue;

      const vacancyDateText = cols.vacancyDateIdx >= 0
        ? collapseWhitespace(cells[cols.vacancyDateIdx] || "")
        : "";
      const actingText = cols.actingIdx >= 0
        ? collapseWhitespace(cells[cols.actingIdx] || "")
        : "";
      const daysText = cols.daysIdx >= 0
        ? collapseWhitespace(cells[cols.daysIdx] || "")
        : "";
      const pastText = cols.pastLimitIdx >= 0
        ? collapseWhitespace(cells[cols.pastLimitIdx] || "")
        : "";

      const daysVacantNum = Number(daysText.match(/\d{1,4}/)?.[0]);
      const daysVacant = Number.isFinite(daysVacantNum) && daysVacantNum >= 0 && daysVacantNum < 10000
        ? daysVacantNum
        : null;

      // Dedupe identical (agency, position) entries that can repeat
      // across pages when the table continues
      vacancies.push({
        position: positionText,
        agency: currentAgency,
        vacantSinceMs: vacancyDateText ? parseDateFromText(vacancyDateText) : null,
        actingOfficial: actingText && !/^(none|vacant|—|-)$/i.test(actingText)
          ? actingText
          : null,
        daysVacant,
        pastStatutoryLimit: /\byes\b/i.test(pastText) || /exceeded/i.test(pastText),
        offset: -1,
      });
    }
    void pageNum; // kept for potential debug
  }

  // Dedupe on (agency, position) — same as text-path dedupe
  const seen = new Set<string>();
  const deduped: ParsedVacancy[] = [];
  for (const v of vacancies) {
    const key = ((v.agency || "_unknown_") + ":" + v.position).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(v);
  }

  if (deduped.length === 0) flags.push("positional_no_data_rows");
  return { reportDate: options.reportDate ?? null, vacancies: deduped, flags };
}

interface ColumnBounds {
  bounds: number[]; // x-min of each column (n+1 entries; last = +Inf)
  positionIdx: number;
  vacancyDateIdx: number;
  actingIdx: number;
  daysIdx: number;
  pastLimitIdx: number;
}

const Y_BAND = 4; // pdfjs y unit tolerance for same-row grouping

function clusterPositionalRows(items: PositionalPdfItem[]): PositionalPdfItem[][] {
  if (items.length === 0) return [];
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionalPdfItem[][] = [];
  let curr: PositionalPdfItem[] = [sorted[0]];
  let bandY = sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (Math.abs(it.y - bandY) <= Y_BAND) {
      curr.push(it);
    } else {
      curr.sort((a, b) => a.x - b.x);
      rows.push(curr);
      curr = [it];
      bandY = it.y;
    }
  }
  if (curr.length > 0) {
    curr.sort((a, b) => a.x - b.x);
    rows.push(curr);
  }
  return rows;
}

function detectColumnHeader(row: PositionalPdfItem[]): ColumnBounds | null {
  // Compose the row joined string lowercased and require it to contain
  // header anchor tokens
  const joined = row.map((it) => it.str).join(" ").toLowerCase();
  const hasPos = /\bposition\b/.test(joined) || /\boffice\b/.test(joined) || /\btitle\b/.test(joined);
  const hasVac = /\bvacancy\b/.test(joined) || /\bvacant\b/.test(joined) || /\bdate\b/.test(joined);
  const hasActing = /\bacting\b/.test(joined) || /\bofficial\b/.test(joined);
  const hasDays = /\bdays\b/.test(joined);
  if (!(hasPos && hasVac && hasActing)) return null;

  // Each contiguous run of items belongs to one column header. Build the
  // X-boundary list from item X positions, collapsing adjacent items into
  // single column anchors.
  const xs: Array<{ x: number; label: string }> = [];
  let bufLabel = "";
  let bufX = -Infinity;
  for (const it of row) {
    if (xs.length === 0 || it.x - bufX > 25) {
      if (bufLabel) xs.push({ x: bufX, label: bufLabel.trim().toLowerCase() });
      bufLabel = it.str;
      bufX = it.x;
    } else {
      bufLabel += " " + it.str;
    }
  }
  if (bufLabel) xs.push({ x: bufX, label: bufLabel.trim().toLowerCase() });
  if (xs.length < 4) return null;

  const bounds = xs.map((x) => x.x);
  bounds.push(Number.POSITIVE_INFINITY);

  const findIdx = (preds: RegExp[]): number => {
    for (let i = 0; i < xs.length; i++) {
      for (const p of preds) {
        if (p.test(xs[i].label)) return i;
      }
    }
    return -1;
  };

  return {
    bounds,
    positionIdx: findIdx([/position/, /office/, /title/]),
    vacancyDateIdx: findIdx([/vacancy\s*date/, /vacant\s*since/, /date/]),
    actingIdx: findIdx([/acting/, /official/, /designee/]),
    daysIdx: findIdx([/days/]),
    pastLimitIdx: findIdx([/past/, /limit/, /exceeded/, /status/]),
  };
}

function sliceRowIntoCells(row: PositionalPdfItem[], cols: ColumnBounds): string[] {
  const cells: string[] = new Array(cols.bounds.length - 1).fill("");
  for (const it of row) {
    // Find which column this item's x falls into
    for (let ci = 0; ci < cols.bounds.length - 1; ci++) {
      const lo = cols.bounds[ci] - 10; // slack for x-position jitter
      const hi = cols.bounds[ci + 1] - 10;
      if (it.x >= lo && it.x < hi) {
        cells[ci] = cells[ci] ? cells[ci] + " " + it.str : it.str;
        break;
      }
    }
  }
  return cells;
}

function matchAgencyText(text: string): string | null {
  for (const pat of AGENCY_HEADER_PATTERNS) {
    pat.lastIndex = 0;
    const m = pat.exec(text);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function looksLikePositionTitle(text: string): boolean {
  for (const pat of POSITION_TITLE_PATTERNS) {
    pat.lastIndex = 0;
    if (pat.test(text)) return true;
  }
  // Permissive secondary check — many position titles start with common
  // Senate-confirmable prefixes that the regex set doesn't enumerate.
  return /^(?:Secretary|Under Secretary|Deputy Secretary|Assistant Secretary|Administrator|Director|Commissioner|Chairman|Chair|Member|Ambassador|Inspector General|Chief|General Counsel|Solicitor|Surgeon General|Comptroller)\b/i.test(text);
}
