# corsair-ops-log-v1.md — CORSAIR LOG DOC

*Everything tried — especially what FAILED. LOG doc in the four-document AI Operating System (rules: `CLAUDE.md`). The most valuable doc and the one that's easy to skip (CLAUDE.md Rule 7). Before proposing any approach, check the "do not repeat" entries below. Seeded 2026-07-30.*

**Entry format:**
```
### [date] — <short title>   [FAILED | LANDED | SUPERSEDED]
```

---

### 2026 (pre-seed) — Browser-side Anthropic API key   [FAILED / SUPERSEDED]
Each user pasting their Anthropic key into the browser was exfiltratable (finding **P13.124**).
DO NOT REPEAT: All Claude calls go through the `anthropicProxy` Firebase Function; key in Secret Manager.

### 2026-07-30 — Four-doc governance described but never committed   [FIXED 2026-08-02]
Plan said the Corsair four docs were "seeded"; repo had none. Now committed to the repo root (`8495444`).
DO NOT REPEAT: A doc isn't "integrated" until committed to the repo and verified present.

### 2026-07-30 — Auto-link sync silently dead (nested-scope bug)   [FIXED — P13.391, LIVE + VERIFIED 2026-08-02]
`autoSyncLinks`/`undoAutoLinks`/`retroLinkAll` were nested inside `autoSyncEnts`; top-level calls threw a `ReferenceError` swallowed by `[P13.300]` catches → links never auto-created.
FIX P13.391: hoisted to top level. Live (`c811e72`); `window.retroLinkAll` is a function at page load; `pipelineSelfTest()` 9/9.
DO NOT REPEAT: Don't define functions inside `autoSyncEnts` that are called at top level.

### 2026-08-01 — "Won't sign in" debugged before checking 2FA   [FAILED / LESSON]
Chased cache/Brave/incognito and cleared site data; real cause was Google 2FA with no phone (on a plane), and clearing data logged Mike out.
DO NOT REPEAT: On any "won't sign in," FIRST confirm the user can complete auth (2FA/phone) before clearing cache/cookies.

### 2026-08-02 — "Merged" ≠ deployed: wrong file uploaded 3× (download-name collision)   [FIXED / LESSON]
P13.391 "merged" twice but both uploads were the wrong bytes — Mike's Downloads already had a `FLiIntel.html`, so re-downloads saved as `FLiIntel_3/_4.html`; GitHub adds a new file unless the name matches exactly, so `FLiIntel.html` never changed.
FIX: uploaded the correctly-named file directly via the browser, committed to `main` (`c811e72`); verified bytes + live + running functions. Strays deleted.
DO NOT REPEAT: (1) verify deployed bytes/marker — never assume "merged" = live. (2) A GitHub upload replaces only on exact filename match.

### 2026-08-01/02 — CT-1 + CT-2/CT-3 built (integrity tier)   [BUILT + LIVE + VERIFIED]
CT-1/P13.392 (pipeline-health recorder + `pipelineHealthReport()`), CT-2/P13.393 (`checkPipelineInvariants`), CT-3 (`pipelineSelfTest()`). Backend-free. Live (`c811e72`); self-test 9/9.

### 2026-08-02 — CT-4 persistence instrumentation   [BUILT — LIVE pending verify]
The write layer swallowed failures: `fbSet` (writes) and `fbRemove` (deletes) throw on total failure, but many callers `.catch(function(){})` or `catch(e){}` them → a failed save = silently lost graph data.
FIX P13.394 (CT-4): instrument the two persistence choke points — `fbSet`/`fbRemove` now call `recordPipelineEvent('persist_error', {stage, path, error})` at the failure point, so every silent write/delete-loss is captured at the buffer + console. Recorded but NOT toasted (network-wedge write failures would spam). +572 bytes, purely additive; brace/paren balanced; recorder region `node --check` clean.
DO NOT REPEAT: don't add a new write path that bypasses `fbSet`/`fbRemove` without the same instrumentation.

### 2026-08-05 — Spec premise "all open commitments are undated" was WRONG   [ASSUMPTION CORRECTED]
`corsair-operator-endpoint-spec.md` (Piece A) claimed the digest's DUE-THIS-WEEK block is "always empty" because every open commitment lacks a deadline. Measured against live Atlas before building: **65 open, 49 WITH a deadline, 16 without, 33 matching the 7-day filter.** The block was rendering fine — capped at 10. The genuine gap was different: only 10 of 65 open commitments were ever visible.
The OPEN COMMITMENTS section still shipped (it closes the real 65-vs-10 gap), but the stated rationale was false.
DO NOT REPEAT: measure the data before accepting a spec's claim about it — a plausible diagnosis in a handoff doc is still unverified.

### 2026-08-05 — `Authorization: Bearer` 401'd on a freshly-created gen2 function   [RESOLVED / TIMING]
First call to the new `operatorData` with a VALID bearer token returned an HTML `401 Unauthorized` from `Google Frontend` (`www-authenticate: Bearer error="invalid_token"`) on the `*.cloudfunctions.net` URL — the request never reached the handler. Same call with NO header correctly hit the handler (JSON 401), proving the function was public and the code was fine. The direct `*.run.app` URL accepted the bearer immediately.
CAUSE: the `allUsers` invoker binding hadn't propagated on the just-created function, so the front end still tried to verify the bearer as a Google IAM identity token. It resolved on its own; the `cloudfunctions.net` URL now accepts bearer normally.
Kept an `X-Operator-Token` header as an accepted fallback (same shape as `draftingFacts`' `x-bridge-key`) so a future propagation lag or IAM change can't strand the caller.
DO NOT REPEAT: on a NEW gen2 onRequest function, don't redesign the auth scheme off one 401 — check whether the handler is reached at all (send no Authorization header; a JSON error = your code ran) and retry after IAM propagation.

### 2026-08-05 — Spec acceptance test referenced an entity that doesn't exist   [SPEC ERROR]
`corsair-operator-endpoint-spec.md` acceptance test 3 said `&entities=Ikeuchi` should return "an ACSL/Ikeuchi dossier." Neither "Ikeuchi" nor "ACSL" appears in `nodes` in ANY of the three workspaces (1777434950454, 1777435779676, 1785637811753) — the endpoint correctly returns `entities: []`.
Substituted real Atlas entities (Rick, Tom Baron, Bill Allen, Cameron Chell) to verify the dossier path; all return meeting counts, last meeting, stance, and open action items.
DO NOT REPEAT: verify an acceptance test's fixture data exists before treating an empty result as a bug in the code.

### 2026-08-05 — Mission 2 CI/CD: the public repo cannot build itself   [BLOCKER / RESOLVED]
The Mission 2 brief assumed a GitHub Actions checkout could `npm ci && npm run build`. It cannot. `.gitignore` excludes 7 `atlasMaster` files (private Sheet IDs / customer names; the repo is PUBLIC) that `functions/src/index.ts` and four other tracked modules import. Proven, not assumed: `tsc` on `git archive HEAD` → **14 errors, 8 × TS2307**. The drafted workflow, committed as-is, would have gone red on every push forever.
FIX: CI restores them from the `ATLAS_MASTER_BUNDLE` secret and verifies against the committed `functions/atlasMaster.sha256` sentinel (Mike's addition — without it an edited private file leaves the secret silently stale and CI deploys old config forever).
DO NOT REPEAT: before wiring any CI that builds this repo, remember a clean checkout does NOT compile. Test with `git archive HEAD` into a temp dir, never with the working tree — the working tree has the private files and will lie to you.

### 2026-08-05 — Reviewer subagent caught three real bugs in the CI diff pre-push   [LANDED / LESSON]
First run of the new `.claude/agents/reviewer.md`, against its own author's staged diff. Three findings that would each have shipped a green-but-wrong pipeline:
1. **Silently-skipped deploy.** Deploy target was computed with `git diff HEAD^ HEAD` — only the LAST commit — while GitHub's `paths:` filter spans the whole push. A push of *[commit A: `database.rules.json`, commit B: `functions/x.ts`]* would have deployed functions and skipped the rules change, green. Fixed to `github.event.before…github.sha`.
2. **Vacuous live check.** The workflow's `paths:` filter listed only backend paths, so the `FLiIntel.html` byte-equality assertion could never fire on a front-end-only push, and passed trivially on backend pushes because the file was unchanged. The headline check tested nothing. Fixed by adding front-end paths.
3. **Swallowed failure in the integrity script.** `list_files()` in `scripts/atlas-bundle.sh` ended in `… done | LC_ALL=C sort`; the pipeline ran the loop in a subshell, so its `exit 1` on a missing file exited only the subshell and the function returned *sort's* status — always 0. `sentinel` and `bundle` would have emitted TRUNCATED output with exit 0. A Rule 11 violation inside the guard whose only job is integrity. Fixed (accumulate, sort last, `return` not `exit`) and negative-tested.
Also caught: the truth-doc section stated never-executed behavior in the present indicative (Rule 2), and cited `index.ts` as naming files it does not name.
DO NOT REPEAT: (a) never compute a CI deploy target from `HEAD^` — use the push range. (b) a `paths:` filter that excludes the artifact a job asserts on makes that job vacuous; check that every assertion can actually fail. (c) never end a guard function in a pipeline — the subshell eats its exit status. (d) run the reviewer BEFORE the first push, not after; all three were free to fix at that point.

### 2026-08-05 — First CI deploy failed: Cloud Billing API disabled on the project   [RESOLVED]
Run #1 of `firebase-deploy` (commit `80b1a9a`) went red at the `Deploy` step. Everything upstream was green — bundle restored, sentinel verified, `tsc` clean on a clean checkout, service-account auth accepted, predeploy build run, source packaged (1.53 MB), nine APIs auto-enabled. Then:
`Error: Request to https://cloudbilling.googleapis.com/v1/projects/fli-network/billingInfo had HTTP Error: 403, Cloud Billing API has not been used in project 51164371993 before or it is disabled.`
CAUSE: `firebase-tools` reads billingInfo as a preflight (gen2 functions need Blaze). The API had simply never been enabled on the project — this is API *enablement*, not a service-account role, and the message misleads toward an IAM fix. It aborted **before creating, updating or deleting any function**, so production was untouched. Enabling the API in the console fixed it; run #3 deployed 77 functions green.
DO NOT REPEAT: on a 403 from a `*.googleapis.com` preflight, read the message for "has not been used in project … before or it is disabled" — that is a disabled API, fixed in the API Library, NOT a missing role. Don't start granting IAM roles.

### 2026-08-05 — Mission 2 acceptance evidence   [LANDED]
All four acceptance criteria demonstrated, not asserted:
1. **Push-to-deploy** — run [#3](https://github.com/mpoppa32/FLi-Network/actions/runs/30993064184), commit `50257ad`, comment-only functions change → 77 × `Successful update operation` incl. `operatorData` and the three gitignored `atlasMaster*` functions. Independently re-verified from the shell: `operatorData` bad token → 401.
2. **Red X on a broken build** — PR #3, run [#2](https://github.com/mpoppa32/FLi-Network/actions/runs/30991964859): `Error: src/ciRedXDemo.ts(5,9): error TS2322: Type 'string' is not assignable to type 'number'. / Error: Process completed with exit code 2.` `Auth`/`Deploy`/smoke all **skipped**, confirming a PR cannot reach production. Branch deleted, PR auto-closed unmerged.
3. **Hook fires** — a `functions/src/index.ts` commit without the truth doc staged printed the LOCKSTEP GUARD banner and (WARN mode, Mike's Gate 2 answer) allowed the commit. Fired again organically on `50257ad`.
4. **verify-live** — green on runs #1 and #3; live `FLiIntel.html` sha256 independently confirmed equal to main's (`35912cfa…`).

---
*Log doc v1 — updated 2026-08-05.*
