// Corsair P2.14 — OAuth flow callback (HTTP)
//
// Google redirects here after the operator consents. We exchange `code` for
// access+refresh tokens and persist them under users/{uid}/captureAuth/google.
// `state` round-tripped from captureOAuthStart resolves to the uid.

import { onRequest } from "firebase-functions/v2/https";
import { db } from "../framework/rtdb";
import { exchangeCodeForTokens } from "../capture/oauth";
import { createLogger } from "../framework/logger";

const CONNECTED_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Corsair — Connected</title>
<style>
  body{background:#070d18;color:#f4ede0;font-family:'IBM Plex Sans',sans-serif;
       margin:0;padding:64px 24px;text-align:center}
  h1{font-family:Antonio,sans-serif;color:#d4823a;font-size:28px;margin:0 0 12px}
  p{color:#b5ad9f;font-size:14px;line-height:1.6;max-width:480px;margin:0 auto}
</style></head>
<body>
<h1>Corsair capture connected</h1>
<p>Gmail and Calendar are now linked. You can close this tab. New messages and
events will appear in the Auto-Capture review queue on the next sync.</p>
</body></html>`;

// P13.372 — shown when the operator consents with the WRONG Google account.
const WRONG_ACCOUNT_HTML = (attempted: string, expected: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>Corsair — Wrong account</title>
<style>
  body{background:#070d18;color:#f4ede0;font-family:'IBM Plex Sans',sans-serif;
       margin:0;padding:64px 24px;text-align:center}
  h1{font-family:Antonio,sans-serif;color:#ef4444;font-size:28px;margin:0 0 12px}
  p{color:#b5ad9f;font-size:14px;line-height:1.6;max-width:520px;margin:0 auto 10px}
  b{color:#f4ede0}
</style></head>
<body>
<h1>Wrong Google account — nothing changed</h1>
<p>You signed in as <b>${attempted}</b>, but Corsair capture is set to <b>${expected}</b>. Your existing connection was left untouched.</p>
<p>Close this tab, go back to <b>Inbox &rarr; Setup &rarr; Connect Google</b>, and choose <b>${expected}</b> (use &ldquo;Use another account&rdquo; if Google skips the chooser).</p>
</body></html>`;

export const captureOAuthCallback = onRequest(
  { region: "us-central1", secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] },
  async (req, res): Promise<void> => {
    const log = createLogger({ source: "captureOAuthCallback" });
    const code = String(req.query.code ?? "");
    const uid = String(req.query.state ?? "");
    const err = req.query.error ? String(req.query.error) : "";
    if (err) {
      log.warn("user_denied_consent", { uid, error: err });
      res
        .status(400)
        .send(`OAuth denied: ${err}. You can close this tab and retry from Settings.`);
      return;
    }
    if (!code || !uid) {
      res.status(400).send("Missing code or state parameter");
      return;
    }
    try {
      const tokens = await exchangeCodeForTokens(code);
      if (!tokens.refresh_token) {
        // Without offline access + prompt=consent we won't get one. Bail loudly.
        log.error("no_refresh_token", { uid });
        res.status(500).send(
          "OAuth flow returned no refresh_token. " +
            "Re-grant with prompt=consent (already configured) " +
            "or revoke prior access at myaccount.google.com/permissions and retry."
        );
        return;
      }
      const expiresAt = tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : new Date(Date.now() + 50 * 60 * 1000).toISOString();
      // P13.149 — fetch userinfo at grant time and persist email + name.
      // The matcher needs the connected-account email to correctly tag
      // outbound messages (sender === operator). Before this fix the
      // matcher only had workspace members' emails — if the operator
      // connected a different Google account for sync (e.g. signed in
      // as mpoppa32@gmail.com but synced mike@atlasmotion.com), outbound
      // messages from the sync account were mis-tagged as inbound and
      // the Nudge Engine surfaced false "they're waiting on you" alerts
      // for messages the operator had just sent.
      // P13.151 — seed from existing record so a userinfo failure on
      // re-grant doesn't wipe a previously-good connectedEmail.
      const existingSnap = await db.ref(`users/${uid}/captureAuth/google`).get();
      const existing = (existingSnap.val() ?? {}) as {
        connectedEmail?: string;
        connectedName?: string;
      };
      let connectedEmail = String(existing.connectedEmail || "");
      let connectedName = String(existing.connectedName || "");
      let consentedEmail = "";
      try {
        const userinfoResp = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (userinfoResp.ok) {
          const ui = (await userinfoResp.json()) as { email?: string; name?: string };
          const newEmail = String(ui.email || "").toLowerCase().trim();
          const newName = String(ui.name || "").trim();
          consentedEmail = newEmail;
          if (newEmail) connectedEmail = newEmail;
          if (newName) connectedName = newName;
        } else {
          log.warn("userinfo_fetch_non_ok", { uid, status: userinfoResp.status });
        }
      } catch (uiErr) {
        const e = uiErr as Error;
        log.warn("userinfo_fetch_failed", { uid, message: e.message });
      }
      // P13.372 — wrong-account guard. Capture is pinned to ONE account. If the
      // operator consents with a DIFFERENT Google account, REFUSE and do NOT
      // overwrite the existing grant — this is exactly what silently hijacked
      // capture from mike@atlasmotion.com to mpoppa32 when Google was reconnected
      // for the sheet sync (2026-06-24); the two systems share one grant.
      const EXPECTED_CAPTURE_EMAIL = "mike@atlasmotion.com";
      if (consentedEmail && consentedEmail !== EXPECTED_CAPTURE_EMAIL) {
        log.warn("capture_wrong_account_refused", {
          uid,
          attempted: consentedEmail,
          expected: EXPECTED_CAPTURE_EMAIL,
        });
        res
          .status(403)
          .set("Content-Type", "text/html")
          .send(WRONG_ACCOUNT_HTML(consentedEmail, EXPECTED_CAPTURE_EMAIL));
        return;
      }
      await db.ref(`users/${uid}/captureAuth/google`).set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope ?? "",
        tokenType: "Bearer",
        expiresAt,
        grantedAt: new Date().toISOString(),
        connectedEmail,
        connectedName,
      });
      log.info("tokens_persisted", { uid, connectedEmail: connectedEmail || "(not captured)" });
      res.set("Content-Type", "text/html").send(CONNECTED_PAGE_HTML);
    } catch (e) {
      const errObj = e as Error;
      log.error("token_exchange_failed", { uid, message: errObj.message });
      res.status(500).send(`OAuth exchange failed: ${errObj.message}`);
    }
  }
);
