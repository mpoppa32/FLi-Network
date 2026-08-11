// Corsair — scheduled job: daily/weekly Brief email digest
//
// Closes SME-eval gap #2 (notifications) from 2026-05-25 session.
// Reads brief_subscriptions/* per workspace, sends Brief content via
// SendGrid to subscribers whose frequency matches the current cadence
// AND who haven't received today's send.
//
// Schedule: daily at 11:00 UTC (≈ 7:00 AM ET / 6:00 AM CT / 4:00 AM PT).
// Picks a UTC time that's morning for most US timezones. Per-user timezone
// preference is a P14.x enhancement.
//
// REQUIRED DEPLOY STEPS (Mike runs once):
//   1. cd functions && npm install @sendgrid/mail
//   2. Get SendGrid API key from https://app.sendgrid.com/settings/api_keys
//      (free tier = 100 emails/day, easily covers a 2-person BD team)
//   3. Verify a sender identity at https://app.sendgrid.com/settings/sender_auth
//      (use the email address that should appear in the "From:" header —
//       must match a verified domain or sender)
//   4. firebase functions:secrets:set SENDGRID_API_KEY
//      (paste the key when prompted)
//   5. firebase functions:secrets:set BRIEF_FROM_EMAIL
//      (paste the verified sender address)
//   6. firebase deploy --only functions:dailyBriefDigest
//
// AFTER DEPLOY:
//   - Each user clicks 📧 Email Digest on the Brief view, fills in their
//     email, picks frequency=daily, hits Save.
//   - Next morning at 11 UTC, the function fires for every subscriber
//     whose lastSent timestamp is not today.
//   - lastSent updates after successful send to prevent dupes.
//
// COST: ~1¢/day per subscriber on SendGrid paid tier; free up to 100/day.

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { createLogger, generateJobId } from "../framework/logger";
import type { BriefOutput, BriefItem } from "./briefSynthesisCommon";
import { sendViaGmail } from "../capture/gmailSend";

// P13.379 — the morning brief is emailed from the operator's OWN Gmail
// (capture/gmailSend → gmail.users.messages.send on the existing
// users/{uid}/captureAuth/google grant), NOT SendGrid (whose key was dead/401).
// The Google OAuth env (GOOGLE_CLIENT_ID/_SECRET/_REDIRECT_URI) is declared in
// each send function's `secrets` array so refreshAccessToken can mint a token.

export interface BriefSubscription {
  email: string;
  name?: string;
  frequency: "daily" | "weekly" | "pipeline";
  uid: string;
  incActions?: boolean;
  incRisks?: boolean;
  incPipeline?: boolean;
  incContacts?: boolean;
  incSbir?: boolean;
  /** P13.375 — include the synthesized OSINT "Overnight Intelligence"
   *  section (signals/awards/opportunities from derivedViews/dailyBrief/
   *  latest). Defaults on when unset, like the other inc* flags. */
  incIntel?: boolean;
  /** P13.389 — include the "Master Sheet Changes" section: the value edits
   *  factsSheetSync caught on the Atlas master sheet since the last digest
   *  (workspaces/{ws}/factChanges ring buffer). Defaults on when unset. */
  incFactChanges?: boolean;
  /** Build C — include the "Atlas Slack" section: recent messages the intake
   *  pulled from the Atlas channels (workspaces/{ws}/slackFeed). Defaults on. */
  incSlack?: boolean;
  /** Operator build — include the "OPEN COMMITMENTS" section: open commitments
   *  regardless of deadline, so the headless morning brief sees the whole book
   *  of work and not just the 7-day window. Defaults on when unset. */
  incCommitments?: boolean;
  subscribedAt?: string;
  lastSent?: string;
}

interface Workspace {
  id: string;
  name: string;
}

function _isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Open commitments in operator-useful order: dated ones first (soonest
 * deadline, overdue at the top), then undated ones newest-first.
 *
 * Shared with the operatorData endpoint so the digest and the headless
 * operator layer agree on "what's open and what matters first."
 */
export function sortOpenCommitments(commitments: unknown[]): any[] {
  return (commitments as any[])
    .filter((c: any) => c && c.status === "open")
    .sort((a: any, b: any) => {
      const ta = a.deadline ? Date.parse(`${a.deadline}T00:00:00`) : NaN;
      const tb = b.deadline ? Date.parse(`${b.deadline}T00:00:00`) : NaN;
      const va = !isNaN(ta);
      const vb = !isNaN(tb);
      if (va && vb) return ta - tb;
      if (va) return -1;
      if (vb) return 1;
      return Date.parse(b.created || 0) - Date.parse(a.created || 0);
    });
}

// ─── HTML MODEL (P13.401) ───────────────────────────────────────────────────
//
// The HTML used to be generated from the plaintext: `text.split("\n").map(...)`
// turning each line into a <div>. Every visual defect Mike reported followed
// from that one design — no hierarchy is reachable from a line-to-div
// transform, and the HTML inherited the plaintext's `[CONTEXT]` prefixes and
// its mid-word 90-char truncation because it was literally made of them.
//
// Now both parts are emitted from ONE pass over the same data: each section
// pushes its plaintext lines AND a structured `BriefSection`. The plaintext
// emission is deliberately left untouched, character for character — that
// redundancy is the point. It makes the parser guarantee provable by snapshot
// rather than argued from a refactor.
//
// FROZEN: the ten section keys, their spelling, their order. Display labels in
// the HTML diverge freely — the three consumers are LLM sessions reading a
// payload that carries BOTH parts, not regexes matching lines.

type RowTone = "normal" | "overdue" | "due-soon";

interface BriefRow {
  /** Tier 1: the thing itself. Never truncated mid-word. */
  headline: string;
  /** Tier 2: sourcing, dates, owner — muted, one line. */
  meta?: string;
  tone?: RowTone;
}

interface BriefSection {
  /** Display label. May differ from the machine-readable key. */
  label: string;
  rows: BriefRow[];
  /** Muted line under the label — counts, filter explanation. */
  summary?: string;
  /** Muted line after the rows — "N more …". */
  footnote?: string;
}

const C = {
  page: "#f9f9f7", card: "#fcfcfb", ink: "#0b0b0b", secondary: "#52514e",
  muted: "#898781", hairline: "#e1e0d9", link: "#2a78d6",
  overdue: "#d03b3b", dueSoon: "#fab219",
  serif: "Georgia,'Times New Roman',serif",
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
};

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Trim to `max` on a WORD boundary with an ellipsis — never mid-word.
 * Defect 2 in the 2026-08-08 ticket: the old code sliced at a character count,
 * producing "…services to adop" and "…joins Jonatha".
 */
export function trimWords(s: string, max: number): string {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-—–]+$/, "") + "…";
}

/**
 * Email HTML: tables only, all CSS inline, no flexbox/grid/web fonts/background
 * images, single column, 640px. Light surface deliberately — Gmail dark mode
 * inverts the old amber-on-dark card badly.
 */
function renderBriefHtml(
  workspaceName: string,
  generatedLabel: string,
  sections: BriefSection[],
  footerNote: string,
): string {
  const label = (text: string) =>
    `<tr><td style="padding:26px 0 8px 0;border-bottom:1px solid ${C.hairline}"><span style="font-family:${C.sans};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:${C.secondary}">${esc(text)}</span></td></tr>`;

  const summary = (text: string) =>
    `<tr><td style="padding:10px 0 0 0;font-family:${C.sans};font-size:12px;color:${C.muted}">${esc(text)}</td></tr>`;

  const row = (r: BriefRow) => {
    const rule = r.tone === "overdue"
      ? `border-left:3px solid ${C.overdue};padding-left:12px;`
      : r.tone === "due-soon" ? `border-left:3px solid ${C.dueSoon};padding-left:12px;` : "";
    const head = `<div style="font-family:${C.sans};font-size:15px;font-weight:600;line-height:1.35;color:${r.tone === "overdue" ? C.overdue : C.ink}">${esc(r.headline)}</div>`;
    const meta = r.meta
      ? `<div style="font-family:${C.sans};font-size:12px;font-weight:400;line-height:1.4;color:${C.muted};padding-top:3px">${esc(r.meta)}</div>`
      : "";
    return `<tr><td style="padding:12px 0 0 0"><div style="${rule}">${head}${meta}</div></td></tr>`;
  };

  const body = sections.map((s) => {
    const inner = [
      label(s.label),
      s.summary ? summary(s.summary) : "",
      ...s.rows.map(row),
      s.footnote
        ? `<tr><td style="padding:10px 0 0 0;font-family:${C.sans};font-size:12px;color:${C.muted}">${esc(s.footnote)}</td></tr>`
        : "",
    ].join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse">${inner}</table>`;
  }).join("");

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:${C.page};margin:0;padding:0">`,
    `<tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px;max-width:640px;background:${C.card};border:1px solid ${C.hairline};border-radius:4px">`,
    `<tr><td style="padding:28px 28px 0 28px">`,
    `<div style="font-family:${C.serif};font-size:26px;font-weight:400;color:${C.ink};letter-spacing:-.01em">${esc(workspaceName)} Brief</div>`,
    `<div style="font-family:${C.sans};font-size:12px;color:${C.muted};padding-top:4px">${esc(generatedLabel)}</div>`,
    `</td></tr>`,
    `<tr><td style="padding:0 28px 28px 28px">${body}</td></tr>`,
    `<tr><td style="padding:0 28px 24px 28px;border-top:1px solid ${C.hairline}">`,
    `<div style="font-family:${C.sans};font-size:12px;color:${C.muted};padding-top:14px">`,
    `<a href="https://mpoppa32.github.io/FLi-Network/FLiIntel.html" style="color:${C.link};text-decoration:none">Open Corsair</a>`,
    ` · Manage subscription: Email Digest button on the Brief view`,
    footerNote ? `<br>${esc(footerNote)}` : "",
    `</div></td></tr>`,
    `</table></td></tr></table>`,
  ].join("");
}

/**
 * The single definition of "is this action item still open", shared with the
 * `operatorData` endpoint the same way `sortOpenCommitments` already is.
 *
 * It exists because the two disagreed: the digest's HIGH PRIORITY ACTIONS
 * filtered completed items while `operatorData`'s `openActionItems` did not,
 * so the headless operator layer read finished work as outstanding. Two call
 * sites, two definitions of "open", one of them wrong.
 *
 * Meeting action items (`meetings/*​/intel/actionItems[]`) mark completion with
 * a boolean `done` — the convention the front end uses in every one of its own
 * filters (`!a.done`). Deliberately NOT a general "is this record active"
 * helper: commitments use `status`, action items use `done`, and conflating
 * those two shapes is how the next drift starts.
 */
export function isOpenActionItem(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  return !(item as { done?: unknown }).done;
}

/**
 * How many commitments `commitmentsAutoArchive` archived in the last `windowMs`.
 *
 * Matches on the note prefix the job writes, so a MANUAL archive is never
 * counted — the line claims the job did something, and it must only say that
 * when the job actually did. Undated `archivedAt` records are skipped rather
 * than assumed recent.
 */
export function countRecentAutoArchived(
  commitments: unknown[],
  nowMs: number,
  windowMs = 86400000,
): number {
  return (commitments as any[]).filter((c: any) => {
    if (!c || c.status !== "archived") return false;
    if (!String(c.archiveNote ?? "").startsWith("auto-archived:")) return false;
    const t = Date.parse(String(c.archivedAt ?? ""));
    return Number.isFinite(t) && nowMs - t <= windowMs && nowMs - t >= 0;
  }).length;
}

/**
 * High-priority action items in operator-useful order.
 *
 * Replaces a first-8-in-key-order slice, which was arbitrary on every axis:
 * not the most urgent, not the most recent, and stable — so the same eight
 * items could sit in the brief indefinitely while genuinely urgent ones
 * never surfaced at all.
 *
 * Contract (pinned in dailyBriefDigest.test.ts):
 *   1. drop completed items (`a.done`) and anything not priority "high"
 *   2. sort by deadline ascending — overdue rises to the top; dated before undated
 *   3. tiebreak by source-meeting recency, newest first
 *   4. cap at `cap` (8 in the digest)
 *
 * DELIBERATELY STATELESS — no persistence, no "already shown" memory, no
 * rotation. An urgent item that keeps reappearing is pressure by design, not
 * staleness: hiding it on alternate days to manufacture variety would defeat
 * the accountability loop.
 *
 * CORRECTED 2026-08-11 (Rule 14). This comment previously justified the
 * statelessness by asserting that "the anti-squat mechanism lives at the
 * right cadence in the WEEKLY digest's staleness sentinel." NO SUCH JOB
 * EXISTS. index.ts exports `dailyBriefDigest` and `triggerBriefDigestTest`
 * and nothing else digest-shaped; the five `*Weekly.ts` jobs are all OSINT
 * source connectors. There is therefore NO second layer — an item can squat
 * in this list indefinitely with nothing flagging it, which is exactly what
 * happened: 43 action items in Atlas were 42-105 days overdue on 2026-08-11
 * with no cadence surfacing them (see corsair-staleness-inventory-v1.md).
 * The statelessness decision may still be correct; the reason given for it
 * was not true. Do not restore the claim without building the job.
 *
 * Rotation would also mean this read-only job starts writing state; CT-1b is
 * the standing lesson on casually-added write paths (see LOG 2026-08-05).
 */
export function selectHighPriorityActions(
  meetings: unknown[],
  nowMs: number,
  cap = 8,
): any[] {
  const out: any[] = [];
  (meetings as any[]).forEach((m: any) => {
    const items = (m && m.intel && m.intel.actionItems) || [];
    // Same recency idiom as operatorData's dossier sort: meta.date, then ts.
    const mtgMs = Date.parse(m?.meta?.date || m?.ts || 0) || 0;
    items.forEach((a: any) => {
      // isOpenActionItem, not an inline `!a.done` — the endpoint uses the same
      // predicate, and an inline copy is exactly how the two drifted before.
      if (a && a.priority === "high" && isOpenActionItem(a)) {
        out.push({ ...a, mtg: m.meta && m.meta.title, _mtgMs: mtgMs });
      }
    });
  });
  return out
    .sort((a: any, b: any) => {
      const ta = a.deadline ? Date.parse(`${a.deadline}T00:00:00`) : NaN;
      const tb = b.deadline ? Date.parse(`${b.deadline}T00:00:00`) : NaN;
      const va = !isNaN(ta);
      const vb = !isNaN(tb);
      if (va && vb && ta !== tb) return ta - tb;
      if (va !== vb) return va ? -1 : 1;
      return b._mtgMs - a._mtgMs;
    })
    .slice(0, cap)
    .map((a: any) => {
      const t = a.deadline ? Date.parse(`${a.deadline}T00:00:00`) : NaN;
      const overdueDays = !isNaN(t) ? Math.floor((nowMs - t) / 86400000) : 0;
      return { ...a, overdueDays: overdueDays > 0 ? overdueDays : 0 };
    });
}

function _isoWeek(d: Date = new Date()): string {
  // Returns YYYY-Www format for weekly de-dupe
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return d.getUTCFullYear() + "-W" + String(weekNumber).padStart(2, "0");
}

export async function composeBrief(
  workspaceId: string,
  workspaceName: string,
  sub: BriefSubscription,
  db: admin.database.Database
): Promise<{ subject: string; text: string; html: string }> {
  const wsRef = db.ref(`workspaces/${workspaceId}`);
  const [oppsSnap, meetingsSnap, commitmentsSnap, calRecordsSnap, briefSnap, factChangesSnap, memberSnap, slackFeedSnap] = await Promise.all([
    wsRef.child("opportunities").once("value"),
    wsRef.child("meetings").once("value"),
    wsRef.child("commitments").once("value"),
    wsRef.child("calibration").once("value"),
    wsRef.child("derivedViews/dailyBrief/latest").once("value"),
    wsRef.child("factChanges").once("value"),
    wsRef.child(`members/${sub.uid}`).once("value"),
    wsRef.child("slackFeed").once("value"),
  ]);

  const opps = oppsSnap.val() ? Object.values(oppsSnap.val() as Record<string, any>) : [];
  const meetings = meetingsSnap.val() ? Object.values(meetingsSnap.val() as Record<string, any>) : [];
  const commitments = commitmentsSnap.val() ? Object.values(commitmentsSnap.val() as Record<string, any>) : [];
  const calRecords = calRecordsSnap.val() ? Object.values(calRecordsSnap.val() as Record<string, any>) : [];

  const activeOpps = (opps as any[]).filter((o: any) => o && o.stage !== "won" && o.stage !== "lost");

  const lines: string[] = [];
  // Emitted in the same pass as `lines`, from the same data. The plaintext
  // pushes below are untouched by the redesign — that is what makes the parser
  // guarantee provable by snapshot rather than argued (P13.401).
  const htmlSections: BriefSection[] = [];
  lines.push(`CORSAIR DAILY BRIEF — ${workspaceName}`);
  lines.push(`Generated: ${new Date().toUTCString()}`);
  lines.push("");

  // Overnight intelligence — the synthesized OSINT Brief (signals / awards /
  // opportunities scored by relevance). briefSynthesisNightly persists this to
  // derivedViews/dailyBrief/latest at 05:00 UTC; this email fires at 11:00 UTC,
  // so `latest` is ~6h fresh. We lead with it so the morning email reads like an
  // intelligence brief, not just a CRM recap. Degrades to nothing if synthesis
  // hasn't run (missing snap or zero items).
  if (sub.incIntel !== false) {
    const brief = briefSnap.val() as BriefOutput | null;
    if (brief && brief.itemsByCategory) {
      const cats: Array<BriefItem["category"]> = ["pursuit", "adversary", "customer", "capability", "context"];
      const catTag: Record<string, string> = {
        pursuit: "PURSUIT", adversary: "ADVERSARY", customer: "CUSTOMER",
        capability: "CAPABILITY", context: "CONTEXT",
      };
      const allItems: BriefItem[] = [];
      for (const c of cats) {
        const arr = brief.itemsByCategory[c];
        if (Array.isArray(arr)) allItems.push(...arr);
      }
      // Highest-relevance first across all categories; the synthesis already
      // sorts within a category, this orders the cross-category top slice.
      allItems.sort((a, b) => (b.relevance?.total ?? 0) - (a.relevance?.total ?? 0));
      const top = allItems.slice(0, 8);
      if (top.length) {
        const ageH = Math.max(0, Math.round((Date.now() - (brief.generatedAt || 0)) / 3600000));
        const ageLabel = ageH < 48
          ? `synthesized ${ageH}h ago`
          : `synthesized ${Math.round(ageH / 24)}d ago (stale — check source syncs)`;
        const sig = brief.counts?.signals ?? 0;
        const awd = brief.counts?.awards ?? 0;
        // Decode the common scraped HTML entities, then strip any literal angle
        // brackets — external text (filer/protest names, think-tank summaries)
        // carries both, and the email HTML render is unescaped. Belt-and-
        // suspenders: `latest` may predate the source-side decode in signalToItem.
        const clean = (s: string) => (s || "")
          .replace(/&#(\d+);/g, (m, n) => { const c = parseInt(n, 10); return Number.isFinite(c) && c !== 60 && c !== 62 ? String.fromCodePoint(c) : m; })
          .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
          .replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’")
          .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
          .replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ")
          .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
          .replace(/[<>]/g, "").trim();
        lines.push("=== OVERNIGHT INTELLIGENCE ===");
        lines.push(`${brief.totalItems} scored items · ${sig} signals, ${awd} awards · ${ageLabel}`);
        top.forEach((it) => {
          const title = clean(it.title) || "(untitled)";
          const subtitle = clean(it.subtitle).slice(0, 90);
          const conf = (typeof it.confidence === "number" && it.confidence < 0.85)
            ? ` · conf ${Math.round(it.confidence * 100)}%`
            : "";
          const tag = catTag[it.category] || String(it.category).toUpperCase();
          lines.push(`• [${tag}] ${title}${subtitle ? " — " + subtitle : ""} (${it.source})${conf}`);
        });
        lines.push("");
        // HTML: the SAME items, dressed differently. Three departures from the
        // plaintext above, all of them the point of this redesign:
        //   · no [TAG] prefix — a label on 100% of items carries no information
        //   · subtitle trimmed on a WORD boundary from the FULL source string,
        //     not the plaintext's 90-char mid-word slice
        //   · top 3 only, with a "N more" line. The PLAINTEXT KEEPS ALL ITEMS —
        //     meeting prep reads this section as a haystack for whoever Mike is
        //     meeting, so pre-filtering the data would hide a counterparty from
        //     a live routine. Presentation solves the visual problem; the data
        //     layer does not move.
        htmlSections.push({
          label: "Overnight intelligence",
          rows: top.slice(0, 3).map((it) => ({
            headline: clean(it.title) || "(untitled)",
            meta: [it.source, trimWords(clean(it.subtitle), 150)].filter(Boolean).join(" · "),
          })),
          footnote: top.length > 3
            ? `${top.length - 3} more signal${top.length - 3 === 1 ? "" : "s"} · view in Corsair`
            : undefined,
        });
      }
    }
  }

  // Master sheet changes — the value edits factsSheetSync detected on the Atlas
  // master since the last digest. Closes the loop from "the sync caught a real
  // edit autonomously" to "the operator actually sees it in the morning email."
  // The ring buffer at factChanges holds up to 50 recent entries; we window to
  // the subscriber's cadence (daily → ~26h, weekly → ~8d) so nothing is missed
  // and near-boundary edits at worst repeat once.
  //
  // VISIBILITY: fail-safe like the rest of the Truth Hub. Only Owner/Admin
  // subscribers (the same privilege check the app uses everywhere:
  // role ∈ {Owner, Admin}) see internal-classified edits. Analyst/Observer —
  // and any subscriber with an unrecognized/missing role — get customer-safe
  // edits only, with a count of how many internal edits were withheld. We read
  // each fact's CURRENT visibility (not a snapshot taken at change time) so an
  // operator reclassification always wins, and default-deny anything we can't
  // resolve (missing fact, missing/!customer-safe visibility → treated internal).
  if (sub.incFactChanges !== false) {
    const rawChanges = factChangesSnap.val();
    const changes: any[] = Array.isArray(rawChanges)
      ? rawChanges
      : rawChanges && typeof rawChanges === "object"
        ? Object.values(rawChanges)
        : [];
    const windowMs = sub.frequency === "weekly" ? 8 * 86400000 : 26 * 3600000;
    const cutoff = Date.now() - windowMs;
    const esc = (s: unknown) => String(s ?? "").replace(/[<>]/g, "").trim();
    const pretty = (s: unknown) => esc(s).replace(/_/g, " ");
    const recent = changes
      .filter((c: any) => c && typeof c.at === "number" && c.at >= cutoff)
      .sort((a: any, b: any) => (b.at ?? 0) - (a.at ?? 0));

    // Privilege gate — mirrors the app's isOwner/isAdmin check (role ∈ {Owner,Admin}).
    const role = String(memberSnap.val()?.role ?? "").toLowerCase();
    const trustedInternal = role === "owner" || role === "admin";

    let visible = recent;
    let withheld = 0;
    if (!trustedInternal && recent.length) {
      // Resolve each changed fact's CURRENT visibility; default-deny on miss.
      const ids = [...new Set(recent.map((c: any) => c.id).filter(Boolean))];
      const visSnaps = await Promise.all(
        ids.map((id) => wsRef.child(`facts/${id}/visibility`).once("value"))
      );
      const visMap: Record<string, unknown> = {};
      ids.forEach((id, i) => { visMap[String(id)] = visSnaps[i].val(); });
      visible = recent.filter((c: any) => visMap[String(c.id)] === "customer-safe");
      withheld = recent.length - visible.length;
    }

    if (visible.length || withheld) {
      const label = sub.frequency === "weekly" ? "last 7d" : "last 24h";
      lines.push(`=== MASTER SHEET CHANGES (${label}) ===`);
      if (visible.length) {
        lines.push(`${visible.length} value ${visible.length === 1 ? "edit" : "edits"} synced from the Atlas master`);
      }
      visible.slice(0, 12).forEach((c: any) => {
        const name = pretty(c.label) || "(fact)";
        lines.push(
          c.from === null || c.from === undefined
            ? `• ${name}: ${esc(c.to)} (new)`
            : `• ${name}: ${esc(c.from)} → ${esc(c.to)}`
        );
      });
      htmlSections.push({
        label: "Master sheet changes",
        summary: visible.length
          ? `${visible.length} value ${visible.length === 1 ? "edit" : "edits"} synced from the Atlas master`
          : undefined,
        rows: visible.slice(0, 12).map((c: any) => ({
          headline: pretty(c.label) || "(fact)",
          meta: c.from === null || c.from === undefined ? `${c.to} (new)` : `${c.from} → ${c.to}`,
        })),
        footnote: withheld
          ? `${withheld} internal ${withheld === 1 ? "edit" : "edits"} hidden · view in Corsair`
          : undefined,
      });
      if (withheld) {
        lines.push(`${withheld} internal ${withheld === 1 ? "edit" : "edits"} hidden — view in Corsair`);
      }
      lines.push("");
    }
  }

  // Atlas Slack — recent messages the intake pulled from the Atlas channels
  // (build C). SURFACED, not authoritative: this is "what was said in Slack,"
  // never a fact source. Window sized to the subscriber's cadence.
  if (sub.incSlack !== false) {
    const rawFeed = slackFeedSnap.val();
    const feed: any[] = Array.isArray(rawFeed)
      ? rawFeed
      : rawFeed && typeof rawFeed === "object" ? Object.values(rawFeed) : [];
    const windowMs = sub.frequency === "weekly" ? 8 * 86400000 : 26 * 3600000;
    const cutoff = Date.now() - windowMs;
    const clip = (s: unknown) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
    const recent = feed
      .filter((m: any) => m && typeof m.atMs === "number" && m.atMs >= cutoff && (m.text || (m.fileNames && m.fileNames.length)))
      .sort((a: any, b: any) => (b.atMs ?? 0) - (a.atMs ?? 0));
    if (recent.length) {
      const label = sub.frequency === "weekly" ? "last 7d" : "last 24h";
      const chans = new Set(recent.map((m: any) => m.channel));
      lines.push(`=== ATLAS SLACK (${label}) ===`);
      lines.push(`${recent.length} message${recent.length === 1 ? "" : "s"} across ${chans.size} channel${chans.size === 1 ? "" : "s"}`);
      recent.slice(0, 14).forEach((m: any) => {
        const who = clip(m.user) || "someone";
        const body = clip(m.text).slice(0, 140);
        const files = m.fileNames && m.fileNames.length ? ` [${m.fileNames.length} file${m.fileNames.length === 1 ? "" : "s"}]` : "";
        lines.push(`• #${clip(m.channel)} — ${who}: ${body}${files}`);
      });
      lines.push("");
      htmlSections.push({
        label: "Atlas Slack",
        summary: `${recent.length} message${recent.length === 1 ? "" : "s"} across ${chans.size} channel${chans.size === 1 ? "" : "s"}`,
        rows: recent.slice(0, 14).map((m: any) => ({
          // Word-boundary trim from the FULL text, not the plaintext's
          // 140-char mid-word slice.
          headline: trimWords(clip(m.text), 140) || "(no text)",
          meta: [`#${clip(m.channel)}`, clip(m.user) || "someone",
            m.fileNames && m.fileNames.length ? `${m.fileNames.length} file${m.fileNames.length === 1 ? "" : "s"}` : null]
            .filter(Boolean).join(" · "),
        })),
      });
    }
  }

  if (sub.incPipeline !== false && activeOpps.length) {
    lines.push("=== PIPELINE ===");
    lines.push(`${activeOpps.length} active pursuits`);
    activeOpps.slice(0, 5).forEach((o: any) => {
      lines.push(`• ${o.name || "(unnamed)"} — ${o.stage}${o.agency ? " at " + o.agency : ""}`);
    });
    lines.push("");
    htmlSections.push({
      label: "Pipeline",
      summary: `${activeOpps.length} active pursuit${activeOpps.length === 1 ? "" : "s"}`,
      rows: activeOpps.slice(0, 5).map((o: any) => ({
        headline: String(o.name || "(unnamed)"),
        meta: [o.stage, o.agency].filter(Boolean).join(" · "),
      })),
    });
  }

  if (sub.incActions !== false && meetings.length) {
    const highActions = selectHighPriorityActions(meetings as unknown[], Date.now(), 8);
    if (highActions.length) {
      lines.push("=== HIGH PRIORITY ACTIONS ===");
      highActions.forEach((a: any) => {
        const due = a.deadline
          ? ` (Due: ${a.deadline}${a.overdueDays > 0 ? ` — ${a.overdueDays}d overdue` : ""})`
          : "";
        lines.push(`• ${a.task}${a.owner ? ` [${a.owner}]` : ""}${due}`);
      });
      lines.push("");
      htmlSections.push({
        label: "Needs you today",
        rows: highActions.map((a: any) => ({
          headline: String(a.task || "Action"),
          meta: [a.owner, a.deadline ? (a.overdueDays > 0 ? `${a.overdueDays}d overdue` : `due ${a.deadline}`) : null]
            .filter(Boolean).join(" · ") || undefined,
          tone: a.overdueDays > 0 ? "overdue" : "normal",
        })),
      });
    }
  }

  if (sub.incRisks !== false && meetings.length) {
    const highRisks: any[] = [];
    (meetings as any[]).forEach((m: any) => {
      const items = (m && m.intel && m.intel.risks) || [];
      items.forEach((r: any) => {
        if (r && r.severity === "high") {
          highRisks.push({ ...r, mtg: m.meta && m.meta.title });
        }
      });
    });
    if (highRisks.length) {
      lines.push("=== HIGH RISKS ===");
      highRisks.slice(0, 5).forEach((r: any) => {
        lines.push(`• ${r.risk}${r.raisedBy ? ` (raised by ${r.raisedBy})` : ""}`);
      });
      lines.push("");
      htmlSections.push({
        label: "High risks",
        rows: highRisks.slice(0, 5).map((r: any) => ({
          headline: String(r.risk || "Risk"),
          meta: [r.raisedBy ? `raised by ${r.raisedBy}` : null, r.mtg].filter(Boolean).join(" · ") || undefined,
          tone: "overdue" as RowTone,
        })),
      });
    }
  }

  // Closed-deal recap (last 30d) — surfaces Win/Loss activity
  const cutoff = Date.now() - 30 * 86400000;
  const recentClosed = (calRecords as any[]).filter((r: any) => {
    if (!r || !r.closedAt) return false;
    const t = Date.parse(r.closedAt);
    return !isNaN(t) && t >= cutoff;
  });
  if (recentClosed.length) {
    lines.push("=== CLOSED DEALS (last 30d) ===");
    recentClosed.forEach((r: any) => {
      lines.push(`• ${r.outcome === "won" ? "🏆 WON" : "❌ LOST"}: ${r.oppName || r.oppId} ${r.value ? `($${r.value})` : ""}`);
    });
    lines.push("");
    htmlSections.push({
      label: "Closed deals (last 30d)",
      rows: recentClosed.map((r: any) => ({
        headline: String(r.oppName || r.oppId || "Deal"),
        meta: [r.outcome === "won" ? "Won" : "Lost", r.value ? `$${r.value}` : null].filter(Boolean).join(" · "),
      })),
    });
  }

  // Commitments due soon
  const now = Date.now();
  const due7d = (commitments as any[]).filter((c: any) => {
    if (!c || c.status !== "open" || !c.deadline) return false;
    const t = Date.parse(`${c.deadline}T00:00:00`);
    return !isNaN(t) && t - now <= 7 * 86400000;
  });
  if (due7d.length) {
    lines.push("=== DUE THIS WEEK ===");
    due7d.slice(0, 10).forEach((c: any) => {
      const t = Date.parse(`${c.deadline}T00:00:00`);
      const days = Math.ceil((t - now) / 86400000);
      const when = days < 0 ? `${-days}d overdue` : days === 0 ? "today" : `in ${days}d`;
      lines.push(`• ${c.task || c.title || "Commitment"} — ${when}`);
    });
    lines.push("");
    const overdueCount = due7d.filter((c: any) => Date.parse(`${c.deadline}T00:00:00`) < now).length;
    htmlSections.push({
      label: "Due this week",
      summary: overdueCount > 0
        ? `${overdueCount} overdue of ${due7d.length}`
        : `${due7d.length} due in the next 7 days`,
      rows: due7d.slice(0, 10).map((c: any) => {
        const days = Math.ceil((Date.parse(`${c.deadline}T00:00:00`) - now) / 86400000);
        return {
          headline: String(c.task || c.title || "Commitment"),
          meta: [c.owner, days < 0 ? `${-days}d overdue` : days === 0 ? "due today" : `due in ${days}d`]
            .filter(Boolean).join(" · "),
          tone: (days < 0 ? "overdue" : days <= 1 ? "due-soon" : "normal") as RowTone,
        };
      }),
    });
  }

  // ALL open commitments, deadline or not. The DUE-THIS-WEEK block above only
  // ever shows the 7-day window (and caps at 10), so a large undated tail —
  // and everything further out — was invisible to anyone reading the email.
  // That matters most for the headless operator tasks (Cowork morning brief /
  // meeting prep), which read this digest as their view of the commitment book.
  if (sub.incCommitments !== false) {
    const openCommits = sortOpenCommitments(commitments as unknown[]);
    if (openCommits.length) {
      lines.push("=== OPEN COMMITMENTS ===");
      lines.push(`${openCommits.length} open total`);
      openCommits.slice(0, 8).forEach((c: any) => {
        const task = String(c.task || c.title || "Commitment").replace(/[<>]/g, "").trim();
        const when = c.deadline ? ` (due ${c.deadline})` : " (no deadline)";
        const who = c.owner ? ` [${String(c.owner).replace(/[<>]/g, "")}]` : "";
        lines.push(`• ${task}${who}${when}`);
      });
      if (openCommits.length > 8) {
        lines.push(`…and ${openCommits.length - 8} more — open Corsair to see all`);
      }
      lines.push("");
      htmlSections.push({
        label: "Open commitments",
        summary: `${openCommits.length} open total`,
        rows: openCommits.slice(0, 8).map((c: any) => ({
          headline: String(c.task || c.title || "Commitment").replace(/[<>]/g, "").trim(),
          meta: [c.owner, c.deadline ? `due ${c.deadline}` : "no deadline"].filter(Boolean).join(" · "),
        })),
        footnote: openCommits.length > 8 ? `${openCommits.length - 8} more · view in Corsair` : undefined,
      });
    }
  }

  // Nothing vanishes silently (Rule 11). commitmentsAutoArchive runs at 04:30
  // UTC and moves stale opens to status:'archived'; without this line they
  // would simply stop appearing above and the operator would never be told.
  // Counted from the records themselves — auto-archived within the last 24h —
  // rather than from a state file the job writes, so the job stays a
  // single-purpose writer (CT-1b is the lesson on extra write paths).
  const archivedRecently = countRecentAutoArchived(commitments as unknown[], Date.now());
  if (archivedRecently > 0) {
    lines.push(`ARCHIVED ${archivedRecently} STALE (>30d, unscheduled)`);
    lines.push("");
  }

  lines.push("---");
  lines.push("Open Corsair: https://mpoppa32.github.io/FLi-Network/FLiIntel.html");
  lines.push("Manage subscription: 📧 Email Digest button on the Brief view");

  const text = lines.join("\n");

  // P13.401 — HTML is now rendered from `htmlSections`, NOT from `text`.
  // Rule 11 applied to presentation: a section that has no rows still prints
  // its label and an explicit empty line. Absence must never read as calm.
  // APPENDED, never unshifted. `unshift` put an EMPTY section at position 1 —
  // above "Needs you today" — so a quiet-signal day opened by announcing that
  // nothing happened and pushed the actions down, on exactly the days the
  // actions should lead hardest. Fail-loudly is right; fail-loudly-at-the-top
  // inverts the ordering principle this redesign exists to establish.
  //
  // This is also the ONE documented exception to HTML↔plaintext section
  // parity: it emits an HTML section the plaintext deliberately has none of,
  // because the plaintext simply omits an empty OVERNIGHT INTELLIGENCE block.
  // The parity test below encodes this exception explicitly so it reads as
  // intent rather than as drift.
  if (!htmlSections.some((s) => s.label === "Overnight intelligence")) {
    htmlSections.push({ label: "Overnight intelligence", rows: [], summary: "No signals cleared the bar." });
  }
  const html = renderBriefHtml(
    workspaceName,
    `Generated ${new Date().toUTCString()}`,
    htmlSections,
    archivedRecently > 0 ? `Archived ${archivedRecently} stale (>30d, unscheduled).` : "",
  );

  // The line-to-div transform and its dark wrapper are GONE (P13.401). They
  // are what made hierarchy impossible and what inverted badly in Gmail dark
  // mode. `renderBriefHtml` above replaces both.

  const subject = `Corsair Brief — ${workspaceName} — ${_isoDate()}`;
  return { subject, text, html };
}

export async function sendOne(
  sub: BriefSubscription,
  composed: { subject: string; text: string; html: string },
  log: any
): Promise<boolean> {
  // P13.379 — send from the subscriber's own connected Gmail grant
  // (users/{uid}/captureAuth/google) rather than SendGrid. gmailSend logs
  // success/failure and never throws, so one bad send won't abort the batch.
  return sendViaGmail(
    sub.uid,
    { to: sub.email, subject: composed.subject, text: composed.text, html: composed.html },
    log
  );
}

export const dailyBriefDigest = onSchedule(
  {
    schedule: "0 11 * * *", // 11:00 UTC daily ≈ 7am ET
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    retryCount: 1,
    secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
  },
  async (event) => {
    const jobId = generateJobId("dailyBriefDigest");
    const log = createLogger({ source: "brief_digest", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    const db = admin.database();
    const today = _isoDate();
    const thisWeek = _isoWeek();

    // Iterate every workspace
    const wsSnap = await db.ref("workspaces").once("value");
    if (!wsSnap.exists()) {
      log.info("no_workspaces");
      return;
    }
    const workspaces = wsSnap.val() as Record<string, any>;
    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const wsId of Object.keys(workspaces)) {
      const ws = workspaces[wsId];
      const wsName: string = (ws && ws.info && ws.info.name) || wsId;
      const subs = (ws && ws.brief_subscriptions) || {};
      const subKeys = Object.keys(subs);
      if (!subKeys.length) continue;

      // P13.125 — cast: wsName is a useful debug breadcrumb but isn't on
      // the strict LoggerContext type. Wider logger typing fix is a
      // follow-on; this unblocks the deploy.
      const wsLog = log.child({ workspace: wsId, wsName } as any);

      for (const uid of subKeys) {
        const sub = subs[uid] as BriefSubscription;
        if (!sub || !sub.email) {
          totalSkipped++;
          continue;
        }

        // Frequency gate
        let dueKey: string;
        if (sub.frequency === "daily") {
          dueKey = today;
        } else if (sub.frequency === "weekly") {
          dueKey = thisWeek;
          // Only fire weekly on Mondays
          if (new Date().getUTCDay() !== 1) {
            totalSkipped++;
            continue;
          }
        } else {
          // 'pipeline' frequency = event-driven, not this job's concern
          totalSkipped++;
          continue;
        }

        if (sub.lastSent === dueKey) {
          totalSkipped++;
          continue;
        }

        try {
          const composed = await composeBrief(wsId, wsName, sub, db);
          const ok = await sendOne(sub, composed, wsLog);
          if (ok) {
            await db
              .ref(`workspaces/${wsId}/brief_subscriptions/${uid}/lastSent`)
              .set(dueKey);
            totalSent++;
          } else {
            totalFailed++;
          }
        } catch (err) {
          const e = err as Error;
          wsLog.error("compose_or_send_threw", { uid, message: e.message || String(err) });
          totalFailed++;
        }
      }
    }

    log.info("job_completed", { totalSent, totalSkipped, totalFailed });
  }
);
