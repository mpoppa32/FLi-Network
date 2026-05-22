// Corsair — scheduled job: daily defense BD news RSS scrape
//
// Pulls Breaking Defense + DefenseScoop + Defense News (+ FedScoop +
// NextGov when opted in) daily at 05:30 UTC. Slightly after the
// state_department slot (04:30 UTC) so the Brief synth window at
// 05:00 UTC catches the state Dept content first, then the news at
// 06:00 picks up overnight publishes.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/defenseScoop";

export const defenseScoopDaily = onSchedule(
  {
    schedule: "30 5 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("defenseScoopDaily");
    const log = createLogger({ source: "defense_scoop", jobId });
    log.info("job_started", {
      scheduleTime: event.scheduleTime,
      jobName: event.jobName,
    });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "defense_scoop",
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
