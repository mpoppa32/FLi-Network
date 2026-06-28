// Corsair P2.14 — Google OAuth helpers
//
// Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI from
// the function runtime environment. Matches the env-var pattern in
// framework/secrets.ts (used by samgov, congressgov, etc.). Set via .env
// in functions/ for local dev, or `firebase functions:secrets:set` for prod.
//
// Returns a fresh OAuth2 client per call to avoid cross-request credential
// bleed between user contexts.

import { google, Auth } from "googleapis";

// P13.150 — added userinfo.email + userinfo.profile so captureOAuthCallback
// can fetch the connected Google account's email at grant time. Without
// these, Google's userinfo endpoint returns 403 and connectedEmail writes
// as empty string, defeating P13.149's outbound-tagging fix. Both scopes
// are non-sensitive — no Google verification required.
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  // P13.379 — outbound email. The morning brief + meeting reminders send from
  // the operator's OWN Gmail (gmail.users.messages.send) instead of SendGrid,
  // which had a dead API key. Granted alongside the existing scopes on the
  // single shared re-consent (guarded to mike@atlasmotion.com in the callback).
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Atlas master-sheet sync (read-only). Reads the operator's pipeline/orders
  // Google Sheets so Corsair can mirror them. Added to the shared connect flow
  // so a single re-consent grants it alongside gmail/calendar.
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

function readGoogleConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth env vars missing. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, " +
        "and GOOGLE_REDIRECT_URI in functions/.env (local) or via " +
        "`firebase functions:secrets:set GOOGLE_CLIENT_ID` etc. (production)."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function newOAuthClient(): Auth.OAuth2Client {
  const { clientId, clientSecret, redirectUri } = readGoogleConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Build the Google consent URL for a given user. `state` is round-tripped via
 * the OAuth flow so the callback can resolve back to the right user uid.
 */
export function buildConsentUrl(uid: string): string {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent", // forces refresh_token issue on re-grant
    scope: GMAIL_SCOPES,
    state: uid,
  });
}

/**
 * Exchange the OAuth `code` returned by the callback for an access+refresh
 * token pair. Caller is responsible for persisting these securely.
 */
export async function exchangeCodeForTokens(code: string): Promise<Auth.Credentials> {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Mint a fresh access token from a stored refresh token. Used when the
 * previous accessToken has expired (typically every 1 hour).
 */
export async function refreshAccessToken(refreshToken: string): Promise<Auth.Credentials> {
  const client = newOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}

/**
 * Build an OAuth2 client preloaded with an access token, ready to be passed
 * as `auth` to googleapis service clients (gmail, calendar).
 */
export function clientForAccessToken(accessToken: string): Auth.OAuth2Client {
  const client = newOAuthClient();
  client.setCredentials({ access_token: accessToken });
  return client;
}
