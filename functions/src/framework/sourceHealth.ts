// Corsair framework — Source Health writer
//
// Per framework spec Part Seven + source-health-ui v1: the framework writes
// per-source state under workspaces/{wsId}/sources/{system}/lastSync and
// lastError. The operator-facing Source Health UI reads these.
//
// Doctrine §IV alignment: state must be honest. A failed sync writes
// lastError; a successful sync clears it. No silent recovery.

import { db, sourcePath } from "./rtdb";
import type { Logger } from "./logger";

export interface SourceHealthError {
  occurredAt: number;
  category: string;
  message: string;
  retriable: boolean;
  attempt?: number;
}

export interface SourceHealthUpdate {
  lastSyncAt?: number | null;
  lastError?: SourceHealthError | null;
  recordsLastSync?: number;
  recordsLastSkipped?: number;
  recordsLastErrored?: number;
  durationLastSyncMs?: number;
  apiCallsLastSync?: number;
}

/**
 * Write source health state. Pass only the fields you want to update;
 * unspecified fields are not touched.
 */
export async function writeSourceHealth(
  workspaceId: string,
  system: string,
  update: SourceHealthUpdate,
  log?: Logger
): Promise<void> {
  const path = sourcePath(workspaceId, system);
  const ref = db.ref(path);

  const patch: Record<string, unknown> = {};
  if (update.lastSyncAt !== undefined) patch.lastSync = update.lastSyncAt;
  if (update.lastError !== undefined) patch.lastError = update.lastError;
  if (update.recordsLastSync !== undefined) patch.recordsLastSync = update.recordsLastSync;
  if (update.recordsLastSkipped !== undefined) patch.recordsLastSkipped = update.recordsLastSkipped;
  if (update.recordsLastErrored !== undefined) patch.recordsLastErrored = update.recordsLastErrored;
  if (update.durationLastSyncMs !== undefined) patch.durationLastSyncMs = update.durationLastSyncMs;
  if (update.apiCallsLastSync !== undefined) patch.apiCallsLastSync = update.apiCallsLastSync;

  await ref.update(patch);
  log?.debug("source_health_written", { workspaceId, system, fields: Object.keys(patch) });
}

/**
 * Convenience: record a successful sync.
 */
export async function recordSyncSuccess(
  workspaceId: string,
  system: string,
  result: {
    recordsUpserted: number;
    recordsSkipped?: number;
    durationMs: number;
    apiCalls?: number;
  },
  log?: Logger
): Promise<void> {
  await writeSourceHealth(
    workspaceId,
    system,
    {
      lastSyncAt: Date.now(),
      lastError: null,
      recordsLastSync: result.recordsUpserted,
      recordsLastSkipped: result.recordsSkipped,
      durationLastSyncMs: result.durationMs,
      apiCallsLastSync: result.apiCalls,
    },
    log
  );
}

/**
 * Convenience: record a sync failure. lastSyncAt is NOT updated on failure
 * so the operator can see how long the source has been down.
 */
export async function recordSyncError(
  workspaceId: string,
  system: string,
  error: SourceHealthError,
  log?: Logger
): Promise<void> {
  await writeSourceHealth(
    workspaceId,
    system,
    {
      lastError: error,
    },
    log
  );
}

/**
 * Read current health snapshot for one workspace + source.
 */
export async function readSourceHealth(
  workspaceId: string,
  system: string
): Promise<{ lastSync: number | null; lastError: SourceHealthError | null } | null> {
  const snap = await db
    .ref(sourcePath(workspaceId, system))
    .once("value");
  const v = snap.val() as
    | { lastSync?: number | null; lastError?: SourceHealthError | null }
    | null;
  if (!v) return null;
  return {
    lastSync: v.lastSync ?? null,
    lastError: v.lastError ?? null,
  };
}
