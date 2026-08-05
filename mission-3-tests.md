# MISSION 3 — First real test suite in `functions/` (local Claude Code session)

ORIENT
Read CLAUDE.md and the corsair-ops truth/log/context docs, confirm read. Run `git pull origin main`
and state the HEAD commit. Check the LOG do-not-repeats — especially 2026-08-05 (clean checkout does
NOT compile; test with `git archive HEAD`, the working tree lies) and the reviewer-subagent lessons.

MISSION (one outcome)
`functions/` gains a real vitest suite covering its highest-value pure logic, `npm test` goes green
locally and in CI, and the workflow runs it between build and deploy — so a push that breaks behavior
(not just compilation) gets a red X before it can ship. This deletes the truth doc's known gap:
"the pipeline currently proves 'it compiles and deploys', not 'it works'."

SPEC
1. SURVEY FIRST. Inventory `functions/src` and pick 3–5 test targets by this rule: **pure or
   near-pure logic, high blast radius, no network/secrets/emulator needed.** Strong candidates from
   the operator's side (validate against the real code before committing to them):
   - `dailyBriefDigest` composition logic — the due-this-week filter, the new OPEN COMMITMENTS
     section, and ABOVE ALL the fact-visibility privilege gate (Owner/Admin vs Analyst,
     default-deny on unresolvable visibility). That gate is security-relevant: a regression leaks
     internal-classified edits into email. Test the fail-safe direction explicitly.
   - `operatorData` request handling — auth acceptance/rejection paths (bad/missing/malformed
     bearer + X-Operator-Token fallback), method gating (POST → 405), entity-match logic,
     response shaping/caps. The 401 contract is what CI's smoke test relies on.
   - `briefSynthesisScoring` — relevance scoring is pure math; pin its behavior.
   - `scripts/atlas-bundle.sh` guards, if cheap via bats or a bash-driven test — otherwise skip;
     shell tests are optional, not the mission.
2. TESTABILITY WITHOUT REFACTORS. Prefer testing already-exported pure functions. Where logic is
   trapped inside a handler, the smallest acceptable change is extracting a pure helper into the
   same file and exporting it — no file moves, no signature changes to deployed handlers, no
   "test-only" behavior branches in production paths. If a target can't be tested without real
   refactoring, drop it and say so rather than distorting the code.
3. RULES FOR THE TESTS THEMSELVES. No network, no Firebase emulator, no secrets, no reliance on
   the gitignored atlasMaster files (tests must pass on a clean public checkout + restored bundle
   alike — i.e., target public modules only). Deterministic (no wall-clock/randomness flakes —
   inject dates). Fast (<60s total).
4. CI WIRING. In `.github/workflows/firebase-deploy.yml`, run `npm test` in the build-deploy job
   after `npm run build` and before any deploy step, for BOTH push and PR events. Remove the
   truth-doc "npm test not wired" gap in the same commit (Rule 6).

PLAN FIRST
Present the survey result and your chosen targets (with one-line why each) before writing tests.
No approval gates needed beyond that — nothing here touches secrets, rules, or production data.
Run the reviewer subagent on the diff BEFORE the first push (LOG lesson d).

CONSTRAINTS
Smallest change that works; truth doc in lockstep; failures to the LOG; no new dependencies beyond
what vitest needs (it's already configured); do not weaken any production code path to make it
testable.

ACCEPTANCE (defines done)
- `cd functions && npm test` → green locally, with a stated test count (target: meaningful coverage
  of the chosen units, not a vanity number).
- Push to main → CI runs build → test → deploy → green run URL captured.
- Negative proof: a branch/PR with a deliberately behavior-breaking change (not a type error — a
  wrong RESULT that compiles) goes red at the test step, evidence verbatim, branch cleaned up.
- The visibility-gate test demonstrably fails if default-deny is inverted (show it once, locally).
- Truth doc updated: known gap removed, replaced by observed test+CI behavior.

REPORT
Commits (SHAs), test count + what each unit covers in one line, the green Actions run URL, the
negative-proof evidence verbatim, reviewer findings, LOG/context updates made.
