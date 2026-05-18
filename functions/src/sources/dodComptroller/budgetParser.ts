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

import type { PositionalPdfItem } from "../../framework/pdfExtractor";

const PE_REGEX = /\b(0[1-9]\d{5}[A-Z]{0,3})\b/g;
const EXHIBIT_HEADER_RE = /Exhibit\s+(R-?\d[A-Z]?|P-?\d+|O-?\d+|M-?\d+)\b/i;

export interface FyFundingPoint {
  /** Fiscal year as a 4-digit string ("2026"). */
  fy: string;
  /** Best-effort dollar amount in millions (the unit budget books use). */
  amountMillions: number;
  /** Best-effort confidence: "header" (anchored on FY column header),
   *  "proximity" (extracted from nearby text without column structure),
   *  "fallback" (loose match). v1.1 errs toward over-collection; the
   *  Brief scorer can weight by confidence. */
  confidence: "header" | "proximity" | "fallback";
}

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
  /** v1.1: best-effort FY funding points parsed from the budget table near
   *  this PE. Empty if no table was detected. */
  fyFunding: FyFundingPoint[];
  /** v1.1: total of all detected FY funding points (millions). 0 if none. */
  fyFundingTotalMillions: number;
  /** v1.1: latest FY for which we found a funding point. null if none. */
  latestFy: string | null;
  /** v1.1: amount for the latest FY (millions). 0 if no latest-FY point. */
  latestFyAmountMillions: number;
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

/**
 * v1.2 (opt-in): extract FY funding for a specific PE using positional PDF
 * items captured via fetchAndExtractPdfWithPositional. This is the table-
 * aware strategy v1.1 deferred — by working in PDF coordinate space rather
 * than reflowed text, we can reconstruct table rows reliably.
 *
 * Algorithm:
 *   1. Find positional items whose `str` includes the PE number; pick the
 *      first hit (most PEs appear once per book on the exhibit page).
 *   2. Filter items to the same page, with y-coordinate in a window below
 *      the PE marker (pdfjs y decreases as you move DOWN the page — keep
 *      items with y in [PE.y - 600, PE.y - 10]).
 *   3. Cluster items by Y coordinate into rows (within 2.5 units = same
 *      row). Sort items left-to-right within each row.
 *   4. Find the header row containing "FY 20XX" columns; record their X
 *      positions.
 *   5. Find the data row(s) containing "Cost", "Total Program Element",
 *      "Program Element", or the PE number itself in the leftmost column.
 *   6. Read each data row's numeric items, snapping each to the closest
 *      header column by X position.
 *
 * Returns [] when no positional reconstruction can be done (PE not found
 * in positionalItems, no header row detected, etc.). Caller should fall
 * back to the v1.1 regex strategy in that case.
 */
export function extractFyFundingPositional(
  positionalItems: PositionalPdfItem[],
  pe: string
): FyFundingPoint[] {
  if (!positionalItems || positionalItems.length === 0) return [];

  // Find first positional item containing the PE number
  let peItem: PositionalPdfItem | null = null;
  for (const it of positionalItems) {
    if (it.str && it.str.indexOf(pe) >= 0) {
      peItem = it;
      break;
    }
  }
  if (!peItem) return [];

  // Filter to same page, items below the PE marker within reasonable Y range
  // (pdfjs y decreases as you move down; budget tables sit ~50-500 units below)
  const Y_WINDOW = 600;
  const onPage = positionalItems.filter(
    (it) =>
      it.pageNum === peItem!.pageNum &&
      it.y < peItem!.y - 10 &&
      it.y > peItem!.y - Y_WINDOW
  );
  if (onPage.length === 0) return [];

  // Cluster items by Y position into rows
  const Y_TOLERANCE = 2.5;
  const sortedByY = [...onPage].sort((a, b) => b.y - a.y); // top-to-bottom
  const rows: PositionalPdfItem[][] = [];
  let currentRow: PositionalPdfItem[] = [];
  let currentY = sortedByY[0]?.y ?? 0;
  for (const it of sortedByY) {
    if (Math.abs(it.y - currentY) <= Y_TOLERANCE) {
      currentRow.push(it);
    } else {
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [it];
      currentY = it.y;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Sort each row left-to-right
  for (const row of rows) row.sort((a, b) => a.x - b.x);

  // Find a header row with FY 20XX entries
  const fyHeaderRe = /\bFY\s*(20\d{2})\b/i;
  type HeaderColumn = { fy: string; x: number };
  let headerColumns: HeaderColumn[] | null = null;
  for (const row of rows) {
    // Reconstruct row text by joining items left-to-right
    const rowText = row.map((it) => it.str).join(" ");
    if (!fyHeaderRe.test(rowText)) continue;
    // Find each FY 20XX in the row and its X position
    const cols: HeaderColumn[] = [];
    for (const it of row) {
      const m = it.str.match(fyHeaderRe);
      if (m && m[1]) {
        cols.push({ fy: m[1], x: it.x });
      }
    }
    // Some FY headers might be split across two items ("FY", "2026") — try
    // pairing adjacent items if cols is too thin
    if (cols.length === 0) {
      for (let i = 0; i < row.length - 1; i++) {
        const aStr = row[i].str.trim();
        const bStr = row[i + 1].str.trim();
        if (/^FY\b/i.test(aStr) && /^20\d{2}$/.test(bStr)) {
          cols.push({ fy: bStr, x: row[i].x });
        }
      }
    }
    if (cols.length >= 2) {
      headerColumns = cols;
      break;
    }
  }
  if (!headerColumns || headerColumns.length < 2) return [];

  // Find a data row anchored on "Cost", "Total Program Element", or the PE
  const dataAnchorRe = /^(Cost|Total\s+Program\s+Element|Program\s+Element|Total\s+Cost)/i;
  let dataRow: PositionalPdfItem[] | null = null;
  for (const row of rows) {
    const rowText = row
      .map((it) => it.str)
      .join(" ")
      .trim();
    if (dataAnchorRe.test(rowText) || rowText.startsWith(pe)) {
      dataRow = row;
      break;
    }
  }
  if (!dataRow) return [];

  // Snap each numeric item in the data row to the closest header column
  const numericRe = /^([\d,]+\.\d{1,3}|[\d,]+)$/;
  const found: FyFundingPoint[] = [];
  const seenFys = new Set<string>();
  for (const it of dataRow) {
    const cleaned = it.str.replace(/[,$\s]/g, "");
    if (!numericRe.test(it.str.trim()) && !numericRe.test(cleaned)) continue;
    const num = parseFloat(cleaned);
    if (!Number.isFinite(num) || num <= 0 || num > 100000) continue;
    // Find closest header column by X distance
    let bestCol: HeaderColumn | null = null;
    let bestDist = Infinity;
    for (const col of headerColumns) {
      const d = Math.abs(it.x - col.x);
      if (d < bestDist) {
        bestDist = d;
        bestCol = col;
      }
    }
    if (!bestCol || bestDist > 60) continue; // 60 PDF units max snap
    if (seenFys.has(bestCol.fy)) continue;
    seenFys.add(bestCol.fy);
    found.push({
      fy: bestCol.fy,
      amountMillions: Math.round(num * 1000) / 1000,
      confidence: "header",
    });
  }
  found.sort((a, b) => a.fy.localeCompare(b.fy));
  return found;
}

/**
 * v1.1: best-effort FY funding extraction from the budget-table region
 * immediately following a PE marker. R-2 / P-1 exhibits typically present
 * funding as a table:
 *
 *   Cost ($ in Millions)            FY 2024     FY 2025     FY 2026   FY 2027
 *   Some Project Line A               12.345      15.678      22.100    24.500
 *   Total Program Element             45.200      48.100      52.300    55.000
 *
 * After PDF text extraction the rows often collapse to space-separated
 * sequences, sometimes column-by-column instead of row-by-row. v1.1 uses
 * three extraction strategies in order:
 *
 *   1) "header" — find an "FY 20XX" header line, then read the next 6 lines
 *      looking for total/program-element row dollar values aligned to the
 *      column positions. Most confident.
 *   2) "proximity" — scan for "FY 20XX ... $N.NN" patterns within ~2000
 *      chars of the PE marker. Anchored on year + dollar value, in either
 *      order.
 *   3) "fallback" — if neither yields anything, scan for "Cost ($ in Millions)"
 *      and grab the next 4 numbers, pairing them with sequential FYs from a
 *      detected header row.
 *
 * v1.1 is intentionally permissive — over-collection is fine because the
 * Brief scorer can weight by confidence. v1.2 will tighten with positional
 * extraction if PDF.js positional metadata becomes available.
 */
function extractFyFundingNear(text: string, peOffset: number, pe: string): FyFundingPoint[] {
  const windowStart = peOffset + pe.length;
  const windowEnd = Math.min(text.length, windowStart + 4000);
  const window = text.slice(windowStart, windowEnd);

  const found: FyFundingPoint[] = [];
  const seenKey = new Set<string>();
  const push = (fy: string, amount: number, confidence: FyFundingPoint["confidence"]) => {
    if (!fy || !Number.isFinite(amount)) return;
    const key = fy;
    if (seenKey.has(key)) return;
    seenKey.add(key);
    found.push({ fy, amountMillions: Math.round(amount * 1000) / 1000, confidence });
  };

  // Strategy 1 + 2 combined: search for FY 20XX patterns with a nearby
  // dollar value. Either order — "FY 2026 ... $52.3" or "$52.3 ... FY 2026".
  // Walk through all FY occurrences in the window and look at the surrounding
  // ~120 chars for a number.
  const fyRe = /\bFY\s*(20\d{2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = fyRe.exec(window)) !== null) {
    const fy = m[1];
    const idx = m.index;
    // Look ahead first (most common pattern: FY 2026 ... $52.3)
    const ahead = window.slice(idx, Math.min(window.length, idx + 200));
    const aheadMatch = ahead.match(/(?:FY\s*20\d{2}\s+)([\d,]+\.?\d*)\b/);
    if (aheadMatch) {
      const num = parseFloat(aheadMatch[1].replace(/,/g, ""));
      if (Number.isFinite(num) && num > 0 && num < 100000) {
        push(fy, num, "header");
        continue;
      }
    }
    // Look behind ($52.3 ... FY 2026)
    const behind = window.slice(Math.max(0, idx - 100), idx);
    const behindMatch = behind.match(/\$?\s*([\d,]+\.?\d*)\s+(?:FY\s*20\d{2})?$/);
    if (behindMatch) {
      const num = parseFloat(behindMatch[1].replace(/,/g, ""));
      if (Number.isFinite(num) && num > 0 && num < 100000) {
        push(fy, num, "proximity");
      }
    }
  }

  // Strategy 3 fallback: "Cost ($ in Millions)" anchor + next 4-6 numbers
  // paired with sequential FYs. Only run if we got nothing from strategies
  // 1-2.
  if (found.length === 0) {
    const costAnchor = window.search(/Cost\s*\(\$\s*in\s*Millions\)/i);
    if (costAnchor >= 0) {
      // Grab next 600 chars and pull all FY headers + numbers
      const tail = window.slice(costAnchor, Math.min(window.length, costAnchor + 800));
      const fyHeaderMatch = tail.match(/FY\s*(20\d{2})\s+FY\s*(20\d{2})\s+FY\s*(20\d{2})\s+FY\s*(20\d{2})/i);
      const numbersMatch = tail.match(/\b([\d,]+\.\d{1,3})\s+([\d,]+\.\d{1,3})\s+([\d,]+\.\d{1,3})\s+([\d,]+\.\d{1,3})\b/);
      if (fyHeaderMatch && numbersMatch) {
        for (let i = 0; i < 4; i++) {
          const fy = fyHeaderMatch[i + 1];
          const num = parseFloat(numbersMatch[i + 1].replace(/,/g, ""));
          push(fy, num, "fallback");
        }
      }
    }
  }

  // Sort by FY ascending
  found.sort((a, b) => a.fy.localeCompare(b.fy));
  return found;
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
  options: {
    maxPesPerBook?: number;
    maxNarrativeChars?: number;
    /** v1.2 (opt-in): when supplied, the positional FY-funding strategy
     *  runs first per PE; the regex strategy fills in the gaps. */
    positionalItems?: PositionalPdfItem[];
  } = {}
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

    // v1.2 (opt-in): positional strategy first. If it returns nothing,
    // fall back to the v1.1 regex extractor. Positional results are
    // tagged confidence:"header" by the extractor.
    let fyFunding: FyFundingPoint[] = [];
    if (options.positionalItems && options.positionalItems.length > 0) {
      fyFunding = extractFyFundingPositional(options.positionalItems, pe);
    }
    if (fyFunding.length === 0) {
      fyFunding = extractFyFundingNear(text, offset, pe);
    }

    const fyFundingTotalMillions = fyFunding.reduce((s, p) => s + p.amountMillions, 0);
    const latestPoint = fyFunding.length
      ? fyFunding.reduce((a, b) => (b.fy > a.fy ? b : a))
      : null;
    const latestFy = latestPoint ? latestPoint.fy : null;
    const latestFyAmountMillions = latestPoint ? latestPoint.amountMillions : 0;

    programElements.push({
      pe,
      title,
      narrative,
      exhibit: currentExhibit,
      fyFunding,
      fyFundingTotalMillions,
      latestFy,
      latestFyAmountMillions,
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
