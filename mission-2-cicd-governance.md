# MISSION 2 — CI/CD + Governance Machinery (local Claude Code session)

ORIENT
Read CLAUDE.md and corsair-ops truth/log/context. Confirm read. Run `git pull origin main`
and state the HEAD commit. Check the LOG for do-not-repeat entries. (Run this mission only
AFTER Mission 1 — the operatorData endpoint — is complete and merged.)

MISSION (one outcome)
After this session, a push to main automatically deploys backend changes and verifies the
live app — the "merged but not deployed" failure class becomes structurally impossible —
and the four-doc rituals are enforced by machinery, not memory.

SPEC / SOURCES
Draft files ship alongside this brief (drop-in, but VALIDATE each against current tooling
before committing — they were authored offline and may need syntax/version fixes):
- .github/workflows/firebase-deploy.yml   (CI: build + deploy functions/rules on push)
- .claude/commands/ship.md, truth-check.md, postmortem.md   (slash commands)
- .claude/agents/reviewer.md   (adversarial diff reviewer subagent)

PLAN FIRST
Present your plan before changing anything. Two items need my approval before execution:
(1) creating the Firebase service-account credential and adding it as the GitHub secret
FIREBASE_SERVICE_ACCOUNT (walk me through it); (2) any hook that blocks commits (see below).

WORK ITEMS, IN ORDER
1. CI/CD: validate + commit the workflow. It must: trigger on push to main touching
   functions/** or database.rules.json; npm ci + tsc build; deploy ONLY what changed
   (--only functions / --only database); authenticate via the FIREBASE_SERVICE_ACCOUNT
   GitHub secret; fail loudly (red X on the commit). Add a second job that curls the live
   FLiIntel.html and asserts the current P13-marker set is present (deploy-verification).
2. Slash commands: commit the three drafts (adjust to current .claude/commands format).
3. Truth-lockstep hook: implement a pre-commit guard (Claude Code hook or git hook — your
   call, justify it) that warns-or-blocks when a commit touches FLiIntel.html or
   functions/** without also staging corsair-ops-truth-v1.md. Get my approval on
   warn-vs-block before enabling block mode.
4. Reviewer subagent: commit the draft; then demonstrate it by having it review your own
   CI workflow diff before you push.

CONSTRAINTS
Smallest change that works; truth doc in the same commit; failures to the LOG; never
weaken database.rules.json; secrets never committed to the repo.

ACCEPTANCE (defines done)
- A trivial functions change pushed to main deploys itself; the Actions run is green;
  the deploy-verification job passes against the live site.
- A push that breaks the build shows a red X (demonstrate with a deliberately broken
  branch build if cheap, or explain the failure path).
- /ship, /truth-check, /postmortem appear and run in a fresh session.
- The hook fires on a test commit that omits the truth doc.
- Reviewer subagent produced a real review of the CI diff.

REPORT
Commits (SHAs), the Actions run URL(s), acceptance evidence verbatim, anything logged,
and any deviation from the drafts with one-line reasons.
