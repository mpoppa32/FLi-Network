// DoD Comptroller — budget book PE extractor (v1.0)
//
// v1.0 scope: extract program element (PE) entries from R-2 / P-1 PDF text.
// Each PE entry is a discrete budget line keyed by:
//   - PE number — 7-digit code optionally followed by 1-3 letters
//     (e.g., 0603308D8Z, 0604222F, 0203756A)
//   - PE title — the human-readable name on the same or next line
//   - Service marker — derived from filename / book-front-matter
//
// PE format:
//   - Format A: "PE 0603308D8Z: SPACE CONTROL TECHNOLOGY"
//   - Format B: "Program Element 0603308D8Z" then line break, then title
//   - Format C: "PE Number: 0603308D8Z\nPE Title: SPACE CONTROL TECHNOLOGY"
//   - Format D (R-2 exhibit header):
//       Exhibit R-2, RDT&E Budget Item Justification: PB 2026 Air Force
//       Date: March 2025
//       Appropriation/Budget Activity                   PE Number / PE Title
//       3600 / 4: Advanced Component Development        0604222F / Aircraft Engine Component Improvement Program
//
// v1.0 anchors on the PE number regex \b\d{7}[A-Z]{0,3}\b within a
// reasonable window of "PE", "Program Element", "Exhibit R-", or "R-2"
// markers. The narrative paragraph following each PE (up to ~4000 chars
// until next PE or new exhibit) is captured verbatim.
//
// v1.0 does NOT attempt structured FY funding table extraction — that's
// the v1.1 problem. v1.0 emits PE catalog records that can be cross-linked
// from SAM.gov / Congress.gov mentions today.

const PE_REGEX = /\b(0[1-9]\d{5}[A-Z]{0,3})\b/g;
const EXHIBIT_HEADER_RE = /Exhibit\s+(R-?\d[A-Z]?|P-?\d+|O-?\d+|M-?\d+)\b/i;

export interface ParsedProgramElement {
  /** PE number, e.g., "0603308D8Z" — uppercase, no spaces. */
  pe: string;
  /** Human-readable title parsed from the line immediately following the
   *  PE marker, or null if not confidently detected. */
  title: string | null;
  /** Narrative paragraph immediately following the PE marker (verbatim
   *  text up to ~4000 chars or next PE / exhibit boundary). */
  narrative: string | null;
  /** Inferred exhibit kind (e.g., "R-2" / "P-1"). */
  exhibit: string | null;
  /** Char offset of the PE marker in source text — useful for debugging
   *  but not stored on the Signal. */
  offset: number;
}

export interface ParsedBudgetBook {
  /** Heuristic detection of the book type from the document header. */
  detectedBookType: string | null;
  /** Heuristic detection of the fiscal year from the document header. */
  detectedFiscalYear: string | null;
  /** All unique PE entries found in the document. */
  programElements: ParsedProgramElement[];
  /** Diagnostic flags. */
  flags: string[];
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function detectBookTypeFromText(headText: string): string | null {
  const m = headText.match(EXHIBIT_HEADER_RE);
  return m ? m[1].toUpperCase().replace(/[^A-Z0-9]/g, "-") : null;
}

function detectFiscalYearFromText(headText: string): string | null {
  // "PB 2026" / "PB2026" / "FY 2026" / "Fiscal Year 2026"
  const m = headText.match(/\b(?:PB|FY|Fiscal\s+Year)\s*(20\d{2})\b/i);
  return m ? m[1] : null;
}

/**
 * Extract a PE title from the text immediately following a PE marker.
 *
 * Common layouts:
 *   - "PE 0603308D8Z: SPACE CONTROL TECHNOLOGY"
 *   - "0603308D8Z\nSPACE CONTROL TECHNOLOGY"
 *   - "0603308D8Z / Space Control Technology"
 *   - "0603308D8Z   Space Control Technology"
 */
function extractTitleAfterPE(text: string, peOffset: number, pe: string): string | null {
  const after = text.slice(peOffset + pe.length, peOffset + pe.length + 400);
  // Strip leading separators: ":", "/", "-", whitespace
  const trimmed = after.replace(/^[\s:\/\-]+/, "");
  // Title ends at line break or another PE pattern or 200 chars
  const stopRe = /[\r\n]|(\b0[1-9]\d{5}[A-Z]{0,3}\b)/;
  const stopMatch = trimmed.search(stopRe);
  let raw = stopMatch >= 0 ? trimmed.slice(0, stopMatch) : trimmed.slice(0, 200);
  raw = collapseWhitespace(raw);
  if (raw.length < 4 || raw.length > 200) return null;
  // Reject obvious non-titles
  if (/^Page\s+\d/i.test(raw)) return null;
  if (/^\d+\s*$/.test(raw)) return null;
  if (/^Date\s*:/i.test(raw)) return null;
  if (/^Appropriation/i.test(raw)) return null;
  return raw;
}

/**
 * Extract the narrative paragraph following a PE marker. v1.0 captures
 * up to ~4000 chars or until the next PE marker / new exhibit boundary,
 * whichever comes first.
 */
function extractNarrativeAfterPE(
  text: string,
  peOffset: number,
  pe: string,
  maxChars: number = 4000
): string | null {
  const windowStart = peOffset + pe.length;
  const windowEnd = Math.min(text.length, windowStart + maxChars * 2);
  const window = text.slice(windowStart, windowEnd);
  // Find the next PE or exhibit boundary
  const stopRe = /(\b0[1-9]\d{5}[A-Z]{0,3}\b)|(Exhibit\s+R-?\d[A-Z]?\b)|(Exhibit\s+P-?\d+\b)/i;
  const stopMatch = window.search(stopRe);
  let body = stopMatch >= 0 ? window.slice(0, stopMatch) : window;
  // Trim leading non-narrative cruft (title line, separators, table headers)
  // by skipping the first 1-2 lines
  const lines = body.split(/[\r\n]+/);
  // Skip the title line (first non-empty line)
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      startIdx = i + 1;
      break;
    }
  }
  body = lines.slice(startIdx).join("\n").trim();
  if (body.length < 80) return null;
  return collapseWhitespace(body).slice(0, maxChars);
}

export function parseBudgetBookText(
  text: string,
  options: { maxPesPerBook?: number; maxNarrativeChars?: number } = {}
): ParsedBudgetBook {
  const flags: string[] = [];
  if (text.length < 500) flags.push("text_too_short");

  const head = text.slice(0, 8000);
  const detectedBookType = detectBookTypeFromText(head);
  const detectedFiscalYear = detectFiscalYearFromText(head);

  const maxPes = options.maxPesPerBook ?? 400;
  const maxNarrative = options.maxNarrativeChars ?? 4000;

  const seenPes = new Set<string>();
  const programElements: ParsedProgramElement[] = [];

  PE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let currentExhibit: string | null = detectedBookType;

  while ((m = PE_REGEX.exec(text)) !== null) {
    if (programElements.length >= maxPes) {
      flags.push("max_pe_cap_hit");
      break;
    }
    const pe = m[1];
    const offset = m.index;

    // Track the most recent exhibit header before this PE
    const lookback = text.slice(Math.max(0, offset - 600), offset);
    const exhibitMatch = lookback.match(EXHIBIT_HEADER_RE);
    if (exhibitMatch) {
      currentExhibit = exhibitMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, "-");
    }

    // Confirm the PE is in a legit context (a PE marker or exhibit window).
    // Reject contexts that look like table-cell pollution (just digits in a
    // narrow band of other digits).
    const ctx = text.slice(Math.max(0, offset - 80), offset).toLowerCase();
    const isInPeContext =
      /\bpe\b|\bprogram\s+element\b|exhibit|\bbudget\s+item\b|\bbudget\s+activity\b/i.test(ctx) ||
      programElements.length === 0; // accept the first hit even without context
    if (!isInPeContext && !/^\s*[\r\n]/.test(text.slice(offset - 2, offset))) {
      // Not in obvious PE context — still keep it but flag mildly
    }

    if (seenPes.has(pe)) continue;
    seenPes.add(pe);

    const title = extractTitleAfterPE(text, offset, pe);
    const narrative = extractNarrativeAfterPE(text, offset, pe, maxNarrative);

    programElements.push({
      pe,
      title,
      narrative,
      exhibit: currentExhibit,
      offset,
    });
  }

  if (programElements.length === 0) flags.push("no_pe_entries_found");

  return {
    detectedBookType,
    detectedFiscalYear,
    programElements,
    flags,
  };
}
