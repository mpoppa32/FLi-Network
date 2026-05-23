// Corsair P2.14 — scheduled hourly Gmail + Calendar capture sweep
//
// Iterates every workspace × every member with a valid Google OAuth grant
// and runs syncGmail + syncCalendar for them. captureState gates per-source
// enablement so operators can turn off either one independently.
//
// Bounded fanout: ~M workspaces × ~N members. For a two-person team this is
// 2 workspaces × 2 users × 2 sources = 8 runs/hour. Comfortably under
// Cloud Functions concurrency limits.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../framework/rtdb";
import { syncGmail, syncCalendar, SyncResult } from "../capture/dispatcher";
import { createLogger, generateJobId } from "../framework/logger";

export const captureHourly = onSchedule(
  {
    schedule: "15 * * * *", // 15 past the hour — offset from samGovHourly (top)
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("captureHourly");
    const log = createLogger({ source: "captureHourly", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    const wsSnap = await db.ref("workspaces").get();
    const workspaces = wsSnap.val() as Record<string, unknown> | null;
    if (!workspaces) {
      log.info("job_completed", { reason: "no_workspaces" });
      return;
    }

    const tasks: Promise<SyncResult>[] = [];
    for (const workspaceId of Object.keys(workspaces)) {
      const membersSnap = await db.ref(`workspaces/${workspaceId}/members`).get();
      const members = (membersSnap.val() as Record<string, unknown>) ?? {};
      for (const uid of Object.keys(members)) {
        tasks.push(syncGmail(uid, workspaceId));
        tasks.push(syncCalendar(uid, workspaceId));
      }
    }
    const results = await Promise.all(tasks);

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let totalWritten = 0;
    for (const r of results) {
      if (r.error) failed++;
      else if (r.skipped) skipped++;
      else {
        synced++;
        totalWritten += r.written;
      }
    }
    log.info("job_completed", {
      runs: results.length,
      synced,
      skipped,
      failed,
      totalWritten,
    });
  }
);
