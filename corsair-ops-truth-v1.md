# corsair-ops-truth-v1.md — CORSAIR TRUTH DOC

*What is actually built and true in the Corsair codebase today, and the reasoning behind it. TRUTH doc in the four-document AI Operating System (rules: `CLAUDE.md`). Source of reality — not the roadmap. Update in the SAME COMMIT as any code change that alters what's real (CLAUDE.md Rule 6). Seeded 2026-07-30 from the verified `corsair-current-state.md` (last verified against the live codebase 2026-07-08) plus a direct repo inspection at commit `56573fb` / P13.390.*

---

## WHAT IT IS
Corsair — "Defense Capture OS" (V1.0). A defense-BD operating system: meeting intelligence + relationship graph + an automated OSINT pipeline that ingests government/defense-industry data and fuses it into a daily brief and a governed entity graph. Product name is "Corsair"; legacy infra name is "FLi" (Firebase project `fli-network`, live file `FLiIntel.html`, storage keys prefixed `fli-`). **The name does not tell you the path** — verify.

**Live:** `https://mpoppa32.github.io/FLi-Network/FLiIntel.html`

## ARCHITECTURE (verified)
- **Front end:** single file `FLiIntel.html` (~4.4MB) + `FLiIntel.css` + ES modules in `js/corsair/` — verified modules: `main, state, util, brief, pipeline, table, theater, cop, poc, posture, rhythm, nudge, inspector`.
- **Backend:** `functions/` — TypeScript, Node 20, Firebase Functions 2nd gen, package `corsair-functions`. Source tree under `functions/src/`: `capture, factsSync, framework(/types), http, jobs, migrations, sources/*`. Verified `sources/` connectors: samGov, usaSpending, dodNews, gaoProtest, gaoReports, secEdgar, congressGov, dscaFms, senateLda, dodComptroller, plumBook, facaDatabase, thinkTanks, serviceNews, darpaNews, nasaOig, dodOig, industryAssoc, advisoryBoards, stateDepartment, defenseScoop, uasPatterns, uasPatternsPie, slack.
- **Hosting:** GitHub Pages (front end) + Firebase (data, functions). The old "no server needed" claim is FALSE — there is a substantial backend.

## THE CLAUDE INTEGRATION (the single most important architecture fact)
Claude is the engine — ~14 call sites, all on `claude-sonnet-4-6`. **All calls route server-side through the `anthropicProxy` Firebase Function.** Anthropic key in Firebase Secret Manager (`ANTHROPIC_API_KEY`), never in the browser. Proxy verifies workspace membership, enforces a per-workspace hourly quota (default 30/hr, ceiling 200), enforces a model allow-list (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`, legacy 3.x), timeout 120s / upstream abort 110s. **Single point of failure:** if `ANTHROPIC_API_KEY` is unset/invalid, all AI features break across all workspaces. (History: browser-side `x-api-key` was security finding P13.124 — closed, do not reintroduce. See LOG.)

## APP SURFACE (verified as ~28 views)
Top nav: Today, Inbox, Pipeline, Accounts, Outreach, Drone, Reckoning, Graph ("Theater"), Table, Posture, Atlas (generic team chamber — NOT a hardcoded workspace), + More (Coverage Matrix, Unbound Domains, Intel Center, RFI Engine, Competitive, Teaming, Timeline, Win/Loss, Trends). Intel Station tabs: Log, Intel, Brief, History, Actions, ⚡Ask.

## INTEGRITY TIER (CT-1 … CT-4)
`recordPipelineEvent` (P13.392/CT-1) is the single choke point for pipeline telemetry: in-memory + `localStorage` ring buffer (100 entries), console on `sync_error`/`invariant_warn`/`persist_error`, toast on the first two. CT-2 (`checkPipelineInvariants`), CT-3 (`pipelineSelfTest()`), CT-4 (P13.394 — `fbSet`/`fbRemove` failures recorded).

- **CT-1b persistence (2026-08-05):** `recordPipelineEvent` now ALSO writes each event to `workspaces/{wsId}/pipelineHealth/{ph-<ms>-<rand>}`, so health survives a reload / clear-site-data and is readable server-side. Written with a direct `ref`+`set`, fire-and-forget so telemetry can never block the pipeline — **deliberately NOT through `fbSet`**, because CT-4 instruments `fbSet` failures *by calling `recordPipelineEvent`*, so routing through `fbSet` would re-enter the recorder on every failed write. Guarded on `currentWsId && window.currentUser`. Per Rule 11 a failed persist is `console.warn`'d (not silent) but does **not** raise a health event — that is the recursion this branch exists to avoid; the event is still in the local buffer either way.
- `database.rules.json` gains a `pipelineHealth` node: members read/write (no observer exclusion — this is automatic instrumentation, not user data), `.indexOn: ["ts"]`. Event `ts` is an ISO string, which sorts chronologically. Rules deployed 2026-08-05.

## OSINT LAYER
Automated external-intelligence pipeline (~40 deployed functions), manual trigger + scheduled cron per source, ingesting a ~142-source catalog tiered by operator impact. Supporting entities: Award, Signal; per-workspace Watchlist (NAICS, agencies, CIKs, committees); Source Health monitoring UI; nightly Brief Synthesis → Intel Center (`pulse`) daily feed.

## OTHER INTEGRATIONS LIVE
Deepgram (multi-speaker HD transcription, per-user key `fli-dgkey-{uid}`), Gmail + Google Calendar auto-capture (~30 min, `gmail.readonly` + `calendar.readonly`), Microsoft Graph (Outlook/O365), EmailJS (browser-side brief send), Slack (incoming webhook + `slackIntake`), SendGrid (server-side digests + reminders), Firebase/Google Auth/D3/Google Fonts.

## OPERATOR / HEADLESS LAYER
The Cowork scheduled tasks (morning brief, meeting prep) run headless — no browser, no Firebase user token — so they cannot reach the graph interactively.

- **Daily digest — OPEN COMMITMENTS section** (`jobs/dailyBriefDigest.ts`, 2026-08-05). The digest's DUE-THIS-WEEK block only ever showed the 7-day window capped at 10. A new OPEN COMMITMENTS block lists the top 8 open commitments regardless of deadline plus the total open count, gated behind `incCommitments !== false` (defaults on). Ordering is shared with the endpoint below via the exported `sortOpenCommitments()` (dated soonest-first, then undated newest-first).
  - **Verification status (be precise):** deployed 2026-08-05; the rendering path was verified by running the compiled `composeBrief()` against the real Atlas commitments — emits `=== OPEN COMMITMENTS === / 65 open total / …and 57 more`, with DUE-THIS-WEEK preserved and the HTML header rendered.
  - **ACCEPTED LIVE 2026-08-05.** The scheduled daily brief that landed on 2026-08-05 contains both a live **DUE THIS WEEK** block and the new **OPEN COMMITMENTS** block — `65 open total`, with the 8 soonest-due listed and carrying ISO dates. Neither block is present in the 2026-08-04 brief, which is the control that ties the change to the output. Provenance: **operator-observed in the received email by Mike**, not machine-captured on this machine — `triggerBriefDigestTest` is an `onCall` needing a Firebase user token and the build machine still has no gcloud/ADC. The scheduled path proved it instead, which is the stronger evidence: it is the path that actually runs in production.
  - The live DUE THIS WEEK block also independently confirms the correction below — the block was never empty.
  - **Correction to a prior assumption:** it was believed every open commitment was undated, making DUE-THIS-WEEK always empty. Measured on Atlas 2026-08-05: **65 open, 49 dated, 16 undated, 33 inside the 7-day window.** DUE-THIS-WEEK was NOT empty — it was showing 10 of 33. The real gap was the 65-vs-10 visibility ceiling.

- **`operatorData` endpoint** (`http/operatorData.ts`, LIVE 2026-08-05). `onRequest` (raw HTTP, not `onCall` — the caller has no Firebase user), region us-central1, 512MiB, 60s. Auth: shared bearer token in Secret Manager (`OPERATOR_API_TOKEN`), SHA-256'd then `timingSafeEqual` (constant time, length-independent). **Read-only** — never writes; non-GET/HEAD returns 405. Reads through the admin SDK, so `database.rules.json` is untouched and unweakened.
  - `GET ?ws={workspaceId}[&entities=A,B][&signals=7][&commitments=15]` → `{workspace, generatedAt, commitments:{openCount, top[]}, signals[], entities[]}`.
  - Sources: `workspaces/{ws}/commitments` (open only), `derivedViews/dailyBrief/latest.itemsByCategory` (flattened, ranked by `relevance.total`), `nodes` + `meetings` for dossiers.
  - Dossiers resolve entity terms exact-name-first then substring over name/org; stance comes from the most recent `meetings/*/intel/keyPeople[].stance`; action items are attributed conservatively (a bare first name matches, a *different* full name sharing a first name does not — "Bill Akman" must not inherit "Bill Allen"'s items; both exist in Atlas).
  - **Two working URLs.** `https://us-central1-fli-network.cloudfunctions.net/operatorData` and the direct Cloud Run URL `https://operatordata-fcxd64equq-uc.a.run.app`. Both accept `Authorization: Bearer <token>`; `X-Operator-Token: <token>` is accepted as a fallback on either (see LOG 2026-08-05 for why the fallback exists).
  - Verified live 2026-08-05: valid token → 200 with `openCount` 65 / 5 signals; bad or missing token → 401; POST → 405; `entities=Rick,Tom Baron` → dossiers with meeting counts, last meeting, stance, and open action items.

## CI/CD + GOVERNANCE MACHINERY (2026-08-05)

**STATUS: LIVE + VERIFIED 2026-08-05.** Observed green end-to-end on run [#3](https://github.com/mpoppa32/FLi-Network/actions/runs/30993064184) (commit `50257ad`): a comment-only change to `functions/src/index.ts` pushed to `main` deployed itself with no human action — **77 × `Successful update operation`**, including `operatorData`, and including the gitignored private functions `atlasMasterSync` / `triggerAtlasMasterRead` / `triggerAtlasMasterSync`, which proves the bundle-restore path works and that nothing was pruned. Deploy 6m27s, post-deploy smoke green, `verify-live` green.

- **Prerequisite that bit us once:** the **Cloud Billing API** must stay enabled on project `fli-network`. It was disabled at first run; `firebase-tools` reads `cloudbilling.googleapis.com/v1/projects/fli-network/billingInfo` as a preflight (gen2 functions require Blaze) and the deploy aborted 403 *before touching any function*. Enabled 2026-08-05; deploys green since. See LOG.

- **`.github/workflows/firebase-deploy.yml`** — a push to `main` touching `functions/**`, `database.rules.json`, or `firebase.json` builds and deploys. Auth via the `FIREBASE_SERVICE_ACCOUNT` GitHub secret (`google-github-actions/auth@v2` → ADC → firebase-tools). `firebase-tools` pinned to `15.17.0`. `--non-interactive` **without** `--force` is deliberate — if the private config fails to restore, the CLI aborts instead of pruning four live production functions.
  - Deploy target is computed in a separate `changes` job from **`github.event.before`…`github.sha`** with `fetch-depth: 0, filter: blob:none` — deliberately NOT `git diff HEAD^ HEAD`. `HEAD^` sees only the last commit while GitHub's `paths:` filter spans the whole push, so a push of *[commit A: rules, commit B: functions]* would deploy functions and **silently skip the rules change on a green run** — reintroducing the exact failure class this workflow exists to kill, on the security-critical surface. An unresolvable range (force-push, first push) falls back to deploying both.
  - Push `paths:` includes the **front end** (`FLiIntel.html`, `FLiIntel.css`, `js/corsair/**`) as well as the backend. This is load-bearing, not decorative: with backend-only paths, `verify-live`'s byte assertion could never fire on a front-end-only push and would pass trivially on every backend push, because `FLiIntel.html` would be unchanged. Backend-only paths made the whole check vacuous.
  - Also runs on `pull_request` (build only — every deploy step gated `if: github.event_name == 'push'`), so a broken branch shows a red X without reaching `main`. Fork PRs are skipped rather than run: they receive no secrets, so they could not compile and would go red for reasons unrelated to the code.
  - Post-deploy smoke: asserts `operatorData` returns **401** to an invalid bearer token. `firebase deploy` can report success while a function is stuck on an old revision or failed to bind a secret; without this, nothing verified the surface the workflow actually deploys.
  - `npm test` is **not** wired in: `vitest run` reports "No test files found, exiting with code 1". There are zero test files in `functions/`. Known gap, deliberately not hidden behind a passing step.
  - `verify-live` asserts **`sha256(live FLiIntel.html) == sha256(repo FLiIntel.html)`** (12 attempts, 25s apart, no-cache headers). That single assertion is what closes the LOG 2026-08-02 failure class. A *hardcoded* marker list cannot: markers are additive and permanent, so such a check can only ever pass. Marker comparison is therefore demoted to a failure-only diagnostic and its set is **derived from the repo at runtime** (195 unique `P13.x` markers today), to turn a hash mismatch into a named diff.

- **The public-repo build constraint (important, previously only an `index.ts` comment).** `functions/src/index.ts` exports four functions (`triggerAtlasMasterRead`, `triggerAtlasMasterSync`, `atlasMasterSync`, plus `factsSync`/`draftingFacts`/`slack/config` imports) whose source is **gitignored** — private Sheet IDs and customer names, and this repo is PUBLIC. **A clean checkout does not compile.** Measured 2026-08-05 on `git archive HEAD`: `tsc` fails with 14 errors, 8 of them `TS2307: Cannot find module '../sources/atlasMaster/…'`.
  - CI restores the 7 private files from the `ATLAS_MASTER_BUNDLE` GitHub secret (base64 tar.gz, 13,277 chars; GitHub's limit is 48 KB), produced by `scripts/atlas-bundle.sh bundle`.
  - **`functions/atlasMaster.sha256`** is a committed, non-sensitive sentinel: filenames plus SHA-256 digests. Non-sensitive because every one of those basenames already appears in tracked public files — `functions/src/index.ts:68-72` names the three top-level modules, and `factsSync/mapper.ts:32-33`, `http/draftingFacts.ts:20`, `jobs/factsSheetSync.ts:14`, `sources/slack/config.ts:12` name the `sources/atlasMaster/*` ones — and a SHA-256 of a multi-KB source file is not invertible. CI verifies the restored bundle against it and fails loudly on mismatch, closing the drift hole where an edited private file leaves the secret silently stale and CI deploys old config forever. Both must be refreshed together (`scripts/atlas-bundle.sh sentinel` + `bundle`); the pre-commit hook warns when they diverge.

- **`.githooks/pre-commit`** — committed git hook. Guard 1: a commit touching `FLiIntel.html` or `functions/**` without staging `corsair-ops-truth-v1.md` (Rule 6). Guard 2: private-config sentinel drift. Mode via `git config corsair.truthlock warn|block`, **default `warn`**. Chosen over a Claude Code hook because it fires on every commit — Mike's, Bryce's, any agent's — not only on commits made through an agent harness. **Requires per-clone activation: `git config core.hooksPath .githooks`** — an unactivated hook is an inert file, so treat that command as part of cloning this repo.

- **`.claude/commands/{ship,truth-check,postmortem}.md`** and **`.claude/agents/reviewer.md`** — the four-doc rituals as slash commands plus an adversarial diff-review subagent. The reviewer earned its place immediately: run against this very diff before its first push, it found a silently-skipped-deploy bug, a vacuous live check, and a swallowed-failure bug in `atlas-bundle.sh`. See LOG 2026-08-05.

- **Known, accepted risk (not fixed):** both GitHub secrets are repo-scoped with no `environment:` gate, so there is no approval boundary between a commit landing on `main` and a service account rewriting production. A required-reviewer environment would also defeat the point of automatic deploy. Revisit if the collaborator set grows beyond Mike and Bryce.

## WORKSPACES
Fully dynamic (`workspaces/{wsId}`). No hardcoded FLi/Atlas IDs. FLi and Atlas are the two operational workspaces in practice. Firebase paths: `workspaces/{wsId}/{meetings,nodes,links,entities,cal,commitments}`.

## KEY FACTS
- Repo: `github.com/mpoppa32/FLi-Network` · anchor commit `50257ad` (P13.396) — kept in step with `CLAUDE.md`'s state anchor
- Firebase project `fli-network` · DB `https://fli-network-default-rtdb.firebaseio.com`
- Model in use: `claude-sonnet-4-6` via `anthropicProxy`
- Owners: Mike (mpoppa32@gmail.com), Bryce (Bryceamcdonald@gmail.com)

---
*Truth doc v1 — seeded 2026-07-30. Anything not verified against code or a cited source is "unverified" (CLAUDE.md Rule 3).*
