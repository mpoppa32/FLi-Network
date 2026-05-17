// Corsair — HTTPS callable: manual GAO Reports sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/gaoReports";

export const triggerGaoReportsSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerGaoReportsSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const itemCap = typeof request.data?.itemCap === "number" ? request.data.itemCap : undefined;

    log.info("gao_reports_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      itemCap,
    });

    try {
      const result = await syncWorkspace(workspaceId, { dryRun, itemCap }, log);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("gao_reports_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `GAO Reports sync failed: ${e.message}`);
    }
  }
);
