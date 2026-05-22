// Corsair — scheduled job: daily State Department RSS scrape
//
// Pulls press releases + briefings + fact sheets (+ sanctions when
// opted in) daily at 04:30 UTC. State publishes throughout the day
// EST; 04:30 UTC catches the prior-day publication wave with margin.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/stateDepartment";

export const stateDepartmentDaily = onSchedule(
  {
    schedule: "30 4 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("stateDepartmentDaily");
    const log = createLogger({ source: "state_department", jobId });
    log.info("job_started", {
      scheduleTime: event.scheduleTime,
      jobName: event.jobName,
    });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "state_department",
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
        totalItemsMatched: outcome.succeeded.reduce(
          (s, x) => s + (x.result.itemsMatched ?? 0),
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
