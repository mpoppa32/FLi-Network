// Corsair P13.278 — scheduled wrapper around the capture matcher backfill.
//
// Mirrors orgMergeBackfillYearly + relatedIdsBackfillMonthly: a yearly
// onSchedule whose primary purpose is cloud-scheduler-run-now during
// matcher-tuning sessions (the onCall counterpart is gated on Firebase
// Auth + workspace membership and can't be invoked from a CLI session).
//
// Iterates approved workspaces and re-runs the matcher against every
// pendingCapture entry. Atomic single-pass per workspace.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../framework/rtdb";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { loadMatchContext, matchEntry } from "../capture/matcher";
import { PendingCaptureEntry } from "../capture/normalizer";
import { wsPath } from "../framework/rtdb";

interface WorkspaceBackfillResult {
  workspaceId: string;
  processed: number;
  matched: number;
  matchedBefore: number;
  bySource: Record<string, number>;
  byDirection: Record<string, number>;
}

export const captureMatchBackfillYearly = onSchedule(
  {
    schedule: "0 4 1 1 *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    retryCount: 1,
    secrets: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
    ],
  },
  async (event) => {
    const jobId = generateJobId("captureMatchBackfillYearly");
    const log = createLogger({ source: "capture_match_backfill", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) => {
          const wsLog = log.child({ workspace: workspaceId });
          return await backfillOneWorkspace(workspaceId, wsLog);
        },
        log
      );

      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalMatched: outcome.succeeded.reduce(
          (s, x) => s + ((x.result as WorkspaceBackfillResult).matched ?? 0),
          0
        ),
        totalProcessed: outcome.succeeded.reduce(
          (s, x) => s + ((x.result as WorkspaceBackfillResult).processed ?? 0),
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

async function backfillOneWorkspace(
  workspaceId: string,
  log: ReturnType<typeof createLogger>
): Promise<WorkspaceBackfillResult> {
  log.info("backfill_start", { workspaceId });

  // P13.278 — the matcher's teamDomains set is built from the connected
  // sync account's email. For the scheduled backfill we don't have a
  // per-caller uid; load the FIRST workspace member's captureAuth so
  // the teamDomain inference fires on at least the primary member's
  // sync account. Multi-member workspaces with multiple connected
  // accounts get full coverage on the next captureHourly run; the
  // backfill targets the primary-member case which is sufficient for
  // re-tagging direction on the 90-entry Atlas backlog.
  const membersSnap = await db.ref(wsPath(workspaceId, "members")).once("value");
  const members = (membersSnap.val() as Record<string, unknown>) ?? {};
  const firstMemberUid = Object.keys(members)[0] || undefined;

  const ctx = await loadMatchContext(workspaceId, firstMemberUid);

  const pcSnap = await db.ref(wsPath(workspaceId, "pendingCapture")).once("value");
  const entries = (pcSnap.val() ?? {}) as Record<string, PendingCaptureEntry>;

  let matchedBefore = 0;
  let matched = 0;
  let processed = 0;
  const bySource: Record<string, number> = {
    "sender-email": 0,
    "attendee-email": 0,
    "sender-domain": 0,
    "attendee-domain": 0,
  };
  const byDirection: Record<string, number> = {
    inbound: 0,
    outbound: 0,
    unknown: 0,
  };
  const updates: Record<string, unknown> = {};

  for (const [id, entry] of Object.entries(entries)) {
    if (!entry) continue;
    processed++;
    if (entry.matchedNodeId) matchedBefore++;
    const attendeeEmails = (entry.meta?.attendees || [])
      .map((a) => (a?.email || "").toLowerCase().trim())
      .filter(Boolean);
    const m = matchEntry(
      {
        senderEmail: entry.fromEmail || "",
        attendeeEmails,
        threadId: entry.threadId || null,
        messageId: entry.messageId || null,
        inReplyTo: entry.inReplyTo || null,
      },
      ctx
    );
    const base = wsPath(workspaceId, "pendingCapture", id);
    updates[`${base}/matchedNodeId`] = m.matchedNodeId;
    updates[`${base}/matchSource`] = m.matchSource;
    updates[`${base}/oppId`] = m.oppId;
    updates[`${base}/oppName`] = m.oppName;
    updates[`${base}/direction`] = m.direction;
    if (m.matchedNodeId) {
      matched++;
      if (m.matchSource) bySource[m.matchSource]++;
    }
    byDirection[m.direction]++;
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  log.info("backfill_complete", {
    workspaceId,
    processed,
    matchedBefore,
    matched,
    bySource,
    byDirection,
  });

  return {
    workspaceId,
    processed,
    matched,
    matchedBefore,
    bySource,
    byDirection,
  };
}
