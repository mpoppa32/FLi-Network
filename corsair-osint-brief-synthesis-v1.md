# CORSAIR PHASE 8.5.8 — DAILY BRIEF SYNTHESIS DESIGN

**Scope:** The operator-impact synthesis layer where all Tier 1 sources converge into a single consolidated morning intelligence view
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-INDEX.md`](corsair-osint-INDEX.md), all per-source deep-dives, [`corsair-osint-source-health-ui-v1.md`](corsair-osint-source-health-ui-v1.md)
**Status:** Design spec for the final Phase 8.5 sub-phase. Defines how five independent source signals synthesize into one coherent operator view. Implementation depends on 8.5.3 through 8.5.7 each completing their own Brief integration sub-tasks.

---

## Document Purpose

Each per-source spec describes how its individual signals reach the Brief surface. This document describes the *synthesis* — how five independent streams compose into one coherent operator-facing morning view that serves the Sovereign's actual cognitive task.

That cognitive task is specific: each morning, the operator opens Corsair and needs to answer "what should I know about that has changed since I last looked?" in five minutes or less. The answer comes from many sources. The synthesis decides what to surface, in what order, with what context.

This spec covers:
- The synthesis algorithm — what gets selected, what gets filtered, how priority is decided
- The Brief layout — how the consolidated view renders
- Relevance scoring — operator-specific tuning so noise doesn't drown signal
- Interaction patterns — how the operator drills from synthesis into source detail
- The relationship between External Intelligence sections and the rest of the Brief content

---

# PART ONE — THE SOVEREIGN'S MORNING COGNITIVE TASK

The Brief is not a news feed. It is a senior intelligence officer briefing a senior commander. The operator does not have time to read everything; the operator has time to read what matters.

## What "what matters" means operationally

Five categories of mattering, in rough priority order:

1. **Pursuit-relevant signals** — anything that touches an Opportunity or Award the operator is actively tracking.
2. **Adversary signals** — actions, statements, or position changes by Organizations in the operator's `posture.adversaries[]` (across her active pursuits).
3. **Customer signals** — actions, statements, or position changes by the agencies the operator pursues.
4. **Capability-segment signals** — broader intelligence in the operator's NAICS/PSC space that doesn't yet touch a specific pursuit but reshapes the segment.
5. **Background context** — geopolitical, congressional, think-tank signals that frame the longer arc.

The synthesis surface allocates screen real estate accordingly: categories 1-3 dominate; category 4 gets a second tier; category 5 is the bottom-of-Brief context layer.

## What the operator should NOT see by default

Doctrine §IV: "No artificial urgency. Corsair does not manufacture alerts, badges, or notifications to drive engagement."

The Brief synthesis explicitly does not:
- Surface every record produced by every source.
- Use red badges or counts to compel attention.
- Repeat the same signal multiple times across categories.
- Promote items that are routine (e.g., minor 8-K filings without material content).

When in doubt, hide. The operator can always expand a category or drill into source detail. Reducing noise is more valuable than ensuring coverage.

---

# PART TWO — THE SYNTHESIS ALGORITHM

Each morning's Brief is computed by a nightly Cloud Function (`functions/src/jobs/briefSynthesisNightly.ts`) that runs at 5:00 AM local-operator-timezone (workspace setting; default UTC).

## Step 1 — Collect signals from last 24 hours

For each workspace, query all Signals created or updated in the prior 24 hours from any of the five sources. Plus Award and Opportunity entities created or transitioned states.

Initial volume: typically 50-300 raw signals per active workspace per day.

## Step 2 — Score each signal for relevance

Relevance score per signal is a weighted sum:

```
relevance =
    pursuit_relevance      × 4.0
  + adversary_relevance    × 3.0
  + customer_relevance     × 2.5
  + capability_relevance   × 1.5
  + recency_factor         × 1.0
  + magnitude_factor       × 1.0
```

Where each factor is normalized 0.0 to 1.0:

**`pursuit_relevance`** — does this signal touch an Opportunity or Award the operator is tracking?
- Direct linkage (Signal `relatedIds` contains a tracked Opportunity/Award): 1.0
- Indirect linkage (touches an Organization that's a prime/adversary on a tracked pursuit): 0.6
- No linkage: 0.0

**`adversary_relevance`** — does this signal touch an Organization in `posture.adversaries[]` across any active pursuit?
- Yes, currently active adversary on a tracked pursuit: 1.0
- Yes, but adversary on an archived/lost pursuit: 0.3
- No: 0.0

**`customer_relevance`** — does this signal involve a customer agency the operator pursues?
- Agency is in operator's customer watchlist: 1.0
- Agency is in broader operator's customer history but not active watchlist: 0.5
- No: 0.0

**`capability_relevance`** — does this signal's NAICS/PSC/topic match the operator's capability segment?
- Direct NAICS match in operator's watchlist: 1.0
- Adjacent NAICS (same 4-digit group): 0.6
- Same broader segment (e.g., R&D services umbrella): 0.3
- No: 0.0

**`recency_factor`** — exponentially decays with age:
- 0-6 hours: 1.0
- 6-12 hours: 0.8
- 12-24 hours: 0.5

**`magnitude_factor`** — source-and-type-specific:
- Award > $50M: 1.0
- Award > $10M: 0.7
- Award > $1M: 0.4
- Award < $1M: 0.2
- 8-K item 1.01 (material contract) or 5.02 (executive transition): 0.8
- 10-K filing: 0.6
- Form 4 (insider trade) > $1M: 0.5
- GAO protest sustained: 0.9
- GAO protest denied: 0.4
- GAO protest filed (status pending): 0.5
- Congressional hearing on tracked topic: 0.7
- Nomination confirmed: 0.7
- Nomination introduced: 0.3
- SAM.gov solicitation in watchlist: 0.7
- SAM.gov sources sought: 0.5
- SAM.gov special notice: 0.3
- SAM.gov amendment (deadline change): 0.6
- SAM.gov amendment (other): 0.3

Scores are computed during the nightly synthesis run and stored as Signal metadata.

## Step 3 — Categorize each signal

Each signal is assigned to one of the five categories:

```typescript
function categorize(signal: Signal, relevance: RelevanceComponents): SignalCategory {
  if (relevance.pursuit_relevance >= 0.6) return 'pursuit';
  if (relevance.adversary_relevance >= 0.6) return 'adversary';
  if (relevance.customer_relevance >= 0.6) return 'customer';
  if (relevance.capability_relevance >= 0.6) return 'capability';
  return 'context';
}
```

Signals at the threshold boundary (e.g., touches both a pursuit and a customer) categorize to the higher-priority category (pursuit wins over adversary wins over customer wins over capability wins over context).

## Step 4 — Apply category-level filtering

Each category has a soft cap on how many signals can surface:

| Category | Soft cap | Hard cap |
|---|---|---|
| Pursuit | 10 | 20 |
| Adversary | 5 | 10 |
| Customer | 5 | 10 |
| Capability | 5 | 8 |
| Context | 3 | 5 |

Soft cap: shown by default. Hard cap: total considered for "show more" expansion. Signals beyond hard cap drop entirely from this morning's Brief but remain available in source-specific views.

Within each category, signals sort by total relevance score descending. Ties broken by recency (newer wins).

## Step 5 — Deduplicate

The same underlying event may produce multiple signals (e.g., a contract award produces a DoD News provisional Signal AND a USAspending authoritative Signal AND potentially an 8-K item 1.01 referencing it). Deduplication rules:

- Award entities with `reconciliation.firstSeenSource: 'dod_news'` reconciled to USAspending: surface as one item (the consolidated Award, not separate Signals).
- 8-K Signal that references a PIID matching a same-day Award: surface the Award, suppress the 8-K Signal (it's redundant intelligence).
- GAO protest filing + subsequent decision: surface the latest state, suppress prior status Signals from the same docket.
- SAM.gov solicitation + subsequent amendment: surface the parent Opportunity once, with amendment as sub-bullet.

Deduplication runs before category cap enforcement — i.e., a deduplicated single surface item counts as one within the cap.

## Step 6 — Format for rendering

Each surviving signal gets a one-line rendering:
- Glyph (category-coded; see Part Three)
- Subject (Organization, Person, or Opportunity name)
- Verb phrase (what happened)
- Quantitative anchor (dollar value, days, etc. — only when meaningful)
- Source attribution (small, --t3 muted)

Examples:
```
◆ LOCKHEED MARTIN    awarded $145M F-35 sustainment contract       USASpending · 14h
◇ AIR FORCE          posted RFP for AI-enabled logistics platform  SAM.gov · 6h
◍ NORTHROP GRUMMAN   filed GAO protest on Sentinel award           GAO · 12h
○ FRANK KENDALL      testified before HSAS on FY27 budget request  Congress.gov · 18h
● BOEING             8-K reports leadership transition              SEC · 22h
```

Glyph palette varies per category (Part Three).

---

# PART THREE — THE BRIEF LAYOUT

The synthesized External Intelligence section in the Brief.

## Layout structure

```
┌──────────────────────────────────────────────────────────────────────────┐
│ EXTERNAL INTELLIGENCE                              Last 24 hours · 17    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ ── On your pursuits ──                                              [+]    │
│                                                                            │
│  ◆ LOCKHEED MARTIN    awarded $145M F-35 sustainment contract             │
│                       Touches your "F-35 Sustainment Phase 2" pursuit     │
│                                                            USASpending·14h │
│                                                                            │
│  ◆ AIR FORCE          posted RFP for AI-enabled logistics platform        │
│                       Matches your "AF AI Logistics" pursuit (watchlist) │
│                                                                SAM.gov·6h │
│                                                                            │
│  ◆ AIR FORCE          extended deadline on RFP-FA8611-25-R-0042            │
│                       Your "F-35 Sustainment Phase 2" pursuit responds    │
│                       in 14 days (was 7 days)               SAM.gov·9h    │
│                                                                            │
│ ── Adversary activity ──                                              [+] │
│                                                                            │
│  ◍ NORTHROP GRUMMAN   filed GAO protest on Sentinel award                 │
│                       Adversary on 3 of your active pursuits              │
│                                                                  GAO·12h │
│                                                                            │
│  ◍ BOEING             8-K reports CFO departure                            │
│                       Adversary on "F-35 Sustainment Phase 2"             │
│                                                                  SEC·22h │
│                                                                            │
│ ── Customer terrain ──                                                [+] │
│                                                                            │
│  ◊ FRANK KENDALL      testified before HSAS on FY27 budget request        │
│                       Department of the Air Force                          │
│                       Themes: software, sustainment, AI    Congress.gov·18h│
│                                                                            │
│  ◊ HSAS               nominated David Doe for Under Secretary AT&L         │
│                                                            Congress.gov·5h │
│                                                                            │
│ ── Your capability segment ──                                         [+] │
│                                                                            │
│  • SAIC               awarded $50M cyber services contract (NAICS 541512) │
│                                                            USASpending·8h │
│                                                                            │
│  • CACI               announced acquisition of cyber boutique             │
│                                                                  SEC·11h │
│                                                                            │
│ ── Background context ──                                              [+] │
│                                                                            │
│  · CSIS               published report on PRC pacing in AI-DoD adoption   │
│                                                              (Tier 2) ·4d │
│                                                                            │
│  · BROOKINGS          published analysis of NDAA conference report         │
│                                                              (Tier 2) ·2d │
│                                                                            │
│ [ Show 12 more items below the surface threshold ]                        │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

## Glyph palette per category

- **◆ Pursuit-relevant** — solid diamond (high attention)
- **◍ Adversary** — half-filled diamond (moderate attention)
- **◊ Customer terrain** — outline diamond (informational)
- **• Capability segment** — small filled dot (lighter attention)
- **· Background context** — small open dot (lightest)

The glyph hierarchy itself is a visual cue. Operator's eye is drawn down from heaviest glyphs to lightest, mirroring the priority order.

## Section headers

Each category is its own section with a header. Section header includes:
- Category name (mono uppercase, --t2 muted)
- Expand toggle `[+]` to show all hard-cap items in this category

## Per-item rendering

Three lines per item:
1. Glyph + Subject (mono uppercase, --text bone) + Verb phrase (--text bone)
2. Context line: why this matters (--t2 paper)
3. Source attribution (--t3 paper-2): source · age

Context line examples:
- "Touches your '<pursuit name>' pursuit"
- "Adversary on N of your active pursuits"
- "Matches your '<saved search name>' (watchlist)"
- "Department of the Air Force" (when customer is the surfacing factor)
- (omitted when redundant with the verb phrase)

## Quantitative anchors

When a dollar value, day count, percentage, or other number sharpens the meaning, it appears in the verb phrase. Examples:
- "awarded $145M F-35 sustainment contract"
- "extended deadline on RFP-FA8611-25-R-0042 to 14 days out (was 7)"
- "8-K reports 12% revenue decline in defense segment"

When the number doesn't sharpen meaning, omit it. Don't pad.

## Empty state

When no signals reach surface in a category:

```
│ ── Adversary activity ──                                              [-] │
│                                                                            │
│   No significant adversary activity in the last 24 hours.                 │
│                                                                            │
```

The empty-state message is also in the Brief — surfacing the absence is itself information. Doctrine §IV: stillness is a state, not the absence of state.

## Items below surface threshold

When the category had more items than the soft cap, they're available via "Show N more items below the surface threshold." Clicking expands the category in-place.

When the operator dismisses an item (right-click → "Dismiss this item; show me next"), the next-highest-score item from below the threshold takes its slot. The dismissal reason is recorded for future scoring tuning.

---

# PART FOUR — RELEVANCE SCORING TUNING

The relevance algorithm in Part Two has explicit weights. These are defaults; the operator should be able to tune.

## Per-workspace weight overrides

Workspace settings include a "Brief tuning" section:

```
Brief priorities (drag to reorder, slider to weight):

  Pursuit signals         [████████████░░] 8 / 10
  Adversary signals       [█████████░░░░░] 6 / 10
  Customer signals        [████████░░░░░░] 5 / 10
  Capability signals      [████░░░░░░░░░░] 3 / 10
  Background context      [██░░░░░░░░░░░░] 2 / 10
```

Sliders adjust the multipliers in the relevance formula. Operator who wants more background context can raise the context multiplier; operator who wants laser focus on pursuits can lower everything else.

## Dismissal feedback loop

When the operator dismisses an item from the Brief, the system records:
- The signal type, source, magnitude
- The category it was surfaced in
- The relevance components that scored it above threshold

Over time, dismissal patterns inform per-workspace adjustments. For example:
- Operator dismisses 80% of Form 4 surfacings → reduce Form 4 magnitude weight for this workspace.
- Operator dismisses CSIS publications → reduce capability_relevance for that source.

Phase 8.5.8 implements basic dismissal logging. Adaptive scoring is a Phase 9+ enhancement.

## Pinning

Operator can pin a specific signal to the Brief, preventing dismissal and keeping it surfaced until manually unpinned. Useful for:
- A protest decision that's still pending and the operator wants to remember to check
- An RFP deadline approaching that the operator wants in the Brief daily

Pinned items render with a small pin icon and persist at the top of their category until unpinned.

---

# PART FIVE — INTERACTION PATTERNS

## Click-through paths

- **Click on subject name** (e.g., "LOCKHEED MARTIN"): navigates to Theater surface centered on that Organization.
- **Click on verb phrase / item body**: opens the underlying Signal or Award/Opportunity in Inspector.
- **Click on source attribution** (e.g., "USASpending · 14h"): opens Source Health detail view for that source.
- **Click on category header**: expands/collapses all items in that category.
- **Click on `[+]`**: shows all items above hard cap.
- **Click on context line** (e.g., "Touches your 'F-35 Sustainment Phase 2' pursuit"): navigates to that pursuit in the Pipeline.

## Right-click / context menu

Right-clicking any item exposes:
- **Open** — same as click on body.
- **Open in new tab** — preserves current Brief while exploring.
- **Dismiss** — removes from this morning's Brief.
- **Snooze** — hides for 7 days (for items that the operator will care about later but not now).
- **Pin** — pins to Brief until unpinned.
- **Why this surfaced** — opens a transparency popover (Part Six).

## "Why this surfaced" popover

When the operator wants to understand why an item is in their Brief:

```
┌─────────────────────────────────────────────────────┐
│ Why this surfaced                                 ×  │
├─────────────────────────────────────────────────────┤
│                                                       │
│ LOCKHEED MARTIN awarded $145M F-35 sustainment       │
│                                                       │
│ Relevance score: 7.3                                 │
│                                                       │
│ Components:                                           │
│   Pursuit linkage:       4.0  (touches your          │
│                                "F-35 Sustainment      │
│                                Phase 2" pursuit)      │
│   Adversary relevance:   0.0  (Lockheed not          │
│                                currently in          │
│                                posture.adversaries)  │
│   Customer relevance:    1.25 (Air Force is in       │
│                                your customer         │
│                                watchlist)             │
│   Capability relevance:  0.45 (NAICS 336411 adjacent │
│                                to your watchlist)    │
│   Recency factor:        0.80 (14 hours old)         │
│   Magnitude factor:      0.80 ($145M; above $50M)    │
│                                                       │
│ Surface category: Pursuit-relevant                   │
│                                                       │
└─────────────────────────────────────────────────────┘
```

This is Doctrine §IV alignment: the operator can always interrogate the platform's reasoning. No opaque scores; every number explained.

## Keyboard navigation

- `↓` / `↑` move selection through Brief items.
- `Enter` opens selected item.
- `D` dismisses selected.
- `P` pins selected.
- `S` snoozes selected.
- `?` opens "Why this surfaced."

---

# PART SIX — RELATIONSHIP WITH REST OF BRIEF

The Brief surface has existing sections beyond External Intelligence:
- Daily Brief (existing pursuit updates, today's meetings, decisions to make)
- Pass-down notes (existing institutional memory)

The External Intelligence section integrates without disrupting these.

## Ordering on the surface

```
1. Daily Brief (existing — operator's own activity context)
2. External Intelligence (this design — what the world did since last look)
3. Source Health (separate design — is Corsair listening?)
4. Pass-down notes (existing)
```

Existing Daily Brief content is operator-internal; External Intelligence is operator-external. The pairing gives a complete picture of "what's changed since I last looked" across both internal and external dimensions.

## Cross-references to existing Brief content

When a Daily Brief item (e.g., "meeting with Capt. Reeves tomorrow") and an External Intelligence item are about the same entity, the platform surfaces a subtle linking indicator:

```
│  Daily Brief                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Meeting with Capt. Reeves tomorrow at 14:00                       │   │
│  │  Subject: F-35 sustainment capture                                  │   │
│  │  ── See External Intelligence: 2 related items below ──             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
```

Click on the cross-reference scrolls to and highlights the related External Intelligence items.

---

# PART SEVEN — IMPLEMENTATION SUB-PHASES

8.5.8 is itself decomposable into four sub-sub-phases.

## Sub-phase 8.5.8.1 — Synthesis algorithm (3-4 days)
Cloud Function that runs nightly, computes relevance scores, categorizes, deduplicates, writes synthesized output to `workspaces/{wsId}/derivedViews/dailyBrief/{date}`.

**Deliverable:** Working nightly synthesis producing a structured Brief output.

## Sub-phase 8.5.8.2 — Brief surface integration (4-5 days)
Client UI consuming the synthesized output. Section rendering per Part Three. Empty states. Expand/collapse.

**Deliverable:** Operator sees synthesized External Intelligence in Brief each morning.

## Sub-phase 8.5.8.3 — Interaction patterns (3-4 days)
Click-throughs, right-click menus, "Why this surfaced" popover, keyboard navigation.

**Deliverable:** Full interaction model functional.

## Sub-phase 8.5.8.4 — Tuning and dismissal feedback (2-3 days)
Per-workspace weight overrides in settings. Dismissal logging. Pinning and snoozing functional.

**Deliverable:** Operator can tune the Brief to her preference.

## Total Phase 8.5.8 estimate: 12-16 operator-days (~2-3 operator-weeks).

---

# PART EIGHT — ACCEPTANCE CRITERIA

1. **Nightly synthesis runs** producing structured Brief output for each active workspace.
2. **Five categories** render correctly with the documented glyph palette.
3. **Relevance scoring** prioritizes pursuit-touching signals above adversary above customer above capability above context.
4. **Soft caps** (10/5/5/5/3) respected; hard caps available via expand.
5. **Deduplication** prevents the same underlying event from surfacing multiple times.
6. **"Why this surfaced"** popover renders with accurate component breakdown.
7. **Click-through paths** functional to Inspector, Theater, Pipeline, Source Health.
8. **Right-click menu** functional: Open, Dismiss, Snooze, Pin, Why.
9. **Per-workspace weight overrides** in settings affect synthesis output.
10. **Dismissal logging** captures operator dismissals for future tuning.
11. **Empty states** render appropriately when categories have no items.
12. **Cross-references** between Daily Brief and External Intelligence items work when entities match.
13. **No item surfaces in multiple categories** simultaneously (deduplication strict).
14. **Doctrine §IV alignment:** every score is explainable in plain language via "Why this surfaced."

---

# PART NINE — OPEN IMPLEMENTATION QUESTIONS

## BSQ-1 — Synthesis timing

**Question:** Run nightly at 5 AM operator local time, or on-demand when operator first opens Brief?

**Tradeoff:** Nightly is more predictable but stale if operator opens Brief 12 hours after computation. On-demand is fresher but adds latency on Brief open.

**Proposal:** Nightly run at 5 AM operator local. On-demand re-run available via a refresh button. Refresh marks Brief as "just refreshed" with timestamp.

**Recommendation:** Confirm hybrid.

## BSQ-2 — Cross-workspace operator (future)

**Question:** Operator with multiple workspaces — does each workspace have its own Brief, or does one Brief aggregate across?

**Proposal:** Per-workspace Brief for Phase 8.5.8. Cross-workspace aggregation is Phase 9+.

**Recommendation:** Confirm per-workspace.

## BSQ-3 — Mobile rendering

**Question:** Does the Brief synthesize render on mobile?

**Proposal:** Phase 8.5.8 desktop only. Mobile is Phase 9+.

**Recommendation:** Confirm.

## BSQ-4 — Snooze duration

**Question:** When operator snoozes an item, default duration?

**Proposal:** 7 days. Operator can choose 1 day / 7 days / 30 days from right-click menu.

**Recommendation:** Confirm.

## BSQ-5 — Dismissal feedback loop sensitivity

**Question:** How quickly should the system tune from dismissal patterns?

**Proposal:** Phase 8.5.8 logs dismissals but doesn't auto-tune. Adaptive scoring is Phase 9+ with explicit operator opt-in.

**Recommendation:** Confirm log-only for now.

## BSQ-6 — Magnitude factor floor

**Question:** Should very-low-magnitude items be excluded entirely rather than just scoring low?

**Proposal:** Yes. Set per-source minimum thresholds:
- Awards under $1M with no other relevance signal: exclude.
- Form 4 sales under $100K: exclude (operator doesn't care about routine ESPP).
- SAM.gov special notices in unrelated NAICS: exclude.

**Recommendation:** Confirm per-source floors.

## BSQ-7 — Weekend / holiday handling

**Question:** When the operator opens Corsair Monday morning, does the Brief show only last 24 hours (missing weekend signals) or extended window?

**Proposal:** Extended window for Monday morning: 72 hours (Friday morning through Monday morning). Detected via "first Brief view this calendar week."

**Recommendation:** Confirm 72-hour window for Monday and post-holiday opens.

---

# CLOSING NOTES

## Why this synthesis matters

The five source integrations individually are valuable but, presented as five separate streams, would overwhelm the operator and undermine Doctrine §IV (Confidence Principle). The operator should not have to be the integrator. The platform integrates; the operator reads the result.

The synthesis is also where the Corsair platform demonstrates that it understands the operator. A generic OSINT feed shows everything; this synthesis shows what matters to *this* operator with *her* pursuits and *her* terrain. The synthesis is where Phase 8.5 stops being a data pipeline and becomes intelligence.

## Implementation order

8.5.8 implements after 8.5.3 through 8.5.7 each have at least their "Brief surface integration" sub-tasks complete (producing per-source Signal feeds). The synthesis layer reads those feeds.

Cross-workspace dependencies: none. 8.5.8 is workspace-isolated like everything else.

## Cross-references

- All five source deep-dives describe per-source Brief surfacing; 8.5.8 layer consumes their output.
- Source Health UI (separate doc) is adjacent to but distinct from External Intelligence synthesis.
- Architecture sketch's OQ-6 (Source Health placement) implicitly applies to External Intelligence placement: both live in the Brief.

## Maintenance principle

This document is v1.0. The synthesis algorithm and category structure are the load-bearing design; revisions to weights, magnitudes, and per-source thresholds are expected as operator usage surfaces patterns. Major revisions to the category structure require operator-approved amendment.

---

*End of Brief synthesis design v1.0. Awaiting parallel build session implementation.*
