// Corsair — HTTPS callable: backfill duplicate org/person node merges.
//
// Operator-facing wrapper around backfillOrgMergeForWorkspace. Cleans up
// duplicate node clusters from the pre-v1.3 orgResolver / pre-v1.2
// personResolver race. Idempotent — re-runs over an already-merged
// workspace are no-ops.
//
// Caller flow (browser or admin):
//   const fn = httpsCallable(fbFunctions, "backfillOrgMerge");
//   const r = await fn({
//     workspaceId: "1777435779676",
//     excludeIfNormContains: ["aerovironment"],  // optional
//     dryRun: false,                              // default false
//   });

import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createLogger } from "../framework/logger";
import { backfillOrgMergeForWorkspace } from "../jobs/backfillOrgMergeCore";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const backfillOrgMerge = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_backfillOrgMerge" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const data = (request.data as Record<string, unknown>) ?? {};
    const workspaceId = String(data.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    // Workspace membership check — same shape as backfillCaptureMatches.
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

    const excludeIfNormContains = Array.isArray(data.excludeIfNormContains)
      ? (data.excludeIfNormContains as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined;
    const dryRun = data.dryRun === true;

    log.info("org_merge_backfill_request", {
      workspaceId,
      userId: request.auth.uid,
      excludeIfNormContains: excludeIfNormContains || [],
      dryRun,
    });

    const result = await backfillOrgMergeForWorkspace(
      workspaceId,
      { excludeIfNormContains, dryRun },
      log
    );
    return { ok: true, ...result };
  }
);
