// Corsair — scheduled job: nightly USAspending sync
//
// Per Award integration spec Part Ten: nightly sync of awards modified in
// last 7 days. Iterates approved workspaces; per-workspace sync invokes
// syncWorkspace.
//
// Schedule: daily at 02:00 ET = 06:00 UTC during DST / 07:00 UTC otherwise.
// Cron string: "0 6 * * *" (06:00 UTC).
//
// Per FIQ-10 (LOCKED): backfill jobs use 60-minute timeout. Nightly delta
// sync uses 540s (9 min) — covers ~100 workspaces at 5s/workspace.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/usaSpending";

export const usaSpendingNightly = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("usaSpendingNightly");
    const log = createLogger({ source: "usaspending", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(
            workspaceId,
            { sinceDays: 7, maxRecords: 300 },
            wsLog
          );
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalAwardsCreated: outcome.succeeded.reduce((s, x) => s + (x.result.awardsCreated ?? 0), 0),
        totalAwardsUpdated: outcome.succeeded.reduce((s, x) => s + (x.result.awardsUpdated ?? 0), 0),
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message ?? String(err) });
      throw err;
    }
  }
);
