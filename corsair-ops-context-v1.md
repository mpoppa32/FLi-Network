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

119 tests across 3 files (`briefSynthesisScoring` 59, `dailyBriefDigest` 31, `operatorData` 29), green locally in 2.21s, re-confirmed immediately before the push rather than inherited. `npm test` runs in CI in its own step between build and every deploy step, on push and PR alike — so a change that compiles but behaves wrong goes red before it can reach production. Green in CI on run #4 (`07ac298`), step order observed. Contract in the TEST SUITE section of the truth doc; evidence in LOG 2026-08-05.

**Acceptance is COMPLETE — nothing owed on Mission 3.** The negative proof closed on PR #4, run #5 (`dbe983b`): `Install + build functions` **success**, `Test functions` **failure**, `Auth`/`Deploy`/smoke **skipped**, `verify-live` skipped. Compiling and then failing on behavior is the exact shape the brief demanded. PR closed unmerged, branch `ci-negative-proof` deleted. Full step record in LOG 2026-08-05.

**Piece A acceptance is CLOSED** — connector-captured, msgs `19fcc6e7ac38cfd5` (08-04 control) vs `19fd1953700e6081` (08-05 test). See TRUTH / LOG.

**Mission 4 — #1 and #2 both SHIPPED, DEPLOYED and ACCEPTED. #3 queued for next session.**

- **#1 HPA ordering (`22215e6`, deployed):** urgency order replaces first-8-in-key-order; `done` items now excluded from the email entirely. 134 tests green in CI on run [#6](https://github.com/mpoppa32/FLi-Network/actions/runs/31041218888) — build → test → deploy → smoke → `verify-live`, all green. Live in the 11:00Z brief from 2026-08-06.
- **#2 CT-1b rebuild (P13.397, `6f5e063`, deployed): ACCEPTED LIVE UNDER THE WEDGE.** REST `PUT` durable path + SDK hang timeout + loud guard-skip + re-entry latch. `node scripts/ct1b-harness.mjs` → **17/17**; the same harness fails **14/17** against the pre-fix code. Live acceptance 2026-08-05 with the connection indicator DELAYED: one 8s hang warning, no failure warnings, record `ph-1785960922768-zlzpej` confirmed in `pipelineHealth` by direct `database:get`. Front-end bytes confirmed live by `verify-live` on run [#7](https://github.com/mpoppa32/FLi-Network/actions/runs/31042845264) (`build-deploy` correctly skipped — no backend paths in that push).
- **Nothing is owed on Mission 4 #1 or #2.** CT-1b is closed; the integrity tier (CT-1 … CT-4 + CT-1b) is fully live and verified for the first time.

## NEXT MOVE (as of 2026-08-05, end of session — nothing owed on a human)
1. **MISSION 4, ITEM #3 — `operatorData.ts:292` builds `openActionItems` WITHOUT filtering `done`.** The field named *open* includes completed work, so the headless operator layer reads finished items as outstanding. Found while shipping #1; deliberately not fixed drive-by. **Its fix must reuse or mirror the `done`-filter semantics shipped in `selectHighPriorityActions`** so the digest and the endpoint cannot drift apart on what "open" means — and it has `operatorData.test.ts` to extend.
2. Consider a `production` GitHub Environment if the collaborator set ever grows past Mike + Bryce (see the accepted-risk note in the truth doc).
3. **Re-point the Cowork operator session to the rotated `OPERATOR_API_TOKEN`** — it was rotated 2026-08-05 (version 2) and anything still holding the old value gets 401. Read the current value with `firebase functions:secrets:access OPERATOR_API_TOKEN`; never paste it into a command that will be captured as a permission rule (LOG 2026-08-05).

## PRIOR STATE — operator endpoint (as of 2026-08-05)

**Operator-endpoint build session (spec: `corsair-operator-endpoint-spec.md`). Three shipped, two acceptance tests still owed.**

- **Piece A — digest OPEN COMMITMENTS: BUILT + DEPLOYED + ACCEPTED LIVE 2026-08-05.** Closed by the scheduled brief, not the manual trigger: the 2026-08-05 daily brief contains a live DUE THIS WEEK block and an OPEN COMMITMENTS block (`65 open total`, 8 soonest-due with ISO dates); the 08-04 brief has neither. Operator-observed in the received email. Nothing further owed here — see TRUTH (OPERATOR / HEADLESS LAYER) and LOG 2026-08-05.
- **Piece B — `operatorData`: LIVE + FULLY VERIFIED.** All three spec acceptance tests pass against live Atlas (200 w/ token + openCount 65 + 5 signals; 401 on bad/missing; dossiers populated). Handoff written to `corsair-operator-endpoint-handoff.md`. Token in Secret Manager only — never in the repo (it is public).
- **CT-1b — pipelineHealth persistence: ACCEPTANCE FAILED 2026-08-05. NOT accepted, NOT working.** The rules are deployed and correct (a direct REST `PUT` returns 200), but the write path itself is broken: it uses the raw SDK `set()` that P13.354 documents as hanging forever on a wedged socket, so events silently never persist and — because a hung promise never rejects — nothing is logged either. Diagnosis and the three-part fix are in LOG 2026-08-05 and NEXT MOVE item #2. **Do not re-run the console one-liner expecting a pass; the bug is understood and the code has not changed yet.**

### No acceptance tests are owed on a human right now
Piece A closed; CT-1b is blocked on a code fix, not on a test. When Mission 4 item #2 lands, the re-test is: open the live app, signed in, on **Atlas**, run `recordPipelineEvent('selftest', { stage: 'ct1b-verify' })`, then check `firebase database:get "/workspaces/1777435779676/pipelineHealth" --project fli-network` for the record. **Re-test deliberately while the connection header shows DELAYED** — a pass on a healthy socket proves nothing about the failure mode that was actually found. Note there is already a probe record in that node from the REST `PUT` used to clear the rules; do not mistake it for a `selftest` event.

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
