// Plum Book quadrennial parser (v1.3)
//
// The Plum Book (plumbook.gpo.gov) is the every-four-years GPO
// publication listing every PAS-confirmable political appointee plus
// SES, SC, and presidential-appointment-without-confirmation positions.
// Distinct from the FVRA tracker (which lists CURRENT vacancies) —
// Plum Book is a HISTORICAL baseline of who held what role under the
// previous administration.
//
// BD value: when Plum Book appointees rotate out and reappear as
// industry lobbyists / board members / consultants, the v1.17 DOOR
// (revolving-door touch) and v1.21 ACTING axes need their prior-
// service connection to be in the graph. v1.3 puts them there.
//
// Layout: heavily tabular. Each page typically lists positions under
// an Agency header with rows containing:
//   Position Title | Type | Pay Plan | Grade | Incumbent | Term
//
// We use the positional pdfjs path (framework/pdfExtractor's
// fetchAndExtractPdfWithPositional) to preserve the tabular layout.
// Then a simple Y-clustering pass groups items into rows, and an
// agency-header heuristic carries the section context forward.
//
// Conservative v1.3 — accepts lossy parsing. Even 30-40% clean
// extraction of ~9000 positions seeds the workspace with thousands
// of baseline Person → former-agency relationships, which is far
// more than the current zero.

import type { PositionalPdfItem } from "../../framework/pdfExtractor";

export interface ParsedPlumBookEntry {
  /** Position / role held (e.g., "Assistant Secretary for Acquisition"). */
  position: string;
  /** Best-effort agency parsed from the section header above this row. */
  agency: string | null;
  /** Incumbent's name verbatim. null when the cell is empty or "Vacant". */
  incumbent: string | null;
  /** Appointment type if detected (PAS / PA / SES / SC). */
  appointmentType: string | null;
  /** 1-indexed PDF page number for debug. */
  pageNum: number;
}

export interface ParsedPlumBook {
  /** Best-effort publication year from the document head. */
  publicationYear: number | null;
  /** All detected position entries (capped via options). */
  entries: ParsedPlumBookEntry[];
  /** Diagnostic flags for parse quality. */
  flags: string[];
}

// Y-cluster tolerance — items within this many pdfjs y units cluster
// into the same row. Plum Book rows are tighter than FVRA tables;
// 3 is safe.
const Y_BAND = 3;

// Agency headers in the Plum Book follow recognizable prefixes.
// We deliberately don't enumerate every agency — just the headers
// that mark major-cabinet section starts. Smaller bureaus inherit
// the section context from above.
const AGENCY_HEADER_PATTERNS: RegExp[] = [
  /^(Department\s+of\s+[A-Z][A-Za-z\s&,]+?)$/,
  /^(Executive\s+Office\s+of\s+the\s+President)$/,
  /^(Office\s+of\s+Management\s+and\s+Budget)$/,
  /^(Office\s+of\s+the\s+Director\s+of\s+National\s+Intelligence)$/,
  /^(Central\s+Intelligence\s+Agency)$/,
  /^(Federal\s+Bureau\s+of\s+Investigation)$/,
  /^(National\s+Aeronautics\s+and\s+Space\s+Administration)$/,
  /^(Environmental\s+Protection\s+Agency)$/,
  /^(Small\s+Business\s+Administration)$/,
  /^(Social\s+Security\s+Administration)$/,
  /^(General\s+Services\s+Administration)$/,
  /^(Federal\s+Reserve\s+System)$/,
  /^(Federal\s+Trade\s+Commission)$/,
  /^(Federal\s+Communications\s+Commission)$/,
];

// Appointment type tokens that the parser recognizes when found in
// a row's cell content. PAS = Presidential Appointment, Senate-
// confirmed. PA = Presidential Appointment, no Senate. SES = Senior
// Executive Service. SC = Schedule C.
const APPOINTMENT_TYPE_PATTERN = /\b(PAS|PA|SES|SC|XS|TA|CA)\b/;

function clusterRowsByY(items: PositionalPdfItem[]): PositionalPdfItem[][] {
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

function matchAgencyHeader(rowText: string): string | null {
  const trimmed = rowText.replace(/\s+/g, " ").trim();
  if (trimmed.length < 4 || trimmed.length > 120) return null;
  for (const pat of AGENCY_HEADER_PATTERNS) {
    const m = trimmed.match(pat);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// Plum Book incumbent names follow common patterns: "Lastname, Firstname",
// "Firstname Lastname", "Firstname M. Lastname". Also commonly include
// suffixes (Jr., III) and titles. The detection here is liberal — we
// accept anything that looks like a person name and isn't an obvious
// position-title token.
function looksLikeIncumbentName(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 5 || trimmed.length > 60) return false;
  if (/^vacant$/i.test(trimmed)) return false;
  // Reject obvious position keywords
  if (
    /^(assistant|deputy|under|secretary|director|administrator|commissioner|chairman|chair|member|inspector|chief|general|counsel|solicitor|surgeon|comptroller|special|principal|associate)\b/i.test(
      trimmed
    )
  ) {
    return false;
  }
  // Require at least one uppercase letter, at least one space (two-word
  // name minimum), and only letters/space/hyphen/apostrophe/period.
  if (!/[A-Z]/.test(trimmed)) return false;
  if (!/\s/.test(trimmed)) return false;
  if (!/^[A-Za-z\s,.''\-]+$/.test(trimmed)) return false;
  return true;
}

export function parsePlumBookPositional(
  positionalItems: PositionalPdfItem[],
  options: { maxEntries?: number } = {}
): ParsedPlumBook {
  const flags: string[] = [];
  const entries: ParsedPlumBookEntry[] = [];
  const maxEntries = options.maxEntries ?? 9000;
  if (!positionalItems || positionalItems.length === 0) {
    flags.push("no_positional_items");
    return { publicationYear: null, entries, flags };
  }

  // Detect publication year from earliest items (Plum Book cover)
  let publicationYear: number | null = null;
  for (let i = 0; i < Math.min(positionalItems.length, 100); i++) {
    const m = positionalItems[i].str.match(/\b(19|20)\d{2}\b/);
    if (m) {
      const y = parseInt(m[0], 10);
      if (y >= 1990 && y <= 2099) {
        publicationYear = y;
        break;
      }
    }
  }

  const byPage = new Map<number, PositionalPdfItem[]>();
  for (const it of positionalItems) {
    if (!it || typeof it.str !== "string") continue;
    const arr = byPage.get(it.pageNum) || [];
    arr.push(it);
    byPage.set(it.pageNum, arr);
  }

  let currentAgency: string | null = null;
  let entryCount = 0;
  for (const [pageNum, items] of byPage) {
    if (entryCount >= maxEntries) break;
    const rows = clusterRowsByY(items);
    for (const row of rows) {
      if (entryCount >= maxEntries) break;
      const rowText = row.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
      if (!rowText) continue;

      // Agency header detection — typically a single short row
      if (row.length <= 6) {
        const agency = matchAgencyHeader(rowText);
        if (agency) {
          currentAgency = agency;
          continue;
        }
      }

      // Data row heuristic: must have an appointment-type token AND
      // somewhere a name-like string. The position title is the LEFT
      // portion before the appointment type; the incumbent is to the
      // right.
      const typeMatch = rowText.match(APPOINTMENT_TYPE_PATTERN);
      if (!typeMatch) continue;
      const typeIdx = rowText.indexOf(typeMatch[0]);
      if (typeIdx < 5) continue;

      const positionPart = rowText.slice(0, typeIdx).trim();
      const afterType = rowText.slice(typeIdx + typeMatch[0].length).trim();

      // Position must look like a title (not all numbers / single word)
      if (
        positionPart.length < 6 ||
        positionPart.length > 200 ||
        !/[A-Za-z]{4,}/.test(positionPart)
      ) {
        continue;
      }

      // Incumbent: scan afterType for the first name-like token cluster.
      // Skip pay-plan / grade tokens.
      let incumbent: string | null = null;
      const afterTokens = afterType.split(/\s{2,}|\t/);
      for (const tok of afterTokens) {
        const candidate = tok.trim();
        if (looksLikeIncumbentName(candidate)) {
          incumbent = candidate;
          break;
        }
      }
      // Fallback: if not split by big gaps, try the whole afterType
      if (!incumbent && looksLikeIncumbentName(afterType)) {
        incumbent = afterType;
      }

      entries.push({
        position: positionPart,
        agency: currentAgency,
        incumbent,
        appointmentType: typeMatch[0],
        pageNum,
      });
      entryCount++;
    }
  }

  if (entries.length === 0) flags.push("no_entries_extracted");
  if (!currentAgency) flags.push("no_agency_headers_detected");
  if (publicationYear === null) flags.push("publication_year_unknown");

  return { publicationYear, entries, flags };
}
