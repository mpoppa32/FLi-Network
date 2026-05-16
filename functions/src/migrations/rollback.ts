// Corsair Phase 8.5.1 — Migration rollback
//
// Per migration spec Part Three: each step has a documented undo. Roll back
// in reverse order (Step 5 → 4 → 3 → 2 → 1) to return the workspace to its
// pre-migration state.
//
// Rollback safety conditions:
//   - Step 4 rollback safe only when awards/ collection is empty (no Awards
//     written by subsequent sub-phases yet) and sources/.../raw is empty.
//   - Step 1 rollback removes source + migration fields from entities the
//     migration itself added them to (tracked by entity.migration.step === 1).

import { db, wsPath, migrationPath, sourcePath, batchedUpdate, BATCH_SIZE } from "../framework/rtdb";
import { Logger } from "../framework/logger";

export const MIGRATION_VERSION = "8.5.1";

export interface RollbackResult {
  step: number;
  startedAt: number;
  completedAt: number;
  unsafe: boolean;
  reason?: string;
  recordsReverted: Record<string, number>;
  pathsRemoved: string[];
  errors: Array<{ pathName?: string; entityId?: string; message: string }>;
}

// ─── Step 1 rollback: remove source/migration fields added by migration ───
export async function rollbackStep1(workspaceId: string, log: Logger): Promise<RollbackResult> {
  const startedAt = Date.now();
  log.info("rollback_step1_started", { workspaceId });

  const result: RollbackResult = {
    step: 1,
    startedAt,
    completedAt: 0,
    unsafe: false,
    recordsReverted: { nodes: 0, opportunities: 0, meetings: 0, signals: 0 },
    pathsRemoved: [],
    errors: [],
  };

  const entityTypes: Array<"nodes" | "opportunities" | "meetings" | "signals"> = [
    "nodes",
    "opportunities",
    "meetings",
    "signals",
  ];

  for (const collection of entityTypes) {
    try {
      const snap = await db.ref(wsPath(workspaceId, collection)).once("value");
      const records = (snap.val() as Record<string, any> | null) || {};
      const updates: Record<string, unknown> = {};
      let batchCount = 0;

      for (const [id, entity] of Object.entries(records)) {
        const e = entity as Record<string, any>;
        // Only revert entities where THIS migration added the fields
        if (
          e.migration &&
          typeof e.migration === "object" &&
          e.migration.version === MIGRATION_VERSION &&
          e.migration.step === 1
        ) {
          updates[`${wsPath(workspaceId, collection, id)}/source`] = null;
          updates[`${wsPath(workspaceId, collection, id)}/migration`] = null;
          batchCount++;
          result.recordsReverted[collection]++;

          if (batchCount >= BATCH_SIZE) {
            await batchedUpdate(updates);
            Object.keys(updates).forEach((k) => delete updates[k]);
            batchCount = 0;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await batchedUpdate(updates);
      }
    } catch (err) {
      const e = err as Error;
      result.errors.push({
        entityId: collection,
        message: e.message ?? String(err),
      });
    }
  }

  // Remove the Step 1 marker
  try {
    await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/1")).remove();
    result.pathsRemoved.push(migrationPath(workspaceId, MIGRATION_VERSION, "steps/1"));
  } catch (err) {
    const e = err as Error;
    result.errors.push({ pathName: "steps/1", message: e.message ?? String(err) });
  }

  result.completedAt = Date.now();
  log.info("rollback_step1_completed", {
    workspaceId,
    totalReverted: Object.values(result.recordsReverted).reduce((s, n) => s + n, 0),
  });
  return result;
}

// ─── Steps 2 and 3 rollback: just remove the markers (client-side change) ──
export async function rollbackStep2(workspaceId: string, log: Logger): Promise<RollbackResult> {
  return rollbackMarkerOnly(workspaceId, 2, log);
}
export async function rollbackStep3(workspaceId: string, log: Logger): Promise<RollbackResult> {
  return rollbackMarkerOnly(workspaceId, 3, log);
}

async function rollbackMarkerOnly(
  workspaceId: string,
  step: number,
  log: Logger
): Promise<RollbackResult> {
  const startedAt = Date.now();
  const result: RollbackResult = {
    step,
    startedAt,
    completedAt: 0,
    unsafe: false,
    recordsReverted: {},
    pathsRemoved: [],
    errors: [],
  };
  try {
    await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, `steps/${step}`)).remove();
    result.pathsRemoved.push(migrationPath(workspaceId, MIGRATION_VERSION, `steps/${step}`));
  } catch (err) {
    const e = err as Error;
    result.errors.push({ pathName: `steps/${step}`, message: e.message ?? String(err) });
  }
  result.completedAt = Date.now();
  log.info(`rollback_step${step}_completed`, { workspaceId });
  return result;
}

// ─── Step 4 rollback: remove new paths IF safe ────────────────────────────
//
// Safety condition: rollback of Step 4 is only safe if no subsequent sub-phase
// has written data to these paths. Specifically:
//   - workspaces/{wsId}/awards must be empty
//   - workspaces/{wsId}/sources/{system}/raw must be empty for each source
//
// If unsafe, return result with `unsafe: true` and `reason`; do NOT modify data.
// Operator must explicitly confirm data loss to proceed (separate operator
// action; not handled by automatic rollback).
export async function rollbackStep4(
  workspaceId: string,
  log: Logger,
  forceUnsafe: boolean = false
): Promise<RollbackResult> {
  const startedAt = Date.now();
  log.info("rollback_step4_started", { workspaceId, forceUnsafe });

  const result: RollbackResult = {
    step: 4,
    startedAt,
    completedAt: 0,
    unsafe: false,
    recordsReverted: {},
    pathsRemoved: [],
    errors: [],
  };

  // Safety check
  if (!forceUnsafe) {
    const awardsSnap = await db.ref(wsPath(workspaceId, "awards")).once("value");
    const awardsVal = awardsSnap.val() as Record<string, unknown> | null;
    if (awardsVal && Object.keys(awardsVal).length > 0) {
      result.unsafe = true;
      result.reason = `Award entities exist (${Object.keys(awardsVal).length}). Rollback would lose data. Pass forceUnsafe=true to proceed with data loss.`;
      result.completedAt = Date.now();
      log.warn("rollback_step4_unsafe", { workspaceId, reason: result.reason });
      return result;
    }

    const sources = ["sam_gov", "usaspending", "dod_news", "gao_protest", "sec_edgar", "congress_gov"];
    for (const system of sources) {
      const rawSnap = await db.ref(sourcePath(workspaceId, system, "raw")).once("value");
      const rawVal = rawSnap.val() as Record<string, unknown> | null;
      if (rawVal && Object.keys(rawVal).length > 0) {
        result.unsafe = true;
        result.reason = `Source ${system} raw cache has ${Object.keys(rawVal).length} records. Rollback would lose data. Pass forceUnsafe=true to proceed.`;
        result.completedAt = Date.now();
        log.warn("rollback_step4_unsafe", { workspaceId, source: system, reason: result.reason });
        return result;
      }
    }
  }

  // Read the Step 4 marker to find which paths to remove
  const markerSnap = await db
    .ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/4"))
    .once("value");
  const marker = markerSnap.val() as { pathsCreated?: string[] } | null;
  const pathsToRemove = marker?.pathsCreated ?? [];

  for (const path of pathsToRemove) {
    try {
      await db.ref(path).remove();
      result.pathsRemoved.push(path);
    } catch (err) {
      const e = err as Error;
      result.errors.push({ pathName: path, message: e.message ?? String(err) });
    }
  }

  // Remove the Step 4 marker
  try {
    await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/4")).remove();
    result.pathsRemoved.push(migrationPath(workspaceId, MIGRATION_VERSION, "steps/4"));
  } catch (err) {
    const e = err as Error;
    result.errors.push({ pathName: "steps/4", message: e.message ?? String(err) });
  }

  result.completedAt = Date.now();
  log.info("rollback_step4_completed", {
    workspaceId,
    pathsRemovedCount: result.pathsRemoved.length,
    errors: result.errors.length,
  });
  return result;
}

// ─── Step 5 rollback: just unset the completedAt and validatedAt markers ──
export async function rollbackStep5(workspaceId: string, log: Logger): Promise<RollbackResult> {
  const startedAt = Date.now();
  log.info("rollback_step5_started", { workspaceId });

  const result: RollbackResult = {
    step: 5,
    startedAt,
    completedAt: 0,
    unsafe: false,
    recordsReverted: {},
    pathsRemoved: [],
    errors: [],
  };

  try {
    const markerSnap = await db.ref(migrationPath(workspaceId, MIGRATION_VERSION)).once("value");
    const marker = (markerSnap.val() as Record<string, any> | null) || {};

    // Preserve other migration state (steps/1..4 markers, inventory, approval);
    // only clear the top-level completedAt/validatedAt
    await db.ref(migrationPath(workspaceId, MIGRATION_VERSION)).update({
      completedAt: null,
      validatedAt: null,
      validationResult: null,
      validationErrors: null,
    });
    log.info("rollback_step5_completed", { workspaceId });
  } catch (err) {
    const e = err as Error;
    result.errors.push({ pathName: "completedAt/validatedAt", message: e.message ?? String(err) });
  }

  result.completedAt = Date.now();
  return result;
}

// ─── Full rollback: invoke in reverse order ───────────────────────────────
export async function rollbackAll(
  workspaceId: string,
  log: Logger,
  forceUnsafe: boolean = false
): Promise<{ steps: RollbackResult[]; aborted: boolean; reason?: string }> {
  log.info("rollback_all_started", { workspaceId, forceUnsafe });
  const steps: RollbackResult[] = [];

  const r5 = await rollbackStep5(workspaceId, log);
  steps.push(r5);

  const r4 = await rollbackStep4(workspaceId, log, forceUnsafe);
  steps.push(r4);
  if (r4.unsafe) {
    log.warn("rollback_all_aborted", { workspaceId, reason: r4.reason });
    return { steps, aborted: true, reason: r4.reason };
  }

  const r3 = await rollbackStep3(workspaceId, log);
  steps.push(r3);

  const r2 = await rollbackStep2(workspaceId, log);
  steps.push(r2);

  const r1 = await rollbackStep1(workspaceId, log);
  steps.push(r1);

  log.info("rollback_all_completed", { workspaceId });
  return { steps, aborted: false };
}
