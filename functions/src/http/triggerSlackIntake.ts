// Corsair — HTTPS callable: run the Slack intake immediately (test/manual).
// Companion to slackIntakeHourly. Returns the pull report (or skipped if the
// SLACK_BOT_TOKEN secret isn't set yet).

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { runSlackIntake } from "../jobs/slackIntakeHourly";

export const triggerSlackIntake = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 120, secrets: ["SLACK_BOT_TOKEN"] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const log = createLogger({ source: "http_triggerSlackIntake" });
    try {
      const res = await runSlackIntake(log);
      return { ok: true, result: res };
    } catch (e) {
      const err = e as Error;
      log.error("threw", { message: err.message });
      throw new HttpsError("internal", err.message);
    }
  }
);
