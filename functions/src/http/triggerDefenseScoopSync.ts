// Corsair — HTTPS callable: manual defense BD news sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/defenseScoop";

export const triggerDefenseScoopSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerDefenseScoopSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const publicationKeyOverride =
      typeof request.data?.publicationKeyOverride === "string"
        ? request.data.publicationKeyOverride
        : undefined;

    log.info("defense_scoop_manual_sync_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      publicationKeyOverride,
    });

    try {
      const result = await syncWorkspace(
        workspaceId,
        { dryRun, publicationKeyOverride },
        log
      );
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("defense_scoop_manual_sync_failed", {
        workspaceId,
        message: e.message,
      });
      throw new HttpsError(
        "internal",
        `Defense Scoop sync failed: ${e.message}`
      );
    }
  }
);
