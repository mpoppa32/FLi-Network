// Industry Association — member → Edge mapper (v1.0)
//
// Edge-only source: each detected member company → company Org +
// member_of Edge to the association's trade_assoc Org. No Signals
// emitted. The Brief surface picks up these Orgs through existing
// pursuit / customer / adversary connections (e.g., an adversary Org
// that joins NDIA gets that fact reflected in the entity graph
// without flooding the Brief).

import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { MemberCandidate } from "./client";

interface AssocEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  dir: "to" | "from" | "both";
  attrs?: Record<string, unknown>;
}

function memberEdgeId(memberOrgId: string, assocOrgId: string): string {
  return (
    "edge_industry_assoc_" +
    memberOrgId.slice(0, 24) +
    "__" +
    assocOrgId.slice(0, 24)
  );
}

export interface AssocOrgs {
  assocOrgId: string;
  assocCreated: boolean;
}

/**
 * Resolve the association itself as a trade_assoc Org. Mirrors the
 * advisory_boards v1.2 pattern: passes the acronym + full name as
 * alternateNames so cross-source dedupe collapses with any prior FACA
 * or other-source Org that may have created a node for the same body.
 */
export async function resolveAssociationOrg(
  workspaceId: string,
  assocName: string,
  assocAcronym: string,
  log?: Logger
): Promise<AssocOrgs> {
  try {
    const r = await resolveRecipientOrg(workspaceId, assocName, null, {
      autoCreate: true,
      type: "trade_assoc",
      alternateNames: [assocAcronym, assocAcronym.toUpperCase()],
    });
    return { assocOrgId: r.orgId, assocCreated: r.created };
  } catch (e) {
    log?.warn("industry_assoc_assoc_org_resolve_failed", {
      assocName,
      message: (e as Error).message,
    });
    throw e;
  }
}

export interface MemberUpsertResult {
  memberOrgId: string;
  memberCreated: boolean;
  edgeUpserted: boolean;
}

/**
 * Resolve a member company as a company Org and upsert member_of Edge to
 * the association Org. Idempotent: re-running the same roster sync
 * updates lastSeenAt + lastSeenOnSync on the existing Edge without
 * touching member Org attrs.
 */
export async function upsertMember(
  workspaceId: string,
  member: MemberCandidate,
  assocOrgId: string,
  syncId: string,
  log?: Logger
): Promise<MemberUpsertResult> {
  // Resolve member company as a company Org
  let memberOrgId: string;
  let memberCreated = false;
  try {
    const r = await resolveRecipientOrg(workspaceId, member.name, null, {
      autoCreate: true,
      type: "company",
    });
    memberOrgId = r.orgId;
    memberCreated = r.created;
  } catch (e) {
    log?.debug("industry_assoc_member_resolve_failed", {
      name: member.name,
      message: (e as Error).message,
    });
    throw e;
  }

  // Upsert member_of Edge
  const eId = memberEdgeId(memberOrgId, assocOrgId);
  const edgePath = wsPath(workspaceId, "edges", eId);
  const now = Date.now();
  const edgeAttrs: Record<string, unknown> = {
    assocKey: member.assoc,
    assocAcronym: member.assocAcronym,
    sourceSystem: "industry_assoc",
    lastSeenOnSync: syncId,
    lastSeenAt: now,
  };
  const provenance = externalProvenance(
    "industry_assoc",
    `${member.assoc}:${member.name}`,
    null,
    null,
    now
  );
  void provenance; // Edge provenance is tracked via attrs.sourceSystem
  const edge: AssocEdge = {
    id: eId,
    source: memberOrgId,
    target: assocOrgId,
    label: "member_of",
    dir: "to",
    attrs: edgeAttrs,
  };
  const edgeSnap = await db.ref(edgePath).once("value");
  let edgeUpserted = false;
  if (!edgeSnap.exists()) {
    await db.ref(edgePath).set(edge);
    edgeUpserted = true;
  } else {
    const existing = edgeSnap.val() as AssocEdge;
    const mergedAttrs = { ...(existing.attrs || {}), ...edgeAttrs };
    await db.ref(edgePath).set({ ...existing, attrs: mergedAttrs });
    edgeUpserted = true;
  }

  return { memberOrgId, memberCreated, edgeUpserted };
}
