// Corsair — scheduled job: daily DoD OIG sync
//
// DoD IG publishes audit/evaluation/investigation/inspection reports less
// frequently than GAO (handful per week typically), so a daily cadence
// with itemCap=80 covers the publication rate with margin. Offset 30min
// from gaoReportsDaily so the two oversight feeds don't collide.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/dodOig";

export const dodOigDaily = onSchedule(
  {
    schedule: "30 16 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("dodOigDaily");
    const log = createLogger({ source: "dod_oig", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "dod_oig",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, { itemCap: 80 }, wsLog);
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
