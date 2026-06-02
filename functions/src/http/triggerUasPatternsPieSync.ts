// Corsair — HTTPS callable: manual uas-patterns PIE sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/uasPatternsPie";

export const triggerUasPatternsPieSync = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerUasPatternsPieSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);

    log.info("uas_patterns_pie_manual_sync_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
    });

    try {
      const result = await syncWorkspace(workspaceId, { dryRun }, log);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("uas_patterns_pie_manual_sync_failed", {
        workspaceId,
        message: e.message,
      });
      throw new HttpsError(
        "internal",
        `uas-patterns PIE sync failed: ${e.message}`
      );
    }
  }
);
