// Corsair — HTTPS callable: manual State Department sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/stateDepartment";

export const triggerStateDepartmentSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerStateDepartmentSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const feedKeyOverride =
      typeof request.data?.feedKeyOverride === "string"
        ? request.data.feedKeyOverride
        : undefined;

    log.info("state_department_manual_sync_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      feedKeyOverride,
    });

    try {
      const result = await syncWorkspace(
        workspaceId,
        { dryRun, feedKeyOverride },
        log
      );
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("state_department_manual_sync_failed", {
        workspaceId,
        message: e.message,
      });
      throw new HttpsError(
        "internal",
        `State Department sync failed: ${e.message}`
      );
    }
  }
);
