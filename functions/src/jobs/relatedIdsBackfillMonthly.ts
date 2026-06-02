// Corsair — scheduled monthly relatedIds backfill.
//
// Per pattern list grows, hash-stable existing signals never re-pick up
// new resolution paths. This job runs the match-to-existing backfill
// across all approved workspaces. Cadence is monthly so the cost stays
// low (most months no signals get patched because the live syncs already
// caught them); operators can also fire run-now via Cloud Scheduler when
// the pattern list grows in a session.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { backfillRelatedIdsForWorkspace } from "./backfillRelatedIdsCore";

export const relatedIdsBackfillMonthly = onSchedule(
  {
    // First of every month at 04:30 UTC — well before the 05:00 brief
    // synthesis pass so any patched relatedIds show up in same-day Briefs.
    schedule: "30 4 1 * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("relatedIdsBackfillMonthly");
    const log = createLogger({ source: "related_ids_backfill", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await backfillRelatedIdsForWorkspace(
            workspaceId,
            { maxRelated: 6 },
            wsLog
          );
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalPatched: outcome.succeeded.reduce(
          (s, x) => s + (x.result.patched ?? 0),
          0
        ),
        totalScanned: outcome.succeeded.reduce(
          (s, x) => s + (x.result.scanned ?? 0),
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
