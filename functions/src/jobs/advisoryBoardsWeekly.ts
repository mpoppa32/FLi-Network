// Corsair — scheduled job: weekly Advisory Boards sync
//
// Cadence: weekly. DSB / DBB / DIB collectively publish ~10-30 reports per
// year, so daily polling would re-walk the same index pages without finding
// new content. Tuesday 13:00 UTC chosen to keep the weekend windows and the
// daily-sync rush (16:00 UTC across GAO Reports / Service News / etc.)
// uncrowded.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/advisoryBoards";

export const advisoryBoardsWeekly = onSchedule(
  {
    schedule: "0 13 * * 2",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("advisoryBoardsWeekly");
    const log = createLogger({ source: "advisory_boards", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "advisory_boards",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, { itemCap: 60 }, wsLog);
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
