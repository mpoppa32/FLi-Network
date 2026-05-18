// Corsair — scheduled job: monthly DoD Comptroller budget materials sync
//
// Cadence: monthly on the 1st at 14:00 UTC. The President's Budget drops
// once per year (typically March), with supplements and Enacted amendments
// landing across the year. Monthly polling picks up supplements without
// burning compute on weeks when nothing changes — a single budget book PDF
// is 50-100MB, so a busy schedule would waste bandwidth.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/dodComptroller";

export const dodComptrollerMonthly = onSchedule(
  {
    schedule: "0 14 1 * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "2GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("dodComptrollerMonthly");
    const log = createLogger({ source: "dod_comptroller", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "dod_comptroller",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, {}, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalSignalsCreated: outcome.succeeded.reduce(
          (s, x) => s + (x.result.signalsCreated ?? 0),
          0
        ),
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message ?? String(err) });
      throw err;
    }
  }
);
