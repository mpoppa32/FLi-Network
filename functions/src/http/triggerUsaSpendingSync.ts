// Corsair — HTTPS callable: manual USAspending sync
//
// Operator-initiated sync from the Corsair client. Useful for:
//   - Testing the integration end-to-end without waiting for cron
//   - Backfilling after watchlist changes
//   - Force-refreshing specific date windows
//
// The scheduled job runs nightly; this callable is the on-demand path.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/usaSpending";

export const triggerUsaSpendingSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerUsaSpendingSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    const sinceDays = typeof request.data?.sinceDays === "number" ? request.data.sinceDays : undefined;
    const maxRecords = typeof request.data?.maxRecords === "number" ? request.data.maxRecords : undefined;
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const forceRefresh = Boolean(request.data?.forceRefresh ?? false);

    log.info("usaspending_manual_sync_request", {
      workspaceId,
      userId: request.auth.uid,
      sinceDays,
      maxRecords,
      dryRun,
      forceRefresh,
    });

    try {
      const result = await syncWorkspace(
        workspaceId,
        { sinceDays, maxRecords, dryRun, forceRefresh },
        log
      );
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("usaspending_manual_sync_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Sync failed: ${e.message}`);
    }
  }
);
