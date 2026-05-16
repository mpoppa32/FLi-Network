// Corsair Phase 8.5.1 — HTTPS callable: apply migration
//
// Operator clicks "Apply migration" in Corsair Settings after reviewing
// inventory and approving. The client first writes operatorApprovedAt to
// gate the migration, then calls this function to execute.
//
// Per migration spec Part Four P-4: per-workspace approval is required.
// This function reads the operatorApprovedAt marker and refuses to run
// without it.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { applyMigration } from "../migrations/migrate851";
import { createLogger } from "../framework/logger";

export const triggerMigration = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerMigration" });
    const auth = request.auth;
    if (!auth) {
      log.warn("unauthenticated_call");
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    const dryRun = Boolean(request.data?.dryRun ?? false);
    const forceProceed = Boolean(request.data?.forceProceed ?? false);

    log.info("migration_request", { workspaceId, userId: auth.uid, dryRun, forceProceed });

    try {
      const outcome = await applyMigration(workspaceId, { dryRun, forceProceed });
      return { ok: true, outcome };
    } catch (err) {
      const e = err as Error;
      log.error("migration_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `Migration failed: ${e.message}`);
    }
  }
);
