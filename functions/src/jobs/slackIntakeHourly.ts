// Corsair — scheduled job: pull recent messages from the Atlas Slack channels
// into a stored feed the morning brief surfaces (build C, V1 = capture+surface).
//
// No-op until SLACK_BOT_TOKEN is set, so it can ship before the Slack app exists.
// NEVER writes Truth Hub facts — Slack is a surfaced feed, not an authoritative
// source (fact extraction is a later, review-gated pass). Health mirrors the
// other sources at sources/slack_intake so a silent failure is operator-visible.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { db } from "../framework/rtdb";
import { SLACK_CONFIG as CFG } from "../sources/slack/config";
import { listChannels, listUsers, channelHistory, normalizeMessage, SlackMessage } from "../sources/slack/client";

export async function runSlackIntake(log: ReturnType<typeof createLogger>): Promise<{ pulled: number; stored: number; missing: string[] } | { skipped: true }> {
  const token = process.env.SLACK_BOT_TOKEN || "";
  if (!token) { log.info("no_token"); return { skipped: true }; }

  const healthRef = db.ref(`workspaces/${CFG.workspaceId}/sources/slack_intake`);
  const [nameToId, users] = await Promise.all([listChannels(token), listUsers(token)]);
  const oldestUnix = Math.floor(Date.now() / 1000) - CFG.lookbackHours * 3600;
  const skip = new Set(CFG.skipSubtypes as readonly string[]);

  const fresh: SlackMessage[] = [];
  const missing: string[] = [];
  for (const name of CFG.channels) {
    const id = nameToId[name.toLowerCase()];
    if (!id) { missing.push(name); continue; } // bot not in channel / channel not found
    let raws: Array<Record<string, any>> = [];
    try {
      raws = await channelHistory(token, id, oldestUnix);
    } catch (e) {
      log.error("channel_read_failed", { channel: name, message: (e as Error).message });
      missing.push(name + " (read)");
      continue;
    }
    for (const raw of raws) {
      const m = normalizeMessage(raw, name, users);
      if (m.subtype && skip.has(m.subtype)) continue;
      if (!m.text && !m.fileNames.length) continue;
      fresh.push(m);
    }
  }

  // Merge into the ring buffer, dedupe by channel+ts, newest first, capped.
  const feedRef = db.ref(`workspaces/${CFG.workspaceId}/slackFeed`);
  const snap = await feedRef.get();
  const priorRaw = snap.exists() ? snap.val() : [];
  const prior: SlackMessage[] = Array.isArray(priorRaw) ? priorRaw : Object.values(priorRaw || {});
  const seen = new Set<string>();
  const merged: SlackMessage[] = [];
  for (const m of [...fresh, ...prior]) {
    if (!m || !m.ts) continue;
    const k = m.channel + "|" + m.ts;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(m);
  }
  merged.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
  const capped = merged.slice(0, CFG.feedCap);
  await feedRef.set(capped);

  await healthRef.update({
    lastSync: Date.now(),
    lastError: missing.length
      ? { category: "channels_missing", message: "bot not in / not found: " + missing.join(", "), at: Date.now() }
      : null,
    lastReport: { pulled: fresh.length, stored: capped.length, channels: CFG.channels.slice(), missing },
  });
  return { pulled: fresh.length, stored: capped.length, missing };
}

export const slackIntakeHourly = onSchedule(
  {
    schedule: "15 * * * *", // hourly at :15
    timeZone: "UTC",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    retryCount: 1,
    secrets: ["SLACK_BOT_TOKEN"],
  },
  async (event) => {
    const jobId = generateJobId("slackIntake");
    const log = createLogger({ source: "slack_intake", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });
    try {
      const res = await runSlackIntake(log);
      log.info("job_completed", res as Record<string, unknown>);
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message });
      const category = /invalid_auth|not_authed|token|missing_scope/i.test(e.message) ? "auth_failed" : "sync_failed";
      await db.ref(`workspaces/${CFG.workspaceId}/sources/slack_intake`)
        .update({ lastError: { category, message: e.message, at: Date.now() } })
        .catch(() => { /* health write best-effort */ });
      throw err;
    }
  }
);
