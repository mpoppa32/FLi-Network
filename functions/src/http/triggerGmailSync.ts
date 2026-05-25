// Corsair P2.14 — Manual Gmail sync (authenticated callable)
//
// Operator clicks "Sync now" in the user settings modal. Frontend invokes
// this via firebase functions httpsCallable; we run a single sync for
// (request.auth.uid, request.data.workspaceId) and return the result.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { syncGmail } from "../capture/dispatcher";
import { createLogger } from "../framework/logger";

export const triggerGmailSync = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 540, secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] },
  async (request) => {
    const log = createLogger({ source: "triggerGmailSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    log.info("manual_sync_request", { uid: request.auth.uid, workspaceId });
    const result = await syncGmail(request.auth.uid, workspaceId);
    if (result.error) {
      throw new HttpsError("internal", result.error);
    }
    return { ok: true, result };
  }
);
