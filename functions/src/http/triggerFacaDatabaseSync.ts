// Corsair — HTTPS callable: manual FACA sync (Phase 8.6.1)
//
// Operator-initiated FACA committee + member + meeting refresh. Also exposes
// a probe mode that just tests endpoint reachability without writing.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncWorkspace, probeFacaApi } from "../sources/facaDatabase";
import { loadConfig } from "../sources/facaDatabase/config";

export const triggerFacaDatabaseSync = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerFacaDatabaseSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    const mode = String(request.data?.mode ?? "sync");
    const maxCommittees = typeof request.data?.maxCommittees === "number"
      ? request.data.maxCommittees
      : undefined;
    const skipMembers = Boolean(request.data?.skipMembers ?? false);
    const skipMeetings = Boolean(request.data?.skipMeetings ?? false);
    const dryRun = Boolean(request.data?.dryRun ?? false);

    log.info("faca_manual_request", {
      workspaceId,
      userId: request.auth.uid,
      mode,
      maxCommittees,
      skipMembers,
      skipMeetings,
      dryRun,
    });

    try {
      if (mode === "probe") {
        // Just verify API reachability — useful for first-time setup
        const cfg = await loadConfig(workspaceId, log);
        const probe = await probeFacaApi(cfg.apiBase, log);
        return { ok: true, mode: "probe", probe };
      }

      const result = await syncWorkspace(
        workspaceId,
        { maxCommittees, skipMembers, skipMeetings, dryRun },
        log
      );
      return { ok: true, mode: "sync", result };
    } catch (err) {
      const e = err as Error;
      log.error("faca_manual_failed", { workspaceId, message: e.message });
      throw new HttpsError("internal", `FACA sync failed: ${e.message}`);
    }
  }
);
