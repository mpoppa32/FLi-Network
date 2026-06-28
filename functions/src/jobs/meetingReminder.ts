// Corsair — scheduled job: per-meeting EMAIL reminders
//
// Complements the in-app desktop notification (FLiIntel.html _corsairNotifications),
// which only fires while the Corsair browser tab is open. This server-side job
// emails an opted-in brief subscriber ~0-30 min before each meeting, so a
// reminder still lands when Corsair is closed or the laptop is asleep.
//
// Runs every 15 min. For each workspace it reads ONLY:
//   - brief_subscriptions (recipients; opt out via meetingReminders:false)
//   - meetings in the [now-5min, now+30min] window (indexed range query — not
//     the whole 400+ meeting node, and never the heavy signals/nodes subtrees)
//   - _meetingRemindersSent (per-meeting dedupe; pruned after 2 days)
// Reuses the SendGrid sender + secrets from dailyBriefDigest. No-ops if the
// SendGrid secrets are unset (logs "secrets_missing").
//
// The meeting instant lives in top-level `ts` (numeric ms on calendar-sourced
// meetings; ISO string on older email ones) — meta.date is UTC-rolled and is
// NOT used for timing. Times are displayed in America/Los_Angeles (operator's
// zone); per-user timezone is a later enhancement.

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { createLogger, generateJobId } from "../framework/logger";
import { sendOne, BriefSubscription } from "./dailyBriefDigest";

const LEAD_MS = 30 * 60 * 1000; // remind when a meeting starts within 30 min
const GRACE_MS = 5 * 60 * 1000; // ...or started up to 5 min ago (missed-run grace)
const DISPLAY_TZ = "America/Los_Angeles";
const CORSAIR_URL = "https://mpoppa32.github.io/FLi-Network/FLiIntel.html";

type ReminderSub = BriefSubscription & { meetingReminders?: boolean };

/** Resolve a meeting's start instant (ms). Prefers meta.ts, then top-level ts;
 *  accepts both numeric epochs and ISO strings. */
function instantMs(m: { ts?: unknown; meta?: { ts?: unknown } }): number | null {
  const cands = [m?.meta?.ts, m?.ts];
  for (const c of cands) {
    if (typeof c === "number" && isFinite(c)) return c;
    if (typeof c === "string") {
      const p = Date.parse(c);
      if (!isNaN(p)) return p;
    }
  }
  return null;
}

/** Shallow-enumerate workspace ids without downloading the whole tree. Falls
 *  back to a full read if the REST shallow call fails. */
async function listWorkspaceIds(db: admin.database.Database, log: ReturnType<typeof createLogger>): Promise<string[]> {
  try {
    const url =
      admin.app().options.databaseURL ||
      `https://${process.env.GCLOUD_PROJECT || "fli-network"}-default-rtdb.firebaseio.com`;
    const tok = await admin.credential.applicationDefault().getAccessToken();
    const resp = await fetch(`${url}/workspaces.json?shallow=true&access_token=${tok.access_token}`);
    if (resp.ok) {
      const keys = (await resp.json()) as Record<string, boolean> | null;
      if (keys && typeof keys === "object") return Object.keys(keys);
    }
    log.warn("shallow_enumerate_failed", { status: resp.status });
  } catch (err) {
    log.warn("shallow_enumerate_threw", { message: (err as Error).message });
  }
  const snap = await db.ref("workspaces").once("value");
  return snap.exists() ? Object.keys(snap.val() as Record<string, unknown>) : [];
}

export const meetingReminder = onSchedule(
  {
    schedule: "*/15 * * * *", // every 15 minutes
    timeZone: "UTC",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    retryCount: 0,
    secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
  },
  async () => {
    const jobId = generateJobId("meetingReminder");
    const log = createLogger({ source: "meeting_reminder", jobId });

    const db = admin.database();
    const now = Date.now();
    const wsIds = await listWorkspaceIds(db, log);
    let sent = 0;
    let pruned = 0;

    for (const wsId of wsIds) {
      const subsSnap = await db.ref(`workspaces/${wsId}/brief_subscriptions`).once("value");
      const subs = (subsSnap.val() as Record<string, ReminderSub> | null) || {};
      const recipients = Object.values(subs).filter(
        (s) => s && s.email && s.meetingReminders !== false
      );
      if (!recipients.length) continue;

      // Only meetings whose start instant is inside the reminder window. The
      // range query transfers just those few records, not the whole node.
      const mSnap = await db
        .ref(`workspaces/${wsId}/meetings`)
        .orderByChild("ts")
        .startAt(now - GRACE_MS)
        .endAt(now + LEAD_MS)
        .once("value");
      const meetings = (mSnap.val() as Record<string, any> | null) || {};
      if (!Object.keys(meetings).length) continue;

      const sentSnap = await db.ref(`workspaces/${wsId}/_meetingRemindersSent`).once("value");
      const sentMap = (sentSnap.val() as Record<string, number> | null) || {};

      for (const [mid, m] of Object.entries(meetings)) {
        const ts = instantMs(m);
        if (ts == null) continue;
        const diff = ts - now;
        if (diff > LEAD_MS || diff < -GRACE_MS) continue; // belt-and-suspenders
        if (sentMap[mid]) continue;

        const meta = (m.meta as Record<string, any>) || {};
        const title = String(meta.title || "Meeting").replace(/[<>]/g, "").trim() || "Meeting";
        const att = meta.att ? String(meta.att).replace(/[<>]/g, "").slice(0, 220) : "";
        const mins = Math.max(0, Math.round(diff / 60000));
        const leadStr = mins <= 1 ? "now" : `in ${mins} min`;
        const whenStr = new Date(ts).toLocaleString("en-US", {
          timeZone: DISPLAY_TZ,
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        });

        const text = [
          title,
          `When: ${whenStr} (${leadStr})`,
          att ? `With: ${att}` : "",
          meta.dur ? `Length: ${meta.dur}` : "",
          "",
          `Open Corsair: ${CORSAIR_URL}`,
        ]
          .filter(Boolean)
          .join("\n");

        const html =
          `<div style="background:#0a1020;padding:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e4e4e7;max-width:520px;margin:0 auto">` +
          `<div style="font-size:11px;letter-spacing:.12em;color:#d4823a;text-transform:uppercase;margin-bottom:8px;font-family:'IBM Plex Mono',monospace">Corsair &middot; Meeting reminder</div>` +
          `<div style="font-size:19px;font-weight:700;color:#fff;margin-bottom:6px">${title}</div>` +
          `<div style="font-size:14px;color:#e4e4e7;margin:2px 0">${whenStr} &middot; <span style="color:#d4823a">${leadStr}</span></div>` +
          (att ? `<div style="font-size:12px;color:#a1a1aa;margin:8px 0 2px">With ${att}</div>` : "") +
          (meta.dur ? `<div style="font-size:12px;color:#71717a;margin:2px 0">${meta.dur}</div>` : "") +
          `<div style="margin-top:16px"><a href="${CORSAIR_URL}" style="color:#d4823a;font-size:12px;text-decoration:none">Open Corsair &rarr;</a></div>` +
          `</div>`;

        const subject = `Reminder: ${title} ${leadStr}`;

        let okAny = false;
        for (const sub of recipients) {
          const ok = await sendOne(sub, { subject, text, html }, log);
          okAny = okAny || ok;
        }
        if (okAny) {
          await db.ref(`workspaces/${wsId}/_meetingRemindersSent/${mid}`).set(now);
          sent++;
          log.info("reminder_sent", { wsId, mid, title, mins, recipients: recipients.length });
        }
      }

      // Prune dedupe markers older than 2 days so the node stays small.
      for (const [mid, t] of Object.entries(sentMap)) {
        if (typeof t === "number" && now - t > 2 * 86400000) {
          await db.ref(`workspaces/${wsId}/_meetingRemindersSent/${mid}`).remove();
          pruned++;
        }
      }
    }

    log.info("job_completed", { workspaces: wsIds.length, sent, pruned });
  }
);
