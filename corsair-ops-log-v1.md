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

---
*Log doc v1 — updated 2026-08-05.*
