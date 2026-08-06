// Corsair — nightly stale-commitment auto-archive (Mission 4 #5).
//
// POLICY (Mike, 2026-08-06 — this is the authoritative rule):
//   status === 'open'  AND  created > 30 days ago
//   AND ( no deadline  OR  deadline overdue by > 7 days )
//     → status:'archived' + archivedAt + archiveNote
//
// ARCHIVE, NEVER DELETE. Fully reversible by setting status back to 'open';
// every other field on the record is left untouched.
//
// A NOTE ON THE PRECEDENT RECORDS: two commitments were archived by hand on
// 2026-08-06 at only ONE day overdue. That was a one-off Mike approved
// directly and is NOT this rule — their notes were amended in place to say so.
// Do not infer policy from stored data; the rule lives here.
//
// NOTHING VANISHES SILENTLY (Rule 11): when this job archives anything, the
// daily brief gains an "ARCHIVED N STALE (>30d, unscheduled)" line. The digest
// derives that count from the records themselves (auto-archived within the
// last 24h) rather than from a state file this job writes — deliberately, so
// the job stays a single-purpose writer. CT-1b is the standing lesson on
// casually-added write paths.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { iterateApprovedWorkspaces } from "../framework/workspaceIterator";
import { db, wsPath } from "../framework/rtdb";
import type { Logger } from "../framework/logger";

export const STALE_AGE_DAYS = 30;
export const OVERDUE_GRACE_DAYS = 7;
const DAY_MS = 86400000;

export interface StaleDecision {
  stale: boolean;
  /** Whole days since `created`; null when unparseable. */
  ageDays: number | null;
  /** Whole days past `deadline`; null when undated or unparseable. */
  overdueDays: number | null;
  /** Why it was spared — for logging, never for control flow. */
  reason: string;
}

/**
 * The whole policy, as one pure function. No database, no clock of its own —
 * `now` is injected so tests are deterministic.
 *
 * Fail-safe direction: anything we cannot positively establish as stale is
 * LEFT OPEN. An unparseable `created` means we do not know the age, so the
 * record is spared; the cost of sparing a stale item is that it stays in the
 * brief, while the cost of archiving a live one is that work disappears from
 * the operator's view.
 */
export function isStale(item: unknown, now: number): StaleDecision {
  const c = item as Record<string, unknown> | null;
  if (!c || typeof c !== "object") {
    return { stale: false, ageDays: null, overdueDays: null, reason: "not_an_object" };
  }
  if (c.status !== "open") {
    return { stale: false, ageDays: null, overdueDays: null, reason: `status_${String(c.status)}` };
  }

  const createdMs = Date.parse(String(c.created ?? ""));
  if (!Number.isFinite(createdMs)) {
    return { stale: false, ageDays: null, overdueDays: null, reason: "created_unparseable" };
  }
  const ageDays = Math.floor((now - createdMs) / DAY_MS);
  if (ageDays <= STALE_AGE_DAYS) {
    return { stale: false, ageDays, overdueDays: null, reason: "younger_than_30d" };
  }

  // Undated: old and never scheduled — the primary target of this policy.
  const rawDeadline = c.deadline;
  const hasDeadline = rawDeadline !== undefined && rawDeadline !== null && String(rawDeadline).trim() !== "";
  if (!hasDeadline) {
    return { stale: true, ageDays, overdueDays: null, reason: "old_and_undated" };
  }

  const deadlineMs = Date.parse(`${String(rawDeadline).trim()}T00:00:00Z`);
  if (!Number.isFinite(deadlineMs)) {
    // A deadline we cannot read is not the same as no deadline — spare it.
    return { stale: false, ageDays, overdueDays: null, reason: "deadline_unparseable" };
  }
  const overdueDays = Math.floor((now - deadlineMs) / DAY_MS);
  if (overdueDays > OVERDUE_GRACE_DAYS) {
    return { stale: true, ageDays, overdueDays, reason: "old_and_overdue" };
  }
  return { stale: false, ageDays, overdueDays, reason: "within_grace" };
}

/** The note written onto every auto-archived record. */
export function archiveNoteFor(d: StaleDecision): string {
  const overdue = d.overdueDays === null ? "no deadline" : `overdue ${d.overdueDays}d`;
  return `auto-archived: created ${d.ageDays}d ago, ${overdue}`;
}

/**
 * Archive stale commitments in one workspace. Returns what it did so the job
 * can log a real number rather than "completed".
 */
export async function archiveStaleCommitments(
  workspaceId: string,
  now: number,
  log?: Logger
): Promise<{ scanned: number; archived: number; ids: string[] }> {
  const snap = await db.ref(wsPath(workspaceId, "commitments")).once("value");
  const all = (snap.val() as Record<string, any> | null) ?? {};
  const keys = Object.keys(all);

  const updates: Record<string, unknown> = {};
  const ids: string[] = [];
  const archivedAt = new Date(now).toISOString();

  for (const key of keys) {
    const decision = isStale(all[key], now);
    if (!decision.stale) continue;
    const base = wsPath(workspaceId, "commitments", key);
    updates[`${base}/status`] = "archived";
    updates[`${base}/archivedAt`] = archivedAt;
    updates[`${base}/archiveNote`] = archiveNoteFor(decision);
    ids.push(key);
  }

  if (ids.length) {
    // Single multi-path update: all-or-nothing, and it touches ONLY the three
    // fields above — every other field on the record is preserved.
    await db.ref().update(updates);
  }
  log?.info("workspace_archived", { workspaceId, scanned: keys.length, archived: ids.length });
  return { scanned: keys.length, archived: ids.length, ids };
}

export const commitmentsAutoArchive = onSchedule(
  {
    schedule: "30 4 * * *", // 04:30 UTC — before briefSynthesisNightly (05:00) and the digest
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    retryCount: 1,
  },
  async (event) => {
    const jobId = generateJobId("commitmentsAutoArchive");
    const log = createLogger({ source: "commitments_auto_archive", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });

    try {
      // Same approval proxy as briefSynthesisNightly: any source config means
      // the workspace completed migration. Per-workspace, never hardcoded.
      const outcome = await iterateApprovedWorkspaces(
        "usaspending",
        async (workspaceId) =>
          await archiveStaleCommitments(workspaceId, Date.now(), log.child({ workspace: workspaceId })),
        log
      );
      log.info("job_completed", {
        succeeded: outcome.succeeded.length,
        failed: outcome.failed.length,
        totalArchived: outcome.succeeded.reduce((s, x) => s + x.result.archived, 0),
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message });
      throw err;
    }
  }
);
