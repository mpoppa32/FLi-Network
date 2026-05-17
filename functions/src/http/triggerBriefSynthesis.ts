// Corsair — HTTPS callable: on-demand Brief synthesis refresh
//
// Per BSQ-1 (LOCKED): operator can refresh the Brief manually via a
// "Refresh" button in the External Intelligence section.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { synthesizeBrief } from "../jobs/briefSynthesisCommon";

export const triggerBriefSynthesis = onCall(
  { region: "us-central1", memory: "1GiB", timeoutSeconds: 540 },
  async (request) => {
    const log = createLogger({ source: "http_triggerBriefSynthesis" });
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) throw new HttpsError("invalid-argument", "workspaceId is required.");
    const windowHours = typeof request.data?.windowHours === "number" ? request.data.windowHours : 24;
    log.info("brief_synthesis_request", { workspaceId, userId: request.auth.uid, windowHours });
    try {
      const output = await synthesizeBrief(workspaceId, windowHours, log);
      return { ok: true, output };
    } catch (err) {
      const e = err as Error;
      throw new HttpsError("internal", `Brief synthesis failed: ${e.message}`);
    }
  }
);
