---
description: Ship staged work properly — lockstep truth doc, checks, commit, CI watch, live verify
---

Ship the staged work properly:
1. Confirm the working tree contains only the intended change (`git status`, `git diff`).
2. If code changed what is real, verify corsair-ops-truth-v1.md is updated and staged in
   the SAME commit; if not, update it now (Rule 6).
3. Run the relevant checks (functions: `npm run build`; front-end: the region syntax
   checks; note results). Note: `npm test` currently has no test files and exits 1 —
   that is a known gap, not a regression.
4. If the change touched any gitignored private atlasMaster file, refresh BOTH the
   sentinel and the secret — `scripts/atlas-bundle.sh sentinel` (commit
   functions/atlasMaster.sha256) and `scripts/atlas-bundle.sh bundle` (update the
   ATLAS_MASTER_BUNDLE GitHub secret). Refreshing only one makes CI fail loudly;
   refreshing neither makes CI deploy stale config.
5. Commit with a P13.x-prefixed message; push to main.
6. Watch the CI run; report the run URL and outcome. If CI is red, stop and diagnose —
   do NOT re-push blind.
7. Verify the live artifact (curl the deployed function or the live page marker). The
   verify-live job also asserts the live FLiIntel.html bytes equal main's bytes.
8. Append a one-line entry to corsair-ops-context-v1.md describing what shipped.
