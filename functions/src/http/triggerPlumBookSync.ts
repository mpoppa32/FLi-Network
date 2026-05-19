// Corsair — HTTPS callable: manual Plum Book / FVRA sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/plumBook";

export const triggerPlumBookSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerPlumBookSync" });
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
    const minDaysVacantOverride =
      typeof request.data?.minDaysVacant === "number"
        ? request.data.minDaysVacant
        : undefined;

    log.info("plum_book_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      maxPdfsPerSync,
      minDaysVacantOverride,
    });

    try {
      const result = await syncWorkspace(
        workspaceId,
        { dryRun, maxPdfsPerSync, minDaysVacantOverride },
        log
      );
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("plum_book_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Plum Book sync failed: ${e.message}`);
    }
  }
);
