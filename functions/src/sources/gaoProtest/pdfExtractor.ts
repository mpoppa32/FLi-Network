// GAO Bid Protest source — PDF decision text extractor (v1.1)
//
// Per signal-sources-v1 Part One §GAO v1.1: GAO publishes the full decision
// as a PDF on each docket. v1.0 captures the RSS description (~200-400 chars
// of summary). v1.1 fetches the PDF, extracts the full text, and feeds the
// downstream decisionParser to lift outcome / awardee / solnum / agency /
// corrective action fields into structured ProtestAttrs.
//
// Uses pdf-parse via its inner module path to bypass the package's test-on-
// import behavior (the default `require('pdf-parse')` tries to read a bundled
// test PDF, which fails in some packaging environments). The inner path
// imports just the parser function, no side effects.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

const PDF_USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

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
}

/**
 * Fetch a PDF from a URL with size + content-type guards.
 */
export async function fetchPdf(
  url: string,
  options: PdfExtractionOptions = {},
  log?: Logger
): Promise<PdfFetchResult> {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;

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
        const err = new Error(`GAO PDF fetch failed: HTTP ${response.status} ${url}`);
        (err as any).statusCode = response.status;
        throw err;
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const contentLength = Number(response.headers.get("content-length") || "0");
      if (contentLength > 0 && contentLength > maxBytes) {
        const err = new Error(
          `GAO PDF too large: ${contentLength} bytes (limit ${maxBytes}) ${url}`
        );
        (err as any).oversize = true;
        throw err;
      }
      // Streaming size check — read body and abort if it exceeds maxBytes
      const ab = await response.arrayBuffer();
      const buffer = Buffer.from(ab);
      if (buffer.byteLength > maxBytes) {
        const err = new Error(
          `GAO PDF too large after fetch: ${buffer.byteLength} bytes (limit ${maxBytes}) ${url}`
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
    source: "gao_protest",
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
  const normalized = normalizeText(rawText);
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
 * GAO decision PDFs contain a lot of soft-wrap line breaks, page headers,
 * and footer artifacts. We collapse runs of whitespace, normalize line
 * endings, drop common GAO header/footer noise, and stitch hyphenated word
 * breaks at line ends so regex-based field extraction is reliable.
 */
function normalizeText(input: string): string {
  let s = input.replace(/\r\n?/g, "\n");
  // Stitch hyphenated breaks: "contrac-\ntor" → "contractor"
  s = s.replace(/(\w)-\n(\w)/g, "$1$2");
  // GAO page footers like "Page N of M" or "GAO-XX-NNNNNN" alone on a line
  s = s.replace(/^\s*Page \d+ of \d+\s*$/gim, "");
  s = s.replace(/^\s*B-\d{5,7}(?:\.\d+)?\s*$/gim, "");
  // Collapse multiple blank lines but preserve paragraph breaks
  s = s.replace(/\n{3,}/g, "\n\n");
  // Squeeze interior whitespace (but preserve newlines)
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  return s.trim();
}
