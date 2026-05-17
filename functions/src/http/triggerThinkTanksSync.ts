// Corsair — HTTPS callable: manual think tank aggregator sync

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace, THINK_TANK_REGISTRY } from "../sources/thinkTanks";

export const triggerThinkTanksSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerThinkTanksSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const dryRun = Boolean(request.data?.dryRun ?? false);
    const perTankCap = typeof request.data?.perTankCap === "number"
      ? request.data.perTankCap
      : undefined;

    log.info("think_tank_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      dryRun,
      perTankCap,
    });

    try {
      const result = await syncWorkspace(workspaceId, { dryRun, perTankCap }, log);
      return { ok: true, result, registry: THINK_TANK_REGISTRY };
    } catch (err) {
      const e = err as Error;
      log.error("think_tank_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Think tank sync failed: ${e.message}`);
    }
  }
);
