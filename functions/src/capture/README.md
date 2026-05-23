# P2.14 — Gmail + Calendar Auto-Capture

**Status: scaffold staged, deploy-blocked until Google Cloud OAuth credentials are configured.**

This directory contains the Firebase Functions backend that auto-captures Gmail messages and Calendar events into `workspaces/{wsId}/pendingCapture/` where the existing `renderCaptureView` UI (FLiIntel.html:35244) consumes them.

## Wait state

The five functions defined under `functions/src/http/capture*.ts` and `functions/src/jobs/captureHourly.ts` are intentionally **NOT exported from `functions/src/index.ts`**. They will not deploy. They will, however, **compile** as part of `tsc`, which means `googleapis` MUST be installed for the build to succeed.

If you ran `cd functions && npm install` after pulling this commit, you already have it.

## What the operator must do before this ships

1. **Google Cloud Console** (one-time, ~10 minutes). Full step-by-step in [`docs/p2.14-gmail-calendar-plan.md`](../../../docs/p2.14-gmail-calendar-plan.md) Phase 1.
2. **Set runtime env vars** for the functions. Match the pattern used by `framework/secrets.ts` (process.env reads). Two options:
   - Local dev: `functions/.env` file with `GOOGLE_CLIENT_ID=...`, `GOOGLE_CLIENT_SECRET=...`, `GOOGLE_REDIRECT_URI=...`.
   - Production: `firebase functions:secrets:set GOOGLE_CLIENT_ID` (etc.) and `--secret GOOGLE_CLIENT_ID` in deploy command, OR set in the Firebase console under Cloud Functions → Configuration.
3. **Uncomment the five exports** in `functions/src/index.ts` (block marked `// P2.14`).
4. **Deploy**: `firebase deploy --only functions:captureOAuthStart,functions:captureOAuthCallback,functions:triggerGmailSync,functions:triggerCalendarSync,functions:captureHourly`.
5. **Wire the frontend "Connect Google" button** in FLiIntel.html user settings modal — opens `captureOAuthStart?uid={uid}` in a popup.

After those five steps, the auto-capture loop is live.

## Module layout

| File | Purpose |
| --- | --- |
| `oauth.ts` | Reads `process.env.GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Exports `buildConsentUrl(uid)`, `exchangeCodeForTokens(code)`, `refreshAccessToken(refreshToken)`. |
| `gmailClient.ts` | Thin wrapper over `googleapis` Gmail messages.list + messages.get. Handles incremental fetch via `after:` query. |
| `calendarClient.ts` | Thin wrapper over `googleapis` Calendar events.list. Date-range incremental. |
| `normalizer.ts` | Converts raw Gmail / Calendar API responses into the exact `pendingCapture` schema that `renderCaptureView` consumes. **Verified against the live UI** — see `docs/p2.14-gmail-calendar-plan.md` Phase 2. |
| `dispatcher.ts` | Orchestrates a single sync run for one user + one workspace: load tokens → refresh if expired → fetch → normalize → write. |
| `../http/captureOAuthStart.ts` | HTTPS endpoint: builds the Google consent URL with `state=uid` and 302-redirects. |
| `../http/captureOAuthCallback.ts` | HTTPS endpoint: receives the OAuth `code`, exchanges for tokens, writes to `users/{uid}/captureAuth/google`, responds with a "connected" page. |
| `../http/triggerGmailSync.ts` | Authenticated callable: operator-initiated manual Gmail sync. Returns count of new captures. |
| `../http/triggerCalendarSync.ts` | Authenticated callable: operator-initiated manual Calendar sync. |
| `../jobs/captureHourly.ts` | Pub/Sub scheduled function: hourly sweep of every workspace × every enabled user, both Gmail and Calendar. |

## What this scaffold deliberately does NOT do

- Does not call `admin.initializeApp()` — `framework/rtdb.ts` already does that.
- Does not register itself in `index.ts` — would deploy half-credentialed functions that would error at runtime.
- Does not implement Outlook (P2.15). Same shape, swap `googleapis` for `@microsoft/microsoft-graph-client`; planned as a follow-on once P2.14 is verified end-to-end.
- Does not handle attachment parsing on Gmail — body text only, attachments referenced in the captured entry's `intel.summary` if metadata is present. Attachment extraction can come later if useful.
