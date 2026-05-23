// Corsair P2.14 — OAuth flow start (HTTP redirect)
//
// Operator clicks "Connect Google" in the user settings modal. The frontend
// opens this endpoint in a popup with ?uid={uid}. We build the Google consent
// URL with state=uid and 302-redirect. After the operator grants, Google
// redirects to captureOAuthCallback with code + state.

import { onRequest } from "firebase-functions/v2/https";
import { buildConsentUrl } from "../capture/oauth";
import { createLogger } from "../framework/logger";

export const captureOAuthStart = onRequest(
  { region: "us-central1" },
  (req, res): void => {
    const log = createLogger({ source: "captureOAuthStart" });
    const uid = String(req.query.uid ?? "");
    if (!uid) {
      res.status(400).send("Missing uid query parameter");
      return;
    }
    try {
      const url = buildConsentUrl(uid);
      log.info("redirect_to_consent", { uid });
      res.redirect(302, url);
    } catch (err) {
      const e = err as Error;
      log.error("consent_url_build_failed", { message: e.message });
      res.status(500).send(`OAuth setup error: ${e.message}`);
    }
  }
);
