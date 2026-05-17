// Corsair — scheduled job: daily GAO Bid Protest sync

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/gaoProtest";

export const gaoProtestDaily = onSchedule(
  {
    schedule: "0 13 * * *", // 13:00 UTC = 09:00 ET (after morning GAO publishing cycle)
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("gaoProtestDaily");
    const log = createLogger({ source: "gao_protest", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "gao_protest",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, { maxItems: 100 }, wsLog);
        },
        log
      );
      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalSignalsCreated: outcome.succeeded.reduce((s, x) => s + (x.result.signalsCreated ?? 0), 0),
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message });
      throw err;
    }
  }
);
