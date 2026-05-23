// Corsair — scheduled job: daily DARPA News sync
//
// DARPA publishes news irregularly (handful per month). Daily cadence
// catches new items within 24h. Offset 45min from dod_oig and 30min
// from defense_scoop so the daily oversight + media + R&D feeds don't
// collide.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/darpaNews";

export const darpaNewsDaily = onSchedule(
  {
    schedule: "45 17 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("darpaNewsDaily");
    const log = createLogger({ source: "darpa_news", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "darpa_news",
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
