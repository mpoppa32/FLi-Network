# corsair-ops-context-v1.md — CORSAIR CONTEXT DOC

*Where we left off and the next move. CONTEXT doc in the four-document AI Operating System (rules: `CLAUDE.md`). Update before you stop (Rule 9). Updated 2026-08-02.*

---

## CURRENT STATE (as of 2026-08-05, later session)

**Mission 2 — CI/CD + governance machinery: COMPLETE + VERIFIED (brief: `mission-2-cicd-governance.md`, committed).**

Push-to-main builds and deploys the backend and asserts the live front-end bytes equal main's bytes. Verified green end-to-end on run #3 (`50257ad`): 77 functions updated with no human action. All four acceptance criteria demonstrated — see LOG 2026-08-05 "Mission 2 acceptance evidence" for the verbatim record. Full contract in the CI/CD section of the truth doc.

**You no longer run `firebase deploy` by hand.** Push to `main`; watch the run.

- **The blocker that shaped the mission:** the public repo cannot compile. `functions/src/index.ts` exports four functions whose source is gitignored (private Sheet IDs / customer names). Proven, not assumed — `tsc` on `git archive HEAD` fails with 14 errors. CI restores them from the `ATLAS_MASTER_BUNDLE` secret and verifies against the committed `functions/atlasMaster.sha256` sentinel.
- **Whenever a private atlasMaster file changes, refresh BOTH** `scripts/atlas-bundle.sh sentinel` (commit the sentinel) and `scripts/atlas-bundle.sh bundle` (update the GitHub secret). One without the other = loud CI failure; neither = CI silently deploys stale config. The pre-commit hook warns on drift.
- **Truth-lockstep hook ships in WARN mode.** Turn on enforcement with `git config corsair.truthlock block`.
- **That gap is CLOSED by Mission 3** (below). It used to read: zero test files, `npm test` exits 1, not wired into CI.
- **Cloud Billing API must stay enabled** on `fli-network` or every CI deploy 403s at preflight (LOG 2026-08-05).

**Mission 3 — first real test suite in `functions/`: SHIPPED (brief: `mission-3-tests.md`, committed).**

119 tests across 3 files (`briefSynthesisScoring` 59, `dailyBriefDigest` 31, `operatorData` 29), green locally in 2.21s, re-confirmed immediately before the push rather than inherited. `npm test` runs in CI in its own step between build and every deploy step, on push and PR alike — so a change that compiles but behaves wrong goes red before it can reach production. Contract and target rationale in the TEST SUITE section of the truth doc; CI run evidence in LOG 2026-08-05.

**Piece A acceptance is CLOSED** — connector-captured, msgs `19fcc6e7ac38cfd5` (08-04 control) vs `19fd1953700e6081` (08-05 test). See TRUTH / LOG.

## NEXT MOVE (as of 2026-08-05, after Mission 3)
1. **MISSION 4, ITEM #1 — fix HIGH PRIORITY ACTIONS selection in `jobs/dailyBriefDigest.ts`.** HPA currently takes the **first 8 in key order**, which is arbitrary: it is neither the most urgent nor the most recent, and it never rotates, so the same stale items can sit in the brief indefinitely while genuinely urgent ones never surface. Fix = sort by deadline then recency, filter out done, and rotate. **Queued deliberately, NOT a drive-by** — `jobs/dailyBriefDigest.test.ts` now pins the ordering contract, so this change has a test to answer to and must land with test updates that state the new contract explicitly.
2. CT-1b acceptance — the one remaining owed test (below), needs Mike's signed-in browser.
3. Consider a `production` GitHub Environment if the collaborator set ever grows past Mike + Bryce (see the accepted-risk note in the truth doc).

## PRIOR STATE — operator endpoint (as of 2026-08-05)

**Operator-endpoint build session (spec: `corsair-operator-endpoint-spec.md`). Three shipped, two acceptance tests still owed.**

- **Piece A — digest OPEN COMMITMENTS: BUILT + DEPLOYED + ACCEPTED LIVE 2026-08-05.** Closed by the scheduled brief, not the manual trigger: the 2026-08-05 daily brief contains a live DUE THIS WEEK block and an OPEN COMMITMENTS block (`65 open total`, 8 soonest-due with ISO dates); the 08-04 brief has neither. Operator-observed in the received email. Nothing further owed here — see TRUTH (OPERATOR / HEADLESS LAYER) and LOG 2026-08-05.
- **Piece B — `operatorData`: LIVE + FULLY VERIFIED.** All three spec acceptance tests pass against live Atlas (200 w/ token + openCount 65 + 5 signals; 401 on bad/missing; dossiers populated). Handoff written to `corsair-operator-endpoint-handoff.md`. Token in Secret Manager only — never in the repo (it is public).
- **CT-1b — pipelineHealth persistence: BUILT + RULES DEPLOYED, live acceptance PENDING.** `recordPipelineEvent` now also writes to `workspaces/{wsId}/pipelineHealth`; rule added (members read/write, `.indexOn ts`) and `firebase deploy --only database` succeeded. Module syntax verified via `node --check` on the whole `<script type="module">` block. **Owed:** the write has never actually executed — it needs a signed-in browser.

### The ONE remaining owed acceptance test (needs Mike's browser, ~1 min)
Piece A is closed (above). **CT-1b is still owed.** Open the live app, signed in, on the **Atlas** workspace, then in the console:
```js
// CT-1b — fires the exact new write path
recordPipelineEvent('selftest', { stage: 'ct1b-verify' });
```
Then verify: `firebase database:get "/workspaces/1777435779676/pipelineHealth" --project fli-network` should show the `selftest` record.

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
