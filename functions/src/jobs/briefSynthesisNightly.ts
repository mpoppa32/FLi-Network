// Corsair — scheduled Brief synthesis (Phase 8.5.8)
//
// Runs nightly at 05:00 UTC (after all source nightly syncs complete).
// Per BSQ-1 (LOCKED): nightly schedule + on-demand refresh button.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { synthesizeBrief } from "./briefSynthesisCommon";

export const briefSynthesisNightly = onSchedule(
  {
    schedule: "0 5 * * *", // 05:00 UTC — runs after USAspending nightly (06:00 UTC) on the prior day
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("briefSynthesisNightly");
    const log = createLogger({ source: "brief_synthesis", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    // Brief synthesis runs for any workspace where 8.5.1 migration completed.
    // It doesn't depend on any specific source enable flag — composes whatever
    // signals/awards/opportunities exist.
    try {
      // We piggyback on the workspaceIterator's approval check but use
      // a stable source name. "brief_synthesis" doesn't have a config path,
      // so we use 'usaspending' as the proxy approval source (any source's
      // config existing means migration completed).
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await synthesizeBrief(workspaceId, 24, wsLog);
        },
        log
      );
      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalItemsBriefed: outcome.succeeded.reduce((s, x) => s + (x.result.totalItems ?? 0), 0),
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message });
      throw err;
    }
  }
);
