// Corsair — scheduled job: weekly Senate LDA sync
//
// Cadence: weekly Thursday 14:00 UTC. LD-2 filings are quarterly with
// occasional amendments; daily polling burns the keyless rate-limit budget
// without finding new content most days. Thursday 14:00 UTC keeps clear of
// the Tuesday advisory_boards window and the 16:00 UTC daily-sync rush.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/senateLda";

export const senateLdaWeekly = onSchedule(
  {
    schedule: "0 14 * * 4",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("senateLdaWeekly");
    const log = createLogger({ source: "senate_lda", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "senate_lda",
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
