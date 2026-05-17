// Corsair — scheduled job: weekly USAspending subaward sync (v1.1)
//
// FFATA subaward reports lag primary award data by 30-180 days. Daily polling
// is wasteful; weekly cadence catches new sub-reports without spamming the
// API. Runs Saturdays at 07:00 UTC.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspaceSubawards } from "../sources/usaSpending";

export const usaSpendingSubawardsWeekly = onSchedule(
  {
    schedule: "0 7 * * 6",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("usaSpendingSubawardsWeekly");
    const log = createLogger({ source: "usaspending", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspaceSubawards(
            workspaceId,
            { maxAwards: 200, onlyLifecycleStates: ["active", "expiring"] },
            wsLog
          );
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalSubawards: outcome.succeeded.reduce(
          (s, x) => s + (x.result.subawardsTotal ?? 0),
          0
        ),
        totalOrgsCreated: outcome.succeeded.reduce(
          (s, x) => s + (x.result.orgsCreated ?? 0),
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
