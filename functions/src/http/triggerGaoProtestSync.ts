// Corsair — HTTPS callable: manual GAO Bid Protest sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/gaoProtest";

export const triggerGaoProtestSync = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 540 },
  async (request) => {
    const log = createLogger({ source: "http_triggerGaoProtestSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const maxItems = typeof request.data?.maxItems === "number" ? request.data.maxItems : undefined;
    const dryRun = Boolean(request.data?.dryRun ?? false);
    log.info("gao_protest_manual_sync_request", { workspaceId, userId: request.auth.uid });
    try {
      const result = await syncWorkspace(workspaceId, { maxItems, dryRun }, log);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      throw new HttpsError("internal", `Sync failed: ${e.message}`);
    }
  }
);
