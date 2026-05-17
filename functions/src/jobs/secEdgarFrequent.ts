// Corsair — scheduled job: SEC EDGAR sync
//
// Per source spec: SEC publishes filings throughout business hours; a 4-hour
// cadence captures most updates without hammering the 10/sec rate limit.
// Skip overnight (filings rare after 7pm ET).
//
// Schedule: every 4 hours at minute 0. Cron "0 */4 * * *" runs at
// 00,04,08,12,16,20 UTC = 20,00,04,08,12,16 ET. Daily total: 6 invocations.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/secEdgar";

export const secEdgarFrequent = onSchedule(
  {
    schedule: "0 */4 * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("secEdgarFrequent");
    const log = createLogger({ source: "sec_edgar", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "sec_edgar",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          // 4-hour delta = recent filings only
          return await syncWorkspace(workspaceId, { sinceDays: 1, maxPerCik: 10 }, wsLog);
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
