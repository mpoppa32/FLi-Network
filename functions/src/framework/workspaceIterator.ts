// Corsair framework — workspace iterator
//
// Per framework spec Part Three: scheduled jobs iterate across all
// approved workspaces and invoke the source's syncDelta per workspace.
//
// Approval criteria per framework spec:
//   - workspace exists
//   - Phase 8.5.1 migration has completed (completedAt set, validation passed)
//   - workspace's source is enabled (no `disabled: true` flag)
//
// Per FIQ-6 (LOCKED): per-invocation cache only; no cross-invocation persistence.

import { db, listWorkspaceIds, migrationPath, sourcePath } from "./rtdb";
import { Logger } from "./logger";

export interface WorkspaceApprovalState {
  workspaceId: string;
  migrationComplete: boolean;
  sourceEnabled: boolean;
  hasConfig: boolean;
  reason: string | null;
}

/**
 * Read the migration + source-enabled state for one workspace + source.
 */
async function checkWorkspaceApproval(
  workspaceId: string,
  source: string
): Promise<WorkspaceApprovalState> {
  // 1. Migration complete?
  const migSnap = await db
    .ref(migrationPath(workspaceId, "8.5.1"))
    .once("value");
  const mig = migSnap.val() as { completedAt?: number; validationResult?: string } | null;
  const migrationComplete = Boolean(
    mig && mig.completedAt && mig.validationResult === "pass"
  );

  if (!migrationComplete) {
    return {
      workspaceId,
      migrationComplete: false,
      sourceEnabled: false,
      hasConfig: false,
      reason: "8.5.1 migration not complete",
    };
  }

  // 2. Source config exists?
  const cfgSnap = await db
    .ref(sourcePath(workspaceId, source, "config"))
    .once("value");
  const hasConfig = cfgSnap.exists();

  if (!hasConfig) {
    return {
      workspaceId,
      migrationComplete: true,
      sourceEnabled: false,
      hasConfig: false,
      reason: `source config not initialized for ${source}`,
    };
  }

  // 3. Source disabled? (explicit operator opt-out)
  const cfg = (cfgSnap.val() as { disabled?: boolean }) ?? {};
  const sourceEnabled = !cfg.disabled;

  if (!sourceEnabled) {
    return {
      workspaceId,
      migrationComplete: true,
      sourceEnabled: false,
      hasConfig: true,
      reason: `source explicitly disabled by operator`,
    };
  }

  return {
    workspaceId,
    migrationComplete: true,
    sourceEnabled: true,
    hasConfig: true,
    reason: null,
  };
}

/**
 * List workspaces approved for a specific source's sync.
 */
export async function listApprovedWorkspaces(
  source: string,
  log?: Logger
): Promise<string[]> {
  const allIds = await listWorkspaceIds();
  const results: string[] = [];
  for (const wsid of allIds) {
    const state = await checkWorkspaceApproval(wsid, source);
    if (state.sourceEnabled && state.migrationComplete && state.hasConfig) {
      results.push(wsid);
    } else {
      log?.debug("workspace_skipped", { workspaceId: wsid, reason: state.reason });
    }
  }
  log?.info("workspaces_loaded", { source, count: results.length, total: allIds.length });
  return results;
}

/**
 * Iterate approved workspaces, invoking `fn` per workspace. Errors in one
 * workspace don't halt the iteration.
 */
export async function iterateApprovedWorkspaces<TResult>(
  source: string,
  fn: (workspaceId: string) => Promise<TResult>,
  log: Logger
): Promise<{
  succeeded: Array<{ workspaceId: string; result: TResult }>;
  failed: Array<{ workspaceId: string; error: { category: string; message: string } }>;
}> {
  const ids = await listApprovedWorkspaces(source, log);
  const succeeded: Array<{ workspaceId: string; result: TResult }> = [];
  const failed: Array<{ workspaceId: string; error: { category: string; message: string } }> = [];

  for (const workspaceId of ids) {
    try {
      const result = await fn(workspaceId);
      succeeded.push({ workspaceId, result });
    } catch (err) {
      const e = err as Error;
      failed.push({
        workspaceId,
        error: { category: "permanent", message: e.message ?? String(err) },
      });
      log.error("workspace_sync_failed", {
        workspaceId,
        source,
        message: e.message ?? String(err),
      });
    }
  }

  return { succeeded, failed };
}

/**
 * Read approval state for one workspace + source. Useful for HTTPS callable
 * functions that need to validate approval before running.
 */
export { checkWorkspaceApproval };
