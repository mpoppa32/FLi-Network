// Corsair framework — generic PDF fetch + text extractor
//
// Promoted from sources/gaoProtest/ once a second source (gaoReports) needed
// the same helpers — the rule of three says wait until the third user to
// extract, but the cross-source-import smell across two siblings was
// already enough friction; 2026-05-17 continuation arc.
//
// Future PDF-heavy sources (T2-3 DoD Comptroller budget PDFs, T2-8
// DSB/DBB/DIB advisory body reports, FACA committee meeting minutes,
// SEC EDGAR exhibit attachments) import these helpers and pass their own
// `source` key for the rate-limit + retry scope.
//
// Uses pdf-parse via its inner module path to bypass the package's test-on-
// import behavior (the default `require('pdf-parse')` tries to read a bundled
// test PDF, which fails in some packaging environments). The inner path
// imports just the parser function, no side effects.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

import { acquireTokens } from "./rateLimit";
import { withRetry } from "./retry";
import { Logger } from "./logger";

const PDF_USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

/** Default rate-limit/retry key when caller doesn't specify one. */
const DEFAULT_SOURCE_KEY = "gao_protest";

export interface PdfFetchResult {
  url: string;
  bytes: number;
  contentType: string;
  buffer: Buffer;
}

export interface PdfExtractionResult {
  url: string;
  bytes: number;
  pages: number;
  text: string;
  textLength: number;
  truncated: boolean;
  durationMs: number;
}

export interface PdfExtractionOptions {
  /** Hard cap on PDF download size in bytes. Default 8MB. */
  maxBytes?: number;
  /** Max characters of extracted text to retain. Default 200,000. */
  maxTextChars?: number;
  /** Overall extraction timeout in ms. Default 45s. */
  timeoutMs?: number;
  /** Rate-limit + retry source key. Default "gao_protest"; pass "gao_reports"
   *  / "dod_news" / etc. when reusing this extractor from another source. */
  source?: string;
}

/**
 * Fetch a PDF from a URL with size + content-type guards. Rate-limited via
 * the framework token bucket bound to `options.source` (default
 * "gao_protest"); polite-scrape sources can share this helper by passing
 * their own source key.
 */
export async function fetchPdf(
  url: string,
  options: PdfExtractionOptions = {},
  log?: Logger
): Promise<PdfFetchResult> {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const sourceKey = options.source || DEFAULT_SOURCE_KEY;

  await acquireTokens(sourceKey, 1);

  const op = async (): Promise<PdfFetchResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5",
          "User-Agent": PDF_USER_AGENT,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const err = new Error(`PDF fetch failed: HTTP ${response.status} ${url}`);
        (err as any).statusCode = response.status;
        throw err;
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const contentLength = Number(response.headers.get("content-length") || "0");
      if (contentLength > 0 && contentLength > maxBytes) {
        const err = new Error(
          `PDF too large: ${contentLength} bytes (limit ${maxBytes}) ${url}`
        );
        (err as any).oversize = true;
        throw err;
      }
      // Streaming size check — read body and abort if it exceeds maxBytes
      const ab = await response.arrayBuffer();
      const buffer = Buffer.from(ab);
      if (buffer.byteLength > maxBytes) {
        const err = new Error(
          `PDF too large after fetch: ${buffer.byteLength} bytes (limit ${maxBytes}) ${url}`
        );
        (err as any).oversize = true;
        throw err;
      }
      return {
        url,
        bytes: buffer.byteLength,
        contentType,
        buffer,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  return withRetry(op, {
    source: sourceKey,
    operationName: "fetch_pdf",
    log,
  });
}

/**
 * Extract plain text from a PDF buffer.
 */
export async function extractPdfText(
  buffer: Buffer,
  options: PdfExtractionOptions = {}
): Promise<{ pages: number; text: string; truncated: boolean }> {
  const maxTextChars = options.maxTextChars ?? 200_000;
  const data = await pdfParse(buffer, { max: 0 });
  const rawText = String(data?.text ?? "");
  const normalized = normalizePdfText(rawText);
  let text = normalized;
  let truncated = false;
  if (text.length > maxTextChars) {
    text = text.slice(0, maxTextChars);
    truncated = true;
  }
  return {
    pages: Number(data?.numpages || 0),
    text,
    truncated,
  };
}

/**
 * v1.2 (additive): positional PDF item with x/y coordinates.
 *
 * pdf-parse wraps pdfjs-dist; we hook the per-page render callback to
 * capture textContent.items, which carry the transform matrix (positions)
 * and width/height. Y values increase top-down in pdfjs convention.
 *
 * Y-clustering on these items reconstructs table rows — items within a
 * narrow Y band belong to the same row. For dod_comptroller budget books
 * this is how FY funding tables get rebuilt cleanly without depending on
 * the lossy text reflow.
 */
export interface PositionalPdfItem {
  /** Text content of the item (one span as pdfjs sees it). */
  str: string;
  /** X position of the item's anchor (left edge). */
  x: number;
  /** Y position (top edge in pdfjs convention; higher = upper). */
  y: number;
  /** Item width in PDF user units. */
  width: number;
  /** Item height in PDF user units. */
  height: number;
  /** 1-indexed page number. */
  pageNum: number;
}

export interface PdfExtractionWithPositionalResult extends PdfExtractionResult {
  /** Positional items captured via pagerender callback. */
  positionalItems: PositionalPdfItem[];
}

/**
 * v1.2: fetch + extract with positional metadata captured via pdfjs
 * page.getTextContent. The returned `text` field stays identical to the
 * v1.0 extractor (same joined-string render) so existing call sites can
 * use this version transparently if they want both. Use `positionalItems`
 * when the caller needs column / row reconstruction.
 *
 * Cost: roughly 1.5-2x the time of plain text extraction, because every
 * item is captured into the outer array. For dod_comptroller budget books
 * (50-100MB, hundreds of pages) this adds 10-30s vs. plain extraction.
 * Callers should set `timeoutMs` accordingly (default 60s; budget books
 * config 120s).
 */
export async function fetchAndExtractPdfWithPositional(
  url: string,
  options: PdfExtractionOptions = {},
  log?: Logger
): Promise<PdfExtractionWithPositionalResult> {
  const startedAt = Date.now();
  const fetched = await fetchPdf(url, options, log);
  const maxTextChars = options.maxTextChars ?? 200_000;

  const positionalItems: PositionalPdfItem[] = [];
  let pageCounter = 0;

  const pagerender = async (pageData: any): Promise<string> => {
    pageCounter++;
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });
    const items: Array<{ str: string; transform: number[]; width: number; height: number }> =
      textContent.items || [];
    const pageStrings: string[] = [];
    for (const it of items) {
      if (!it || typeof it.str !== "string") continue;
      pageStrings.push(it.str);
      // transform = [scaleX, skewY, skewX, scaleY, translateX, translateY]
      const x = Array.isArray(it.transform) ? Number(it.transform[4]) : 0;
      const y = Array.isArray(it.transform) ? Number(it.transform[5]) : 0;
      positionalItems.push({
        str: it.str,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        width: Number(it.width) || 0,
        height: Number(it.height) || 0,
        pageNum: pageCounter,
      });
    }
    return pageStrings.join(" ");
  };

  const data = await pdfParse(fetched.buffer, { max: 0, pagerender });
  const rawText = String(data?.text ?? "");
  const normalized = normalizePdfText(rawText);
  let text = normalized;
  let truncated = false;
  if (text.length > maxTextChars) {
    text = text.slice(0, maxTextChars);
    truncated = true;
  }
  return {
    url: fetched.url,
    bytes: fetched.bytes,
    pages: Number(data?.numpages || pageCounter),
    text,
    textLength: text.length,
    truncated,
    positionalItems,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Full pipeline: fetch + extract.
 */
export async function fetchAndExtractPdf(
  url: string,
  options: PdfExtractionOptions = {},
  log?: Logger
): Promise<PdfExtractionResult> {
  const startedAt = Date.now();
  const fetched = await fetchPdf(url, options, log);
  const { pages, text, truncated } = await extractPdfText(fetched.buffer, options);
  return {
    url: fetched.url,
    bytes: fetched.bytes,
    pages,
    text,
    textLength: text.length,
    truncated,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Normalize PDF text: stitch hyphenated breaks across line ends, drop
 * common page header/footer noise patterns, collapse interior whitespace
 * while preserving paragraph breaks. Tuned for government report PDFs
 * (GAO, FACA, DSB-class advisory bodies, DoD Comptroller R-documents)
 * but generic enough to handle most well-formed PDFs.
 */
export function normalizePdfText(input: string): string {
  let s = input.replace(/\r\n?/g, "\n");
  // Stitch hyphenated breaks: "contrac-\ntor" → "contractor"
  s = s.replace(/(\w)-\n(\w)/g, "$1$2");
  // GAO page footers
  s = s.replace(/^\s*Page \d+ of \d+\s*$/gim, "");
  s = s.replace(/^\s*B-\d{5,7}(?:\.\d+)?\s*$/gim, "");
  s = s.replace(/^\s*GAO-\d{2}-\d{4,7}[A-Z]?\s*$/gim, "");
  // Collapse multiple blank lines but preserve paragraph breaks
  s = s.replace(/\n{3,}/g, "\n\n");
  // Squeeze interior whitespace (but preserve newlines)
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  return s.trim();
}
