// Corsair — HTTPS callable: manual service-branch news sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace, SERVICE_NEWS_REGISTRY } from "../sources/serviceNews";

export const triggerServiceNewsSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerServiceNewsSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const perServiceCap = typeof request.data?.perServiceCap === "number"
      ? request.data.perServiceCap
      : undefined;

    log.info("service_news_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      perServiceCap,
    });

    try {
      const result = await syncWorkspace(workspaceId, { dryRun, perServiceCap }, log);
      return { ok: true, result, registry: SERVICE_NEWS_REGISTRY };
    } catch (err) {
      const e = err as Error;
      log.error("service_news_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Service news sync failed: ${e.message}`);
    }
  }
);
