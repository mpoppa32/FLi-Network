// Corsair P13.137 — Phase 1A: email-to-account matcher
//
// Phase 0 audit confirmed: capture pipeline writes pendingCapture entries
// with matchedNodeId / oppId / oppName initialized to null and never set.
// 68 entries on Atlas, 0% match rate. This module fills that gap server-
// side at capture time, so every new entry lands pre-joined and the
// Follow-Up Nudge Engine (Phase 1B) has a trustworthy join to build on.
//
// What this module does NOT do:
//   - Draft, send, or auto-reply on the operator's behalf (doctrine)
//   - Scrape behind logins or gather non-public data (Phase 2 doctrine)
//   - Best-effort guess matching with no confidence signal — every match
//     records its source so the UI can label confidence honestly
//
// Match strategy (in priority order — first wins):
//   1. Sender email → person node by node.email (exact, case-insensitive)
//   2. Any attendee email → person node (for forwarded threads where the
//      operator is recipient but a known contact is on the To/Cc)
//   3. Sender domain → company node by name (case-insensitive contains)
//   4. No match → matchedNodeId = null with matchSource = null
//
// Direction:
//   - If sender email is in the workspace's operator-emails set → outbound
//   - Else → inbound
//   - (unknown only when sender email is empty, which is rare)
//
// Opp linkage (after matchedNodeId is set):
//   - Find any opportunity where customer/agency name matches the matched
//     company node's name OR opp.contacts[] / opp.keyPeople[] include the
//     matched person node's id
//   - Most-recent open opp wins (ties broken by stage advance order)

import { db, wsPath } from "../framework/rtdb";

export interface MatchContext {
  // node.id -> person node ({ id, name, email, ... })
  personByEmail: Map<string, { id: string; name?: string; org?: string }>;
  // company name (lowercased) -> company node
  companyByName: Map<string, { id: string; name?: string }>;
  // company-domain hints (lowercased domain, e.g. "neros.com") -> companyId
  companyByDomain: Map<string, string>;
  // open opportunities keyed for lookup by customer name (lowercased)
  oppsByCustomerName: Map<string, Array<{ id: string; name?: string; stage?: string; stageEnteredAt?: number }>>;
  // person.id -> opportunity.ids[] where the person is linked
  oppsByPersonId: Map<string, Array<{ id: string; name?: string; stage?: string; stageEnteredAt?: number }>>;
  // operator emails (workspace members' email addresses) for direction detection
  operatorEmails: Set<string>;
  // P13.278 — team domains: any email at this domain is team-internal
  // outbound traffic. Built from the connected Google sync account's
  // domain (e.g. mike@atlasmotion.com -> "atlasmotion.com" is a team
  // domain). Freemail providers (gmail.com, hotmail.com, etc.) are
  // excluded so the heuristic doesn't mis-flag a personal Gmail account
  // as "the team's domain." Without this set, every Tom/Bryce email
  // from atlasmotion.com tagged as inbound and polluted AWAITING REPLY
  // with self-traffic (the 51% TEAM_INTERNAL category in Atlas's
  // pendingCapture pre-fix).
  teamDomains: Set<string>;
}

export interface MatchResult {
  matchedNodeId: string | null;
  // P13.278 — extended with "attendee-domain" so outbound team emails
  // get matched to the recipient's company. Distinguished from
  // "sender-domain" so the UI can render honest confidence chips
  // ("matched via recipient domain" vs "matched via sender domain").
  matchSource:
    | "sender-email"
    | "attendee-email"
    | "sender-domain"
    | "attendee-domain"
    | null;
  oppId: string | null;
  oppName: string | null;
  direction: "inbound" | "outbound" | "unknown";
  threadId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
}

interface NodeRow {
  id?: string;
  name?: string;
  email?: string;
  emails?: string[];
  type?: string;
  org?: string;
  domain?: string;
}

interface OppRow {
  id?: string;
  name?: string;
  agency?: string;
  customer?: string;
  stage?: string;
  stageEnteredAt?: number;
  contacts?: string[];
  keyPeople?: Array<{ id?: string; name?: string }>;
}

interface MemberRow {
  uid?: string;
  email?: string;
}

const STAGE_ORDER: Record<string, number> = {
  awareness: 0,
  tracking: 1,
  engaged: 2,
  rfp: 3,
  proposal: 4,
  negotiation: 5,
  submitted: 6,
  award: 7,
};

/**
 * Load all the workspace state the matcher needs in one pass. Called once
 * per sync run in dispatcher.ts so we don't re-fetch nodes/opps per email.
 *
 * P13.149 — accepts optional syncUid so the matcher can also add the
 * connected Google account's email to operatorEmails. Workspace members
 * map to the auth-account uid, NOT the sync-account email. Without
 * this, a workspace member who connected a DIFFERENT Google account
 * for sync (e.g. signed in as mpoppa32@gmail.com but syncs from
 * mike@atlasmotion.com) had outbound mail wrongly tagged inbound.
 */
export async function loadMatchContext(workspaceId: string, syncUid?: string): Promise<MatchContext> {
  const [nodesSnap, oppsSnap, membersSnap, syncAuthSnap] = await Promise.all([
    db.ref(wsPath(workspaceId, "nodes")).get(),
    db.ref(wsPath(workspaceId, "opportunities")).get(),
    db.ref(wsPath(workspaceId, "members")).get(),
    syncUid ? db.ref(`users/${syncUid}/captureAuth/google`).get() : Promise.resolve(null as any),
  ]);

  const personByEmail = new Map<string, { id: string; name?: string; org?: string }>();
  const companyByName = new Map<string, { id: string; name?: string }>();
  const companyByDomain = new Map<string, string>();

  const nodesRaw = (nodesSnap.val() ?? {}) as Record<string, NodeRow>;
  for (const [id, n] of Object.entries(nodesRaw)) {
    if (!n) continue;
    const nid = n.id || id;
    if (n.type === "person") {
      // Index by primary email and any alternate emails
      const emails: string[] = [];
      if (n.email) emails.push(String(n.email).toLowerCase().trim());
      if (Array.isArray(n.emails)) {
        for (const e of n.emails) if (e) emails.push(String(e).toLowerCase().trim());
      }
      for (const e of emails) {
        if (e && !personByEmail.has(e)) {
          personByEmail.set(e, { id: nid, name: n.name, org: n.org });
        }
      }
    } else if (n.type === "company" || n.type === "government") {
      const nameLc = String(n.name || "").toLowerCase().trim();
      if (nameLc && !companyByName.has(nameLc)) {
        companyByName.set(nameLc, { id: nid, name: n.name });
      }
      // Optional explicit domain field on company nodes
      const dom = String(n.domain || "").toLowerCase().trim();
      if (dom && !companyByDomain.has(dom)) companyByDomain.set(dom, nid);
    }
  }

  const oppsByCustomerName = new Map<
    string,
    Array<{ id: string; name?: string; stage?: string; stageEnteredAt?: number }>
  >();
  const oppsByPersonId = new Map<
    string,
    Array<{ id: string; name?: string; stage?: string; stageEnteredAt?: number }>
  >();

  const oppsRaw = (oppsSnap.val() ?? {}) as Record<string, OppRow>;
  for (const [id, o] of Object.entries(oppsRaw)) {
    if (!o) continue;
    const stageLc = String(o.stage || "").toLowerCase().trim();
    if (stageLc === "won" || stageLc === "lost" || stageLc === "no-bid") continue; // closed opps don't drive nudges
    const oid = o.id || id;
    const entry = { id: oid, name: o.name, stage: stageLc, stageEnteredAt: o.stageEnteredAt };
    const custLc = String(o.agency || o.customer || "").toLowerCase().trim();
    if (custLc) {
      if (!oppsByCustomerName.has(custLc)) oppsByCustomerName.set(custLc, []);
      oppsByCustomerName.get(custLc)!.push(entry);
    }
    const contactIds = new Set<string>();
    if (Array.isArray(o.contacts)) for (const cid of o.contacts) if (cid) contactIds.add(String(cid));
    if (Array.isArray(o.keyPeople)) for (const p of o.keyPeople) if (p?.id) contactIds.add(String(p.id));
    for (const cid of contactIds) {
      if (!oppsByPersonId.has(cid)) oppsByPersonId.set(cid, []);
      oppsByPersonId.get(cid)!.push(entry);
    }
  }

  const operatorEmails = new Set<string>();
  const membersRaw = (membersSnap.val() ?? {}) as Record<string, MemberRow>;
  for (const [, m] of Object.entries(membersRaw)) {
    if (!m) continue;
    const e = String(m.email || "").toLowerCase().trim();
    if (e) operatorEmails.add(e);
  }
  // P13.149 — add the connected Google account email so outbound
  // messages from the sync account are tagged correctly even when the
  // operator's auth account differs from their sync account.
  // P13.278 — derive teamDomains from the connected email's domain so
  // the OTHER team members at the same domain (tom@atlasmotion.com,
  // bryce@atlasmotion.com when only Mike is a workspace member yet)
  // get tagged outbound, not inbound. Excludes freemail providers so
  // a personal-Gmail connectedEmail doesn't mis-flag all of gmail.com
  // as "the team's domain."
  const teamDomains = new Set<string>();
  if (syncAuthSnap && typeof syncAuthSnap.val === "function") {
    const auth = syncAuthSnap.val() as { connectedEmail?: string } | null;
    const ce = String(auth?.connectedEmail || "").toLowerCase().trim();
    if (ce) {
      operatorEmails.add(ce);
      const at = ce.indexOf("@");
      if (at > 0) {
        const dom = ce.slice(at + 1);
        if (dom && !FREEMAIL_DOMAINS.has(dom)) teamDomains.add(dom);
      }
    }
  }

  return {
    personByEmail,
    companyByName,
    companyByDomain,
    oppsByCustomerName,
    oppsByPersonId,
    operatorEmails,
    teamDomains,
  };
}

// P13.278 — generic-email-provider domains. Connected sync accounts on
// these domains do NOT seed teamDomains (otherwise gmail.com would get
// flagged as the team's outbound domain and every contact at gmail.com
// would mis-tag). The list covers the common operator-account providers;
// adding to it is a single-line edit if a new provider proves common.
const FREEMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "live.com",
  "msn.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

/**
 * Extract a domain from an email address. "alice@foo.bar" -> "foo.bar".
 * Returns empty string for malformed input.
 */
export function emailToDomain(email: string): string {
  const at = email.indexOf("@");
  if (at < 0 || at >= email.length - 1) return "";
  return email.slice(at + 1).toLowerCase().trim();
}

/**
 * P13.278 — resolve a domain to a tracked company id. Two passes:
 *
 *   1. Explicit company.domain field match (high confidence).
 *   2. Second-level-domain fuzzy match against company name. Tightened
 *      against the pre-fix SLD-fuzzy via WORD-BOUNDARY matching +
 *      hyphen normalization + SPECIFICITY ORDERING:
 *        - "hunter.io" no longer matches "SECURITYHUNTER, INC." (the
 *          string contains "hunter" but the word "hunter" doesn't
 *          appear standalone). The pre-fix matcher would have hit it.
 *        - "global-ordnance.com" now matches "Global Ordnance" by
 *          stripping hyphens before comparison.
 *        - "sam.gov" no longer matches "AMSAM-SPK" — "sam" only
 *          appears as part of "AMSAM" with no word boundary.
 *        - "quantum-systems.com" correctly matches "Quantum-Systems"
 *          (the whole-SLD wins over the generic sub-piece "systems"
 *          that would otherwise match "Planned Systems International").
 *
 * Specificity ordering: try the whole multi-word SLD across all
 * companies first; only fall back to sub-pieces if no whole-SLD match
 * exists. Sub-pieces also get a generic-word stoplist so "systems" /
 * "group" / "international" alone never trigger a match — they need
 * the more specific compound to match.
 *
 * Returns the company id on match, null on no match.
 */
function resolveDomainToCompany(
  domain: string,
  ctx: MatchContext
): string | null {
  if (!domain) return null;
  // Pass 1: explicit company.domain
  const explicit = ctx.companyByDomain.get(domain);
  if (explicit) return explicit;
  // Pass 2: SLD fuzzy. Try variants from MOST specific to LEAST
  // specific so multi-word SLDs win over generic sub-pieces.
  const orderedVariants = sldVariantsOrdered(domain);
  for (const variant of orderedVariants) {
    const sldNorm = normalizeForFuzzy(variant);
    if (sldNorm.length < 3) continue;
    const re = new RegExp("\\b" + escapeRegex(sldNorm) + "\\b");
    for (const [name] of ctx.companyByName) {
      const nameNorm = normalizeForFuzzy(name);
      if (re.test(nameNorm)) {
        return ctx.companyByName.get(name)!.id;
      }
    }
  }
  return null;
}

/** P13.278 — generic words that are too broad to disambiguate on their
 *  own. If "systems" alone matched, "Planned Systems International",
 *  "Acme Systems Inc", and "Federated Systems Group" would all hit
 *  for any email at *-systems.com, regardless of which "systems" the
 *  sender means. The whole multi-word SLD ("quantum-systems") still
 *  matches if it appears as a token in the company name; the bare
 *  "systems" fallback is blocked. */
const GENERIC_NAME_TOKENS = new Set<string>([
  "systems",
  "group",
  "international",
  "company",
  "industries",
  "services",
  "solutions",
  "global",
  "holdings",
  "partners",
  "consulting",
  "technology",
  "technologies",
  "corp",
  "incorporated",
  "limited",
  "ltd",
  "llc",
  "inc",
  "co",
  // P13.278 — generic short words that pollute the SLD-fuzzy when used
  // as standalone tokens. "data" matched "COMPANION DATA SERVICES" for
  // any email from api.data.gov; "gov" matched any organization with
  // "gov" in its name; etc. The whole multi-word SLD ("data-services")
  // still matches the right company; the bare token is stoplisted.
  "data",
  "gov",
  "tech",
  "labs",
  "lab",
  "studio",
  "studios",
  "media",
  "press",
  "news",
  "info",
  "online",
  "support",
  "contact",
  "team",
  "office",
  "admin",
]);

/** P13.278 — pattern check for tooling-bot senders. Drive notifications,
 *  calendar invitations from third-party scheduling tools, mailer-daemon,
 *  generic reminders — these are not operator-action signals and
 *  matching them to any tracked entity is almost always a false positive
 *  (drive-shares-noreply@google.com matched "Google" on Atlas; the entry
 *  is correct as a tooling-noise classification but useless as an opp
 *  signal). Returns true if the sender looks like a tooling bot. */
function isToolingBotSender(senderEmail: string): boolean {
  if (!senderEmail) return false;
  const lc = senderEmail.toLowerCase();
  // Local-part patterns
  const at = lc.indexOf("@");
  const local = at > 0 ? lc.slice(0, at) : lc;
  if (
    /^(no-?reply|notifications?|mailer[-_]?daemon|reminder|alerts?|automated)/.test(
      local
    )
  ) {
    return true;
  }
  // Specific tooling-bot domain heuristics
  const domain = at > 0 ? lc.slice(at + 1) : "";
  if (/^drive-shares/.test(local) && domain === "google.com") return true;
  if (domain === "mail.granola.ai") return true;
  if (domain === "calendar.google.com") return true;
  if (domain === "docusign.net") return true;
  if (domain === "mail.notion.so") return true;
  return false;
}

/** Ordered variants of an SLD, longest/most-specific first. For
 *  "quantum-systems.com" -> ["quantum-systems", "quantum"]. ("systems"
 *  is stoplisted as a generic token.) For "global-ordnance.com" ->
 *  ["global-ordnance", "ordnance"]. ("global" is stoplisted.) For
 *  "neros.com" -> ["neros"]. The whole multi-word SLD always tries
 *  first; sub-pieces fall back only if the whole-SLD finds no match
 *  in any company.  */
function sldVariantsOrdered(domain: string): string[] {
  const parts = domain.split(".");
  const sld = parts.length >= 2 ? parts[parts.length - 2] : "";
  if (!sld) return [];
  const variants: string[] = [sld];
  if (sld.includes("-")) {
    for (const piece of sld.split("-")) {
      const lc = piece.toLowerCase();
      if (lc.length < 4) continue;
      if (GENERIC_NAME_TOKENS.has(lc)) continue;
      variants.push(piece);
    }
  }
  // Already in most-specific-first order: whole SLD before any sub-piece.
  return variants;
}

/** Normalize a name or SLD for fuzzy comparison: lowercase, strip
 *  punctuation, collapse hyphens + whitespace to single spaces. */
function normalizeForFuzzy(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[,.]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Best-open-opp picker: most-recently-advanced (highest stageEnteredAt),
 * with stage-advance order as a deterministic tiebreaker. Returns null
 * when the list is empty.
 */
function pickBestOpp(
  candidates: Array<{ id: string; name?: string; stage?: string; stageEnteredAt?: number }>
): { id: string; name?: string } | null {
  if (!candidates.length) return null;
  const sorted = candidates.slice().sort((a, b) => {
    const ta = Number(a.stageEnteredAt || 0);
    const tb = Number(b.stageEnteredAt || 0);
    if (tb !== ta) return tb - ta;
    const sa = STAGE_ORDER[a.stage || ""] ?? 99;
    const sb = STAGE_ORDER[b.stage || ""] ?? 99;
    return sb - sa;
  });
  return { id: sorted[0].id, name: sorted[0].name };
}

interface MatchInput {
  senderEmail: string;
  attendeeEmails: string[];
  threadId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
}

/**
 * Resolve one captured entry to an Atlas node + opp + direction. Pure
 * function — no I/O, no mutation. Inputs are the parsed email facts +
 * the pre-loaded workspace context.
 */
export function matchEntry(input: MatchInput, ctx: MatchContext): MatchResult {
  const senderLc = (input.senderEmail || "").toLowerCase().trim();
  const result: MatchResult = {
    matchedNodeId: null,
    matchSource: null,
    oppId: null,
    oppName: null,
    direction: "unknown",
    threadId: input.threadId,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo,
  };

  // Direction first — sender against the workspace's operator emails
  // AND against the team-domain set (P13.278). A sender on the team's
  // outbound domain (atlasmotion.com when Mike's connectedEmail is
  // mike@atlasmotion.com) is treated as outbound team traffic even if
  // not yet a workspace member, so AWAITING REPLY doesn't pollute with
  // self-traffic.
  const senderDomain = senderLc ? emailToDomain(senderLc) : "";
  if (senderLc) {
    const isOperatorEmail = ctx.operatorEmails.has(senderLc);
    const isTeamDomain = senderDomain && ctx.teamDomains.has(senderDomain);
    result.direction = isOperatorEmail || isTeamDomain ? "outbound" : "inbound";
  }

  // P13.278 — tooling-bot short-circuit. Drive-share notifications,
  // mailer-daemon, calendar-invite-from-scheduling-tool, etc. produce
  // false positives even with the tightened SLD-fuzzy because their
  // domains (google.com, granola.ai, data.gov) contain real-word tokens
  // that incidentally appear in tracked org names. Returning early with
  // no match leaves the entry in pendingCapture with direction set but
  // matchedNodeId=null — operator-visible as unmatched, the honest
  // classification.
  if (senderLc && isToolingBotSender(senderLc)) {
    return result;
  }

  // 1. Sender → person by email (exact)
  if (senderLc) {
    const person = ctx.personByEmail.get(senderLc);
    if (person) {
      result.matchedNodeId = person.id;
      result.matchSource = "sender-email";
    }
  }

  // 2. Any attendee email → person (skipping operator emails so a CC'd
  //    operator doesn't pull the match to themselves)
  if (!result.matchedNodeId) {
    for (const a of input.attendeeEmails) {
      const aLc = (a || "").toLowerCase().trim();
      if (!aLc || ctx.operatorEmails.has(aLc)) continue;
      const person = ctx.personByEmail.get(aLc);
      if (person) {
        result.matchedNodeId = person.id;
        result.matchSource = "attendee-email";
        break;
      }
    }
  }

  // 3. Sender domain → company (by explicit company.domain first, then
  //    by company.name fuzzy-matching the second-level domain). For
  //    team-outbound mail (direction === "outbound") the sender domain
  //    IS the team's own domain — never a target company — so this
  //    path is skipped and (4) attendee-domain takes over.
  let matchedCompanyId: string | null = null;
  const senderIsTeam = senderDomain && ctx.teamDomains.has(senderDomain);
  if (!result.matchedNodeId && senderLc && !senderIsTeam) {
    matchedCompanyId = resolveDomainToCompany(senderDomain, ctx);
    if (matchedCompanyId) {
      result.matchedNodeId = matchedCompanyId;
      result.matchSource = "sender-domain";
    }
  }

  // 4. P13.278 — attendee domain → company. For team-outbound emails the
  //    sender is team-internal but the recipient is the customer being
  //    addressed. Match the FIRST attendee whose domain resolves to a
  //    tracked company. Skips operator emails (the operator CC'd on
  //    a teammate's outbound) and team domains (other teammates on the
  //    To/Cc). Same resolver as sender-domain so confidence semantics
  //    stay consistent. matchSource = "attendee-domain" so the UI can
  //    render an honest confidence chip ("matched to recipient org").
  if (!result.matchedNodeId) {
    for (const a of input.attendeeEmails) {
      const aLc = (a || "").toLowerCase().trim();
      if (!aLc || ctx.operatorEmails.has(aLc)) continue;
      const aDom = emailToDomain(aLc);
      if (!aDom || ctx.teamDomains.has(aDom)) continue;
      const hit = resolveDomainToCompany(aDom, ctx);
      if (hit) {
        matchedCompanyId = hit;
        result.matchedNodeId = hit;
        result.matchSource = "attendee-domain";
        break;
      }
    }
  }

  // Opp linkage. Try person-keyed opps first (more specific), then company-
  // name-keyed opps (broader). pickBestOpp picks the most-recently-advanced
  // open opp.
  if (result.matchedNodeId) {
    const personOpps = ctx.oppsByPersonId.get(result.matchedNodeId) || [];
    let pick = pickBestOpp(personOpps);
    if (!pick && matchedCompanyId) {
      // Company match — try opps by the company's name
      // (companyByName values include the canonical name)
      let companyName = "";
      for (const [n, info] of ctx.companyByName) {
        if (info.id === matchedCompanyId) {
          companyName = n;
          break;
        }
      }
      if (companyName) {
        const companyOpps = ctx.oppsByCustomerName.get(companyName) || [];
        pick = pickBestOpp(companyOpps);
      }
    }
    if (pick) {
      result.oppId = pick.id;
      result.oppName = pick.name || null;
    }
  }

  return result;
}
