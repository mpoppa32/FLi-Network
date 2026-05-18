// Corsair — HTTPS callable: manual DoD Comptroller budget materials sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/dodComptroller";

export const triggerDodComptrollerSync = onCall(
  {
    region: "us-central1",
    memory: "2GiB", // budget PDFs run large
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerDodComptrollerSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const maxPdfsPerSync =
      typeof request.data?.maxPdfsPerSync === "number"
        ? request.data.maxPdfsPerSync
        : undefined;
    const fiscalYearsOverride = Array.isArray(request.data?.fiscalYears)
      ? (request.data.fiscalYears as string[])
      : undefined;

    log.info("dod_comptroller_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      maxPdfsPerSync,
      fiscalYearsOverride,
    });

    try {
      const result = await syncWorkspace(
        workspaceId,
        { dryRun, maxPdfsPerSync, fiscalYearsOverride },
        log
      );
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("dod_comptroller_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `DoD Comptroller sync failed: ${e.message}`);
    }
  }
);
