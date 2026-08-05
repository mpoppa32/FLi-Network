---
description: Audit the codebase against corsair-ops-truth-v1.md and report CONFIRMED / DRIFTED / UNVERIFIABLE
---

Audit reality vs. the truth doc:
1. Read corsair-ops-truth-v1.md.
2. For each concrete claim (files, functions, paths, integrations, versions), verify it
   against the actual codebase/config.
3. Report three lists: CONFIRMED, DRIFTED (truth doc wrong — propose the fix),
   UNVERIFIABLE (needs a deploy/live check).
4. With my approval, commit the corrected truth doc. Never "fix" reality to match the
   doc — the doc follows reality.
