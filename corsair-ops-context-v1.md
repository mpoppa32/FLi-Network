# corsair-ops-context-v1.md — CORSAIR CONTEXT DOC

*Where we left off and the next move. CONTEXT doc in the four-document AI Operating System (rules: `CLAUDE.md`). Update before you stop (Rule 9). Updated 2026-08-02.*

---

## CURRENT STATE (as of 2026-08-05)

**Operator-endpoint build session (spec: `corsair-operator-endpoint-spec.md`). Three shipped, two acceptance tests still owed.**

- **Piece A — digest OPEN COMMITMENTS: BUILT + DEPLOYED, live acceptance PENDING.** `dailyBriefDigest` + `triggerBriefDigestTest` redeployed. The test trigger is an `onCall` needing a Firebase user token, and this machine has no gcloud/ADC, so it could not be fired headlessly. **Owed:** Mike runs the one-liner in the app console (below) and the digest email is checked for the OPEN COMMITMENTS block.
- **Piece B — `operatorData`: LIVE + FULLY VERIFIED.** All three spec acceptance tests pass against live Atlas (200 w/ token + openCount 65 + 5 signals; 401 on bad/missing; dossiers populated). Handoff written to `corsair-operator-endpoint-handoff.md`. Token in Secret Manager only — never in the repo (it is public).
- **CT-1b — pipelineHealth persistence: BUILT + RULES DEPLOYED, live acceptance PENDING.** `recordPipelineEvent` now also writes to `workspaces/{wsId}/pipelineHealth`; rule added (members read/write, `.indexOn ts`) and `firebase deploy --only database` succeeded. Module syntax verified via `node --check` on the whole `<script type="module">` block. **Owed:** the write has never actually executed — it needs a signed-in browser.

### The two owed acceptance tests (both need Mike's browser, ~2 min)
Open the live app, signed in, on the **Atlas** workspace, then in the console:
```js
// CT-1b — fires the exact new write path
recordPipelineEvent('selftest', { stage: 'ct1b-verify' });
// Piece A — sends the digest to yourself
const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
await httpsCallable(getFunctions(undefined,'us-central1'),'triggerBriefDigestTest')({ workspaceId: currentWsId });
```
Then verify: `firebase database:get "/workspaces/1777435779676/pipelineHealth" --project fli-network` should show the `selftest` record, and the digest email should contain an `OPEN COMMITMENTS` section reading `65 open total`.

## PRIOR STATE (as of 2026-08-02)

- **P13.391 + CT-1 + CT-2 + CT-3 are LIVE and VERIFIED.** Committed to `main` as commit `c811e72` (correctly-named `FLiIntel.html`, 4,393,339 bytes). Verified three ways: repo bytes (markers P13.391/392/393 present), live deployed bytes (all three present), and running functions — `window.retroLinkAll` is a function at page load (proves the fix) and `pipelineSelfTest()` returns **9/9 green**.
- **What each does now, live:** auto-link creation fires on every process/reprocess (P13.391); a swallowed sync error now surfaces to console + toast and `pipelineHealthReport()` (CT-1); `checkPipelineInvariants` flags silently-missing links (CT-2); `pipelineSelfTest()` is a console regression guard (CT-3).
- **Repo cleanup DONE (2026-08-02):** stray `FLiIntel_3.html` / `FLiIntel_4.html` deleted; the four governance docs (`CLAUDE.md` + `corsair-ops-truth/log/context`) committed to the repo root.

## NEXT MOVE
0. **Close the two owed acceptance tests above**, then hand the endpoint URL + token to the Cowork session so it can repoint `Morning brief` and `Meeting prep` off the digest and onto `operatorData` (`corsair-operator-endpoint-handoff.md` has the contract).
1. (Optional) Live end-to-end proof: log a FRESH meeting in the TEST workspace (2 named attendees sharing an org) and Process → expect a "links created" toast + Undo, edges in Graph, green `sync_ok` in `pipelineHealthReport()`. (Do NOT run sync off the in-memory `meetings` array right after a workspace switch — it can hold the previous workspace's data. Use the UI process path in the target workspace.)
2. Next Tier 0: CT-4 targeted un-swallow (route the ~15-25 pipeline swallow points through `recordPipelineEvent`; leave the ~630 benign UI guards alone). CT-1b persistent health log needs a Firebase rules publish (`pipelineHealth` node + `.indexOn ts`, browser-only via console.firebase.google.com → RTDB → Rules).
3. Parallel track: Operator Jarvis brief (needs Gmail/Calendar connector auth in Claude).

## ENVIRONMENT NOTES
- Two Chrome browsers connected to Mike's account; Browser 1 (deviceId 45397478-…) is the one signed into GitHub + the app.
- GitHub file replace requires exact filename match — see the 2026-08-02 LOG entry.
- Workspace isolation is sacred: after switching workspaces, the in-memory `meetings`/`nodes`/`links` globals may briefly hold the prior workspace's data (esp. on REST backup). Never mutate based on them without confirming `currentWs`.

---
*Context doc v1 — updated 2026-08-02.*
