// Corsair — HTTPS callable: manual USAspending subaward sync (v1.1)
//
// Operator-initiated FFATA subaward refresh for a workspace. Useful when the
// operator changes the watchlist or wants fresh sub-recipient data for a
// specific competitor's awards.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspaceSubawards } from "../sources/usaSpending";

export const triggerUsaSpendingSubawards = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerUsaSpendingSubawards" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    const maxAwards = typeof request.data?.maxAwards === "number" ? request.data.maxAwards : undefined;
    const onlyLifecycleStates = Array.isArray(request.data?.onlyLifecycleStates)
      ? (request.data.onlyLifecycleStates as string[])
      : undefined;

    log.info("usaspending_subaward_manual_sync_request", {
      workspaceId,
      userId: request.auth.uid,
      maxAwards,
      onlyLifecycleStates,
    });

    try {
      const result = await syncWorkspaceSubawards(
        workspaceId,
        { maxAwards, onlyLifecycleStates },
        log
      );
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("usaspending_subaward_manual_sync_failed", {
        workspaceId,
        message: e.message,
      });
      throw new HttpsError("internal", `Subaward sync failed: ${e.message}`);
    }
  }
);
