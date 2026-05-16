// Corsair Phase 8.5.1 — Migration validation
//
// Per migration spec Part Six: six validation checks run at Step 5 to
// verify the workspace's post-migration state is internally consistent.
// Hard failures block the completion marker; soft failures flag but don't
// block.
//
//   V-1: Every entity has source provenance              (HARD)
//   V-2: No orphan edges                                  (SOFT)
//   V-3: Every opportunity has a valid stage              (SOFT)
//   V-4: Posture extensions are well-formed               (SOFT)
//   V-5: New collections initialized                       (HARD)
//   V-6: Migration markers are well-formed                (HARD)

import { db, wsPath, migrationPath, sourcePath } from "../framework/rtdb";
import { Logger } from "../framework/logger";

export const MIGRATION_VERSION = "8.5.1";

const VALID_STAGES = new Set([
  "awareness",
  "tracking",
  "engaged",
  "rfp",
  "proposal",
  "negotiation",
  "submitted",
  "award",
  "won",
  "lost",
]);

export interface ValidationFailure {
  check: string;
  entityType?: string;
  entityId?: string;
  linkId?: string;
  pathName?: string;
  issue: string;
}

export interface ValidationResult {
  ranAt: number;
  durationMs: number;
  hardFailures: ValidationFailure[];
  softFailures: ValidationFailure[];
  result: "pass" | "fail";
  recommendation: string;
}

export async function runValidation(workspaceId: string, log: Logger): Promise<ValidationResult> {
  const startedAt = Date.now();
  log.info("validation_started", { workspaceId });

  const hardFailures: ValidationFailure[] = [];
  const softFailures: ValidationFailure[] = [];

  const wsSnap = await db.ref(wsPath(workspaceId)).once("value");
  const ws = (wsSnap.val() as Record<string, unknown>) || {};
  const nodes = (ws.nodes as Record<string, any> | undefined) || {};
  const links = (ws.links as Record<string, any> | undefined) || {};
  const opportunities = (ws.opportunities as Record<string, any> | undefined) || {};
  const meetings = (ws.meetings as Record<string, any> | undefined) || {};
  const signals = (ws.signals as Record<string, any> | undefined) || {};
  const nodeIds = new Set(Object.keys(nodes));

  // V-1: every entity has source provenance
  for (const [collection, records] of [
    ["nodes", nodes],
    ["opportunities", opportunities],
    ["meetings", meetings],
    ["signals", signals],
  ] as const) {
    for (const [id, entity] of Object.entries(records)) {
      const e = entity as Record<string, any>;
      if (!e.source || typeof e.source !== "object" || typeof e.source.system !== "string" || e.source.system.length === 0) {
        hardFailures.push({
          check: "V-1",
          entityType: collection,
          entityId: id,
          issue: "missing or empty source.system",
        });
      } else if (typeof e.source.fetchedAt !== "number") {
        hardFailures.push({
          check: "V-1",
          entityType: collection,
          entityId: id,
          issue: "source.fetchedAt is not a timestamp number",
        });
      }
    }
  }

  // V-2: no orphan edges (soft)
  for (const [id, link] of Object.entries(links)) {
    const l = link as Record<string, any>;
    if (l.source !== undefined && !nodeIds.has(String(l.source))) {
      softFailures.push({
        check: "V-2",
        linkId: id,
        issue: `link.source references missing node: ${l.source}`,
      });
    }
    if (l.target !== undefined && !nodeIds.has(String(l.target))) {
      softFailures.push({
        check: "V-2",
        linkId: id,
        issue: `link.target references missing node: ${l.target}`,
      });
    }
  }

  // V-3: every opportunity has a valid stage (soft)
  for (const [id, opp] of Object.entries(opportunities)) {
    const o = opp as Record<string, any>;
    const stage = String(o.stage || "");
    if (!VALID_STAGES.has(stage)) {
      softFailures.push({
        check: "V-3",
        entityType: "opportunities",
        entityId: id,
        issue: `invalid stage value: '${stage}'`,
      });
    }
    if (o.stageEnteredAt !== undefined && typeof o.stageEnteredAt !== "number" && typeof o.stageEnteredAt !== "string") {
      softFailures.push({
        check: "V-3",
        entityType: "opportunities",
        entityId: id,
        issue: "stageEnteredAt is not a timestamp",
      });
    }
  }

  // V-4: posture extensions well-formed (soft)
  for (const [id, node] of Object.entries(nodes)) {
    const n = node as Record<string, any>;
    if (!n.posture) continue;
    const p = n.posture as Record<string, any>;
    if (p.tells !== undefined && !Array.isArray(p.tells)) {
      softFailures.push({
        check: "V-4",
        entityType: "nodes",
        entityId: id,
        issue: "posture.tells exists but is not an array",
      });
    }
    if (p.byPursuit !== undefined && (typeof p.byPursuit !== "object" || Array.isArray(p.byPursuit))) {
      softFailures.push({
        check: "V-4",
        entityType: "nodes",
        entityId: id,
        issue: "posture.byPursuit exists but is not an object",
      });
    }
  }
  for (const [id, opp] of Object.entries(opportunities)) {
    const o = opp as Record<string, any>;
    if (o.posture && o.posture.adversaries !== undefined && !Array.isArray(o.posture.adversaries)) {
      softFailures.push({
        check: "V-4",
        entityType: "opportunities",
        entityId: id,
        issue: "posture.adversaries exists but is not an array",
      });
    }
  }

  // V-5: new collections initialized (hard)
  const expectedPaths = [
    wsPath(workspaceId, "awards"),
    sourcePath(workspaceId, "sam_gov", "config"),
    sourcePath(workspaceId, "usaspending", "config"),
    sourcePath(workspaceId, "dod_news", "config"),
    sourcePath(workspaceId, "gao_protest", "config"),
    sourcePath(workspaceId, "sec_edgar", "config"),
    sourcePath(workspaceId, "congress_gov", "config"),
  ];
  for (const path of expectedPaths) {
    const snap = await db.ref(path).once("value");
    if (!snap.exists()) {
      hardFailures.push({
        check: "V-5",
        pathName: path,
        issue: "expected path does not exist after Step 4",
      });
    }
  }

  // V-6: migration markers well-formed (hard)
  const step1Snap = await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/1")).once("value");
  if (!step1Snap.exists() || typeof (step1Snap.val() as any)?.completedAt !== "number") {
    hardFailures.push({
      check: "V-6",
      pathName: migrationPath(workspaceId, MIGRATION_VERSION, "steps/1"),
      issue: "Step 1 marker missing or completedAt is not a timestamp",
    });
  }
  const step4Snap = await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "steps/4")).once("value");
  if (!step4Snap.exists() || typeof (step4Snap.val() as any)?.completedAt !== "number") {
    hardFailures.push({
      check: "V-6",
      pathName: migrationPath(workspaceId, MIGRATION_VERSION, "steps/4"),
      issue: "Step 4 marker missing or completedAt is not a timestamp",
    });
  }

  const ranAt = startedAt;
  const durationMs = Date.now() - startedAt;
  const result: ValidationResult = {
    ranAt,
    durationMs,
    hardFailures,
    softFailures,
    result: hardFailures.length === 0 ? "pass" : "fail",
    recommendation:
      hardFailures.length === 0
        ? "Migration validation passed. Workspace is 8.5.1-ready."
        : `Validation failed with ${hardFailures.length} hard failure(s). Review and remediate before retry. Common causes: incomplete Step 1 (some entities lack source provenance) or incomplete Step 4 (some collections not initialized).`,
  };

  log.info("validation_completed", {
    workspaceId,
    durationMs,
    hardFailures: hardFailures.length,
    softFailures: softFailures.length,
    result: result.result,
  });

  return result;
}
