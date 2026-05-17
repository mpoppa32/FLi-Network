// Corsair — scheduled job: hourly SAM.gov sync
//
// Per architecture sketch Tier 1: SAM.gov hourly cadence catches new
// solicitations within ~1 hour of posting. Cost is minimal at 1000/hr
// budget; ~50 requests/hour per workspace is comfortable.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/samGov";

export const samGovHourly = onSchedule(
  {
    schedule: "0 * * * *", // top of every hour
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("samGovHourly");
    const log = createLogger({ source: "sam_gov", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "sam_gov",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          // Hourly delta: last 24h to catch any missed posts
          return await syncWorkspace(workspaceId, { sinceDays: 1, maxRecords: 200 }, wsLog);
        },
        log
      );
      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalOppsCreated: outcome.succeeded.reduce((s, x) => s + (x.result.oppsCreated ?? 0), 0),
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message });
      throw err;
    }
  }
);
