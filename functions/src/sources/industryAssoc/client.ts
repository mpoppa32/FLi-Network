// Industry Association rosters — HTML member walker
//
// Each association publishes its corporate-members roster as an HTML page.
// Page layouts vary but typically follow one of:
//   (a) <ul>/<ol> list of <li> entries each containing the member name
//   (b) <table> with each <tr> carrying the member name in a <td>
//   (c) <div class="member" ...>{name}</div> grid layout
//
// v1.0 walks the HTML with a heuristic: find every text node within
// candidate container elements (<li>, <td>, .member-style divs) whose
// content looks like a company name (3-100 chars, contains a Latin
// letter, not all-caps boilerplate words). Filter to deduplicated
// strings.
//
// Best-effort by design. Operator-side validation against actual pages
// will tune the heuristic per association. v1.1 should add a per-
// association `selector` config so each association uses its known
// CSS structure.

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { Logger } from "../../framework/logger";
import {
  AssociationKey,
  ASSOCIATION_REGISTRY,
  resolveRosterUrl,
  type IndustryAssocConfig,
} from "./config";

const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";
const SOURCE_KEY = "industry_assoc";

export interface MemberCandidate {
  assoc: AssociationKey;
  assocName: string;
  assocAcronym: string;
  /** Best-effort company name as scraped. */
  name: string;
}

async function fetchHtml(url: string, log?: Logger): Promise<string> {
  await acquireTokens(SOURCE_KEY, 1);
  const op = async (): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const r = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });
      if (!r.ok) {
        const err = new Error(
          `Industry assoc roster fetch failed: HTTP ${r.status} ${url}`
        );
        (err as any).statusCode = r.status;
        throw err;
      }
      return await r.text();
    } finally {
      clearTimeout(timer);
    }
  };
  return await withRetry(op, {
    source: SOURCE_KEY,
    operationName: "fetch_industry_assoc_roster",
    log,
  });
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAVIGATION_BOILERPLATE = new Set([
  "home",
  "about",
  "contact",
  "membership",
  "events",
  "news",
  "press",
  "sponsors",
  "search",
  "login",
  "register",
  "join",
  "donate",
  "subscribe",
  "follow",
  "share",
  "previous",
  "next",
  "page",
  "show more",
  "load more",
  "view all",
  "see all",
  "back to top",
]);

/** v1.0 heuristic: a text fragment looks like a member-company name when:
 *   - Length 3-100 chars
 *   - Contains at least one Latin letter
 *   - Has at least one space OR is a 2-letter acronym (ATK, RTX) length 2-6
 *   - Not in the navigation-boilerplate list
 *   - Not a generic sentence (no terminal punctuation in the middle, no
 *     "click here" patterns)
 */
function looksLikeMemberName(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 100) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  const lc = trimmed.toLowerCase();
  if (NAVIGATION_BOILERPLATE.has(lc)) return false;
  if (/\b(click|read more|learn more|here)\b/i.test(trimmed)) return false;
  // Multi-word with capitalized words OR short acronym
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    // Allow short all-caps acronyms (RTX, BAE, ATK)
    return /^[A-Z]{2,6}$/.test(trimmed);
  }
  // Require at least one capitalized word
  const hasCap = words.some((w) => /^[A-Z]/.test(w));
  if (!hasCap) return false;
  // Reject sentence-shaped text (has period mid-string + lowercase after)
  if (/\.[a-z]/.test(trimmed)) return false;
  return true;
}

// Match content within likely member containers: <li>, <td>, common
// member-card classes.
const CONTAINER_RES: Array<{ tag: string; re: RegExp }> = [
  { tag: "li", re: /<li\b[^>]*>([\s\S]*?)<\/li>/gi },
  { tag: "td", re: /<td\b[^>]*>([\s\S]*?)<\/td>/gi },
  {
    tag: "div_member",
    re: /<div\b[^>]*class="[^"]*(?:member|company|corp|sponsor)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  },
  {
    tag: "span_member",
    re: /<span\b[^>]*class="[^"]*(?:member|company|corp|sponsor)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
  },
];

export function parseRoster(
  html: string,
  assoc: AssociationKey
): MemberCandidate[] {
  const spec = ASSOCIATION_REGISTRY[assoc];
  const seenNames = new Set<string>();
  const out: MemberCandidate[] = [];
  for (const { re } of CONTAINER_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const inner = m[1];
      if (!inner) continue;
      const candidate = stripTags(inner);
      if (!candidate) continue;
      if (!looksLikeMemberName(candidate)) continue;
      const key = candidate.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      out.push({
        assoc,
        assocName: spec.name,
        assocAcronym: spec.acronym,
        name: candidate,
      });
    }
  }
  return out;
}

export async function fetchAssociationRoster(
  assoc: AssociationKey,
  config: IndustryAssocConfig,
  log?: Logger
): Promise<MemberCandidate[]> {
  const url = resolveRosterUrl(config, assoc);
  const html = await fetchHtml(url, log);
  const members = parseRoster(html, assoc);
  log?.debug("industry_assoc_roster_parsed", {
    assoc,
    url,
    memberCount: members.length,
  });
  return members;
}
