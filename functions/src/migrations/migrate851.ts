// Corsair Phase 8.5.1 — Migration orchestrator
//
// Composes the five steps + validation + completion marker per migration
// spec Part Three. Enforces operator approval gating per P-4.
//
// Per migration spec, migration runs only if:
//   - workspaces/{wsId}/migrations/8.5.1/operatorApprovedAt is set
//   - No concurrent migration is locked on the same workspace

import { db, migrationPath, wsPath } from "../framework/rtdb";
import { createLogger, generateJobId, Logger } from "../framework/logger";
import { runInventory, InventoryReport } from "./inventory";
import { runStep1, runStep2, runStep3, runStep4 } from "./steps";
import { runValidation, ValidationResult } from "./validation";
import {
  rollbackAll,
  rollbackStep1,
  rollbackStep2,
  rollbackStep3,
  rollbackStep4,
  rollbackStep5,
} from "./rollback";

export const MIGRATION_VERSION = "8.5.1";

// Lock lease duration per FIQ-7 (LOCKED): 60 minutes for migrations
const MIGRATION_LOCK_LEASE_MS = 60 * 60 * 1000;

// Anomaly rate threshold per OIQ-6 (LOCKED): 5%
const DEFAULT_ANOMALY_THRESHOLD_PERCENT = 5;

export interface MigrationOptions {
  forceProceed?: boolean; // override anomaly threshold; explicit operator action
  dryRun?: boolean; // run inventory only; no writes
}

export interface MigrationOutcome {
  workspaceId: string;
  version: typeof MIGRATION_VERSION;
  jobId: string;
  startedAt: number;
  completedAt: number | null;
  validatedAt: number | null;
  validationResult: "pass" | "fail" | null;
  validationErrors: ValidationResult["hardFailures"];
  recordsUpdated: {
    nodes: number;
    opportunities: number;
    meetings: number;
    signals: number;
    pathsCreated: number;
    sourcesInitialized: number;
  };
  errors: Array<{ step?: number; message: string }>;
  inventory?: InventoryReport;
  aborted?: { reason: string };
}

// ────────────────────────────────────────────────────────────────────────
// Inventory-only mode (dry-run): read workspace, write inventory.json,
// return report without performing any data migration.
// ────────────────────────────────────────────────────────────────────────
export async function previewMigration(workspaceId: string): Promise<InventoryReport> {
  const jobId = generateJobId("migrate851-preview");
  const log = createLogger({ source: "migration", workspace: workspaceId, jobId });
  log.info("preview_started", { workspaceId });
  const report = await runInventory(workspaceId, log);
  log.info("preview_completed", { workspaceId });
  return report;
}

// ────────────────────────────────────────────────────────────────────────
// Full migration: requires operator approval + acquires lock + runs all
// steps + validation + completion marker.
// ────────────────────────────────────────────────────────────────────────
export async function applyMigration(
  workspaceId: string,
  options: MigrationOptions = {}
): Promise<MigrationOutcome> {
  const jobId = generateJobId("migrate851-apply");
  const log = createLogger({ source: "migration", workspace: workspaceId, jobId });
  const startedAt = Date.now();

  const outcome: MigrationOutcome = {
    workspaceId,
    version: MIGRATION_VERSION,
    jobId,
    startedAt,
    completedAt: null,
    validatedAt: null,
    validationResult: null,
    validationErrors: [],
    recordsUpdated: {
      nodes: 0,
      opportunities: 0,
      meetings: 0,
      signals: 0,
      pathsCreated: 0,
      sourcesInitialized: 0,
    },
    errors: [],
  };

  log.info("apply_started", { workspaceId, options });

  if (options.dryRun) {
    outcome.inventory = await previewMigration(workspaceId);
    outcome.completedAt = Date.now();
    return outcome;
  }

  // ─── Approval gate ───
  const approvalPath = migrationPath(workspaceId, MIGRATION_VERSION, "operatorApprovedAt");
  const approvalSnap = await db.ref(approvalPath).once("value");
  if (!approvalSnap.exists() || typeof approvalSnap.val() !== "number") {
    outcome.aborted = {
      reason: "Migration not approved by operator. Set operatorApprovedAt timestamp to authorize.",
    };
    log.warn("apply_aborted_no_approval", { workspaceId });
    return outcome;
  }

  // ─── Lock acquisition (per FIQ-7) ───
  const lockPath = migrationPath(workspaceId, MIGRATION_VERSION, "locked");
  const lockResult = await db.ref(lockPath).transaction((current) => {
    if (current === null) {
      return {
        acquiredAt: Date.now(),
        acquiredBy: jobId,
        expiresAt: Date.now() + MIGRATION_LOCK_LEASE_MS,
      };
    }
    const lock = current as { expiresAt?: number };
    if (lock.expiresAt && lock.expiresAt < Date.now()) {
      // Stale lock — reclaim
      return {
        acquiredAt: Date.now(),
        acquiredBy: jobId,
        expiresAt: Date.now() + MIGRATION_LOCK_LEASE_MS,
      };
    }
    // Lock is held by another job
    return; // abort transaction
  });

  if (!lockResult.committed) {
    outcome.aborted = {
      reason: "Another migration job holds the lock on this workspace. Try again later.",
    };
    log.warn("apply_aborted_locked", { workspaceId });
    return outcome;
  }

  try {
    // ─── Inventory (write or refresh) ───
    const inventory = await runInventory(workspaceId, log);
    outcome.inventory = inventory;

    // ─── Anomaly threshold check (per OIQ-6) ───
    if (
      !options.forceProceed &&
      inventory.anomalyRatePercent > DEFAULT_ANOMALY_THRESHOLD_PERCENT
    ) {
      outcome.aborted = {
        reason: `Anomaly rate ${inventory.anomalyRatePercent}% exceeds default threshold of ${DEFAULT_ANOMALY_THRESHOLD_PERCENT}%. Review inventory anomalies and either remediate or pass forceProceed=true to override.`,
      };
      log.warn("apply_aborted_anomaly_threshold", {
        workspaceId,
        anomalyRate: inventory.anomalyRatePercent,
      });
      return outcome;
    }

    // ─── Step 1: source provenance ───
    const step1 = await runStep1(workspaceId, log);
    outcome.recordsUpdated.nodes += step1.recordsUpdated.nodes ?? 0;
    outcome.recordsUpdated.opportunities += step1.recordsUpdated.opportunities ?? 0;
    outcome.recordsUpdated.meetings += step1.recordsUpdated.meetings ?? 0;
    outcome.recordsUpdated.signals += step1.recordsUpdated.signals ?? 0;
    if (step1.errors.length > 0) {
      outcome.errors.push(...step1.errors.map((e) => ({ step: 1, message: e.message })));
    }

    // ─── Step 2: organization.type enum (client-side marker) ───
    const step2 = await runStep2(workspaceId, log);
    if (step2.errors.length > 0) {
      outcome.errors.push(...step2.errors.map((e) => ({ step: 2, message: e.message })));
    }

    // ─── Step 3: edge schema extension (client-side marker) ───
    const step3 = await runStep3(workspaceId, log);
    if (step3.errors.length > 0) {
      outcome.errors.push(...step3.errors.map((e) => ({ step: 3, message: e.message })));
    }

    // ─── Step 4: new collections initialization ───
    const step4 = await runStep4(workspaceId, log);
    outcome.recordsUpdated.pathsCreated += step4.pathsCreated?.length ?? 0;
    const sourcesCount = (step4.pathsCreated ?? []).filter((p) => p.includes("/sources/") && p.endsWith("/config")).length;
    outcome.recordsUpdated.sourcesInitialized = sourcesCount;
    if (step4.errors.length > 0) {
      outcome.errors.push(...step4.errors.map((e) => ({ step: 4, message: e.message })));
    }

    // ─── Step 5: validation ───
    const validation = await runValidation(workspaceId, log);
    outcome.validatedAt = validation.ranAt + validation.durationMs;
    outcome.validationResult = validation.result;
    outcome.validationErrors = validation.hardFailures;

    if (validation.result === "pass") {
      outcome.completedAt = Date.now();
      // Write final completion marker
      await db.ref(migrationPath(workspaceId, MIGRATION_VERSION)).update({
        version: MIGRATION_VERSION,
        startedAt: outcome.startedAt,
        completedAt: outcome.completedAt,
        validatedAt: outcome.validatedAt,
        validationResult: "pass",
        recordsUpdated: outcome.recordsUpdated,
        errors: outcome.errors,
        jobId: outcome.jobId,
      });
      log.info("apply_succeeded", {
        workspaceId,
        durationMs: outcome.completedAt - outcome.startedAt,
        recordsUpdated: outcome.recordsUpdated,
      });
    } else {
      // Validation failed: completedAt remains null
      await db.ref(migrationPath(workspaceId, MIGRATION_VERSION)).update({
        version: MIGRATION_VERSION,
        startedAt: outcome.startedAt,
        completedAt: null,
        validatedAt: outcome.validatedAt,
        validationResult: "fail",
        validationErrors: outcome.validationErrors,
        recordsUpdated: outcome.recordsUpdated,
        errors: outcome.errors,
        jobId: outcome.jobId,
      });
      log.error("apply_validation_failed", {
        workspaceId,
        hardFailures: validation.hardFailures.length,
      });
    }
  } catch (err) {
    const e = err as Error;
    outcome.errors.push({ message: e.message ?? String(err) });
    log.error("apply_threw", { workspaceId, message: e.message });
  } finally {
    // Release lock
    await db.ref(lockPath).remove();
  }

  return outcome;
}

// ────────────────────────────────────────────────────────────────────────
// Rollback: invoke per-step or full
// ────────────────────────────────────────────────────────────────────────
export async function rollbackMigration(
  workspaceId: string,
  options: { steps?: number[]; forceUnsafe?: boolean } = {}
): Promise<{
  workspaceId: string;
  jobId: string;
  steps: Array<{ step: number; result: unknown }>;
  aborted: boolean;
  reason?: string;
}> {
  const jobId = generateJobId("migrate851-rollback");
  const log = createLogger({ source: "migration", workspace: workspaceId, jobId });
  log.info("rollback_started", { workspaceId, options });

  if (!options.steps || options.steps.length === 0) {
    // Full rollback
    const result = await rollbackAll(workspaceId, log, options.forceUnsafe ?? false);
    return {
      workspaceId,
      jobId,
      steps: result.steps.map((r) => ({ step: r.step, result: r })),
      aborted: result.aborted,
      reason: result.reason,
    };
  }

  const stepHandlers: Record<number, (wsId: string, log: Logger) => Promise<unknown>> = {
    1: rollbackStep1,
    2: rollbackStep2,
    3: rollbackStep3,
    5: rollbackStep5,
  };

  const results: Array<{ step: number; result: unknown }> = [];
  for (const stepNum of options.steps) {
    if (stepNum === 4) {
      const r = await rollbackStep4(workspaceId, log, options.forceUnsafe ?? false);
      results.push({ step: 4, result: r });
      if (r.unsafe) {
        return { workspaceId, jobId, steps: results, aborted: true, reason: r.reason };
      }
      continue;
    }
    const handler = stepHandlers[stepNum];
    if (!handler) {
      results.push({ step: stepNum, result: { error: `No handler for step ${stepNum}` } });
      continue;
    }
    const r = await handler(workspaceId, log);
    results.push({ step: stepNum, result: r });
  }

  log.info("rollback_completed", { workspaceId, stepsCount: results.length });
  return { workspaceId, jobId, steps: results, aborted: false };
}
