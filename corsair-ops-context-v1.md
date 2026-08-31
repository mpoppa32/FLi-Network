# corsair-ops-context-v1.md — CORSAIR CONTEXT DOC

*Where we left off and the next move. CONTEXT doc in the four-document AI Operating System (rules: `CLAUDE.md`). Update before you stop (Rule 9). Updated 2026-08-02.*

---

## CURRENT STATE (2026-08-31 — HOSTING MOVED; CORSAIR IS BACK UP)

**Corsair is live and signed-in-verified at `https://mpoppa32.github.io/FLi-Network/FLiIntel.html`.** This is the address now. `flisolutions.io/fliintel` is dead and stays dead until Netlify credits reset.

**What happened:** Netlify paused all three projects on a team credit cap. The GitHub Pages fallback was also dead — a repo-root `CNAME` file 301'd it back to the paused domain. Deleting `CNAME` from the remote fixed it at zero cost. Google sign-in confirmed working; `mpoppa32.github.io` was already an authorized domain in Firebase Auth. Full account in LOG 2026-08-31, including four "do not repeat" items.

**Docs updated in lockstep:** `CLAUDE.md` lines 6 and 8, truth doc Live / Hosting / Outage entries, this doc. **Two retractions recorded:** bandwidth was never verified as the cause, and the "account suspended" reading came from signing in with the wrong email.

### BLOCKED / OPEN — in priority order

1. **UNRESOLVED ROOT CAUSE — which resource burned the Netlify credits.** The usage breakdown was never opened. **This is the single next move: Netlify → Billing → Usage.** Until it is read, the same cap recurs on any metered host. Two unexplained projects (`regal-capybara-3a72ec`, `wonderful-frangipane-c26155`, both 08-13, both showing the Corsair marketing thumbnail) are unaccounted for and were deliberately NOT deleted.
2. **`git pull` owed on the local working copy.** It still holds the deleted `CNAME`; a push without pulling restores it and re-breaks hosting.
3. **Uncommitted in the working tree:** `CLAUDE.md`, `corsair-ops-truth-v1.md`, `corsair-ops-log-v1.md`, `corsair-ops-context-v1.md` (this change), plus `adversarial-verify.js` sitting in the repo ROOT and still owed a move into `.claude/workflows/`.
4. **Atlas-lane ingest — 4 meetings.** Was blocked on Corsair being down; **that blocker is now cleared.**
5. **The 23% transfer cut** (comment/indent strip, ~1.01 MB → ~0.78 MB gzipped) is free, reversible and still untaken. **It is a cost reduction, not a fix** — do not let it stand in for reading the usage breakdown.

### NEXT SINGLE MOVE

**Open Netlify → Billing → Usage and read what consumed the credits.** Everything else about hosting is guesswork until that number is on the page.

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

## CURRENT STATE (2026-08-25 — THE SWEEP RAN; relay 020 executed end to end)

**Steps A-E of relay 020 are complete. Three commits on `main`, UNPUSHED, awaiting Mike's word.**

- **The sweep is DONE: 54 archived, 54 VERIFIED, 0 unverified**, Atlas `1777435779676` (confirmed from live `info/name`, not from a doc). Archive-never-delete: `archivedAt` + `archivedNote` only, no `done` (the rule cannot know work was *finished*), no nulls, one multi-path update scoped below the workspace root. **Idempotent, proven both ways** — same manifest re-run archives 0 and throws nothing; a regenerated manifest selects 4 (demo only) / archives 0. **AUDIT TEST `1779914425960-rwmlx` excluded and confirmed untouched.**
- **The count moved 41 → 54 by AGING ONLY.** Atlas is unchanged at 592 meetings / 359 action items; the newest meeting is dated **2026-08-03**. Relay 020's premise that a week of new meetings had landed is false — every meeting it named is from June/July. **Nothing has been ingested for three weeks** (see LOG).
- **⚠ THE BRIEF IS NOW WORSE IN ONE SPECIFIC WAY.** The 118-day April block is gone as intended, but **the top 4 of 8 HIGH PRIORITY ACTIONS are now the synthetic AUDIT TEST items** (68-81d, fabricated people). Correct behavior, unacceptable output. This is the cost of the exclusion decision arriving, and it makes the synthetic cleanup urgent.
- **Answer to relay 020's `[CONTEXT]` question: DELIBERATE, and it should stay.** The `[TAG]` prefix takes five distinct values (`PURSUIT / ADVERSARY / CUSTOMER / CAPABILITY / CONTEXT`) — it is real per-item classification in the layer the three LLM consumers read, so the HTML's "a label on 100% of items carries no information" rationale does not transfer. It was flagged upstream for an explicit call, never overridden, and is pinned by test. Not missed.
- **New this session:** the refusal is now disclosed in the brief (19 items, both MIME parts, one shared wording); `scripts/sweep-manifest.mjs` and `scripts/sweep-action-items.mjs` are committed with `sweep-manifests/` gitignored; a timezone-fragile hazard test is fixed. **233 tests green, `tsc` clean.**

### RELAY 021 EXECUTED (2026-08-25, later session)

- **PUSHED + CI GREEN.** `8f84a34..0c75c6e` (the three authorized hashes) — run [#32815436343](https://github.com/mpoppa32/FLi-Network/actions/runs/32815436343) **success on all three jobs**, step order observed from the jobs API rather than assumed: `Install + build functions` → `Test functions` → `Auth` → `Deploy` → `Post-deploy smoke` → `verify-live`. The marker-diagnostic step correctly **skipped** (it only runs on a hash mismatch).
- **INGEST HEARTBEAT BUILT** (`992c32b`) — see the truth doc section. `meta.date`, warn past 7 days, both MIME parts, never omitted. **Parser contract consolidated: it is now TWELVE keys** (9 header-shaped + 3 line-shaped), and the list had drifted into three places while still calling itself "the ten keys". 245 tests green.
- **SYNTHETIC CLEANUP MANIFEST BUILT** (`e56503f`) — read-only, no deleter written. **3 delete / 3 keep / 0 dangling links / 0 commitments.** Anduril was SPARED by the conservative rule and the three reasons are in the truth doc; that is the case worth reading before approving anything.

### RELAY 022 EXECUTED (2026-08-25)

- **PUSHED, CI GREEN** — run [32819852788](https://github.com/mpoppa32/FLi-Network/actions/runs/32819852788), all three jobs success (build → test → auth → deploy → smoke → verify-live). **The heartbeat and the refusal line are now LIVE.** Deviation logged: three commits went up, not two (`cfa5d2b`, docs-only, rode along on `git push origin main`).
- **HARD DELETE EXECUTED** — 4 of 4 paths, 3 of 3 KEEP nodes intact, 0 dangling links, capture taken and verified first. Atlas 592 → **591 meetings**, 359 → **354 action items**. Ledgered in the truth doc as the documented exception to archive-never-delete.
- **ALL THREE ACCEPTANCE CRITERIA CONFIRMED at the data layer** (the 11:00 UTC send is the operator's to read): HIGH PRIORITY ACTIONS' top 8 are now **all real meetings** — no April block, no synthetic items; refusal count **19**; heartbeat **"Newest meeting in Corsair: 22 days old", warn = true → amber**. Its first appearance is a warning, as predicted.

### RELAY 023 (2026-08-25) — push done, repair BLOCKED

- **`814a3cd` pushed by hash** (`git push origin 814a3cd:main`), nothing else — the do-not-repeat applied. **`firebase-deploy` correctly did not run:** the commit touches only `scripts/*.mjs` and `*.md`, neither in the workflow's `paths:` filter, and it contains no deployable code. The heartbeat deployed on `cfa5d2b` already.
- **REPAIR BUILT, GATED, DRY-RUN CLEAN — NOT EXECUTED.** Blocked on **expired Firebase CLI credentials**. Two attempts failed at the write with three different-looking errors from one cause; **all three arrays re-read and byte-identical to before (6 / 26 / 1, dead id present)**. Nothing partial landed.

### REPAIR EXECUTED 2026-08-26 — THE CLEANUP ARC IS CLOSED

Reauth by Mike, then one re-run. **3 of 3 nodes repaired and independently re-verified outside the script; 0 residual references to the deleted meeting or nodes across all five surfaces** (nodes 2778 · links 73 · opportunities 512 · commitments 73 · meetings 591). `Anduril`'s `meetings` key is absent, as predicted and as asserted; its other 17 fields and its `"Anduril — Motor supply"` opportunity are intact.

### NEXT MOVE (2026-08-26)

1. **CHECK MEETING CAPTURE — now a much narrower question than "the ingest".** The OSINT connectors are **demonstrably alive** (3 new org nodes written 2026-08-25, opportunities 509 → 512). It is **meeting capture specifically** — Otter / Gmail / Calendar — that has produced nothing since **2026-08-03**. Start there, not at the pipeline as a whole. The heartbeat now reports the gap in amber every morning but cannot say why.
2. **STILL OWED — the operator-facing half.** No UI in `FLiIntel.html` to tick an action item done; the sweep is still the only writer of those fields.
3. **Push the repair-execution docs commit** — needs Mike's word (`ef07cec` was authorized and pushed; the follow-up recording execution is separate).
4. **Forward note (relay 023):** when meeting capture resumes, the heartbeat ticks down on its own and the sweep generator's counts will move. That is real data arriving, not drift.

### SUPERSEDED NEXT MOVE (2026-08-25, after relay 022)

1. **THREE DANGLING MEETING REFS — Mike's call.** `Atlas`, `Mike Poppa` and `Anduril` still list the deleted meeting id in `node.meetings`; Anduril's array now points *only* at it. Reported, not repaired, because repairing means writing to KEEP nodes. Needs a decision and, if yes, its own tiny scoped fix.
2. **CHECK THE INGEST — still the biggest open item.** Newest Atlas meeting is 2026-08-03. From the next brief onward the heartbeat says so in amber every morning, but it does not say *why*. Open on Mike's side: meetings since Aug 3 that never got captured?
3. **STILL OWED — the operator-facing half.** No UI in `FLiIntel.html` to tick an action item done. The sweep remains the only writer of those fields.
4. **Push the deleter commit** — needs Mike's word like every other push.

### SUPERSEDED NEXT MOVE (2026-08-25, earlier session)

1. **MIKE'S DELETE DECISION on the synthetic cleanup manifest.** Regenerate it in-session before acting (60m freshness contract) — the one in `sweep-manifests/` is already stale by the time this is read. On a yes, the deleter gets written with the same gate discipline as the sweep. **Read the Anduril entry first**: it is kept because a live BD-generated opportunity points at it, and whether that opportunity is itself synthetic-derived is a judgement the script deliberately does not make.
2. **PUSH `992c32b` + `e56503f` — needs Mike's word.** Relay 021 authorized three specific hashes and these are not among them. The heartbeat does not reach production until they ship.
3. **CHECK THE INGEST.** Newest Atlas meeting is still 2026-08-03. The heartbeat makes it visible from the next brief onward, but it does not answer *why*. Open on Mike's side: has he had meetings since Aug 3 that never got captured?
4. **Verify the 11:00 UTC brief** — Cowork operator owns this. The sweep effect is already live (the archived-exclusion deployed 08-18); **the refusal line and the heartbeat are NOT live until #2 ships.**
5. **STILL OWED — the operator-facing half.** No UI in `FLiIntel.html` to tick an action item done. The sweep remains the only writer of these fields.

## PRIOR STATE (2026-08-11 — staleness audit; the queue was re-ordered by relay 012)

**Read-only audit done, nothing archived, nothing deployed.** Full findings in **`corsair-staleness-inventory-v1.md`** (committed) and summarized in the truth doc's new STALENESS section. Headlines:

- **`stale=15` / `aged=330` in the brief telemetry are OPPORTUNITY metrics, not commitments** — `brief.js:261-335` (no meeting ≥14d) and `pipeline.js:155-165` (`daysInStage > stage ageLimit`). Four staleness notions coexist; only commitments had an owner.
- **Commitments need no change.** `isStale`'s 7-day-overdue rule for dated items is already stricter than Mike's 21 days, and the live >21d count is **0** of 51 open. Relay 012 ruled: **DO NOT TOUCH `isStale`** — changing a working selector with 29 tests to fix a problem it does not have is scope creep.
- **43 action items are 42-105 days overdue** (28 high / 15 medium, 7 meetings) with nothing surfacing them at any cadence. **4 of the 43 are synthetic** (`AUDIT TEST — DARPA TTO Capabilities Brief`) → delete as demo data, not archive. Real count is **39**.
- **THE FINDING OF THE DAY: action items have no completion field.** All 359 carry only `context/deadline/owner/priority/task` — no `done`, no `status`. `isOpenActionItem()`'s `done` test can never be true-negative, every action item is permanently "open", and Mike has never had a way to mark one finished. **The 43 are not provably abandoned; some are probably done with nowhere to say so.**
- **79% of action-item deadlines are free text** and `Date.parse` invents dates for them (`"Phase 1"` → 9,352 days overdue). Any date logic here needs a strict ISO prefix.

## NEXT MOVE (as of 2026-08-11 — sequence set by relay 012; DO NOT REORDER)

**Nothing archives until Mike answers.** The list is captured (session-local, with record paths); the sweep is last, not first.

1. **P13.402 commit 2 — BUILT 2026-08-11, test-verified, UNPUSHED.** It had been described upstream as "built, unpushed" **twice** (relays 012 and 013) while the tree was clean and `origin/main..main` empty — it had never been written. It is now genuinely built: the mid-word 90-char plaintext slice is replaced by `trimWords(…, 400)`, 192 tests green, `tsc` clean, non-vacuity proven (restoring `.slice(0, 90)` turns 4 red), plaintext golden re-captured with its one-line diff read first. **The `[TAG]` prefix was deliberately NOT removed** — it carries five varying category values, so it is real metadata for the LLM consumers of the plaintext, and the HTML's "a label on 100% of items carries no information" rationale does not transfer. That is flagged upstream for an explicit call, not silently actioned.
2. **Completion fields on action items — BUILT 2026-08-12, test-verified, UNPUSHED.** `jobs/actionItemArchive.ts`: `parseIsoDate` (never calls `Date.parse`), `isStaleActionItem` (pure, fail-safe, idempotent), `actionItemArchiveNote` (states rule/date/authority/reversal, and says time-based rather than abandoned). `isOpenActionItem` extended to exclude archived items at the shared predicate. **216 tests green (+24), `tsc` clean, both contracts proven non-vacuous** (Date.parse fallback → 6 red; bare `!a.done` → 2 red). The `"Phase 1"` regression is pinned by execution.
   - **STILL OWED: the operator-facing half.** There is no UI in `FLiIntel.html` for Mike to mark an action item done. The fields exist and the backend honours them, but until that ships the sweep is the only writer and the finding is half-closed. Not deferred silently — this is the next build after the sweep.
3. **THEN the sweep — 41 records.** On Mike's authorization (given: *"and sweep those"*), manifest first, archive-never-delete, verify after and report the **verified** count.
   - **The count moved 39 → 41, and the reason is a caught defect, not a data change.** Manifest v1 was generated by the ad-hoc audit script, which required `Date.parse` to succeed on top of the shape match; the shipped `parseIsoDate` never calls `Date.parse` and correctly reads two more values (`"2026-05-25 to 2026-05-27"` 79d, `"2026-06-08 week"` 65d). **Manifest v2 is generated by importing the shipped selector** (`functions/lib/jobs/actionItemArchive.js`) so the artifact and the action cannot drift. Current: **45 selected / 41 to archive / 4 excluded**, `swept: false`, `verifiedCount: null`.
   - The 4 `AUDIT TEST` items are **EXCLUDED, not deleted** (relay 014, quoted verbatim in 016) — archive-never-delete governs them too.
4. **QUEUED — synthetic-data cleanup, Mike's decision, meeting AND graph nodes together.** Deleting the AUDIT TEST meeting alone would leave its fabricated people in the node graph: a cleanup that looks complete and is not. Needs its own manifest.
5. **QUEUED — the ingest emits free-text deadlines.** 263 of 359 carry no ISO date at all and 19 more embed one in prose. Until extraction emits ISO (or an explicit null), 8 genuinely-overdue records are unsweepable by design.

## PRIOR NEXT MOVE (as of 2026-08-06 — a live operator-blocking bug was then top of the queue)

0. **MISSION 4, ITEM #4 — FIXED as P13.398, DEPLOYED + BYTE-VERIFIED 2026-08-06** (run [#8](https://github.com/mpoppa32/FLi-Network/actions/runs/31081715020); live sha256 matches repo, `P13.398` present in served bytes, old hang absent). Wedge path accepted on harness evidence (18/18; pre-fix code proven to hang under identical stubs). **A clean live PROCESS run is a happy-path regression check ONLY — it is not wedge acceptance**, because the old code also worked on a healthy network. **If `.lp` starts 503ing during the Otter backlog, capture the surface behavior — that IS the wedge acceptance:** toast, `console.error` naming both REST and SDK paths, header `error` (not stuck on `saving`), and a `persist_error` record in `pipelineHealth`, all triggered by the 8s clock. **Expect loud failures, not smooth ingest** — the fix makes a wedge fail visibly; it does not make writes succeed through one.
   *(superseded status line)* **harness-verified 18/18, LIVE ACCEPTANCE OWED (unpushed at time of writing).** `fbSet`/`fbRemove`: REST authoritative, SDK raced against an 8s timeout, `getIdToken`/`fetch` deadlined, failure surfaced via sync state + `console.error` + `persist_error` + toast, then thrown so the process path's `try/catch` fires. `node scripts/fbwrite-harness.mjs` → 18/18; the pre-fix code under the same stubs returns `HUNG` with zero errors and zero health events. **Owed:** confirm in Mike's browser during a real wedge that PROCESS now fails loudly instead of stalling — and then re-run the 20-meeting Otter backlog. Details below and in TRUTH / LOG 2026-08-06.
   *(original diagnosis, kept for the record)* **MEETING PROCESSING HANGS FOREVER ON A WEDGED SOCKET. Operator-blocking.** Reproduced twice 2026-08-06: PROCESS → "Analyzing" forever, no error, no console, **zero requests to `anthropicProxy`**, RTDB `.lp` 503 throughout.
   **Verified root cause (corrected from the handoff, which said reads — it is a WRITE):** `fbSet` (`FLiIntel.html:12687-12692`). Line `12689` fires SDK `set()` fire-and-forget; line `12690`'s REST `PUT` returns early **only on `_r.ok`**, so a 503 falls through; line `12691` then awaits the hung SDK promise from 12689 — never resolves, never rejects. `saveMeeting` (`13080`) is the first await in the process path (`26431`), so nothing downstream runs and the `try/catch` at `26430-26436` cannot fire. Fixing reads would NOT have fixed this.
   **Fix:** apply the CT-1b/P13.397 pattern — never `await` the SDK promise as the durable path; treat a non-ok REST response as a failure to **surface**, not a reason to fall back to the hung path; timeout any remaining SDK await; surface processing errors to the UI (silence is the bug). Prove it with a wedge-simulating harness before deploy — `scripts/ct1b-harness.mjs` is the working model. Note CT-4's `persist_error` is blind to hangs (it is in a `catch`), so pipeline health records nothing here either.
1. **MISSION 4, ITEM #5 — BUILT 2026-08-06 (`commitmentsAutoArchive` + P13.400).** Job at 04:30 UTC, pure `isStale(item, now)`, archive-never-delete via a 3-field multi-path update, digest line `ARCHIVED N STALE (>30d, unscheduled)` counted from the records (manual archives excluded), and the three deny-list leak sites patched in the same commit. **173 tests green** (+39). **Owed after deploy:** the job archives nothing today (zero qualify on live data) so there is nothing to observe on the first run — confirm instead that the 04:30 run **logs `job_completed` with `totalArchived: 0` and does not throw**, and that the brief is unchanged. First real behavior will appear only when a commitment ages past 30d unscheduled. *(original ticket below for reference)*
   **`commitmentsAutoArchive` nightly job** (ticket: Mike 2026-08-06). Scheduled Firebase function, admin SDK (the only thing that writes headlessly), patterned on `briefSynthesisNightly`. Per-workspace, no hardcoded IDs. Rule: open commitments created >30d ago with **no deadline OR overdue >7d** → `status:'archived'` + `archivedAt` + `archiveNote`. **Never delete.** The daily brief MUST report it when N>0 — one line, `ARCHIVED N STALE (>30d, unscheduled)` — nothing vanishes silently (Rule 11). Staleness selector extracted as a pure exported function, tested Mission-3 style.
   - **Field convention CONFIRMED against the live precedent** (2 records archived 2026-08-06, Atlas): `status:"archived"`, `archivedAt` ISO string, `archiveNote` string, and the original fields left untouched (`closedNote` stays `""`, `deadline` and `created` preserved). Precedent note text: `Auto-archive policy (Mike, 2026-08-06): >30d old and overdue — stale. Reversible: set status back to open.`
   - **RULE — DECIDED 2026-08-06 (Mike).** The **specced rule is authoritative**: `status==='open' && created >30d ago && (no deadline OR overdue >7d)`. The two precedent records (43d old, only **1 day** overdue) were a **one-off Mike approved directly** and do **not** define the standing rule; their original `archiveNote` wording was the operator session's error (its correction #7). **Their notes were patched 2026-08-06** to read: *"Manual exception, Mike-approved 2026-08-06 (archived at 1d overdue). NOT the standing auto-archive rule, which requires >30d old AND (no deadline OR overdue >7d). Reversible: set status back to open."* — `status`/`archivedAt` untouched, tally unchanged (47 open / 2 archived / 4 fulfilled / 16 completed). The job's own note text must match the real rule: `auto-archived: created Nd ago, overdue Md`.
   - **⚠ LIVE DATA: the job archives ZERO items today, under every reading.** Measured on Atlas 2026-08-06: 47 open, **all 47 dated, 0 undated, 0 overdue** (earliest deadline 2026-08-06, latest 2026-08-28; 42 are >30d old). So acceptance canNOT be "it archived N on live data" and the brief's `ARCHIVED N` line will not render today. **Test with synthetic fixtures** — which is what the pure-selector requirement already sets up. (Contrast with 2026-08-05's snapshot of 65 open / 16 undated: Mike has since dated or closed the whole undated tail.)
   - **AGREED 2026-08-06:** the three deny-list fixes ship in the **same commit** as the job, and acceptance is by **synthetic fixtures** (zero live blast radius, measured and agreed).
   - **⚠ UI TOLERANCE: "believed safe" is FALSE — 3 real leak sites.** Allow-list filters (`status === 'open'`) are fine, and so is the entire backend (`sortOpenCommitments`, the digest, `operatorData` all use allow-lists). But three **deny-list** sites exclude only completed/fulfilled/broken/closed, so archived rows keep rendering as active:
     - `33971-33984` (timeline/Reckoning) — uses `c.deadline`, so an archived past-due item is pushed as **`sev:'critical', kind:'OVERDUE'`**. Checkable right now: the 2 already-archived items should be showing as critical OVERDUE.
     - `24141-24148` (opp dossier, org commitments) — no date requirement, archived rows appear.
     - `45672-45674` (opp dossier, commitments by `sourceMtgId`) — same.
     Add `'archived'` to those three deny-lists **in the same commit as the job**, or archiving will look broken to the operator.
   - **Separate latent bug found while checking (NOT part of this ticket):** three other commitment filters — `45296-45300` (Resolve overdue), `45345-45349` (due soon), `45473-45476` — gate on `c.due`, but Atlas records carry `c.deadline`. Those three "next best action" features are **inert on real data** and always have been. **Queued as its own item after #3** (agreed 2026-08-06); do not fix drive-by.
1b. **CLEANUP — DONE 2026-08-06 (operator).** The stranded PA-RFP `pending` record was pre-existing (`…335zn` 05:01, `done` twin `…etcwd` 05:05); the backlog run had added a **third** copy (`…5yjhm` 08:26) that a `processingState` sweep could not detect because it looked healthy. Operator deleted the stranded pending **and** the duplicate, keeping the pre-existing `done` original. Store 594 → 592. See LOG for the do-not-repeat on duplicate-hunting after a hang fix.
2. **MISSION 4, ITEM #6 — DONE as P13.399** (both one-liners shipped: `window.onNotesInput`/`window.updateCC` exported, and `_fbWriteFailed`'s toast `catch(_){}` replaced with `console.warn` + warns for unavailable-toast and un-recordable health event). Harness extended to cover the new branches: **21/21**. **Owed (operator, seconds):** after the deploy and a hard refresh, (a) type in the transcript box — the char counter should update and the console stay clean; (b) confirm a write-failure toast is visible at the **bottom** of the viewport, remembering it is a single shared element that later toasts overwrite. `FLiIntel.html:9484` inline `oninput` → module-scoped function never exported. One line: `window.onNotesInput = onNotesInput; window.updateCC = updateCC;`. The four sibling handlers on the same element are already exported (`25941-25956`) — this is the only one missed. P13.391's pattern; see LOG 2026-08-06.
3. **MISSION 4, ITEM #3 — `operatorData.ts:292` builds `openActionItems` WITHOUT filtering `done`.** The field named *open* includes completed work, so the headless operator layer reads finished items as outstanding. Found while shipping #1; deliberately not fixed drive-by. **Its fix must reuse or mirror the `done`-filter semantics shipped in `selectHighPriorityActions`** so the digest and the endpoint cannot drift apart on what "open" means — and it has `operatorData.test.ts` to extend.
3b. **GOVERNANCE-AS-MACHINERY MISSION — SCOPE REDUCED 2026-08-07 after verification.** The brief (from `two-agent-operating-model-v1.md` §4) proposed four pieces; **three already shipped in Mission 2 (P13.395)** and were re-verified 2026-08-07: `.githooks/pre-commit` guards `FLiIntel.html|functions/` unless the truth doc is staged (docs-only commits pass inherently, since the guard only fires on runtime paths); `.claude/commands/{ship,truth-check,postmortem}.md` all exist with real procedures; `.claude/agents/reviewer.md` exists, is read-only, and has a written verdict on its first real diff (three genuine bugs caught pre-push — LOG 2026-08-05). Mike owned the duplication operator-side (ledger #9). **Remaining scope, all of it:**
   - **(a) Enforcement by COMMITTED default, not per-clone config.** `corsair.truthlock` currently defaults to `warn` inside the hook and is set per clone — so flipping it here would not bind Bryce or a fresh clone. Change the hook's own default to `block`. **Acceptance:** it demonstrably refuses a runtime commit missing the truth doc (only WARN has ever been demonstrated — the 2026-08-05 record shows it firing and *allowing*), and a docs-only commit still passes untouched.
   - **(b) Exercise `/ship` end-to-end on a docs-only change.** The commands exist; there is no evidence any has been *run*. Same "exists ≠ works" distinction Mission 3 drew for the test suite.
   - **(c) Model-routing paragraph — MEASURE FIRST.** Where extraction vs synthesis calls split across the proxy's ~14 call sites, for a later Haiku-routing decision. Design only, no build. Do not write the paragraph from plausibility; count the call sites first (Rule 3).
4. Consider a `production` GitHub Environment if the collaborator set ever grows past Mike + Bryce (see the accepted-risk note in the truth doc).
5. **Re-point the Cowork operator session to the rotated `OPERATOR_API_TOKEN`** — it was rotated 2026-08-05 (version 2) and anything still holding the old value gets 401. Read the current value with `firebase functions:secrets:access OPERATOR_API_TOKEN`; never paste it into a command that will be captured as a permission rule (LOG 2026-08-05).

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
