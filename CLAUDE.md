# CLAUDE.md — CORSAIR BUILD RULES (the RULES doc)

*The operating contract for any Claude / Claude Code session working on the Corsair codebase (`github.com/mpoppa32/FLi-Network`). Claude Code auto-reads this file at the root of the repo on every session. It is the RULES document in the four-document AI Operating System (see `ai-operating-system-plan.md` in the Corsair claude.ai project). Companions in this repo: `corsair-ops-truth-v1.md`, `corsair-ops-log-v1.md`, `corsair-ops-context-v1.md`.*

**Domain:** Corsair — "Defense Capture OS." A single-file front end (`FLiIntel.html`) + `FLiIntel.css` + `js/corsair/*` modules, a TypeScript Firebase Functions backend (`functions/`, package `corsair-functions`), Firebase project `fli-network`, live at `https://mpoppa32.github.io/FLi-Network/FLiIntel.html`.
**Maintainer:** Mike Poppa.
**State anchor:** commit `56573fb` (P13.390).

---

## 0. READ THIS FIRST, EVERY SESSION

Before writing any code, read all four Corsair docs and confirm you've read them:
1. `CLAUDE.md` (this file) — the rules.
2. `corsair-ops-truth-v1.md` — what is actually built and true in the codebase today, and why.
3. `corsair-ops-log-v1.md` — what's been tried, **especially what failed**. Check before proposing any approach.
4. `corsair-ops-context-v1.md` — where the last session left off and the next move.

Do not start work until you have. If a companion doc is missing, say so — do not proceed as if it exists.

## 1. THE COMPACTION RULE

When the conversation compacts, you have lost the contents of these docs. The moment it happens: **stop, re-read all four, restate the current task in one line, then continue.** Every time. This is the single rule that stops a long session from drifting.

## 2. NO FUDGE FACTORS — NOTHING FAKED

Avery's hard line, applied to code. Never fake a result, stub a function and claim it works, hardcode a value to make a test pass, or report something as done when it is untested. A confident wrong answer is worse than an honest gap. If something is broken or unverified, say so plainly.

## 3. DON'T INVENT THE CODEBASE — VERIFY IT

Never guess a Firebase path, a function name, an API contract, a storage key, or a data shape. Check the source: `FLiIntel.html`, `js/corsair/*`, `functions/src/*`, `database.rules.json`. If it isn't in the code or the truth doc, it is unverified — say "unverified, need to check" rather than filling the gap. (Legacy trap: infra is named `fli-`/`FLiIntel`, product is "Corsair" — don't assume the name tells you the path.)

## 4. RESPECT THE ARCHITECTURE — THESE ARE HARD LINES

- **All Claude calls route server-side through the `anthropicProxy` Firebase Function.** The Anthropic key lives in Firebase Secret Manager (`ANTHROPIC_API_KEY`), never in the browser. Do not reintroduce browser-side `x-api-key` calls — that was security finding P13.124 and it is closed.
- Respect the model allow-list and the per-workspace hourly quota in the proxy. Don't bypass them.
- Workspaces are fully dynamic (`workspaces/{wsId}`). Never hardcode a FLi or Atlas workspace ID.

## 5. ONE AGENT AT A TIME; FAN OUT ONLY FOR RESEARCH

Run one focused agent on one task. Spin up parallel agents only for deep research/read-only investigation, never for parallel writes to the codebase.

## 6. RELEASE IN LOCKSTEP

Code and truth doc move together. Never commit a code change without updating `corsair-ops-truth-v1.md` in the **same commit** when the change alters what is real. The docs and the code must always agree.

## 7. LOG EVERY FAILURE

When a build breaks, an approach is rejected, or an assumption proves wrong, write it to `corsair-ops-log-v1.md` with a one-line "do not repeat." This is the most valuable doc and the one that's easy to skip. Do not skip it.

## 8. TEST BEFORE "DONE"

Nothing is complete until it's verified — build passes, function deploys/emulates, the UI path actually works. Partial or error-state work stays open, not marked done.

## 9. CONTEXT BEFORE YOU STOP

Update `corsair-ops-context-v1.md` with current state and the next move before ending, so the next session (yours, Bryce's, or a fresh agent's) resumes cold with zero re-briefing.

## 10. POST-MORTEM GROWS THIS FILE

After a session that went sideways, add one or two rules here. Slow growth over months — 1–2 a month, not a rewrite.

---
*Corsair Build Rules v1 — 2026-07-30. Companion manual: `ai-operating-system-plan.md`.*
