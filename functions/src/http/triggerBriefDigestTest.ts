// Corsair — HTTPS callable: send one Brief digest immediately (test/manual)
//
// Companion to dailyBriefDigest. Lets an authenticated user fire a digest
// send to their own email (or override `to`) without waiting for 11 UTC cron.
//
// Does NOT update lastSent — that's the scheduled job's job. This is purely
// for testing the SendGrid setup + Brief composition.
//
// Usage from client (after firebase auth + functions SDK loaded):
//   const fn = httpsCallable(functions, 'triggerBriefDigestTest');
//   await fn({ workspaceId: 'abc123', to: 'me@example.com' });

import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createLogger } from "../framework/logger";
import {
  SENDGRID_API_KEY,
  BRIEF_FROM_EMAIL,
  composeBrief,
  sendOne,
  BriefSubscription,
} from "../jobs/dailyBriefDigest";

export const triggerBriefDigestTest = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    secrets: [SENDGRID_API_KEY, BRIEF_FROM_EMAIL],
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerBriefDigestTest" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    const apiKey = SENDGRID_API_KEY.value();
    const fromEmail = BRIEF_FROM_EMAIL.value();
    if (!apiKey || !fromEmail) {
      throw new HttpsError(
        "failed-precondition",
        "SENDGRID_API_KEY and BRIEF_FROM_EMAIL secrets must be set. Run: firebase functions:secrets:set SENDGRID_API_KEY"
      );
    }

    const db = admin.database();

    // Workspace info
    const wsInfoSnap = await db.ref(`workspaces/${workspaceId}/info`).once("value");
    if (!wsInfoSnap.exists()) {
      throw new HttpsError("not-found", `Workspace ${workspaceId} not found.`);
    }
    const wsName: string = (wsInfoSnap.val()?.name as string) || workspaceId;

    // Recipient: prefer override, fall back to caller's stored email
    const overrideTo = String(request.data?.to ?? "").trim();
    let toEmail = overrideTo;
    if (!toEmail) {
      const subSnap = await db
        .ref(`workspaces/${workspaceId}/brief_subscriptions/${request.auth.uid}`)
        .once("value");
      if (subSnap.exists()) {
        toEmail = String((subSnap.val() as any)?.email ?? "");
      }
    }
    if (!toEmail) {
      // Last resort: use the auth token's email
      toEmail = String(request.auth.token?.email ?? "");
    }
    if (!toEmail) {
      throw new HttpsError(
        "invalid-argument",
        "No recipient — pass `to`, subscribe via Email Digest, or authenticate with email-bearing token."
      );
    }

    const sub: BriefSubscription = {
      email: toEmail,
      name: String(request.auth.token?.name ?? "Tester"),
      frequency: "daily",
      uid: request.auth.uid,
      incActions: true,
      incRisks: true,
      incPipeline: true,
      incContacts: true,
    };

    log.info("test_send_request", { workspaceId, uid: request.auth.uid, to: toEmail });

    try {
      const composed = await composeBrief(workspaceId, wsName, sub, db);
      const ok = await sendOne(sub, composed, fromEmail, apiKey, log);
      if (!ok) {
        throw new HttpsError("internal", "SendGrid send failed — check function logs.");
      }
      return {
        ok: true,
        sentTo: toEmail,
        subject: composed.subject,
        preview: composed.text.slice(0, 280),
      };
    } catch (err) {
      const e = err as Error;
      log.error("test_send_threw", { message: e.message || String(err) });
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", `Test send failed: ${e.message ?? String(err)}`);
    }
  }
);
