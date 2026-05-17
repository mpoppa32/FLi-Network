// Corsair — scheduled job: daily DoD News Contracts scrape
//
// Per award-integration-v1 Part Three: fetches defense.gov/News/Contracts/
// daily at 23:00 UTC (~6 PM ET, post-publication window). Operators can
// also trigger manually via triggerDodNewsSync.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/dodNews";

export const dodNewsDaily = onSchedule(
  {
    schedule: "0 23 * * 1-5",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("dodNewsDaily");
    const log = createLogger({ source: "dod_news", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "dod_news",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, {}, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalProvisional: outcome.succeeded.reduce(
          (s, x) => s + (x.result.provisionalCreated ?? 0),
          0
        ),
        totalObservations: outcome.succeeded.reduce(
          (s, x) => s + (x.result.observationsAppended ?? 0),
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
