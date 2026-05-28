// Corsair P13.154 — HTTPS callable: list invites scoped to caller's email.
//
// Replaces the prior client-side full-tree read of `/invites` (FLiIntel.html
// checkInvites) that required `.read: "auth != null"` on the entire invites
// tree and let any signed-in user enumerate every pending invite email,
// invitedBy address, and workspace name across all workspaces.
//
// Server reads `/invites` via admin SDK (bypasses rules); filters entries
// keyed by the caller's verified auth.token.email; returns only matches.
// Rule on `/invites` no longer grants `.read` to any client — only
// `/invites/$wsId/$email/.write` for workspace members issuing invites.
//
// Usage from client (after firebase auth + functions SDK loaded):
//   const fn = httpsCallable(functions, 'listMyInvites');
//   const result = await fn();
//   // result.data.invites: Array<{ wsId, email, invitedBy, workspaceName, ... }>

import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createLogger } from "../framework/logger";

if (!admin.apps.length) {
  admin.initializeApp();
}

interface InviteRecord {
  email?: string;
  invitedBy?: string;
  invitedByEmail?: string;
  workspaceName?: string;
  status?: string;
  ts?: number;
}

interface ListMyInvitesResponse {
  invites: Array<InviteRecord & { wsId: string }>;
}

export const listMyInvites = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (request): Promise<ListMyInvitesResponse> => {
    const log = createLogger({ source: "http_listMyInvites" });
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    // Use the verified email from the auth token, NOT a client-provided
    // value. Prevents impersonation — a caller can't read invites for
    // any email other than the one they're signed in as.
    const email = String(auth.token?.email ?? "").toLowerCase().trim();
    if (!email) {
      // No email on token (uncommon for Google sign-in; possible with
      // anonymous or phone auth). No invites can be matched to a missing
      // identity — return empty.
      log.info("invites_no_email", { userId: auth.uid });
      return { invites: [] };
    }
    // Invite path encoding: `.` → `_` since RTDB keys can't contain dots.
    const emailKey = email.replace(/\./g, "_");

    const db = admin.database();
    const snap = await db.ref("invites").get();
    const all = (snap.val() ?? {}) as Record<string, Record<string, InviteRecord>>;
    const out: Array<InviteRecord & { wsId: string }> = [];
    for (const wsId of Object.keys(all)) {
      const inv = all[wsId]?.[emailKey];
      if (inv) out.push({ ...inv, wsId });
    }
    log.info("invites_listed", { userId: auth.uid, count: out.length });
    return { invites: out };
  }
);
