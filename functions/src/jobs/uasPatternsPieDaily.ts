// Corsair — scheduled daily uas-patterns PIE supply-chain scrape.
//
// Cadence: 19:00 UTC. One hour after the DDG scrape (18:00 UTC) so the
// two plugins share the rate-limit bucket on uas-patterns.com without
// queuing. PIE updates are operator-relevant when the curator publishes
// new scenarios or manufacturer audits (~monthly cadence). Daily fire
// gives same-day visibility on changes.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/uasPatternsPie";

export const uasPatternsPieDaily = onSchedule(
  {
    schedule: "0 19 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("uasPatternsPieDaily");
    const log = createLogger({ source: "uas_patterns_pie", jobId });
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
        totalManufacturerSignals: outcome.succeeded.reduce(
          (s, x) =>
            s +
            (x.result.manufacturerSignalsCreated ?? 0) +
            (x.result.manufacturerSignalsUpdated ?? 0),
          0
        ),
        totalScenarioSignals: outcome.succeeded.reduce(
          (s, x) =>
            s +
            (x.result.scenarioSignalsCreated ?? 0) +
            (x.result.scenarioSignalsUpdated ?? 0),
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
