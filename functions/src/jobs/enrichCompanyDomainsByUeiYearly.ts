// Corsair — scheduled wrapper around enrichCompanyDomainsByUeiForWorkspace
// so a cloud-scheduler-run-now can fire it headlessly during enrichment
// sessions. The onCall counterpart requires Firebase Auth + workspace
// membership and can't be invoked from a CLI session.
//
// Cadence: yearly (Jan 1, 06:30 UTC). Actual purpose is operator
// invocation via Cloud Scheduler run-now; the annual fire is a low-traffic
// safety net (catches any company nodes that gained UEI since the last
// run, or SAM.gov entities that became public since previously-failed
// fetches).
//
// Idempotent — never overwrites existing node.domain. Re-runs of an
// already-enriched workspace are constrained by the refreshMs window so
// repeat invocations don't burn the sam_gov rate budget on dead UEIs.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { enrichCompanyDomainsByUeiForWorkspace } from "./enrichCompanyDomainsByUeiCore";
import { SAMGOV_API_KEY } from "./samGovHourly";

export const enrichCompanyDomainsByUeiYearly = onSchedule(
  {
    schedule: "30 6 1 1 *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 0,
    secrets: [SAMGOV_API_KEY],
  },
  async (event) => {
    const jobId = generateJobId("enrichCompanyDomainsByUeiYearly");
    const log = createLogger({ source: "company_uei_enrichment", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "sam_gov",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await enrichCompanyDomainsByUeiForWorkspace(workspaceId, {}, wsLog);
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
        totalSkipNoEntity: outcome.succeeded.reduce(
          (s, x) => s + (x.result.skipNoEntity?.length ?? 0),
          0
        ),
        totalSkipNoUrl: outcome.succeeded.reduce(
          (s, x) => s + (x.result.skipNoUrl?.length ?? 0),
          0
        ),
        totalApiErrors: outcome.succeeded.reduce(
          (s, x) => s + (x.result.apiErrors?.length ?? 0),
          0
        ),
        anyDeadlineHit: outcome.succeeded.some((x) => x.result.deadlineHit),
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message ?? String(err) });
      throw err;
    }
  }
);
