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
}

export interface MatchResult {
  matchedNodeId: string | null;
  matchSource: "sender-email" | "attendee-email" | "sender-domain" | null;
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
  if (syncAuthSnap && typeof syncAuthSnap.val === "function") {
    const auth = syncAuthSnap.val() as { connectedEmail?: string } | null;
    const ce = String(auth?.connectedEmail || "").toLowerCase().trim();
    if (ce) operatorEmails.add(ce);
  }

  return {
    personByEmail,
    companyByName,
    companyByDomain,
    oppsByCustomerName,
    oppsByPersonId,
    operatorEmails,
  };
}

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

  // Direction first — sender against the workspace's operator emails.
  if (senderLc) {
    result.direction = ctx.operatorEmails.has(senderLc) ? "outbound" : "inbound";
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
  //    by company.name contains the second-level domain)
  let matchedCompanyId: string | null = null;
  if (!result.matchedNodeId && senderLc) {
    const domain = emailToDomain(senderLc);
    if (domain) {
      const explicit = ctx.companyByDomain.get(domain);
      if (explicit) {
        matchedCompanyId = explicit;
        result.matchedNodeId = explicit;
        result.matchSource = "sender-domain";
      } else {
        // Try second-level domain (neros.com -> "neros") against company names
        const sld = domain.split(".").slice(-2, -1)[0] || "";
        if (sld.length >= 3) {
          for (const [name, info] of ctx.companyByName) {
            if (name.indexOf(sld) !== -1) {
              matchedCompanyId = info.id;
              result.matchedNodeId = info.id;
              result.matchSource = "sender-domain";
              break;
            }
          }
        }
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
