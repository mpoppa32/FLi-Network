// uas-patterns PIE Supply-Chain Intelligence — HTTP client + HTML parser
//
// Fetches https://uas-patterns.com/patterns/ and extracts the static
// data structures embedded in the page:
//
//   MANUFACTURERS = [...]   ~51 vendor risk profiles (id, name, country,
//                           hq, status, funding, programs, key_risk,
//                           dependency_note, acquisition_probability,
//                           ndaa_status, signal, last_audited)
//
//   SCENARIOS = [...]       ~38 supply-chain risk forecasts (id, name,
//                           probability, description, disrupted[],
//                           lead_override, recovery, mitigation)
//
// Both are JS-literal arrays with bare keys + trailing commas; we reuse
// the same brace-counting extractor + jsLiteralToJson cleaner the DDG
// client established (P13.273).
//
// The page also emits FLAGS / PREDICTIONS / OUTCOMES / signals arrays
// as empty placeholders — those load asynchronously from a token-gated
// /api/data endpoint at runtime. v1 ignores them; v1.1 will wire the
// token via a per-workspace secret if operators want the dynamic stream.
//
// Polite-scrape contract (shares rate-limit bucket with DDG since same
// domain, same operator, same audit class):
//   - User-Agent identifies us with an email
//   - 1 request per page; framework rate-limit "uas_patterns" bucket
//     cap 1, refill 0.2/s (5s between fetches)
//   - Single GET; no follow-on auth
//   - robots.txt Allow:/ + Crawl-delay:1 (we exceed politeness)

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";

export const UAS_PATTERNS_PIE_URL = "https://uas-patterns.com/patterns/";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface PieManufacturer {
  id?: string;
  name: string;
  country?: string;
  hq?: string;
  tags?: string[];
  status?: string;
  status_label?: string;
  funding?: string;
  last_round?: string;
  revenue?: string;
  programs?: string[];
  platforms_in_forge?: string[];
  key_risk?: string;
  dependency_note?: string;
  acquisition_probability?: number;
  acquirers?: string[];
  ndaa_status?: string;
  signal?: "positive" | "neutral" | "negative" | string;
  last_audited?: string;
}

export interface PieScenario {
  id?: string;
  name: string;
  probability: number;
  description?: string;
  disrupted?: string[];
  lead_override?: number;
  recovery?: string;
  mitigation?: string;
}

export interface PiePagePayload {
  pageUrl: string;
  fetchedAt: number;
  manufacturers: PieManufacturer[];
  scenarios: PieScenario[];
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
        `uas-patterns PIE fetch failed: HTTP ${response.status} ${url} — ${text.slice(0, 200)}`
      );
      (err as { statusCode?: number }).statusCode = response.status;
      throw err;
    }
    return await response.text();
  };
  return withRetry(op, {
    source: "uas_patterns_pie",
    operationName: "fetch_pie_html",
    log,
  });
}

/** Convert a JS-object-literal array into JSON. Extends the DDG
 *  client's pattern with JS-comment stripping — the PIE MANUFACTURERS
 *  and SCENARIOS arrays carry curator section dividers like
 *  `// ── Blue UAS / Domestic ──` between groups of records.
 *
 *  Steps:
 *   1. Strip `// ...` line comments (matched only at line start with
 *      optional leading whitespace, so URLs inside strings are safe).
 *      Verified: 0 URLs in either array, 6 line-comment dividers.
 *   2. Strip `/* ... *​/` block comments (defensive; none present today).
 *   3. Quote bare property keys (`{ name: "..."` → `{ "name": "..."`).
 *   4. Strip trailing commas before `]` / `}`.  */
function jsLiteralToJson(src: string): string {
  return src
    .replace(/^[ \t]*\/\/[^\n]*/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[\]}])/g, "$1");
}

/** Slice a JS array literal between `<marker> = [` and the matching `]`
 *  via brace-depth tracking. The marker can include a leading
 *  declaration keyword ("const FOO", "let bar") since the page mixes
 *  styles. Tries JSON.parse first; on failure converts bare property
 *  keys + strips trailing commas and retries. Returns [] on miss. */
function extractJsonArray(
  html: string,
  marker: string,
  log?: Logger
): unknown[] {
  const startToken = `${marker} = [`;
  const startIdx = html.indexOf(startToken);
  if (startIdx < 0) {
    log?.warn?.("uas_patterns_pie_marker_not_found", { marker });
    return [];
  }
  const arrayStart = startIdx + startToken.length - 1;
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
    if (c === '"' || c === "'" || c === "`") {
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
          try {
            return JSON.parse(jsLiteralToJson(slice));
          } catch (err) {
            log?.warn?.("uas_patterns_pie_parse_failed", {
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
  log?.warn?.("uas_patterns_pie_array_unterminated", { marker });
  return [];
}

export async function fetchPiePage(log?: Logger): Promise<PiePagePayload> {
  const html = await fetchHtml(UAS_PATTERNS_PIE_URL, log);
  const manufacturers = extractJsonArray(
    html,
    "const MANUFACTURERS",
    log
  ) as PieManufacturer[];
  const scenarios = extractJsonArray(
    html,
    "const SCENARIOS",
    log
  ) as PieScenario[];
  return {
    pageUrl: UAS_PATTERNS_PIE_URL,
    fetchedAt: Date.now(),
    manufacturers,
    scenarios,
  };
}
