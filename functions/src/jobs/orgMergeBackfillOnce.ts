// Corsair — scheduled wrapper around backfillOrgMergeForWorkspace so a
// cloud-scheduler-run-now can fire it headlessly (the operator-callable
// onCall counterpart requires Firebase Auth + workspace membership and
// can't be invoked from a CLI session).
//
// Cadence: yearly (Jan 1, 03:00 UTC). The actual purpose is operator
// invocation via Cloud Scheduler run-now during cleanup sessions; the
// annual fire is a low-traffic safety net.
//
// Idempotent — re-runs over an already-merged workspace are no-ops.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { backfillOrgMergeForWorkspace } from "./backfillOrgMergeCore";

export const orgMergeBackfillYearly = onSchedule(
  {
    schedule: "0 3 1 1 *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("orgMergeBackfillYearly");
    const log = createLogger({ source: "org_merge_backfill", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await backfillOrgMergeForWorkspace(workspaceId, {}, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalOrgClustersMerged: outcome.succeeded.reduce(
          (s, x) => s + (x.result.orgClustersMerged ?? 0),
          0
        ),
        totalPersonClustersMerged: outcome.succeeded.reduce(
          (s, x) => s + (x.result.personClustersMerged ?? 0),
          0
        ),
        totalDupsDeleted: outcome.succeeded.reduce(
          (s, x) => s + (x.result.dupsDeleted ?? 0),
          0
        ),
        totalRefsRewritten: outcome.succeeded.reduce(
          (s, x) => s + (x.result.totalRefsRewritten ?? 0),
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
