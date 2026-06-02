// Corsair — scheduled job: daily Congress.gov sync

import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/congressGov";

// P13.267 — bind CONGRESSGOV_API_KEY secret to runtime env. Framework
// reads process.env.CONGRESSGOV_API_KEY (framework/secrets.ts:46).
export const CONGRESSGOV_API_KEY = defineSecret("CONGRESSGOV_API_KEY");

export const congressGovDaily = onSchedule(
  {
    schedule: "0 12 * * *", // 12:00 UTC = 08:00 ET
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
    secrets: [CONGRESSGOV_API_KEY],
  },
  async (event) => {
    const jobId = generateJobId("congressGovDaily");
    const log = createLogger({ source: "congress_gov", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "congress_gov",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, { sinceDays: 14, maxMeetingsPerChamber: 30 }, wsLog);
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
