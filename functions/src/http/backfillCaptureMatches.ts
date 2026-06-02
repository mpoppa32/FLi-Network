// Corsair P13.137 — Phase 1A backfill callable.
//
// The matcher (capture/matcher.ts) joins new pendingCapture entries as
// they land. Existing entries (e.g. the 68 Atlas entries captured before
// P13.137 deployed) stay null. This callable re-runs the matcher across
// every existing entry in a single workspace so the operator's current
// view becomes joined without waiting for those entries to age out.
//
// Idempotent: safe to call multiple times. Re-running on already-matched
// entries produces the same result.
//
// Caller flow (browser):
//   const fn = httpsCallable(fbFunctions, "backfillCaptureMatches");
//   const r = await fn({ workspaceId: currentWsId });
//   // r.data: { processed, matched, perSource: {...} }

import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createLogger } from "../framework/logger";
import { loadMatchContext, matchEntry } from "../capture/matcher";
import { PendingCaptureEntry } from "../capture/normalizer";
import { wsPath } from "../framework/rtdb";

if (!admin.apps.length) {
  admin.initializeApp();
}

interface BackfillRequest {
  workspaceId?: string;
}

interface BackfillResponse {
  processed: number;
  matched: number;
  bySource: {
    "sender-email": number;
    "attendee-email": number;
    "sender-domain": number;
    "attendee-domain": number;
  };
  byDirection: {
    inbound: number;
    outbound: number;
    unknown: number;
  };
}

export const backfillCaptureMatches = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request): Promise<BackfillResponse> => {
    const log = createLogger({ source: "http_backfillCaptureMatches" });
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const data = (request.data as BackfillRequest) ?? {};
    const workspaceId = String(data.workspaceId || "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    // Membership check (same shape as anthropicProxy at functions/src/http/anthropicProxy.ts:86)
    try {
      const db = admin.database();
      const snap = await db
        .ref(`users/${auth.uid}/workspaces/${workspaceId}`)
        .once("value");
      if (!snap.exists()) {
        throw new HttpsError(
          "permission-denied",
          "You are not a member of this workspace."
        );
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const e = err as Error;
      throw new HttpsError("internal", `Membership check failed: ${e.message}`);
    }

    log.info("backfill_start", { workspaceId, userId: auth.uid });

    const db = admin.database();
    // P13.149 — pass the caller's uid so the matcher resolves the
    // connected Google account's email and adds it to operatorEmails.
    const ctx = await loadMatchContext(workspaceId, auth.uid);

    const snap = await db.ref(wsPath(workspaceId, "pendingCapture")).get();
    const entries = (snap.val() ?? {}) as Record<string, PendingCaptureEntry>;

    const response: BackfillResponse = {
      processed: 0,
      matched: 0,
      bySource: { "sender-email": 0, "attendee-email": 0, "sender-domain": 0, "attendee-domain": 0 },
      byDirection: { inbound: 0, outbound: 0, unknown: 0 },
    };

    const updates: Record<string, unknown> = {};
    for (const [id, entry] of Object.entries(entries)) {
      if (!entry) continue;
      response.processed++;
      const attendeeEmails = (entry.meta?.attendees || [])
        .map((a) => (a?.email || "").toLowerCase().trim())
        .filter(Boolean);
      const m = matchEntry(
        {
          senderEmail: entry.fromEmail || "",
          attendeeEmails,
          threadId: entry.threadId || null,
          messageId: entry.messageId || null,
          inReplyTo: entry.inReplyTo || null,
        },
        ctx
      );
      // Granular update keys so we don't overwrite intel.* / meta.* on the
      // existing entry — only touch the match fields.
      const base = wsPath(workspaceId, "pendingCapture", id);
      updates[`${base}/matchedNodeId`] = m.matchedNodeId;
      updates[`${base}/matchSource`] = m.matchSource;
      updates[`${base}/oppId`] = m.oppId;
      updates[`${base}/oppName`] = m.oppName;
      updates[`${base}/direction`] = m.direction;
      if (m.matchedNodeId) {
        response.matched++;
        if (m.matchSource) response.bySource[m.matchSource]++;
      }
      response.byDirection[m.direction]++;
    }

    if (Object.keys(updates).length > 0) {
      // Atomic multi-path update — one write, all entries patched.
      await db.ref().update(updates);
    }

    log.info("backfill_complete", {
      workspaceId,
      processed: response.processed,
      matched: response.matched,
      bySource: response.bySource,
      byDirection: response.byDirection,
    });

    return response;
  }
);
