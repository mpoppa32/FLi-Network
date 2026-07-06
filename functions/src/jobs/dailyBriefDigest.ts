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
  const [oppsSnap, meetingsSnap, commitmentsSnap, calRecordsSnap, briefSnap, factChangesSnap, memberSnap] = await Promise.all([
    wsRef.child("opportunities").once("value"),
    wsRef.child("meetings").once("value"),
    wsRef.child("commitments").once("value"),
    wsRef.child("calibration").once("value"),
    wsRef.child("derivedViews/dailyBrief/latest").once("value"),
    wsRef.child("factChanges").once("value"),
    wsRef.child(`members/${sub.uid}`).once("value"),
  ]);

  const opps = oppsSnap.val() ? Object.values(oppsSnap.val() as Record<string, any>) : [];
  const meetings = meetingsSnap.val() ? Object.values(meetingsSnap.val() as Record<string, any>) : [];
  const commitments = commitmentsSnap.val() ? Object.values(commitmentsSnap.val() as Record<string, any>) : [];
  const calRecords = calRecordsSnap.val() ? Object.values(calRecordsSnap.val() as Record<string, any>) : [];

  const activeOpps = (opps as any[]).filter((o: any) => o && o.stage !== "won" && o.stage !== "lost");

  const lines: string[] = [];
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
      if (withheld) {
        lines.push(`${withheld} internal ${withheld === 1 ? "edit" : "edits"} hidden — view in Corsair`);
      }
      lines.push("");
    }
  }

  if (sub.incPipeline !== false && activeOpps.length) {
    lines.push("=== PIPELINE ===");
    lines.push(`${activeOpps.length} active pursuits`);
    activeOpps.slice(0, 5).forEach((o: any) => {
      lines.push(`• ${o.name || "(unnamed)"} — ${o.stage}${o.agency ? " at " + o.agency : ""}`);
    });
    lines.push("");
  }

  if (sub.incActions !== false && meetings.length) {
    const highActions: any[] = [];
    (meetings as any[]).forEach((m: any) => {
      const items = (m && m.intel && m.intel.actionItems) || [];
      items.forEach((a: any) => {
        if (a && a.priority === "high") {
          highActions.push({ ...a, mtg: m.meta && m.meta.title });
        }
      });
    });
    if (highActions.length) {
      lines.push("=== HIGH PRIORITY ACTIONS ===");
      highActions.slice(0, 8).forEach((a: any) => {
        lines.push(`• ${a.task}${a.owner ? ` [${a.owner}]` : ""}${a.deadline ? ` (Due: ${a.deadline})` : ""}`);
      });
      lines.push("");
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
  }

  lines.push("---");
  lines.push("Open Corsair: https://mpoppa32.github.io/FLi-Network/FLiIntel.html");
  lines.push("Manage subscription: 📧 Email Digest button on the Brief view");

  const text = lines.join("\n");
  const html = text
    .split("\n")
    .map((line) => {
      if (line.startsWith("===")) {
        return `<h3 style="margin:14px 0 4px;color:#d4823a;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;border-bottom:1px solid #1a2236;padding-bottom:3px">${line.replace(/===/g, "").trim()}</h3>`;
      }
      if (line.startsWith("•")) {
        return `<div style="font-size:13px;color:#e4e4e7;margin:3px 0 3px 12px">${line}</div>`;
      }
      if (line.startsWith("CORSAIR")) {
        return `<div style="font-family:'Antonio',sans-serif;font-size:20px;font-weight:700;color:#fff;margin-bottom:4px">${line}</div>`;
      }
      if (line.startsWith("Generated:") || line.startsWith("---") || line.startsWith("Open Corsair") || line.startsWith("Manage")) {
        return `<div style="font-size:11px;color:#71717a;margin:2px 0">${line}</div>`;
      }
      if (!line.trim()) return "<br>";
      return `<div style="font-size:13px;color:#a1a1aa;margin:2px 0">${line}</div>`;
    })
    .join("");

  const htmlWrapped = `<div style="background:#0a1020;padding:24px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e4e4e7;max-width:680px;margin:0 auto">${html}</div>`;

  const subject = `Corsair Brief — ${workspaceName} — ${_isoDate()}`;
  return { subject, text, html: htmlWrapped };
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
