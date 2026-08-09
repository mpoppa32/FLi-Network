# CLAUDE.md — CORSAIR BUILD RULES (the RULES doc)

*The operating contract for any Claude / Claude Code session working on the Corsair codebase (`github.com/mpoppa32/FLi-Network`). Claude Code auto-reads this file at the root of the repo on every session. It is the RULES document in the four-document AI Operating System (see `ai-operating-system-plan.md` in the Corsair claude.ai project). Companions in this repo: `corsair-ops-truth-v1.md`, `corsair-ops-log-v1.md`, `corsair-ops-context-v1.md`.*

**Domain:** Corsair — "Defense Capture OS." A single-file front end (`FLiIntel.html`) + `FLiIntel.css` + `js/corsair/*` modules, a TypeScript Firebase Functions backend (`functions/`, package `corsair-functions`), Firebase project `fli-network`, live at `https://mpoppa32.github.io/FLi-Network/FLiIntel.html`.
**Maintainer:** Mike Poppa.
**State anchor:** commit `b1638c9` (P13.399 — `onNotesInput` export + the toast swallow) — the newest `P13.x` marker on `main`. Later commits (docs, tests, CI machinery) introduce no new runtime marker, so this anchor holds until the next marked change.

---

## 0. READ THIS FIRST, EVERY SESSION

Before writing any code, read all four Corsair docs and confirm you have read them:
1. `CLAUDE.md` (this file) — the rules.
2. `corsair-ops-truth-v1.md` — what is actually built and true in the codebase today, and why.
3. `corsair-ops-log-v1.md` — what has been tried, **especially what failed**. Check before proposing any approach.
4. `corsair-ops-context-v1.md` — where the last session left off and the next move.

Also read `pappas-operator-context-v1.md` (claude.ai project) — who Mike is, what he is running, how he wants to be worked for. It applies in every lane, build included.

Do not start work until you have. If a companion doc is missing, say so — do not proceed as if it exists.

## 1. THE COMPACTION RULE

When the conversation compacts, you have lost the contents of these docs. The moment it happens: **stop, re-read all four, restate the current task in one line, then continue.** Every time. This is the single rule that stops a long session from drifting.

## 2. NO FUDGE FACTORS — NOTHING FAKED

Avery's hard line, applied to code. Never fake a result, stub a function and claim it works, hardcode a value to make a test pass, or report something as done when it is untested. A confident wrong answer is worse than an honest gap. If something is broken or unverified, say so plainly.

## 3. DO NOT INVENT THE CODEBASE — VERIFY IT

Never guess a Firebase path, a function name, an API contract, a storage key, or a data shape. Check the source: `FLiIntel.html`, `js/corsair/*`, `functions/src/*`, `database.rules.json`. If it is not in the code or the truth doc, it is unverified — say "unverified, need to check" rather than filling the gap. (Legacy trap: infra is named `fli-`/`FLiIntel`, product is "Corsair" — do not assume the name tells you the path.)

## 4. RESPECT THE ARCHITECTURE — THESE ARE HARD LINES

- **All Claude calls route server-side through the `anthropicProxy` Firebase Function.** The Anthropic key lives in Firebase Secret Manager (`ANTHROPIC_API_KEY`), never in the browser. Do not reintroduce browser-side `x-api-key` calls — that was security finding P13.124 and it is closed.
- Respect the model allow-list and the per-workspace hourly quota in the proxy. Do not bypass them.
- Workspaces are fully dynamic (`workspaces/{wsId}`). Never hardcode a FLi or Atlas workspace ID. Confirm the active workspace before any mutation; in-memory globals can hold stale workspace data after a switch.

## 5. ONE AGENT AT A TIME; FAN OUT ONLY FOR RESEARCH

Run one focused agent on one task. Spin up parallel agents only for deep research/read-only investigation, never for parallel writes to the codebase.

## 6. RELEASE IN LOCKSTEP

Code and truth doc move together. Never commit a code change without updating `corsair-ops-truth-v1.md` in the **same commit** when the change alters what is real. The docs and the code must always agree.

## 7. LOG EVERY FAILURE

When a build breaks, an approach is rejected, or an assumption proves wrong, write it to `corsair-ops-log-v1.md` with a one-line "do not repeat." This is the most valuable doc and the one that is easy to skip. Do not skip it.

## 8. TEST BEFORE "DONE"

Nothing is complete until it is verified — build passes, function deploys/emulates, the UI path actually works. Partial or error-state work stays open, not marked done. **A merge is not a deploy and an upload is not a replace** — verify the deployed bytes, never assume (see LOG 2026-08-02).

## 9. CONTEXT BEFORE YOU STOP

Update `corsair-ops-context-v1.md` with current state and the next move before ending, so the next session (yours, Bryce's, or a fresh agent's) resumes cold with zero re-briefing.

## 10. POST-MORTEM GROWS THIS FILE

After a session that went sideways, add one or two rules here. Slow growth over months — 1–2 a month, not a rewrite.

## 11. FAIL LOUDLY

Never swallow an error, add a blanket catch, or write "graceful" handling that hides breakage to keep things looking smooth. P13.391's auto-link pipeline was dead for months precisely because a best-effort catch swallowed a `ReferenceError`. Errors surface, always. When you must catch, log loudly and surface the failure to the UI or health log — never silently.

## 12. EXECUTION TEMPO

- **Act, do not announce.** When you can simply do the thing, do it. No "here is what I will do," no filler, no re-listing the request. The report (Rule 13) is your output.
- **Parallel reads, sequential writes.** Batch every independent read, search, and lookup into one turn of simultaneous calls. Writes, deploys, and anything irreversible stay sequential and individually verified — speed on the gather, discipline on the commit.
- **Run the read, do not offer it.** A read-only check that would strengthen your answer: just run it. Offer only actions that change state.
- **The plan gate.** Simple and clear → act immediately, answer in 1–2 lines. Complex or multi-step → the plan runs visibly before execution. Never pad the small; never wing the large.
- **Questions earn their keep.** Ask only when the answer materially changes what gets built. Otherwise decide, state the assumption in one line, and proceed.

## 13. THE REPORT — AND PERSIST WHAT MATTERS

Structure substantial responses: objective → what already exists → the move → how we will know it worked → the one risk + guardrail → next single move. Before finishing, red-team your own work in three lines (where does it break, what did you assume, what would the sharpest critic say) and fix what that surfaces.

**A deliverable another session must act on is not delivered until it is written to the repo or the project.** Session files die with the session — a triage doc was lost this way on 2026-08-04. Same lesson as "a doc is not integrated until committed."

## 14. THE OPERATOR STATES THE REQUIREMENT; THE FABRICATOR FINDS THE INVARIANT

Never assert an invariant about code you have not read. A spec written from the outside may state the *requirement* — what must remain true for the user — but any mechanical claim about the source is **UNVERIFIED** until the session holding the code confirms it. Mark it as such rather than stating it as a constraint.

Paid for by three failures in eight days, all the same shape: a mission drafted for three pieces of machinery that already existed; a parser-key inventory naming seven keys when the generator emits ten; and "the plaintext must be byte-identical", which was a guess at an invariant whose real form was "the ten section keys and their order are frozen" — the guess was stricter than the requirement and would have blocked a live functional fix.

The corollary binds this side too: when you receive a spec containing a claim about the code, **check it before building on it**, and report the correction. A confident spec is still unverified until someone reads the source.

---
*Corsair Build Rules v1.1 — 2026-08-04. Rules 11–13 added after the 2026-08-04 session (P13.391 swallow lesson, live tempo test, lost-deliverable incident); each is paid for by a logged failure, not added speculatively. Companion manual: `ai-operating-system-plan.md`.*
