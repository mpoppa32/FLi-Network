// Corsair — scheduled wrapper around enrichEntityDomainsForWorkspace so
// a cloud-scheduler-run-now can fire it headlessly (the operator-callable
// onCall counterpart requires Firebase Auth + workspace membership and
// can't be invoked from a CLI session).
//
// Cadence: yearly (Jan 1, 05:30 UTC). The actual purpose is operator
// invocation via Cloud Scheduler run-now during enrichment sessions; the
// annual fire is a low-traffic safety net (catches any new SAM.gov POC
// data accumulated since the last run).
//
// Idempotent — re-runs never overwrite an existing node.domain.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { enrichEntityDomainsForWorkspace } from "./enrichEntityDomainsCore";

export const enrichEntityDomainsYearly = onSchedule(
  {
    schedule: "30 5 1 1 *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("enrichEntityDomainsYearly");
    const log = createLogger({ source: "entity_domain_enrichment", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "sam_gov",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await enrichEntityDomainsForWorkspace(workspaceId, {}, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalWrites: outcome.succeeded.reduce(
          (s, x) => s + (x.result.writeCount ?? 0),
          0
        ),
        totalHigh: outcome.succeeded.reduce(
          (s, x) => s + (x.result.tierCounts?.high ?? 0),
          0
        ),
        totalMedium: outcome.succeeded.reduce(
          (s, x) => s + (x.result.tierCounts?.medium ?? 0),
          0
        ),
        totalLow: outcome.succeeded.reduce(
          (s, x) => s + (x.result.tierCounts?.low ?? 0),
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
