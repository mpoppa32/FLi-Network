// Corsair Phase 8.5.1 — HTTPS callable: rollback migration
//
// Operator clicks "Rollback migration" in Corsair Settings → triggers this
// callable function → executes rollback per request body (full or per-step).

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { rollbackMigration } from "../migrations/migrate851";
import { createLogger } from "../framework/logger";

export const triggerRollback = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerRollback" });
    const auth = request.auth;
    if (!auth) {
      log.warn("unauthenticated_call");
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    const steps: number[] | undefined = Array.isArray(request.data?.steps)
      ? request.data.steps.map((n: unknown) => Number(n))
      : undefined;
    const forceUnsafe = Boolean(request.data?.forceUnsafe ?? false);

    log.info("rollback_request", { workspaceId, userId: auth.uid, steps, forceUnsafe });

    try {
      const result = await rollbackMigration(workspaceId, { steps, forceUnsafe });
      return { ok: true, result };
    } catch (err) {
      const e = err as Error;
      log.error("rollback_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Rollback failed: ${e.message}`);
    }
  }
);
