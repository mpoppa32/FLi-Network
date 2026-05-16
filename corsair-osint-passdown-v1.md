# CORSAIR PHASE 8.5 — OPERATOR PASS-DOWN SPEC

**Scope:** How Phase 8.5 features participate in workspace pass-down when one operator transitions to another
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** All Phase 8.5 artifacts; particularly the onboarding flow design
**Status:** Design spec for the pass-down dimension of Phase 8.5. Doctrine §IX is the soul of the platform — institutional memory persists. This document defines how external-intelligence configurations, observations, and tuning state outlive the operator who built them.

---

## Document Purpose

Corsair's central organizing principle, per Doctrine §IX, is mission pass-down: "nothing the operator learns is lost when she leaves the chair." The platform's pre-Phase-8.5 design built this around the operator's own observations: Posture-Layer tells, pursuit notes, meeting log entries, byPursuit positions.

Phase 8.5 introduces a new dimension: external-intelligence context. The operator builds:
- A watchlist tuned to her pursuits
- Saved searches refined over months of iteration
- Reconciliation decisions on ambiguous matches
- Source-tuning preferences (Brief weights, dismissal patterns)
- External-signal interpretations recorded in Posture-Layer attributes

Without explicit design, this context could be lost in operator transition. A successor inheriting the workspace would see the entity graph but not understand *why* certain Awards are tracked, *how* the predecessor weighted competitor signals, *which* reconciliation merges the predecessor approved.

This document defines what persists, how it surfaces to the successor, and what is intentionally not passed down.

---

# PART ONE — THE PASS-DOWN MODEL

## Definition of pass-down

Pass-down happens when:
- An operator transitions out of the role and a successor takes over the same workspace
- A workspace transfers ownership (e.g., consultant handing off to client team)
- An operator is on extended leave and someone covers their workspace temporarily
- A workspace is archived and later re-activated by a new operator

All four scenarios share the property: the institutional memory must survive the operator transition.

## Two layers of pass-down content

### Layer A — Auto-persisted (no operator action required)
Everything stored in the workspace's RTDB paths persists automatically. Successor inheriting the workspace inherits this state.

Specifically for Phase 8.5:
- All entities (Persons, Organizations, Opportunities, Awards, Signals, Edges)
- All Posture-Layer attributes (`posture.tells[]`, `posture.byPursuit{}`, `posture.influenceReads`, `posture.adversaries[]`, etc.)
- All Phase 8.5 entity attributes (source provenance, lifecycle states, reconciliation records)
- Watchlist configuration
- Saved searches
- Source enable/disable flags
- Brief synthesis weights and tuning
- Dismissal history (for adaptive scoring continuity)

### Layer B — Operator-curated pass-down notes
The operator's deliberate narration of what the successor should know. Already partially supported in Brief surface's "Pass-down notes" section pre-Phase-8.5.

Phase 8.5 extends pass-down notes with external-intelligence context: why certain sources are weighted, why certain auto-matches were rejected, how to read specific Brief categories.

---

# PART TWO — AUTO-PERSISTED PASS-DOWN

What persists by default. The successor doesn't need to do anything; this state is in their workspace when they open it.

## A-1 — Watchlist configuration

The full watchlist (NAICS, agencies, competitors, members of Congress, geographies, keywords, set-asides, dollar thresholds) and all saved searches persist as workspace data. Successor inherits the predecessor's watchlist intact.

What this means operationally:
- Successor opens Corsair → sees Brief already populated with relevant External Intelligence on day one (no setup gap).
- Successor doesn't need to rebuild the watchlist from scratch.
- Successor can adjust the watchlist over time but starts from the predecessor's working state.

What the successor may want to do:
- Review the watchlist composition early (within first 2 weeks).
- Validate it matches their pursuits (which may differ from predecessor's emphasis).
- Adjust where needed.

## A-2 — Source enable/disable choices

Which sources are enabled for the workspace persists. If the predecessor disabled SEC EDGAR (e.g., because their work was all private-side), that persists.

What the successor may want to do:
- Audit disabled sources during onboarding.
- Re-enable if their work would benefit.

## A-3 — Reconciliation history

Auto-merge decisions, operator-confirmed merges, dismissed match candidates — all persist as part of entity history.

What this means:
- Successor sees clean entity graph (predecessor already resolved ambiguities).
- Successor doesn't re-encounter the same reconciliation queue items.
- Edge cases the predecessor flagged are visible in their original flagged state.

What the successor may want to do:
- Review the reconciliation queue if any items still pending.
- Understand what patterns the predecessor accepted vs. rejected (helps inform their own decisions).

## A-4 — Posture-Layer attributes

The operator's hard-won political-terrain observations persist. Tells, byPursuit notes, influence reads, adversary lists — all intact.

This is the soul of the pass-down. Doctrine §IX: "everything the operator learns about the political terrain survives her departure."

What the successor inherits:
- Predecessor's read on every relationship visible in the Theater
- Predecessor's notes on every pursuit
- Predecessor's observed tells on every tracked Person
- Predecessor's adversary calls on every active pursuit

The successor's first weeks are largely about validating the predecessor's reads against their own observations.

## A-5 — Brief tuning and dismissal patterns

The predecessor's per-workspace Brief synthesis weights persist. If the predecessor tuned to emphasize adversary signals over capability segment, that tuning carries.

Dismissal patterns (Brief synthesis v1 dismissal feedback loop) also persist — the system "remembers" what the predecessor consistently dismissed.

**Important caveat:** Dismissal patterns reflect the predecessor's preferences, not absolute truth. The successor may have different priorities.

**Mitigation:** Phase 8.5.8's dismissal-driven adaptation is logged-only initially. Adaptive scoring is Phase 9+ with explicit operator opt-in. Phase 8.5.8 doesn't auto-tune from predecessor's dismissals; it just preserves them as data.

## A-6 — Entity source provenance

Every entity carries `source.system` and related provenance attributes (per E-4). The successor can always see which source any data came from.

This is critical for trust: when the successor questions whether to act on an entity's data, they can see whether it's from a public source (USAspending), a paid source (Inside Defense, if Phase 8.6.4 shipped), or operator-input (`operator_manual`).

---

# PART THREE — OPERATOR-CURATED PASS-DOWN NOTES

What the predecessor deliberately writes for the successor. Already partially supported pre-Phase-8.5; Phase 8.5 extends.

## Existing pass-down notes (pre-Phase-8.5)

The Brief surface has a Pass-Down Notes section where the operator writes free-form context about pursuits, contacts, and customer terrain.

Pre-Phase-8.5 pass-down notes typically cover:
- Pursuit context that doesn't fit in `Opportunity.notes`
- Contact dynamics not captured in `Person.notes`
- Customer terrain reads that span multiple pursuits
- Specific institutional knowledge ("the last time we worked with this prime, the program manager left after 6 months because of X")

## Phase 8.5 extensions to pass-down notes

External intelligence introduces new types of context worth deliberate pass-down narration:

### N-1 — Watchlist rationale notes

The watchlist itself persists (A-1), but *why* the watchlist looks the way it does is in the operator's head. Phase 8.5 adds an optional narrative attached to the watchlist:

```
Workspace Settings → Watchlist → Pass-Down Notes
─────────────────────────────────────────────────

Why I track this watchlist:

NAICS 541330: Our shop is positioned as an engineering services prime.
This is our primary capability.

NAICS 541512: We layer software-of-record on top of engineering. Tracked
to catch IT-heavy pursuits where we might pair with a software prime.

Customer Air Force: Long-standing customer relationship.
Customer DARPA: Strategic; we have less depth here but growth area.
Customer Space Force: New (post-2019). Less established.

Competitor Lockheed Martin: Adversary on F-35 sustainment pursuits.
Not adversary on most other Air Force work — they don't compete in our
core space. Disregard their wins outside F-35 unless they signal market
entry.

Competitor Booz Allen: Often a teaming partner, not adversary. Don't
auto-add them to posture.adversaries[] when their wins surface.

Keyword "AI": Aspirational; we have one capability claim here. Track
to understand market direction more than for specific pursuit hits.
```

This narrative tells the successor *why* the watchlist is what it is. Without it, the successor sees a list but lacks context.

### N-2 — Source-specific notes

Each source can carry its own pass-down note:

```
Workspace Settings → Source: Inside Defense → Pass-Down Notes
──────────────────────────────────────────────────────────────

Why we subscribe: Their Pentagon beat catches program-management
detail not in free press. Particularly strong on:
- Air Force PEO Fighters and Bombers coverage
- OSD acquisition policy decisions
- Congressional defense committee staff dynamics

What to ignore: Their general procurement coverage isn't worth the
read for us; mostly duplicates free press coverage. Stick to the
Pentagon beat for ROI.
```

### N-3 — Reconciliation pattern notes

Recurring ambiguities the predecessor encountered and how they decided:

```
Workspace Settings → Pass-Down → Reconciliation Notes
──────────────────────────────────────────────────────

Common ambiguities:

"Lockheed Martin" name variations: I treat LMC, Lockheed Martin Corporation,
Lockheed Martin Aeronautics, etc. as the same parent entity. The platform
auto-merges these now (set up via the parent linkage in early 2026).

"AFLCMC" vs. "Air Force Life Cycle Management Center": same entity; the
platform handles. But the sub-offices under AFLCMC are distinct customer
relationships. Don't conflate.

Sources Sought from prior years: occasionally re-surface as new notices
(the customer re-issues). Watch for these — they're not new pursuits but
opportunities to revise prior responses.
```

### N-4 — Brief tuning rationale

Why the predecessor's Brief is weighted the way it is:

```
Workspace Settings → Brief → Pass-Down Notes
──────────────────────────────────────────────

Brief weights I've found work for our workspace:

Pursuit signals: 8/10 — primary focus, want these visible.
Adversary signals: 7/10 — slightly elevated because our adversary set is
                          tight and changes are meaningful.
Customer signals: 5/10 — default; works.
Capability signals: 2/10 — reduced because the broader segment produces
                           noise; I prefer to see only what touches us.
Background context: 1/10 — minimal; I read CSIS reports separately when
                           I want them.

Dismissal patterns I've trained:
- SEC Form 4 sales under $5M: dismiss (noise for our adversaries)
- DoD News awards under $20M outside our NAICS: dismiss
- Congressional hearings without a defense committee anchor: dismiss
```

### N-5 — Posture-Layer external-signal interpretations

Some Posture-Layer reads are based on external-source patterns the predecessor watched:

```
Workspace Pass-Down → Person: Captain Jane Doe
────────────────────────────────────────────────

External signal interpretations:
- Her Form 4 filings show consistent option exercises around quarterly
  earnings. Pattern; not predictive of departure.
- She testified at HSAS in 2025 on counter-UAS. Topic indicates her
  current portfolio includes counter-UAS programs.
- Did not appear at AUSA 2025 (vs. AUSA 2023 and 2024). Might indicate
  travel schedule conflict; not a tell on its own. Watch for next 12 months.
```

These cross-reference the Posture Layer's existing `posture.tells[]` and `posture.influenceReads` with external-intelligence context.

## Pass-down note storage

All pass-down notes live in workspace data under structured paths:

```
workspaces/{wsId}/passDown/
├── overview.md                      (high-level workspace introduction)
├── watchlist/
│   └── rationale.md                 (N-1)
├── sources/
│   ├── samGov.md                    (per-source notes)
│   ├── usaSpending.md
│   ├── insideDefense.md
│   └── ...
├── reconciliation/
│   └── patterns.md                  (N-3)
├── brief/
│   └── tuning.md                    (N-4)
├── posture/
│   └── person_{personId}.md         (per-Person N-5 notes)
└── pursuits/
    └── opp_{oppId}.md               (per-pursuit pass-down notes)
```

Format: markdown. Operator writes with the existing Brief pass-down note editor.

---

# PART FOUR — SUCCESSOR ONBOARDING

When a new operator inherits a workspace, they need orientation specific to the pre-existing state.

## Successor first-time experience

When a workspace transitions to a new operator (identity change detected), the first-time view includes:

```
┌──────────────────────────────────────────────────────────────────┐
│ WELCOME TO {WORKSPACE NAME}                                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ This workspace was previously held by {predecessor name}.         │
│                                                                    │
│ Their accumulated work persists:                                  │
│  • {N} active pursuits                                            │
│  • {N} Persons with Posture-Layer observations                    │
│  • {N} Organizations with relationship data                       │
│  • {N} months of pass-down notes                                  │
│  • External intelligence configured for {N} sources               │
│                                                                    │
│ Suggested first steps:                                            │
│                                                                    │
│  1. Read the workspace overview pass-down note                    │
│  2. Review the watchlist and its rationale                        │
│  3. Browse the active Pipeline with current stages                │
│  4. Review pass-down notes on top 5 pursuits                      │
│  5. Skim Posture-Layer observations on key contacts               │
│                                                                    │
│  [ Read workspace overview ]                                      │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

The successor isn't dropped into the platform cold. The orientation contextualizes what they're inheriting.

## Successor onboarding tour

After the initial welcome, a brief guided tour covers Phase 8.5-specific features:

### Tour stop 1 — The Brief
"This is your morning intelligence read. The previous operator tuned the Brief weights and dismissal patterns; you can re-tune in Settings. The pass-down note explains their choices."

### Tour stop 2 — The Watchlist
"The previous operator configured Corsair to listen for these capabilities, customers, and competitors. Their rationale is in the pass-down note. Adjust over time as your priorities differ."

### Tour stop 3 — Source Health
"This shows whether external sources are syncing correctly. If anything's amber or red, the previous operator may have left it broken; investigate."

### Tour stop 4 — Posture Layer
"This is the political terrain map. The previous operator's hard-won observations live here. Validate against your own observations before acting on them."

### Tour stop 5 — Pass-down hub
"Everything the previous operator deliberately wrote for you lives in the Pass-Down section. Read it. Update it as you go."

Tour is dismissible. New operator can return via Settings → Onboarding.

---

# PART FIVE — WHAT INTENTIONALLY DOESN'T PASS DOWN

Some state is operator-specific and shouldn't transfer.

## D-1 — Authentication credentials

API keys, OAuth tokens, subscription credentials — these are application-level or operator-level, not workspace-level. They don't transfer; the new operator needs to verify auth (e.g., re-enter Inside Defense subscription if it's per-operator).

Source Health shows ● Stopped state for any source missing the new operator's auth. Onboarding tour calls this out.

## D-2 — Personal preferences UI state

Sidebar collapse state, recently-viewed entities, last-opened surface — these are operator-specific UI state, not institutional knowledge. New operator starts fresh.

## D-3 — Operator-pending review queue items

If the predecessor had a stale reconciliation review queue item that they were procrastinating on, it persists (so the data is intact) but the new operator gets a fresh notification banner: "X items in reconciliation queue inherited from previous operator. Review at your earliest convenience."

## D-4 — Dismissal patterns vs. tuning preferences

This is nuanced (mentioned in A-5):

- **Preferences (explicit operator choices):** Brief weight sliders, source enable/disable, watchlist composition. These pass down because they're institutional decisions about workspace.

- **Patterns (implicit operator behavior):** Specific items the predecessor dismissed. These persist as data but don't drive auto-tuning for the new operator.

Phase 8.5.8 logs dismissals but doesn't auto-tune. This means the new operator's preferences won't be silently shaped by the predecessor's dismissal patterns; they'd have to explicitly opt in to adaptive scoring (Phase 9+) and that opt-in is operator-specific.

## D-5 — Private observations the predecessor explicitly marked private

Doctrine §V: "the operator's private observations are sacred." If the predecessor marked specific tells, byPursuit notes, or influenceReads as "private to me — don't pass down," those are honored.

Implementation:
- Operator can flag any Posture-Layer entry with `passDownVisible: false`.
- Default for all entries is `passDownVisible: true` (Doctrine §IX wins by default).
- Operator-flagged-private entries hidden from successor view.
- This is an explicit operator choice; not a default behavior.

The reason this option exists: the predecessor may have observations they made under conditions of trust that wouldn't transfer (e.g., a contact shared something in confidence; the predecessor's note reflects their understanding but they don't want the new operator to act on it without rebuilding the relationship).

---

# PART SIX — INSTITUTIONAL CONTINUITY ACROSS LONG PERIODS

Pass-down isn't only operator-to-operator. It's also operator-to-future-self.

## Operator returning after extended leave

If an operator returns after months away, the workspace state needs to communicate "here's what happened while you were gone."

Phase 8.5 supports this via:

### The Returning Operator view

When operator opens Corsair after >30 days of absence:

```
┌──────────────────────────────────────────────────────────────────┐
│ WELCOME BACK                                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ You've been away for {N} days.                                    │
│                                                                    │
│ While you were gone:                                              │
│  • {N} new awards in your watchlist                               │
│  • {N} new opportunities posted                                   │
│  • {N} adversary actions                                          │
│  • {N} customer terrain changes                                   │
│  • {N} congressional hearings on tracked topics                   │
│                                                                    │
│ Top 10 items that would have been in your Brief:                  │
│  ... summarized ...                                                │
│                                                                    │
│  [ Show me the full daily Briefs I missed ]                       │
│  [ Skip ahead and just show today's Brief ]                       │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

The "Briefs I missed" view shows each day's archived Brief (Phase 8.5.8 archives Briefs daily).

## Workspace archival and reactivation

If a workspace is archived (e.g., a pursuit cycle complete, going dormant for budget cycle reasons) and later reactivated, the state preserves:
- All entities and history
- Last watchlist configuration
- Last source enable states
- Pass-down notes

Reactivation prompts the operator: "This workspace was archived on {date}. Refresh sources to current state?"

Sources resume from the archive date; the gap is filled with backfill where supported (USAspending, Congress.gov, SAM.gov historical APIs all support multi-month backfill).

---

# PART SEVEN — PRIVACY AND ACCESS CONTROL

Pass-down operates within the existing Corsair access control model. Phase 8.5 doesn't introduce new privacy concerns at the pass-down level beyond:

## P-1 — Workspace access transfer

Pass-down assumes legitimate workspace access transfer (employer reassignment, team member rotation, etc.). The platform doesn't authenticate the legitimacy of the transfer; that's an out-of-platform decision.

If a workspace transfer happens via Firebase Auth ownership change, the new owner inherits everything per this spec. If a transfer is illegitimate, that's a separate concern (workspace owner should detect and revoke access).

## P-2 — Multi-operator workspaces

Some workspaces may have multiple concurrent operators (a small team). Each operator can:
- Read all workspace data
- Write their own observations
- See attribution on every entry (`source.system: 'operator_manual:<userId>'`)

Pass-down in multi-operator context: when one team member leaves, their accumulated work persists. The remaining team members see no disruption.

## P-3 — Doctrine §V private observations and team access

When a workspace has multiple operators, the private-observation flag (D-5 above) is operator-specific. A note marked private by Operator A is visible to Operator A only, not to Operator B even on the same workspace.

Phase 8.5 doesn't ship with this multi-operator private-observation distinction (Phase 8.5 assumes single-operator workspace per the existing model). Phase 9+ multi-operator support adds this distinction.

---

# PART EIGHT — ACCEPTANCE CRITERIA

The pass-down spec is honored when:

1. **All Phase 8.5 workspace state persists across operator transitions** — entities, watchlist, source configs, reconciliation history, posture, brief tuning, dismissal logs.
2. **Pass-down notes hub** is accessible via Brief surface (existing) and Workspace Settings (new for Phase 8.5).
3. **Successor first-time view** appears on detected operator change with the documented welcome content.
4. **Successor onboarding tour** functional through five stops.
5. **Source Health shows ● Stopped** for sources missing successor auth; clear remediation path.
6. **Returning operator view** appears after >30 days absence.
7. **Archived workspace reactivation** correctly resumes source sync with backfill where supported.
8. **Private-observation flag** (D-5) respected — operator-flagged-private entries hidden from successor view.
9. **No data loss** during legitimate workspace transfer.
10. **Documentation** for predecessor: clear guidance on what to write in pass-down notes specifically for external-intelligence context (N-1 through N-5 above).

---

# PART NINE — OPEN IMPLEMENTATION QUESTIONS

## PIQ-1 — Operator transition detection

How does Corsair detect that a workspace transition has occurred?

**Proposal:** Detect via Firebase Auth UID change on workspace ownership. When the active session's UID doesn't match the workspace's last-known active UID for >7 days, treat as transition. Show successor welcome view.

**Recommendation:** Confirm UID-change detection.

## PIQ-2 — Predecessor-handoff workflow

Should there be an explicit "I'm handing this workspace off to X" action by the predecessor?

**Proposal:** Yes. Optional but recommended. Settings → "Hand off workspace" lets the predecessor:
- Write a final pass-down note
- Mark observations as private or public
- Specify the next operator's email (for notification)
- Trigger workspace transfer

Without this workflow, transition still works (per PIQ-1 detection) but loses the predecessor's deliberate handoff.

**Recommendation:** Confirm optional handoff workflow.

## PIQ-3 — Multi-operator concurrent edit handling

If two operators have access to a workspace, conflicting edits can occur. How are they handled?

**Proposal:** Last-write-wins for most fields with edit-attribution visible. Posture-Layer entries are operator-attributed (`posture.tells[].observedBy`), so multiple operators can add tells without conflict.

**Recommendation:** Confirm last-write-wins with attribution.

## PIQ-4 — Pass-down note format

Markdown vs. structured fields?

**Proposal:** Markdown. Operator-written narrative is more valuable than form-filled structured data for pass-down purposes.

**Recommendation:** Confirm markdown.

## PIQ-5 — Brief archive retention

How long are daily Briefs archived (for returning-operator view)?

**Proposal:** 1 year. Brief archive is small (text only); retention is cheap. After 1 year, archives compress to monthly summaries.

**Recommendation:** Confirm 1-year retention + monthly compression.

## PIQ-6 — Dismissal pattern reset on transition

Should dismissal patterns reset for new operator?

**Proposal:** Patterns persist as workspace data (not operator-specific). But Phase 8.5.8 doesn't auto-tune from patterns; new operator's preferences won't be silently shaped.

**Recommendation:** Confirm patterns-persist-but-don't-auto-tune.

## PIQ-7 — External-source provenance visibility in pass-down

Should the successor see *who* the predecessor was when they made specific Posture observations?

**Proposal:** Yes. `posture.tells[].observedBy: <predecessorUserId>` is visible in Inspector. Helps successor understand provenance of observations.

**Recommendation:** Confirm.

## PIQ-8 — Workspace-level pass-down summary

Should there be a workspace-level "what to know about this workspace" summary that the predecessor writes?

**Proposal:** Yes. The `passDown/overview.md` file (Part Three) is this. Recommended one-page narrative on what makes this workspace unique.

**Recommendation:** Confirm.

---

# CLOSING NOTES

## Why this spec matters

Pass-down is Doctrine §IX — "the soul of the platform." Phase 8.5 introduces substantial new state that, without explicit pass-down design, would create discontinuity between operators. A successor without pass-down support sees the data but lacks the predecessor's contextual understanding.

The spec's purpose: ensure Phase 8.5 features participate in pass-down with the same fidelity that pre-Phase-8.5 Posture-Layer observations already do.

## Cross-references

- Doctrine §IX is the foundational principle; this spec is its Phase 8.5 application.
- Onboarding flow design v1 (`onboarding-flow-v1.md`) is for new operators on a fresh workspace; this spec is for new operators on an existing workspace.
- Brief synthesis v1 (`brief-synthesis-v1.md`) Part Six's cross-references between Daily Brief and External Intelligence enable some of the predecessor's context to surface naturally.

## Maintenance principle

This document is v1.0. As multi-operator workflows mature in Phase 9+, the pass-down model expands. The current spec is sufficient for single-operator-per-workspace transitions (the common case).

## Implementation order

Most of Part Two (auto-persisted pass-down) is achieved simply by storing data in workspace-scoped paths. Part Three (operator-curated pass-down notes) requires UI work — extending the existing Brief pass-down notes section with structured locations (watchlist rationale, source notes, etc.). Part Four (successor onboarding) requires detecting transitions and presenting welcome views.

Phase 8.5.8 (Brief synthesis) is the natural home for the pass-down UI work since it's already in the Brief surface. Estimated additional effort: 1-2 operator-weeks beyond Brief synthesis core work.

---

*End of pass-down spec v1.0.*
