// uas-patterns DDG Tracker — HTTP client + HTML parser
//
// Fetches https://uas-patterns.com/ddg/ and extracts two embedded JS
// data structures:
//
//   competitors = [...]   one record per DDG vendor (rank, score, dim
//                         scores, win prob, phase-2 outlook, etc.)
//   const predictions = [...]   forward-looking analyst calls (prob,
//                               timeframe, impact, summary, derivation)
//
// Both are JSON-compatible JS literals; we slice them out of the page
// HTML between the opening `= [` and matching `];` and parse with
// JSON.parse. The page format has been stable since launch but the
// brittle bit is the slice; if the maintainer wraps the array
// differently we'll need to fall back to a tag-based parse.
//
// Polite-scrape contract (per audit Risk + mitigation):
//   - User-Agent identifies us with an email
//   - 1 request per page; framework rate-limit token cap 1, refill 0.2/s
//   - Single GET; no follow-on auth / form submission
//   - robots.txt confirmed Allow:/ for unknown user agents with a
//     Crawl-delay:1 directive (we exceed politeness at 5s)

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

export const UAS_PATTERNS_DDG_URL = "https://uas-patterns.com/ddg/";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface DdgScoreDim {
  v: number;
  basis?: string;
}

export interface DdgCompetitor {
  rank: number;
  name: string;
  sub?: string;
  platform?: string;
  type?: string[];
  score?: number;
  costLow?: string;
  costHigh?: string;
  costNote?: string;
  status?: string;
  description?: string;
  g1what?: string;
  g1well?: string[];
  g1poor?: string[];
  specs?: Array<[string, string]>;
  phase2?: string;
  phase2risk?: string;
  phase2pos?: string;
  winProb?: number;
  winRationale?: string;
  scores?: Partial<
    Record<"mfg" | "supply" | "ndaa" | "flight" | "funding" | "team", DdgScoreDim>
  >;
}

export interface DdgPrediction {
  prob: number;
  title: string;
  timeframe?: string;
  impact?: "critical" | "high" | "medium" | "low" | string;
  summary?: string;
  derivation?: string;
  color?: string;
}

export interface DdgPagePayload {
  pageUrl: string;
  fetchedAt: number;
  competitors: DdgCompetitor[];
  predictions: DdgPrediction[];
}

async function fetchHtml(url: string, log?: Logger): Promise<string> {
  await acquireTokens("uas_patterns", 1);
  const op = async (): Promise<string> => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `uas-patterns fetch failed: HTTP ${response.status} ${url} — ${text.slice(0, 200)}`
      );
      (err as { statusCode?: number }).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };
  return withRetry(op, {
    source: "uas_patterns",
    operationName: "fetch_ddg_html",
    log,
  });
}

/** Convert a JS-object-literal array into JSON by:
 *   1. wrapping unquoted property keys in double quotes (only the
 *      property-key position — preceded by `{` or `,` — so we don't
 *      touch arbitrary `word:` matches inside string values), and
 *   2. stripping trailing commas before `]` and `}` (legal in JS,
 *      illegal in JSON; the predictions array uses both).
 *  Handles both the proper-JSON `competitors = [{"rank":1,...}]` and
 *  the bare-key + trailing-comma `predictions = [{prob:91,...},]`
 *  shapes the page emits. */
function jsLiteralToJson(src: string): string {
  return src
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[\]}])/g, "$1");
}

/** Slice a JS array literal between `<marker> = [` and the matching
 *  `];` via brace-depth tracking. Returns the parsed array or [] on
 *  miss. Tries JSON.parse first; on failure converts bare property
 *  keys to JSON form and retries. */
function extractJsonArray(
  html: string,
  marker: string,
  log?: Logger
): unknown[] {
  const startToken = `${marker} = [`;
  const startIdx = html.indexOf(startToken);
  if (startIdx < 0) {
    log?.warn?.("uas_patterns_marker_not_found", { marker });
    return [];
  }
  const arrayStart = startIdx + startToken.length - 1; // include the `[`
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;
  for (let i = arrayStart; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === inString) {
        inString = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        const slice = html.slice(arrayStart, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          // Bare-key fallback (predictions array uses JS literal form).
          try {
            return JSON.parse(jsLiteralToJson(slice));
          } catch (err) {
            log?.warn?.("uas_patterns_parse_failed", {
              marker,
              message: (err as Error).message,
              sampleHead: slice.slice(0, 200),
            });
            return [];
          }
        }
      }
    }
  }
  log?.warn?.("uas_patterns_array_unterminated", { marker });
  return [];
}

export async function fetchDdgPage(log?: Logger): Promise<DdgPagePayload> {
  const html = await fetchHtml(UAS_PATTERNS_DDG_URL, log);
  // The page emits two top-level arrays. `competitors = [{...}]` is the
  // 11-vendor leaderboard; `const predictions = [{...}]` is the analyst
  // forecast scoreboard.
  const competitors = extractJsonArray(html, "competitors", log) as DdgCompetitor[];
  const predictions = extractJsonArray(html, "const predictions", log) as DdgPrediction[];
  return {
    pageUrl: UAS_PATTERNS_DDG_URL,
    fetchedAt: Date.now(),
    competitors,
    predictions,
  };
}
