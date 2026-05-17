// Corsair — scheduled job: daily service-branch news aggregation

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/serviceNews";

export const serviceNewsDaily = onSchedule(
  {
    schedule: "0 15 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("serviceNewsDaily");
    const log = createLogger({ source: "service_news", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "service_news",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, { perServiceCap: 30 }, wsLog);
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
        totalLeadershipAnnouncements: outcome.succeeded.reduce(
          (s, x) => s + (x.result.leadershipAnnouncementsCreated ?? 0),
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
