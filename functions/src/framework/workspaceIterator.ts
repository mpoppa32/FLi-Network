// Corsair framework — workspace iterator
//
// Per framework spec Part Three: scheduled jobs iterate across all
// approved workspaces and invoke the source's syncDelta per workspace.
//
// P13.164 — the original gate read `migrations/8.5.1` as an RTDB key. RTDB
// forbids dots in keys; the read THREW on every call, so every OSINT cron
// silently failed for every workspace. The framework never produced data
// in production. Approval is now config-only:
//   - workspace exists
//   - /workspaces/{ws}/sources/{source}/config exists
//   - cfg.disabled !== true
//
// Enrollment = writing the source config. Operator opt-out = setting
// disabled:true. Per-invocation cache only (FIQ-6 LOCKED).

import { db, listWorkspaceIds, sourcePath } from "./rtdb";
import { Logger } from "./logger";

export interface WorkspaceApprovalState {
  workspaceId: string;
  migrationComplete: boolean; // kept for backward compat; mirrors hasConfig
  sourceEnabled: boolean;
  hasConfig: boolean;
  reason: string | null;
}

/**
 * Read the source-enabled state for one workspace + source.
 *
 * P13.164: dropped the legacy 8.5.1 migration check — its RTDB key path
 * was invalid (dots) so the read always threw. Approval is now just
 * "config exists + not disabled".
 */
async function checkWorkspaceApproval(
  workspaceId: string,
  source: string
): Promise<WorkspaceApprovalState> {
  const cfgSnap = await db
    .ref(sourcePath(workspaceId, source, "config"))
    .once("value");
  const hasConfig = cfgSnap.exists();

  if (!hasConfig) {
    return {
      workspaceId,
      migrationComplete: false,
      sourceEnabled: false,
      hasConfig: false,
      reason: `source config not initialized for ${source}`,
    };
  }

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
