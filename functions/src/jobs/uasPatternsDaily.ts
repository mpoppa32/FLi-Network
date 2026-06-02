// Corsair — scheduled daily uas-patterns DDG scrape.
//
// Cadence: 18:00 UTC. After DARPA (17:45 UTC) + NASA OIG (17:30 UTC)
// so it slots into the afternoon-UTC drone-intel band without colliding
// with the morning-UTC federal-procurement passes. Daily is overkill
// (the curator's update cadence is ~monthly) but it costs ~1 HTML
// fetch per day and gives same-day visibility on any update.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/uasPatterns";

export const uasPatternsDaily = onSchedule(
  {
    schedule: "0 18 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("uasPatternsDaily");
    const log = createLogger({ source: "uas_patterns", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, {}, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalVendorSignals: outcome.succeeded.reduce(
          (s, x) =>
            s +
            (x.result.vendorSignalsCreated ?? 0) +
            (x.result.vendorSignalsUpdated ?? 0),
          0
        ),
        totalPredictionSignals: outcome.succeeded.reduce(
          (s, x) =>
            s +
            (x.result.predictionSignalsCreated ?? 0) +
            (x.result.predictionSignalsUpdated ?? 0),
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
