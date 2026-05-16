// Corsair Phase 8.5.1 — Migration steps
//
// Five sequential steps per migration spec Part Three:
//   Step 1: Add source provenance to existing entities
//   Step 2: Organization.type enum extension (client-side only — no RTDB write)
//   Step 3: Edge schema extension (client-side only — no RTDB write)
//   Step 4: Initialize new collections and source configurations
//   Step 5: Migration completion marker and validation (in validation.ts)
//
// Each step is idempotent (safe to re-run) and has documented rollback.

import { db, wsPath, migrationPath, sourcePath, batchedUpdate, BATCH_SIZE } from "../framework/rtdb";
import { Logger } from "../framework/logger";
import { operatorManualProvenance, OPERATOR_MANUAL_SYSTEM } from "../framework/provenance";

export const MIGRATION_VERSION = "8.5.1";

export interface StepResult {
  step: number;
  startedAt: number;
  completedAt: number;
  recordsProcessed: Record<string, number>;
  recordsUpdated: Record<string, number>;
  recordsSkipped: Record<string, number>;
  pathsCreated?: string[];
  pathsSkipped?: string[];
  errors: Array<{ entityType?: string; entityId?: string; pathName?: string; message: string }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Step 1 — Add source provenance to existing entities
//
// For every Person/Org node, link, opportunity, meeting, signal in the
// workspace that does not currently have a `source` field, add:
//   source: { system: 'operator_manual', externalId: null, url: null,
//             fetchedAt: <entity.created || now>, refreshedAt: <same>,
//             hash: null }
//   migration: { version: '8.5.1', step: 1, appliedAt: <now> }
//
// Idempotency: skip entities that already have source.system.
// ─────────────────────────────────────────────────────────────────────────
export async function runStep1(workspaceId: string, log: Logger): Promise<StepResult> {
  const startedAt = Date.now();
  log.info("step1_started", { workspaceId });

  const result: StepResult = {
    step: 1,
    startedAt,
    completedAt: 0,
    recordsProcessed: { nodes: 0, links: 0, opportunities: 0, meetings: 0, signals: 0 },
    recordsUpdated: { nodes: 0, links: 0, opportunities: 0, meetings: 0, signals: 0 },
    recordsSkipped: { nodes: 0, links: 0, opportunities: 0, meetings: 0, signals: 0 },
    errors: [],
  };

  // Entity collections to migrate. Note: edges (links) in this codebase use
  // `source` and `target` as node FK fields, so the migration adds `.source`
  // provenance to the OTHER named entity types. The migration spec Step 1 is
  // explicit: provenance attaches to entities; edges are out of Step 1 scope
  // (they get a separate provenance field if needed in a future migration).
  const entityTypes: Array<{ key: "nodes" | "opportunities" | "meetings" | "signals"; resultKey: string }> = [
    { key: "nodes", resultKey: "nodes" },
    { key: "opportunities", resultKey: "opportunities" },
    { key: "meetings", resultKey: "meetings" },
    { key: "signals", resultKey: "signals" },
  ];

  for (const { key, resultKey } of entityTypes) {
    try {
      await migrateEntityType(workspaceId, key, result, resultKey);
    } catch (err) {
      const e = err as Error;
      result.errors.push({
        entityType: key,
        message: e.message ?? String(err),
      });
      log.error("step1_entity_type_failed", { entityType: key, message: e.message });
    }
  }

  result.completedAt = Date.now();

  // Persist step marker
  await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/1")).set(result);

  log.info("step1_completed", {
    workspaceId,
    durationMs: result.completedAt - result.startedAt,
    totalUpdated: Object.values(result.recordsUpdated).reduce((s, n) => s + n, 0),
  });

  return result;
}

async function migrateEntityType(
  workspaceId: string,
  collectionKey: "nodes" | "opportunities" | "meetings" | "signals",
  result: StepResult,
  resultKey: string
): Promise<void> {
  const snap = await db.ref(wsPath(workspaceId, collectionKey)).once("value");
  const records = (snap.val() as Record<string, any> | null) || {};
  const ids = Object.keys(records);
  result.recordsProcessed[resultKey] = ids.length;

  const updates: Record<string, unknown> = {};
  let batchCount = 0;

  for (const id of ids) {
    const entity = records[id];
    if (entity && entity.source && typeof entity.source === "object" && typeof entity.source.system === "string") {
      result.recordsSkipped[resultKey]++;
      continue;
    }

    const createdAt = entity?.created
      ? typeof entity.created === "string"
        ? Date.parse(entity.created) || Date.now()
        : Number(entity.created)
      : entity?.createdAt
      ? Number(entity.createdAt)
      : Date.now();

    const provenance = operatorManualProvenance(createdAt);
    const migration = { version: MIGRATION_VERSION, step: 1, appliedAt: Date.now() };

    updates[`${wsPath(workspaceId, collectionKey, id)}/source`] = provenance;
    updates[`${wsPath(workspaceId, collectionKey, id)}/migration`] = migration;
    batchCount++;
    result.recordsUpdated[resultKey]++;

    if (batchCount >= BATCH_SIZE) {
      await batchedUpdate(updates);
      Object.keys(updates).forEach((k) => delete updates[k]);
      batchCount = 0;
    }
  }

  if (Object.keys(updates).length > 0) {
    await batchedUpdate(updates);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2 — Organization.type enum extension (client-side marker only)
//
// No RTDB writes. The new types (program, committee, lobby_firm, university,
// ffrdc, trade_assoc) are additive; existing 'company' / 'government' /
// 'other' records unaffected. Client code recognizes the new values when
// the new client deploys.
// ─────────────────────────────────────────────────────────────────────────
export async function runStep2(workspaceId: string, log: Logger): Promise<StepResult> {
  const startedAt = Date.now();
  log.info("step2_started", { workspaceId });

  const result: StepResult = {
    step: 2,
    startedAt,
    completedAt: Date.now(),
    recordsProcessed: {},
    recordsUpdated: {},
    recordsSkipped: {},
    errors: [],
  };

  await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/2")).set({
    ...result,
    note: "client-side enum extension; no data migration required",
    clientVersionRequired: "0.85.0",
  });

  log.info("step2_completed", { workspaceId });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3 — Edge schema extension (client-side marker only)
//
// No RTDB writes. The new optional fields (start, end, attrs) are additive;
// existing edges without them continue to work.
// ─────────────────────────────────────────────────────────────────────────
export async function runStep3(workspaceId: string, log: Logger): Promise<StepResult> {
  const startedAt = Date.now();
  log.info("step3_started", { workspaceId });

  const result: StepResult = {
    step: 3,
    startedAt,
    completedAt: Date.now(),
    recordsProcessed: {},
    recordsUpdated: {},
    recordsSkipped: {},
    errors: [],
  };

  await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/3")).set({
    ...result,
    note: "client-side edge schema extension; no data migration required",
    clientVersionRequired: "0.85.0",
  });

  log.info("step3_completed", { workspaceId });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Step 4 — Initialize new collections and source configurations
//
// Creates the new top-level paths Phase 8.5 will write to:
//   workspaces/{wsId}/awards = {}
//   workspaces/{wsId}/sources/{system}/config = { ... defaults ... }
//   workspaces/{wsId}/sources/{system}/lastSync = null
//   workspaces/{wsId}/sources/{system}/lastError = null
//   workspaces/{wsId}/sources/{system}/raw = {}
//
// Per OIQ-7 (LOCKED): empty config seeds. Operator populates via Settings UI.
// Per migration spec Part Three Step 4: skip paths that already exist.
// ─────────────────────────────────────────────────────────────────────────
export async function runStep4(workspaceId: string, log: Logger): Promise<StepResult> {
  const startedAt = Date.now();
  log.info("step4_started", { workspaceId });

  const result: StepResult = {
    step: 4,
    startedAt,
    completedAt: 0,
    recordsProcessed: {},
    recordsUpdated: {},
    recordsSkipped: {},
    pathsCreated: [],
    pathsSkipped: [],
    errors: [],
  };

  const initializedAt = Date.now();

  const initSpecs: Array<{ path: string; defaultValue: unknown }> = [
    // Awards collection
    { path: wsPath(workspaceId, "awards"), defaultValue: {} },

    // SAM.gov source
    {
      path: sourcePath(workspaceId, "sam_gov", "config"),
      defaultValue: {
        naics: [],
        agencies: [],
        setAsides: [],
        noticeTypes: ["solicitation", "combined_synopsis_solicitation", "presol", "sources_sought"],
        initializedAt,
      },
    },
    { path: sourcePath(workspaceId, "sam_gov", "lastSync"), defaultValue: null },
    { path: sourcePath(workspaceId, "sam_gov", "lastError"), defaultValue: null },
    { path: sourcePath(workspaceId, "sam_gov", "raw"), defaultValue: {} },

    // USAspending source
    {
      path: sourcePath(workspaceId, "usaspending", "config"),
      defaultValue: {
        naics: [],
        agencies: [],
        competitorOrgs: [],
        lookBackMonths: 24,
        recompeteWatchHorizonMonths: 18,
        initializedAt,
      },
    },
    { path: sourcePath(workspaceId, "usaspending", "lastSync"), defaultValue: null },
    { path: sourcePath(workspaceId, "usaspending", "lastError"), defaultValue: null },
    { path: sourcePath(workspaceId, "usaspending", "raw"), defaultValue: {} },

    // DoD News source
    {
      path: sourcePath(workspaceId, "dod_news", "config"),
      defaultValue: { initializedAt },
    },
    { path: sourcePath(workspaceId, "dod_news", "lastSync"), defaultValue: null },
    { path: sourcePath(workspaceId, "dod_news", "lastError"), defaultValue: null },
    { path: sourcePath(workspaceId, "dod_news", "raw"), defaultValue: {} },

    // GAO Protest source
    {
      path: sourcePath(workspaceId, "gao_protest", "config"),
      defaultValue: {
        trackedOrgs: [],
        lookBackMonths: 12,
        initializedAt,
      },
    },
    { path: sourcePath(workspaceId, "gao_protest", "lastSync"), defaultValue: null },
    { path: sourcePath(workspaceId, "gao_protest", "lastError"), defaultValue: null },
    { path: sourcePath(workspaceId, "gao_protest", "raw"), defaultValue: {} },

    // SEC EDGAR source
    {
      path: sourcePath(workspaceId, "sec_edgar", "config"),
      defaultValue: {
        watchlistCiks: [],
        filingTypes: ["8-K", "10-K", "10-Q", "DEF 14A", "4"],
        initializedAt,
      },
    },
    { path: sourcePath(workspaceId, "sec_edgar", "lastSync"), defaultValue: null },
    { path: sourcePath(workspaceId, "sec_edgar", "lastError"), defaultValue: null },
    { path: sourcePath(workspaceId, "sec_edgar", "raw"), defaultValue: {} },

    // Congress.gov source
    {
      path: sourcePath(workspaceId, "congress_gov", "config"),
      defaultValue: {
        committees: ["hsas00", "hsap02", "hlig00", "ssas00", "ssap02", "slin00"],
        trackedNominationCategories: ["DoD", "Defense", "Air Force", "Navy", "Army", "Space Force"],
        initializedAt,
      },
    },
    { path: sourcePath(workspaceId, "congress_gov", "lastSync"), defaultValue: null },
    { path: sourcePath(workspaceId, "congress_gov", "lastError"), defaultValue: null },
    { path: sourcePath(workspaceId, "congress_gov", "raw"), defaultValue: {} },
  ];

  for (const spec of initSpecs) {
    try {
      const snap = await db.ref(spec.path).once("value");
      if (snap.exists()) {
        result.pathsSkipped!.push(spec.path);
        continue;
      }
      await db.ref(spec.path).set(spec.defaultValue);
      result.pathsCreated!.push(spec.path);
    } catch (err) {
      const e = err as Error;
      result.errors.push({
        pathName: spec.path,
        message: e.message ?? String(err),
      });
    }
  }

  result.completedAt = Date.now();

  await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/4")).set(result);

  log.info("step4_completed", {
    workspaceId,
    pathsCreated: result.pathsCreated!.length,
    pathsSkipped: result.pathsSkipped!.length,
    errors: result.errors.length,
  });

  return result;
}

// Re-export for convenience
export { OPERATOR_MANUAL_SYSTEM };
