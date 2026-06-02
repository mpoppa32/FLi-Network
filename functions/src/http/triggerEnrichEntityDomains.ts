// Corsair — HTTPS callable: enrich Organization node domains from
// SAM.gov POC email aggregation.
//
// Workspace-scoped, operator-callable. Mirrors triggerOrgMergeBackfill
// shape: requires Firebase Auth + workspace membership; returns the
// EnrichEntityDomainsResult straight back to the caller.
//
// Idempotent — re-runs add only newly-derivable orgs; never overwrites
// an existing explicit `node.domain`.
//
// Caller flow (browser or admin):
//   const fn = httpsCallable(fbFunctions, "triggerEnrichEntityDomains");
//   const r = await fn({ workspaceId: "1777435779676", dryRun: false });

import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createLogger } from "../framework/logger";
import { enrichEntityDomainsForWorkspace } from "../jobs/enrichEntityDomainsCore";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const triggerEnrichEntityDomains = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerEnrichEntityDomains" });
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

    log.info("entity_domain_enrichment_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
    });

    const result = await enrichEntityDomainsForWorkspace(
      workspaceId,
      { dryRun },
      log
    );
    return { ok: true, ...result };
  }
);
