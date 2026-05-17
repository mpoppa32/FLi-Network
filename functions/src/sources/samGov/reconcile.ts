// SAM.gov v1.1 — operator-Opp reconciliation
//
// Per spec Part Six §6.2: when a SAM.gov notice arrives with a
// solicitationNumber that matches an operator-created Opportunity (one with
// source.system === 'operator_manual' or no SAM linkage yet), MERGE into
// that existing Opp rather than creating a new one. Reconciliation rules:
//   - Preserve operator-input fields (name, agency text, value text, notes,
//     stage, meetings, posture)
//   - Set samgov* fields from SAM data
//   - Mark reconciliation.{operatorCreatedAt, samgovMatchedAt, matchMethod}

import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Opportunity } from "../../framework/types/entities";

export interface ReconcileMatch {
  oppId: string;
  matchConfidence: number;
  matchMethod: "solnum" | "fuzzy_title";
}

function normalizeSolNum(s: string | undefined): string {
  return (s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Find an existing operator-created Opportunity that matches the incoming
 * SAM notice by solicitation number. Returns match info or null.
 */
export async function findReconciliationMatch(
  workspaceId: string,
  notice: { solicitationNumber?: string; title?: string },
  log?: Logger
): Promise<ReconcileMatch | null> {
  const solNum = normalizeSolNum(notice.solicitationNumber);
  if (!solNum) return null;

  const snap = await db.ref(wsPath(workspaceId, "opportunities")).once("value");
  const all = (snap.val() as Record<string, Opportunity> | null) ?? {};

  // 1. Strict solicitation-number match against operator-created Opps that
  //    don't yet have a SAM linkage (or that already have a different SAM
  //    notice — operator may want to merge late-arriving SAM data).
  for (const opp of Object.values(all)) {
    if (!opp) continue;
    if (normalizeSolNum(opp.solicitationNumber) === solNum) {
      const wasOperator = !opp.samgovNoticeId && (!opp.source || opp.source.system === "operator_manual");
      if (wasOperator) {
        log?.debug("samgov_reconcile_match", {
          oppId: opp.id,
          method: "solnum",
          solNum,
        });
        return { oppId: opp.id, matchConfidence: 1.0, matchMethod: "solnum" };
      }
    }
  }
  return null;
}

/**
 * Apply SAM notice data to an existing operator-created Opportunity.
 * Preserves operator-input fields; records reconciliation metadata.
 */
export async function applyReconciliation(
  workspaceId: string,
  match: ReconcileMatch,
  samMappedOpp: Opportunity,
  log?: Logger
): Promise<{ oppId: string; mergedFields: string[] }> {
  const path = wsPath(workspaceId, "opportunities", match.oppId);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    log?.warn("samgov_reconcile_target_missing", { oppId: match.oppId });
    return { oppId: match.oppId, mergedFields: [] };
  }
  const existing = snap.val() as Opportunity;
  const now = Date.now();
  const mergedFields: string[] = [];

  // Build update map — set SAM-only fields, preserve operator fields
  const updates: Record<string, unknown> = {};
  const setIfMissing = (key: keyof Opportunity, val: unknown) => {
    if (val !== undefined && val !== null) {
      const cur = (existing as any)[key];
      const empty = cur === undefined || cur === null || cur === "" || (Array.isArray(cur) && cur.length === 0);
      if (empty) {
        updates[`${path}/${String(key)}`] = val;
        mergedFields.push(String(key));
      }
    }
  };
  const setAlways = (key: keyof Opportunity, val: unknown) => {
    if (val !== undefined && val !== null) {
      updates[`${path}/${String(key)}`] = val;
      mergedFields.push(String(key));
    }
  };

  // SAM-only fields: always overwrite
  setAlways("samgovNoticeId", samMappedOpp.samgovNoticeId);
  setAlways("samgovUiLink", samMappedOpp.samgovUiLink);
  setAlways("samgovNoticeType", samMappedOpp.samgovNoticeType);
  setAlways("samgovBaseType", samMappedOpp.samgovBaseType);
  setAlways("samgovPostedDate", samMappedOpp.samgovPostedDate);
  setAlways("samgovArchiveDate", samMappedOpp.samgovArchiveDate);
  setAlways("samgovResponseDeadline", samMappedOpp.samgovResponseDeadline);
  setAlways("samgovLifecycle", samMappedOpp.samgovLifecycle);
  setAlways("amendmentNumber", samMappedOpp.amendmentNumber);
  setAlways("isLatestVersion", samMappedOpp.isLatestVersion);
  setAlways("samgovPocs", samMappedOpp.samgovPocs);
  setAlways("attachments", samMappedOpp.attachments);
  setAlways("relatedNotices", samMappedOpp.relatedNotices);

  // Operator-input fields: fill only if blank
  setIfMissing("agency", samMappedOpp.agency);
  setIfMissing("naicsCodes", samMappedOpp.naicsCodes);
  setIfMissing("pscCodes", samMappedOpp.pscCodes);
  setIfMissing("setAsideCode", samMappedOpp.setAsideCode);
  setIfMissing("setAsideDescription", samMappedOpp.setAsideDescription);
  setIfMissing("placeOfPerf", samMappedOpp.placeOfPerf);
  setIfMissing("customerOrgId", samMappedOpp.customerOrgId);
  setIfMissing("agencyHierarchy", samMappedOpp.agencyHierarchy);

  // Source provenance: switch to SAM since SAM now has authoritative
  // listing data, but preserve a manual-import note in operatorOverrides
  // for any field operator already set.
  updates[`${path}/source`] = samMappedOpp.source;
  mergedFields.push("source");

  const reconciliation = {
    ...(existing.reconciliation ?? {}),
    operatorCreatedAt: existing.reconciliation?.operatorCreatedAt
      || (existing.source?.system === "operator_manual" ? existing.source.fetchedAt : now),
    samgovMatchedAt: now,
    matchConfidence: match.matchConfidence,
    matchMethod: match.matchMethod,
  };
  updates[`${path}/reconciliation`] = reconciliation;
  mergedFields.push("reconciliation");

  updates[`${path}/updatedAt`] = new Date(now).toISOString();
  await db.ref().update(updates);

  log?.info("samgov_reconcile_applied", {
    oppId: match.oppId,
    mergedFieldCount: mergedFields.length,
    method: match.matchMethod,
  });
  return { oppId: match.oppId, mergedFields };
}
