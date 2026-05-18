// SEC EDGAR — DEF 14A (proxy statement) HTML parser (v1.2.2)
//
// DEF 14A filings disclose executive compensation, director compensation,
// shareholder proposals, beneficial ownership, and director nominations.
// SEC mandates specific tabular formats (Item 402 of Regulation S-K) so
// while every issuer's HTML differs, the table headings + row order are
// remarkably consistent.
//
// v1.2.2 scope: Summary Compensation Table (CEO + CFO + 3-5 next NEOs
// with annual salary / bonus / stock awards / option awards / non-equity
// / total) and shareholder-proposal counts. Director Compensation Table
// and Outstanding Equity Awards table deferred to a possible v1.2.3.
//
// Strategy: same as periodicReportParser — normalize HTML to text-with-
// breaks, then anchor on the SUMMARY COMPENSATION TABLE heading and pull
// the next ~12 KB of normalized text (the table itself plus some
// surrounding context). From that body, regex-extract rows that look
// like "Name | Year | $X,XXX,XXX | $X,XXX,XXX | ..." with at least 4
// dollar amounts.

export interface ProxyExecutiveComp {
  name: string;
  year: number | null;
  salary: number | null;
  bonus: number | null;
  stockAwards: number | null;
  optionAwards: number | null;
  nonEquityIncentive: number | null;
  allOther: number | null;
  total: number | null;
  /** Raw row text the parser pulled from (truncated). */
  raw: string;
}

export interface ParsedProxyStatement {
  executiveCompensation: ProxyExecutiveComp[];
  /** CEO total comp (the highest-total entry, typically). */
  ceoTotalComp: number | null;
  ceoName: string | null;
  /** Sum of top-5 executive total comp. */
  top5TotalComp: number;
  /** Count of "shareholder proposal" hits in the document. */
  shareholderProposalCount: number;
  /** Was a say-on-pay vote explicitly mentioned? */
  hasSayOnPay: boolean;
  /** Was board declassification / annual election discussed? */
  hasBoardDeclassification: boolean;
  flags: string[];
}

export interface ProxyParseOptions {
  /** Max executive rows to retain. Default 8. */
  maxExecutives?: number;
}

const NAME_HINT_RE = /\b(?:Chairman|Chief\s+Executive|Chief\s+Financial|Chief\s+Operating|President|Director|Officer|EVP|SVP|VP)\b/i;

export function parseProxyStatementHtml(
  html: string,
  options: ProxyParseOptions = {}
): ParsedProxyStatement {
  const flags: string[] = [];
  const maxExecs = options.maxExecutives ?? 8;

  if (html.length < 1000) flags.push("doc_too_short");

  const text = normalizeHtml(html);

  const compRows = extractSummaryCompensationTable(text, maxExecs);
  if (compRows.length === 0) flags.push("no_summary_comp_table");

  let ceoTotal: number | null = null;
  let ceoName: string | null = null;
  let top5Total = 0;
  // CEO = highest total; top-5 sum
  const ranked = [...compRows].sort(
    (a, b) => (b.total ?? 0) - (a.total ?? 0)
  );
  if (ranked[0] && ranked[0].total !== null) {
    ceoTotal = ranked[0].total;
    ceoName = ranked[0].name;
  }
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    if (ranked[i].total) top5Total += ranked[i].total!;
  }

  const shareholderProposalCount = (text.match(/\bshareholder\s+proposal\b/gi) || []).length;
  const hasSayOnPay = /\bsay[\s-]on[\s-]pay\b|\badvisory\s+vote\s+on\s+executive\s+compensation\b/i.test(text);
  const hasBoardDeclassification =
    /\bclassified\s+board\b|\bdeclassif(?:y|ication)\b|\bannual(?:ly)?\s+elect(?:ed|ion)\s+(?:of\s+)?director/i.test(text);

  return {
    executiveCompensation: compRows,
    ceoTotalComp: ceoTotal,
    ceoName,
    top5TotalComp: top5Total,
    shareholderProposalCount,
    hasSayOnPay,
    hasBoardDeclassification,
    flags,
  };
}

// ─── Internals ──────────────────────────────────────────────────────────

function normalizeHtml(html: string): string {
  let s = html;
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/div>/gi, "\n");
  // Tables: tag rows + cells distinctly so the row-walker can recover structure
  s = s.replace(/<\/tr>/gi, "\n[[ROW]]\n");
  s = s.replace(/<\/td>/gi, " [[CELL]] ");
  s = s.replace(/<\/h\d>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function extractSummaryCompensationTable(
  text: string,
  maxRows: number
): ProxyExecutiveComp[] {
  // Anchor on the heading variants
  const headingRe = /\bSUMMARY\s+COMPENSATION\s+TABLE\b/i;
  const m = headingRe.exec(text);
  if (!m) return [];
  // Pull a generous window after the heading — tables can be wrapped + paginated
  const start = m.index + m[0].length;
  const tail = text.slice(start, start + 20_000);

  // Walk row by row using the [[ROW]] markers we inserted
  const rows = tail.split("[[ROW]]");
  const out: ProxyExecutiveComp[] = [];

  for (const rawRow of rows) {
    if (out.length >= maxRows) break;
    if (!rawRow) continue;
    const cells = rawRow.split("[[CELL]]").map((c) => c.replace(/\s+/g, " ").trim());
    // Need at least a name + year + a few dollar columns
    if (cells.length < 4) continue;

    // First cell that looks like a person name (has at least 2 words starting capital)
    let nameIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      // Skip empties and column-header-ish strings
      if (!c) continue;
      if (/^year$|^salary$|^bonus$|^stock\b|^option\b|^total$/i.test(c)) continue;
      if (/^[A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+){1,3}$/.test(c) && c.length >= 5 && c.length <= 80) {
        nameIdx = i;
        break;
      }
    }
    if (nameIdx < 0) continue;
    const name = cells[nameIdx];
    if (out.some((r) => r.name === name)) continue;

    // Year follows the name (or is the next 4-digit number)
    let year: number | null = null;
    for (let i = nameIdx + 1; i < Math.min(cells.length, nameIdx + 4); i++) {
      const y = parseInt(cells[i], 10);
      if (Number.isFinite(y) && y >= 2010 && y <= 2050) {
        year = y;
        break;
      }
    }

    // Collect dollar amounts in order
    const dollars: number[] = [];
    for (const c of cells) {
      const d = parseDollar(c);
      if (d !== null && d > 1000) dollars.push(d);
    }
    if (dollars.length < 3) continue; // need a meaningful comp row

    // Heuristic column mapping: Salary, Bonus, Stock, Option, Non-equity, Other, Total.
    // The largest value is almost always Total; salary/bonus/stock/option in roughly the
    // first 4 positions. Mapping is best-effort — the operator-facing UI displays the
    // total + raw cells if needed.
    const total = Math.max(...dollars);
    let salary: number | null = null;
    let bonus: number | null = null;
    let stockAwards: number | null = null;
    let optionAwards: number | null = null;
    let nonEquityIncentive: number | null = null;
    let allOther: number | null = null;
    // Strip the total from the array; map remaining to columns in order
    const remaining = dollars.filter((d) => d !== total);
    if (remaining.length >= 1) salary = remaining[0] ?? null;
    if (remaining.length >= 2) bonus = remaining[1] ?? null;
    if (remaining.length >= 3) stockAwards = remaining[2] ?? null;
    if (remaining.length >= 4) optionAwards = remaining[3] ?? null;
    if (remaining.length >= 5) nonEquityIncentive = remaining[4] ?? null;
    if (remaining.length >= 6) allOther = remaining[5] ?? null;

    out.push({
      name,
      year,
      salary,
      bonus,
      stockAwards,
      optionAwards,
      nonEquityIncentive,
      allOther,
      total,
      raw: cells.join(" | ").slice(0, 400),
    });
  }

  // Filter out spurious rows that don't have plausible exec names
  const filtered = out.filter((r) => {
    // At minimum, full name pattern; reject obvious non-name strings
    if (/Compensation|Stockholders|Total of|Note|Item/i.test(r.name)) return false;
    return true;
  });

  return filtered;
}

function parseDollar(s: string): number | null {
  if (!s) return null;
  const m = s.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

// Exported for any caller that wants to know if a string looks role-named
export function looksLikeExecutiveRoleName(s: string): boolean {
  return NAME_HINT_RE.test(s);
}
