// Corsair P2.14 — Manual Calendar sync (authenticated callable)
//
// Same shape as triggerGmailSync but routes to syncCalendar.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { syncCalendar } from "../capture/dispatcher";
import { createLogger } from "../framework/logger";

export const triggerCalendarSync = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 540 },
  async (request) => {
    const log = createLogger({ source: "triggerCalendarSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    log.info("manual_sync_request", { uid: request.auth.uid, workspaceId });
    const result = await syncCalendar(request.auth.uid, workspaceId);
    if (result.error) {
      throw new HttpsError("internal", result.error);
    }
    return { ok: true, result };
  }
);
