// Corsair P2.14 — sync dispatcher
//
// Orchestrates a single sync run for one (user, workspace) pair:
//   1. Load stored OAuth tokens from users/{uid}/captureAuth/google
//   2. Refresh accessToken if expired
//   3. Fetch new Gmail messages or Calendar events
//   4. Normalize to pendingCapture shape
//   5. Write each entry to workspaces/{wsId}/pendingCapture/{entry.id}
//   6. Update workspaces/{wsId}/captureState/{gmail|calendar}

import { db, wsPath } from "../framework/rtdb";
import { refreshAccessToken } from "./oauth";
import { fetchGmailMessages } from "./gmailClient";
import { fetchCalendarEvents } from "./calendarClient";
import { gmailToPendingCapture, calendarEventToPendingCapture, PendingCaptureEntry } from "./normalizer";
import { loadMatchContext, matchEntry, MatchContext } from "./matcher";
import { createLogger } from "../framework/logger";

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  scope: string;
  tokenType: "Bearer";
  expiresAt: string;
  grantedAt: string;
}

interface GmailState {
  enabled?: boolean;
  lastSyncAt?: string;
  lastMessageDate?: string;
  filter?: string;
}

interface CalendarState {
  enabled?: boolean;
  lastSyncAt?: string;
  lastEventEnd?: string;
}

export interface SyncResult {
  source: "gmail" | "calendar";
  uid: string;
  workspaceId: string;
  fetched: number;
  written: number;
  skipped?: string;
  error?: string;
}

async function loadAuth(uid: string): Promise<StoredAuth | null> {
  const snap = await db.ref(`users/${uid}/captureAuth/google`).get();
  return snap.exists() ? (snap.val() as StoredAuth) : null;
}

/**
 * P13.137 — apply matcher results to a pendingCapture entry in place.
 * Pulls the sender + attendee facts off the entry, runs matchEntry against
 * the pre-loaded workspace context, then writes matchedNodeId / oppId /
 * oppName / matchSource / direction back onto the entry. Pure side-effect;
 * called once per entry inside the dispatcher loops above.
 */
function _applyMatch(entry: PendingCaptureEntry, ctx: MatchContext): void {
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
  entry.matchedNodeId = m.matchedNodeId;
  entry.matchSource = m.matchSource;
  entry.oppId = m.oppId;
  entry.oppName = m.oppName;
  entry.direction = m.direction;
}

async function ensureFreshAccessToken(
  uid: string,
  auth: StoredAuth
): Promise<string> {
  if (auth.expiresAt && Date.parse(auth.expiresAt) > Date.now() + 60_000) {
    // still good for at least another minute
    return auth.accessToken;
  }
  const creds = await refreshAccessToken(auth.refreshToken);
  const newAccess = creds.access_token;
  if (!newAccess) throw new Error("OAuth refresh returned no access_token");
  // expiry_date is millis epoch
  const expiresAt = creds.expiry_date
    ? new Date(creds.expiry_date).toISOString()
    : new Date(Date.now() + 50 * 60 * 1000).toISOString();
  await db.ref(`users/${uid}/captureAuth/google`).update({
    accessToken: newAccess,
    expiresAt,
  });
  return newAccess;
}

export async function syncGmail(uid: string, workspaceId: string): Promise<SyncResult> {
  const log = createLogger({ source: "captureGmail", workspace: workspaceId });
  log.info("sync_start", { uid });
  const result: SyncResult = {
    source: "gmail",
    uid,
    workspaceId,
    fetched: 0,
    written: 0,
  };
  try {
    const auth = await loadAuth(uid);
    if (!auth?.refreshToken) {
      result.skipped = "no-auth";
      log.info("sync_skipped", { reason: "no-auth" });
      return result;
    }
    const stateSnap = await db.ref(wsPath(workspaceId, "captureState/gmail")).get();
    const state: GmailState = (stateSnap.val() as GmailState) ?? {};
    // Default-on: if captureState was never explicitly disabled, sync. Operator can opt out via UI later.
    if (state.enabled === false) {
      result.skipped = "disabled";
      log.info("sync_skipped", { reason: "disabled" });
      return result;
    }
    const accessToken = await ensureFreshAccessToken(uid, auth);
    const filter = state.filter || "newer_than:7d";
    const messages = await fetchGmailMessages(accessToken, {
      query: filter,
      sinceIso: state.lastMessageDate ?? null,
    });
    result.fetched = messages.length;
    let latestTs = state.lastMessageDate ? Date.parse(state.lastMessageDate) : 0;
    // P13.137 — load workspace match context ONCE per sync run so the
    // matcher is O(messages) instead of O(messages × nodes). Phase 0
    // audit found 0% match rate; this closes the gap.
    // P13.149 — pass uid so the matcher can also include the connected
    // Google account's email (captureAuth.connectedEmail) in
    // operatorEmails, not just workspace members'.
    const matchCtx = await loadMatchContext(workspaceId, uid);
    const updates: Record<string, unknown> = {};
    for (const msg of messages) {
      const entry = gmailToPendingCapture(msg);
      _applyMatch(entry, matchCtx);
      updates[wsPath(workspaceId, "pendingCapture", entry.id)] = entry;
      if (entry.ts > latestTs) latestTs = entry.ts;
    }
    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      result.written = Object.keys(updates).length;
    }
    await db.ref(wsPath(workspaceId, "captureState/gmail")).update({
      lastSyncAt: new Date().toISOString(),
      lastMessageDate: latestTs ? new Date(latestTs).toISOString() : null,
    });
    log.info("sync_complete", { fetched: result.fetched, written: result.written });
    return result;
  } catch (err) {
    const e = err as Error;
    result.error = e.message;
    log.error("sync_failed", { message: e.message, stack: e.stack });
    return result;
  }
}

export async function syncCalendar(
  uid: string,
  workspaceId: string
): Promise<SyncResult> {
  const log = createLogger({ source: "captureCalendar", workspace: workspaceId });
  log.info("sync_start", { uid });
  const result: SyncResult = {
    source: "calendar",
    uid,
    workspaceId,
    fetched: 0,
    written: 0,
  };
  try {
    const auth = await loadAuth(uid);
    if (!auth?.refreshToken) {
      result.skipped = "no-auth";
      return result;
    }
    const stateSnap = await db.ref(wsPath(workspaceId, "captureState/calendar")).get();
    const state: CalendarState = (stateSnap.val() as CalendarState) ?? {};
    if (state.enabled === false) {
      result.skipped = "disabled";
      return result;
    }
    const accessToken = await ensureFreshAccessToken(uid, auth);
    // Window: from lastEventEnd back-edge to +14 days. On first run, last 7d.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sinceIso = state.lastEventEnd ?? sevenDaysAgo;
    const events = await fetchCalendarEvents(accessToken, { sinceIso });
    result.fetched = events.length;
    let latestEnd = state.lastEventEnd ? Date.parse(state.lastEventEnd) : 0;
    // P13.137 — same match-context pattern as Gmail. Calendar invites have
    // attendee emails too; running the matcher gives us account linkage
    // for "next meeting with this org" surfaces.
    // P13.149 — pass uid so the matcher can also include the connected
    // Google account's email (captureAuth.connectedEmail) in
    // operatorEmails, not just workspace members'.
    const matchCtx = await loadMatchContext(workspaceId, uid);
    const updates: Record<string, unknown> = {};
    for (const ev of events) {
      const entry = calendarEventToPendingCapture(ev);
      _applyMatch(entry, matchCtx);
      updates[wsPath(workspaceId, "pendingCapture", entry.id)] = entry;
      const endIso = ev.raw.end?.dateTime ?? ev.raw.end?.date;
      if (endIso) {
        const t = Date.parse(endIso);
        if (t > latestEnd) latestEnd = t;
      }
    }
    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      result.written = Object.keys(updates).length;
    }
    await db.ref(wsPath(workspaceId, "captureState/calendar")).update({
      lastSyncAt: new Date().toISOString(),
      lastEventEnd: latestEnd ? new Date(latestEnd).toISOString() : null,
    });
    log.info("sync_complete", { fetched: result.fetched, written: result.written });
    return result;
  } catch (err) {
    const e = err as Error;
    result.error = e.message;
    log.error("sync_failed", { message: e.message, stack: e.stack });
    return result;
  }
}
