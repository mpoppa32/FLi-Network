// Corsair — HTTPS callable: manual DSCA FMS sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/dscaFms";

export const triggerDscaFmsSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerDscaFmsSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const confidenceFloor = typeof request.data?.confidenceFloor === "number"
      ? request.data.confidenceFloor
      : undefined;

    log.info("dsca_fms_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      confidenceFloor,
    });

    try {
      const result = await syncWorkspace(workspaceId, { dryRun, confidenceFloor }, log);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("dsca_fms_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `DSCA FMS sync failed: ${e.message}`);
    }
  }
);
