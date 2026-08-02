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
Plan said the Corsair four docs were "seeded"; repo had none. Now committed to the repo root.
DO NOT REPEAT: A doc isn't "integrated" until committed to the repo and verified present.

### 2026-07-30 — Auto-link sync silently dead (nested-scope bug)   [FIXED — P13.391, LIVE + VERIFIED 2026-08-02]
`autoSyncLinks`/`undoAutoLinks`/`retroLinkAll` were nested inside `autoSyncEnts`; top-level calls threw a `ReferenceError` swallowed by `[P13.300]` catches → links never auto-created.
FIX P13.391: hoisted them to top level. **Now live and verified** (commit `c811e72`): deployed bytes checked, and `window.retroLinkAll` is a function at page load (impossible in the old nested version). `pipelineSelfTest()` = 9/9 green.
DO NOT REPEAT: Don't define functions inside `autoSyncEnts` that are called at top level.

### 2026-08-01 — "Won't sign in" debugged before checking 2FA   [FAILED / LESSON]
Chased cache/Brave/incognito theories and cleared site data; real cause was Google 2FA with no phone (on a plane), and clearing data logged Mike out.
DO NOT REPEAT: On any "won't sign in," FIRST confirm the user can complete auth (2FA/phone) before clearing cache/cookies.

### 2026-08-02 — "Merged" ≠ deployed: wrong file uploaded 3× (download-name collision)   [FIXED / LESSON]
P13.391 was "merged" via PRs #1 and #2, but BOTH uploads were the wrong bytes — main's `FLiIntel.html` stayed unfixed for hours while everyone believed it shipped. Root cause: Mike's Downloads already had a `FLiIntel.html`, so each re-download saved as a new name (`FLiIntel (1)` → stored as `FLiIntel_3.html`, `FLiIntel_4.html`). GitHub only *replaces* on an exact name match, so it kept adding new files and never overwrote `FLiIntel.html`.
FIX: uploaded the correctly-named file directly (drove GitHub in the browser with a file literally named `FLiIntel.html`), committed to `main` (`c811e72`). Verified repo bytes + live deploy + running functions. Stray `FLiIntel_3.html` / `FLiIntel_4.html` deleted 2026-08-02.
DO NOT REPEAT: (1) A merge is not a deploy and an upload is not a replace — **verify the deployed bytes/marker, never assume "merged" = live.** (2) When replacing a GitHub file by upload, the local file must be named EXACTLY the target name; clear old downloads first.

### 2026-08-01/02 — CT-1 + CT-2/CT-3 built (integrity tier)   [BUILT + LIVE + VERIFIED]
CT-1/P13.392 (pipeline-health recorder + `pipelineHealthReport()`), CT-2/P13.393 (`checkPipelineInvariants`), CT-3 (`pipelineSelfTest()`). Backend-free (in-memory + localStorage). Now live (commit `c811e72`); `pipelineSelfTest()` returns 9/9 and confirms `recordPipelineEvent` + `checkPipelineInvariants` present.
NEXT: CT-1b persistent health log needs a `firebase deploy --only database` (`pipelineHealth` index rule). CT-4 targeted un-swallow pending (FE has ~654 swallow points; only ~15-25 pipeline ones matter).

---
*Log doc v1 — updated 2026-08-02.*
