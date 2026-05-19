// Corsair — scheduled job: quarterly Industry Association rosters sync
//
// Cadence: 7th of January / April / July / October at 14:00 UTC.
// Industry association rosters change slowly (annual membership cycles
// for most associations); quarterly polling catches new joiners and
// drops without burning bandwidth.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/industryAssoc";

export const industryAssocQuarterly = onSchedule(
  {
    schedule: "0 14 7 1,4,7,10 *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("industryAssocQuarterly");
    const log = createLogger({ source: "industry_assoc", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "industry_assoc",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, {}, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalEdgesUpserted: outcome.succeeded.reduce(
          (s, x) => s + (x.result.edgesUpsertedTotal ?? 0),
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
