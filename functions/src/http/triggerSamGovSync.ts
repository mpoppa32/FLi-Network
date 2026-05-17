// Corsair — HTTPS callable: manual SAM.gov sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/samGov";

export const triggerSamGovSync = onCall(
  { region: "us-central1", memory: "1GiB", timeoutSeconds: 540 },
  async (request) => {
    const log = createLogger({ source: "http_triggerSamGovSync" });
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) throw new HttpsError("invalid-argument", "workspaceId is required.");
    const sinceDays = typeof request.data?.sinceDays === "number" ? request.data.sinceDays : undefined;
    const maxRecords = typeof request.data?.maxRecords === "number" ? request.data.maxRecords : undefined;
    const dryRun = Boolean(request.data?.dryRun ?? false);
    log.info("samgov_manual_sync_request", { workspaceId, userId: request.auth.uid });
    try {
      const result = await syncWorkspace(workspaceId, { sinceDays, maxRecords, dryRun }, log);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      throw new HttpsError("internal", `Sync failed: ${e.message}`);
    }
  }
);
