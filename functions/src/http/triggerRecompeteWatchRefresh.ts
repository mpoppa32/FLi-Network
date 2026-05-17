// Corsair — HTTPS callable: manual Recompete Watch derived view rebuild (v1.1)
//
// The Recompete Watch view is rebuilt automatically at the end of every
// USAspending sync. This callable lets the operator force a rebuild without
// waiting for a full sync — useful after dismissing an entry or after
// importing operator-curated Awards.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { buildRecompeteWatchView } from "../sources/usaSpending";

export const triggerRecompeteWatchRefresh = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerRecompeteWatchRefresh" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const horizonDays = typeof request.data?.horizonDays === "number"
      ? request.data.horizonDays
      : undefined;

    log.info("recompete_watch_manual_refresh", {
      workspaceId,
      userId: request.auth.uid,
      horizonDays,
    });

    try {
      const view = await buildRecompeteWatchView(workspaceId, { horizonDays }, log);
      return { ok: true, totals: view.totals, generatedAt: view.generatedAt };
    } catch (err) {
      const e = err as Error;
      log.error("recompete_watch_manual_refresh_failed", {
        workspaceId,
        message: e.message,
      });
      throw new HttpsError("internal", `Recompete refresh failed: ${e.message}`);
    }
  }
);
