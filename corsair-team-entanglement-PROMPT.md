# CORSAIR — The Team Entanglement Layer (QUEUED MISSION — paste into a FRESH session)

> **Status:** NOT STARTED. This is the next mission, pasted by the operator at the end of the 2026-05-30 session and deferred to a fresh session (the operator wants the prior session's context cleared first — same discipline as the coherence audit). The operator's instruction: **bring the three audit deliverables back to him BEFORE building the ship sequence** — review together to catch interpretation drift before it becomes code.
>
> Read `corsair-session-passdown.md` first for current state, then this is the work.

---

## Mission
The team-coordination layer is intended to be the defining capability of Corsair — the single thing that, once experienced, makes operators unable to imagine running their teams without it. It is the structural realization of the spine sentence (*the operator does what they already do; the platform makes it count for the team*) and the operational realization of the bridge principle (*information flows through the platform the way intent flows through a SEAL team*).

This audit and ship sequence is dedicated to that layer specifically. Not OSINT, not pipeline, not the entity graph. The team layer.

Standard: a team of 5–10 uses Corsair for two weeks and cannot return to their prior tools — because they've **felt** frictionless team operation and the alternative now feels unacceptable.

## File inputs — read first, in order
1. `corsair-experiential-vision.md` — spine sentence, bridge principle, Moment 3 (The Logging) are the standards.
2. `corsair-coherence-audit.md` + `corsair-rebuild-sequence.md` — original team-coordination findings + rebuild order.
3. `corsair-midbuild-checkin.md` + `corsair-build-review.md` — what's been touched/verified since the rebuild began.
4. Current codebase: `FLiIntel.html` + `js/corsair/*`. Read the team-coordination implementation IN FULL — logged-meeting flow, entity propagation, Activity feed (Atlas Team Activity P13.224), commitment tracking, all team-shared state.
5. Live platform on Atlas — walk the team layer from **two** perspectives (originator + receiver).

## Team Entanglement — operational definition
The property such that **every individual action by any team member instantly + automatically updates the shared reality of the entire team — full context, honest confidence labeling, zero operator effort beyond doing the work they were already going to do.**

Five testable Properties (every ship must move ≥1 measurably forward):
1. **Zero-Effort Propagation** — doing the work IS communicating it; comms overhead → 0.
2. **Full-Context Preservation** — propagated info carries who/what/committed/expected-next/entities/trajectories; receiver doesn't have to ask follow-ups.
3. **Honest Confidence Labeling** — every shared datum carries who created it, when, with what certainty; extracted ≠ asserted.
4. **Proactive Surfacing** — the platform notices shared state (approaching deadlines, gone-quiet accounts, two operators on the same territory) and surfaces it — a thinking team member, not a shared notebook.
5. **Asymmetric Awareness Without Asymmetric Effort** — role-appropriate views, auto-filtered; operator configures nothing.

## Phase 0 — the audit (NO CODE)
**A. Read the team layer end-to-end**, report with file:line: the logged-meeting pipeline (tap → team feed → every entity record; every silent-fail point); the Activity feed / Atlas page (shows/hides, sort, filter, who-sees-what, fresh-vs-stale, same-view-vs-personalized); cross-entity propagation (which records auto-update on a logged meeting; every path that fails to update something it should); commitment tracking (extracted? where? who sees? deadline-tied? proactively surfaced? team-vs-customer commitments separate?); proactive notification layer (what notifications exist TODAY, or does state just update + wait?); concurrent-operator behavior (simultaneous edits → conflict resolution, visible or silent?); cross-device freshness (**measure real latency on Atlas**, don't estimate).

**B. Walk twice** — as **originator** (log a meeting / posture call / commitment / contact; is effort minimal, context auto-captured, propagation visible-so-trusted?) and as **receiver** (open fresh after a teammate's action; did it arrive everywhere — feed, entity, opp, Brief, Sovereign Read — with full context, surfaced proactively or hidden?). The gap between originator and receiver experience is where the team layer fails. Find every instance.

**C. Score the 5 Properties 0–10** with evidence (numeric forces specificity).

**D. Diamond Gaps** — specific shortfalls vs the 5-property standard that, if fixed, move the team to true-believer. Not polish. Rank by leverage; top 3 become the next ships.

## Phase 1+ — build sequence
After the audit, produce the ship plan. Each ship: smallest atomic unit delivering a felt team difference; addresses ≥1 Property + ≥1 top Diamond Gap. Discipline: **no ship until BOTH originator and receiver perspectives verified** (a propagation that works one way but not the other is not shipped); verify each on live Atlas with a **simulated team of two** (two browser sessions as different members — but see passdown re: the extension/IDB hazard + don't-hammer-reloads); re-score the 5 Properties after each ship (living scorecard); doctrine intact (honest confidence, no auto-outreach, operator-in-send-seat, no surveillance-without-consent — the team layer makes the team transparent to each other, never to outside parties without consent).

## Out of scope
NOT the OSINT layer, entity-graph rendering, Sovereign Read synthesis quality, or pipeline scoring. Adjacent findings → a separate "Adjacent Findings" section, not folded into this plan.

## Deliverables (commit + push all three)
1. `corsair-team-entanglement-audit.md` — Phase 0: full mapping w/ file:line, dual-perspective results, 0–10 Property scores w/ evidence, ranked Diamond Gaps.
2. `corsair-team-entanglement-sequence.md` — ordered ship plan; each ship: what / which Property / which Diamond Gap / originator + receiver success / effort (days) / dependencies.
3. `corsair-team-entanglement-scorecard.md` — living 0–10 scorecard, updated after each ship.

## Rules
Vision is the standard; spine is the test; 5 Properties are the spec; Diamond Gaps are the targets. File:line for technical claims, behavioral for experiential, **latency measurements** for propagation (measure, don't estimate). "I cannot verify" is valid + required (esp. cross-device freshness). No softening — 3/10 is 3/10. Bar = operator-cannot-return-to-prior-tools after two weeks.

**Move:** Read inputs. Read team-layer code in full. Walk live twice (originator + receiver). Score the 5. Find Diamond Gaps. Write the three deliverables. Commit. Push. Stop. **Then bring the three files to the operator BEFORE building.**
