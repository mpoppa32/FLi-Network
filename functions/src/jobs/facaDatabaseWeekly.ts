// Corsair — scheduled job: weekly FACA sync (Phase 8.6.1)
//
// Federal Advisory Committee membership + meetings refresh. Saturdays 08:00
// UTC — non-overlapping with USAspending subaward sync (07:00) and other
// daily/hourly jobs.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { syncWorkspace } from "../sources/facaDatabase";

export const facaDatabaseWeekly = onSchedule(
  {
    schedule: "0 8 * * 6",
    timeZone: "UTC",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    retryCount: 2,
  },
  async (event) => {
    const jobId = generateJobId("facaDatabaseWeekly");
    const log = createLogger({ source: "faca", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime, jobName: event.jobName });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "faca",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await syncWorkspace(workspaceId, { maxCommittees: 50 }, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalCommitteesUpserted: outcome.succeeded.reduce(
          (s, x) => s + (x.result.committeesUpserted ?? 0),
          0
        ),
        totalMembersUpserted: outcome.succeeded.reduce(
          (s, x) => s + (x.result.membersUpserted ?? 0),
          0
        ),
        totalMeetingsUpserted: outcome.succeeded.reduce(
          (s, x) => s + (x.result.meetingsUpserted ?? 0),
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
