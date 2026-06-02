// Corsair — HTTPS callable: manual Congress.gov sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/congressGov";
import { CONGRESSGOV_API_KEY } from "../jobs/congressGovDaily";

export const triggerCongressGovSync = onCall(
  { region: "us-central1", memory: "1GiB", timeoutSeconds: 540, secrets: [CONGRESSGOV_API_KEY] },
  async (request) => {
    const log = createLogger({ source: "http_triggerCongressGovSync" });
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) throw new HttpsError("invalid-argument", "workspaceId is required.");
    const sinceDays = typeof request.data?.sinceDays === "number" ? request.data.sinceDays : undefined;
    const dryRun = Boolean(request.data?.dryRun ?? false);
    log.info("congressgov_manual_sync_request", { workspaceId, userId: request.auth.uid });
    try {
      const result = await syncWorkspace(workspaceId, { sinceDays, dryRun }, log);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      throw new HttpsError("internal", `Sync failed: ${e.message}`);
    }
  }
);
