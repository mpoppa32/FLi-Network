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
      await db.ref(`users/${uid}/captureAuth/google`).set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope ?? "",
        tokenType: "Bearer",
        expiresAt,
        grantedAt: new Date().toISOString(),
      });
      log.info("tokens_persisted", { uid });
      res.set("Content-Type", "text/html").send(CONNECTED_PAGE_HTML);
    } catch (e) {
      const errObj = e as Error;
      log.error("token_exchange_failed", { uid, message: errObj.message });
      res.status(500).send(`OAuth exchange failed: ${errObj.message}`);
    }
  }
);
