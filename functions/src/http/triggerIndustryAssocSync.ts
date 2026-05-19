// Corsair — HTTPS callable: manual Industry Association rosters sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/industryAssoc";

export const triggerIndustryAssocSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerIndustryAssocSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);

    log.info("industry_assoc_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
    });

    try {
      const result = await syncWorkspace(workspaceId, { dryRun }, log);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("industry_assoc_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Industry Assoc sync failed: ${e.message}`);
    }
  }
);
