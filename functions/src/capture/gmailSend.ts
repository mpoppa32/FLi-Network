// Corsair P13.379 — send email from the operator's own Gmail.
//
// Replaces the SendGrid path (dead API key → 401) for the morning brief and
// the meeting reminders. Sends via gmail.users.messages.send using the same
// stored Google OAuth grant that capture already uses
// (users/{uid}/captureAuth/google), refreshing the access token as needed.
// Requires the gmail.send scope (added to oauth.ts GMAIL_SCOPES) — the operator
// must re-consent once for existing grants to gain it; until then sends 403.

import { db } from "../framework/rtdb";
import { refreshAccessToken, clientForAccessToken } from "./oauth";
import { google } from "googleapis";

interface CaptureAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  connectedEmail?: string;
}

interface MinimalLogger {
  info: (event: string, payload?: unknown) => void;
  error: (event: string, payload?: unknown) => void;
}

/** Load the stored Google grant for `uid` and return a currently-valid access
 *  token (refreshing + persisting if expired), plus the connected From address.
 *  Returns null when there is no usable grant. */
async function freshAccessToken(uid: string): Promise<{ accessToken: string; from: string } | null> {
  const snap = await db.ref(`users/${uid}/captureAuth/google`).get();
  if (!snap.exists()) return null;
  const auth = (snap.val() as CaptureAuth) || {};
  let accessToken = auth.accessToken || "";
  const stillFresh = !!auth.expiresAt && Date.parse(auth.expiresAt) > Date.now() + 60_000;
  if (!stillFresh) {
    if (!auth.refreshToken) return null;
    const creds = await refreshAccessToken(auth.refreshToken);
    if (!creds.access_token) return null;
    accessToken = creds.access_token;
    const expiresAt = creds.expiry_date
      ? new Date(creds.expiry_date).toISOString()
      : new Date(Date.now() + 50 * 60 * 1000).toISOString();
    await db.ref(`users/${uid}/captureAuth/google`).update({ accessToken, expiresAt });
  }
  if (!accessToken) return null;
  return { accessToken, from: String(auth.connectedEmail || "") };
}

/** RFC 2047 encoded-word for non-ASCII header values (e.g. a subject with an
 *  em-dash); pass ASCII through unchanged. */
function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
}

/** Base64 a UTF-8 body and hard-wrap at 76 chars per RFC 2045. */
function b64Body(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function buildRawMessage(from: string, to: string, subject: string, text: string, html: string): string {
  const boundary = "corsair_" + Date.now().toString(36);
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Body(text),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Body(html),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

/**
 * Send one email from `uid`'s connected Gmail. Returns true on success.
 * Never throws — logs and returns false so a single bad send doesn't abort a
 * batch (brief digest / reminder sweep).
 */
export async function sendViaGmail(
  uid: string,
  msg: { to: string; subject: string; text: string; html: string },
  log: MinimalLogger
): Promise<boolean> {
  try {
    const tok = await freshAccessToken(uid);
    if (!tok) {
      log.error("gmail_send_no_grant", { uid, to: msg.to });
      return false;
    }
    const from = tok.from || msg.to;
    const raw = buildRawMessage(from, msg.to, msg.subject, msg.text, msg.html);
    const gmail = google.gmail({ version: "v1", auth: clientForAccessToken(tok.accessToken) });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    log.info("gmail_send_success", { uid, to: msg.to });
    return true;
  } catch (err) {
    const e = err as { message?: string; code?: number };
    log.error("gmail_send_failed", { uid, to: msg.to, code: e?.code, message: e?.message || String(err) });
    return false;
  }
}
