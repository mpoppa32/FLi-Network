// Corsair — HTTPS callable: manual NASA OIG sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace } from "../sources/nasaOig";

export const triggerNasaOigSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerNasaOigSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const itemCap =
      typeof request.data?.itemCap === "number" ? request.data.itemCap : undefined;

    log.info("nasa_oig_manual_request", {
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
      log.error("nasa_oig_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `NASA OIG sync failed: ${e.message}`);
    }
  }
);
