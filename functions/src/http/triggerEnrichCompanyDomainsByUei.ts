// Corsair — HTTPS callable: company domain enrichment from SAM.gov
// entity-information API by UEI lookup.
//
// Workspace-scoped, operator-callable. Mirrors triggerEnrichEntityDomains
// shape: requires Firebase Auth + workspace membership; passes options
// through; returns the EnrichCompanyDomainsByUeiResult.
//
// Idempotent — never overwrites an existing node.domain. Re-runs continue
// from where the previous run stopped (skips nodes whose domainFetchAttemptAt
// is within `refreshMs` of now, default 90 days).
//
// Caller flow (browser or admin):
//   const fn = httpsCallable(fbFunctions, "triggerEnrichCompanyDomainsByUei");
//   const r = await fn({ workspaceId: "1777435779676", dryRun: false,
//                        maxRecords: 200, deadlineMs: 450000 });

import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createLogger } from "../framework/logger";
import { enrichCompanyDomainsByUeiForWorkspace } from "../jobs/enrichCompanyDomainsByUeiCore";
import { SAMGOV_API_KEY } from "../jobs/samGovHourly";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const triggerEnrichCompanyDomainsByUei = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: [SAMGOV_API_KEY],
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerEnrichCompanyDomainsByUei" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const data = (request.data as Record<string, unknown>) ?? {};
    const workspaceId = String(data.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    try {
      const db = admin.database();
      const snap = await db
        .ref(`users/${request.auth.uid}/workspaces/${workspaceId}`)
        .once("value");
      if (!snap.exists()) {
        throw new HttpsError("permission-denied", "You are not a member of this workspace.");
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", `Membership check failed: ${(err as Error).message}`);
    }

    const dryRun = data.dryRun === true;
    const maxRecords = typeof data.maxRecords === "number" ? data.maxRecords : undefined;
    const deadlineMs = typeof data.deadlineMs === "number" ? data.deadlineMs : undefined;
    const refreshMs = typeof data.refreshMs === "number" ? data.refreshMs : undefined;

    log.info("company_uei_enrichment_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      maxRecords: maxRecords ?? null,
      deadlineMs: deadlineMs ?? null,
    });

    const result = await enrichCompanyDomainsByUeiForWorkspace(
      workspaceId,
      { dryRun, maxRecords, deadlineMs, refreshMs },
      log
    );
    return { ok: true, ...result };
  }
);
