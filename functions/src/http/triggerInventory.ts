// Corsair Phase 8.5.1 — HTTPS callable: inventory
//
// Operator clicks "Inventory workspace" in Corsair Settings → triggers this
// callable function → returns inventory report.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { previewMigration } from "../migrations/migrate851";
import { createLogger } from "../framework/logger";

export const triggerInventory = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 540 },
  async (request) => {
    const log = createLogger({ source: "http_triggerInventory" });
    const auth = request.auth;
    if (!auth) {
      log.warn("unauthenticated_call");
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    log.info("inventory_request", { workspaceId, userId: auth.uid });

    try {
      const report = await previewMigration(workspaceId);
      return { ok: true, report };
    } catch (err) {
      const e = err as Error;
      log.error("inventory_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Inventory failed: ${e.message}`);
    }
  }
);
