// Corsair Phase 8.5.1 — Migration inventory
//
// Per migration spec Part Two: before any migration step runs, an inventory
// script reads the workspace and writes a structured report to
// `workspaces/{wsId}/migrations/8.5.1/inventory.json`.
//
// Inventory is read-only (except for writing the inventory itself).
// Operator reviews inventory before approving migration.

import { db, wsPath, migrationPath } from "../framework/rtdb";
import { Logger } from "../framework/logger";

export const MIGRATION_VERSION = "8.5.1";

export interface InventoryAnomaly {
  type: "orphan_edge" | "malformed_opp" | "malformed_entity" | "duplicate_entity";
  entityId?: string;
  edgeId?: string;
  oppId?: string;
  reason: string;
}

export interface InventoryReport {
  workspaceId: string;
  inventoryAt: number;
  entityCounts: {
    nodes: { total: number; byType: Record<string, number> };
    links: { total: number };
    opportunities: { total: number; byStage: Record<string, number> };
    meetings: { total: number };
    signals: { total: number; byType: Record<string, number> };
    workspaceMembers: { total: number };
  };
  schemaState: {
    entitiesWithSource: number;
    entitiesWithoutSource: number;
    postureExtensionsPresent: {
      byPursuit: number;
      tells: number;
      adversaries: number;
      influenceReads: number;
      trajectory: number;
      path: number;
    };
  };
  anomalies: InventoryAnomaly[];
  estimatedDurationSec: number;
  estimatedWritesCount: number;
  anomalyRatePercent: number;
  inventoryVersion: typeof MIGRATION_VERSION;
}

// Valid stage keys per pipeline.js (locked by operator 2026-05-14)
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

export async function runInventory(workspaceId: string, log: Logger): Promise<InventoryReport> {
  log.info("inventory_started", { workspaceId });

  const wsSnap = await db.ref(wsPath(workspaceId)).once("value");
  const ws = (wsSnap.val() as Record<string, unknown>) || {};

  const nodes = (ws.nodes as Record<string, any> | undefined) || {};
  const links = (ws.links as Record<string, any> | undefined) || {};
  const opportunities = (ws.opportunities as Record<string, any> | undefined) || {};
  const meetings = (ws.meetings as Record<string, any> | undefined) || {};
  const signals = (ws.signals as Record<string, any> | undefined) || {};
  const members = (ws.members as Record<string, any> | undefined) || {};

  const nodeIds = new Set(Object.keys(nodes));
  const nodeByType: Record<string, number> = {};
  let entitiesWithSource = 0;
  let entitiesWithoutSource = 0;
  let postureByPursuit = 0;
  let postureTells = 0;
  let postureAdversaries = 0;
  let postureInfluenceReads = 0;
  let postureTrajectory = 0;
  let posturePath = 0;

  const anomalies: InventoryAnomaly[] = [];

  // Pass 1: nodes
  for (const [id, node] of Object.entries(nodes)) {
    const n = node as Record<string, any>;
    const type = String(n.type || "unknown");
    nodeByType[type] = (nodeByType[type] || 0) + 1;

    if (n.source && typeof n.source === "object" && typeof n.source.system === "string") {
      entitiesWithSource++;
    } else {
      entitiesWithoutSource++;
    }

    if (n.posture && typeof n.posture === "object") {
      const p = n.posture as Record<string, any>;
      if (p.byPursuit && typeof p.byPursuit === "object") postureByPursuit++;
      if (Array.isArray(p.tells) && p.tells.length > 0) postureTells++;
      if (Array.isArray(p.adversaries) && p.adversaries.length > 0) postureAdversaries++;
      if (typeof p.influenceReads === "string" && p.influenceReads.length > 0) postureInfluenceReads++;
      if (typeof p.trajectory === "string" && p.trajectory.length > 0) postureTrajectory++;
      if (typeof p.path === "string" && p.path.length > 0) posturePath++;
    }

    if (!n.name || typeof n.name !== "string" || n.name.length === 0) {
      anomalies.push({
        type: "malformed_entity",
        entityId: id,
        reason: "missing or empty name field",
      });
    }
  }

  // Pass 2: links (orphan detection)
  for (const [id, link] of Object.entries(links)) {
    const l = link as Record<string, any>;
    const src = String(l.source ?? "");
    const tgt = String(l.target ?? "");
    if (!nodeIds.has(src) || !nodeIds.has(tgt)) {
      anomalies.push({
        type: "orphan_edge",
        edgeId: id,
        reason: `link references missing node(s): source=${src} target=${tgt}`,
      });
    }
    if (l.source !== undefined && l.target !== undefined) {
      // count source presence
      if (l.source && typeof l.source === "object" && typeof (l.source as any).system === "string") {
        // edge has been migrated already — but this is the link.source field which
        // is the node reference, not provenance. Provenance lives on l.provenance
        // or l.source.system depending on schema. For Phase 8.5.1, we check
        // l.source.system existence pattern in nodes/opportunities/meetings/signals.
        // Edges in this codebase use `source` as node FK, so source provenance
        // for edges goes on a separate field. The migration adds `.source` only to
        // entities, not edges — per migration spec Step 1 scope.
      }
    }
  }

  // Pass 3: opportunities (stage validation)
  const oppByStage: Record<string, number> = {};
  for (const [id, opp] of Object.entries(opportunities)) {
    const o = opp as Record<string, any>;
    const stage = String(o.stage || "unknown");
    oppByStage[stage] = (oppByStage[stage] || 0) + 1;
    if (!VALID_STAGES.has(stage)) {
      anomalies.push({
        type: "malformed_opp",
        oppId: id,
        reason: `invalid stage value: ${stage}`,
      });
    }

    // Check posture extensions on opportunities (e.g., adversaries)
    if (o.posture && typeof o.posture === "object") {
      const p = o.posture as Record<string, any>;
      if (Array.isArray(p.adversaries) && p.adversaries.length > 0) postureAdversaries++;
    }

    if (o.source && typeof o.source === "object" && typeof o.source.system === "string") {
      entitiesWithSource++;
    } else {
      entitiesWithoutSource++;
    }
  }

  // Pass 4: meetings (provenance presence)
  for (const meeting of Object.values(meetings)) {
    const m = meeting as Record<string, any>;
    if (m.source && typeof m.source === "object" && typeof m.source.system === "string") {
      entitiesWithSource++;
    } else {
      entitiesWithoutSource++;
    }
  }

  // Pass 5: signals (by type)
  const signalByType: Record<string, number> = {};
  for (const signal of Object.values(signals)) {
    const s = signal as Record<string, any>;
    const type = String(s.type || "unknown");
    signalByType[type] = (signalByType[type] || 0) + 1;
    if (s.source && typeof s.source === "object" && typeof s.source.system === "string") {
      entitiesWithSource++;
    } else {
      entitiesWithoutSource++;
    }
  }

  const totalEntities = entitiesWithSource + entitiesWithoutSource;
  const estimatedWrites = entitiesWithoutSource; // Step 1 only writes to entities lacking source
  // Estimate ~5ms per entity write at batch size 500 = ~10ms/entity overhead average
  const estimatedDurationSec = Math.max(5, Math.ceil(estimatedWrites * 0.01));
  const anomalyRate = totalEntities === 0 ? 0 : (anomalies.length / totalEntities) * 100;

  const report: InventoryReport = {
    workspaceId,
    inventoryAt: Date.now(),
    entityCounts: {
      nodes: { total: Object.keys(nodes).length, byType: nodeByType },
      links: { total: Object.keys(links).length },
      opportunities: { total: Object.keys(opportunities).length, byStage: oppByStage },
      meetings: { total: Object.keys(meetings).length },
      signals: { total: Object.keys(signals).length, byType: signalByType },
      workspaceMembers: { total: Object.keys(members).length },
    },
    schemaState: {
      entitiesWithSource,
      entitiesWithoutSource,
      postureExtensionsPresent: {
        byPursuit: postureByPursuit,
        tells: postureTells,
        adversaries: postureAdversaries,
        influenceReads: postureInfluenceReads,
        trajectory: postureTrajectory,
        path: posturePath,
      },
    },
    anomalies,
    estimatedDurationSec,
    estimatedWritesCount: estimatedWrites,
    anomalyRatePercent: Math.round(anomalyRate * 100) / 100,
    inventoryVersion: MIGRATION_VERSION,
  };

  await db.ref(migrationPath(workspaceId, MIGRATION_VERSION, "inventory")).set(report);

  log.info("inventory_completed", {
    workspaceId,
    totalEntities,
    entitiesWithoutSource,
    anomalyCount: anomalies.length,
    anomalyRatePercent: report.anomalyRatePercent,
  });

  return report;
}
