# CORSAIR OSINT — OPERATOR ONBOARDING FLOW DESIGN

**Scope:** The first-time experience for an operator enabling Phase 8.5 OSINT integration on a workspace
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** All Phase 8.5 design artifacts, particularly [`corsair-osint-source-health-ui-v1.md`](corsair-osint-source-health-ui-v1.md) and [`corsair-osint-watchlist-ux-v1.md`](corsair-osint-watchlist-ux-v1.md)
**Status:** UX flow design connecting migration approval, source selection, watchlist configuration, and first-Brief delivery into a coherent first-time activation experience.

---

## Document Purpose

Phase 8.5 introduces meaningful new operator-facing surfaces: Source Health, External Intelligence in Brief, Watchlist configuration, Recompete Watch, Proposed Pursuits. A new operator (whether net-new to Corsair or an existing operator's new workspace) encounters all of these for the first time when Phase 8.5 activates.

Without a deliberate onboarding flow, the operator experience is fragmented:
- Settings screen for migration approval
- Different settings screen for source enable/disable
- Yet another for watchlist configuration
- Brief surface that suddenly shows External Intelligence with no context

This document designs a unified flow that walks the operator through activation in 10-15 minutes, ending with a working Phase 8.5 deployment producing relevant Brief content. The flow respects Doctrine §IV (Confidence Principle): the operator should finish onboarding more certain of what Corsair is doing for her, not less.

The flow is **operator-initiated, operator-paced, and skippable** at any point. Operators who prefer to configure manually can do so at any time.

---

# PART ONE — THE FIRST-TIME OPERATOR'S MENTAL STATE

Before designing the flow, understand who's at the keyboard.

## Scenario A: Existing operator enabling Phase 8.5 on existing workspace

Context: operator has been using Corsair pre-Phase-8.5. Their workspace has accumulated entities (Persons, Organizations, Opportunities, Meetings). Phase 8.5 just shipped. Operator opens Corsair as usual; sees notice that "External intelligence is now available — set up?"

Mental state:
- Knows the platform
- Cares about workspace data integrity (existing accumulated work is sacred)
- Likely curious but cautious — "what changes for me?"
- Will accept guided activation if the value is clear

## Scenario B: New operator on a fresh workspace

Context: operator is new to Corsair (or has a new workspace alongside an existing one). Just authenticated; workspace is empty.

Mental state:
- Doesn't know the platform deeply
- Wants to see value quickly
- Will tolerate setup if rewarded with concrete capability
- May abandon if onboarding feels heavy

## Scenario C: Existing operator on existing workspace, no migration yet

Context: operator opens Corsair, hasn't seen Phase 8.5 messaging yet (migration not approved). Default state: workspace works as before; external sources inactive.

Mental state:
- May not realize Phase 8.5 is available
- Needs prompt that surfaces the new capability without disrupting current work

The onboarding flow handles all three scenarios with branching paths off the same trunk.

---

# PART TWO — ONBOARDING GOALS

Doctrine §IV translated to onboarding success criteria:

## G-1 — Operator understands what Phase 8.5 does
Within the first 60 seconds, the operator can answer: "what is Corsair listening to now that it wasn't before?"

## G-2 — Operator's existing work is unaffected
Migration is explicit, gated by approval, reversible. Operator's accumulated entities never look different post-onboarding unless they're being deliberately enhanced.

## G-3 — Operator has a working watchlist within 10 minutes
End state: Corsair has a populated watchlist appropriate to the operator's pursuits and is actively syncing relevant sources.

## G-4 — Operator's first Brief arrives within 24 hours
The next morning after onboarding, operator opens Corsair and sees relevant External Intelligence in the Brief surface. This is the moment Phase 8.5 proves its value.

## G-5 — Operator can pause and resume
At any point in the flow, operator can save progress and return later. Onboarding doesn't lock the operator into a single uninterrupted session.

## G-6 — Operator can opt out cleanly
If the operator decides Phase 8.5 isn't right for them, they can disable external sources without losing their existing workspace.

---

# PART THREE — THE FLOW

A linear flow with branching paths. Each step has explicit entry conditions, operator actions, exit conditions, and back/skip options.

## Entry trigger

The flow auto-presents in three scenarios:
1. **Scenario A:** Operator opens an existing workspace that has Phase 8.5 features available but migration not yet approved. A non-intrusive banner appears at top of Brief.
2. **Scenario B:** New workspace creation completes; the operator lands on an empty Brief with "Welcome to Corsair" content that includes Phase 8.5 setup CTA.
3. **Scenario C:** Operator clicks "External Intelligence" anywhere in Corsair when not yet activated.

Manual trigger: operator can access onboarding any time via Settings → Onboarding → Start Phase 8.5 setup.

## Banner / Entry CTA

For Scenario A (existing workspace):

```
┌──────────────────────────────────────────────────────────────────┐
│ External intelligence is now available for this workspace.       │
│ Set up takes about 10 minutes.                                    │
│                                                                    │
│ [ Show me what this means ]    [ Not now ]                       │
└──────────────────────────────────────────────────────────────────┘
```

"Not now" dismisses banner for 7 days. Banner returns weekly until either accepted or operator dismisses permanently from settings.

"Show me what this means" opens the onboarding flow.

---

## Step 1 — Orientation (60 seconds)

```
┌──────────────────────────────────────────────────────────────────┐
│ EXTERNAL INTELLIGENCE                                      1 of 5 │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Corsair can now listen to public defense procurement data on      │
│ your behalf:                                                       │
│                                                                    │
│   • New solicitations posted to SAM.gov                           │
│   • Contracts awarded by DoD and other agencies                   │
│   • Protests filed at GAO                                          │
│   • SEC filings from publicly traded competitors                  │
│   • Congressional hearings, nominations, and bill activity        │
│                                                                    │
│ What changes for you: each morning, your Brief shows what         │
│ happened in your watchlist while you weren't looking.             │
│                                                                    │
│ What doesn't change: your existing pursuits, contacts, notes,     │
│ and pass-down stay exactly as they are. Nothing in your           │
│ workspace gets overwritten.                                       │
│                                                                    │
│                                          [ Continue ]   [ Cancel ]│
└──────────────────────────────────────────────────────────────────┘
```

**Operator action:** Read, click Continue or Cancel.

**Exit:** Continue → Step 2. Cancel → returns to Brief, banner reappears in 7 days.

---

## Step 2 — Workspace migration approval (1-3 minutes)

```
┌──────────────────────────────────────────────────────────────────┐
│ WORKSPACE SCHEMA UPDATE                                    2 of 5 │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Before external sources can flow into your workspace, your        │
│ data needs to be prepared. This is a one-time schema update.      │
│                                                                    │
│ What this does:                                                   │
│   • Adds source-tracking to your existing entities                │
│   • Creates collections for new entity types (Awards)             │
│   • Initializes source configuration paths                        │
│                                                                    │
│ What this does NOT do:                                            │
│   • Modify any field on your existing entities                    │
│   • Remove or merge any of your records                           │
│   • Change how Corsair looks or behaves                           │
│                                                                    │
│ The update is fully reversible. You can undo it anytime           │
│ from Settings.                                                     │
│                                                                    │
│ ── Workspace inventory ──                                          │
│                                                                    │
│  4,287 entities scanned                                            │
│  • 1,243 Persons                                                  │
│  • 856 Organizations                                              │
│  • 23 Opportunities                                                │
│  • 1,201 Meetings                                                 │
│  • 964 Signals                                                    │
│                                                                    │
│  Estimated migration duration: 45 seconds                         │
│                                                                    │
│  [ Approve and apply migration ]   [ Back ]                       │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Operator action:** Read inventory, click Approve.

**Behind the scenes:** When operator clicks Approve, the migration runs (Phase 8.5.1 spec). Progress shows in real-time:

```
┌──────────────────────────────────────────────────────────────────┐
│ APPLYING SCHEMA UPDATE                                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Step 1 of 5 — Adding source tracking to existing entities         │
│ ████████████████████░░░░  3,127 of 4,287 (73%)                   │
│                                                                    │
│ Estimated time remaining: 12 seconds                              │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

On completion:

```
┌──────────────────────────────────────────────────────────────────┐
│ ✓ MIGRATION COMPLETE                                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Your workspace is now ready for external intelligence.            │
│                                                                    │
│ Summary:                                                          │
│  • 4,287 entities updated with source tracking                    │
│  • 0 entities encountered errors                                  │
│  • 0 fields modified on existing records                          │
│  • Source collections initialized                                 │
│                                                                    │
│  [ Continue setup ]                                                │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Exit:** Continue → Step 3.

**Failure path:** If migration fails (validation errors per migration spec V-1 through V-6), the flow shows the error and offers to roll back. Operator can fix anomalies and retry.

---

## Step 3 — Source selection (1-2 minutes)

```
┌──────────────────────────────────────────────────────────────────┐
│ WHICH SOURCES SHOULD CORSAIR LISTEN TO?                    3 of 5 │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Most operators enable all sources. You can disable any anytime    │
│ from the Source Health view.                                      │
│                                                                    │
│ ☑ SAM.gov                                                          │
│   Solicitations and opportunities · Free · 1000 req/hour          │
│   Powers your Pipeline surface with new pursuit candidates        │
│                                                                    │
│ ☑ USAspending.gov + DoD News Contract Announcements               │
│   Federal contract awards · Free · 1000 req/hour                  │
│   Powers your Recompete Watch and competitor wins view            │
│                                                                    │
│ ☑ GAO Bid Protest                                                  │
│   Protest filings and decisions · Free · No published limit       │
│   Surfaces protest activity affecting your pursuits                │
│                                                                    │
│ ☑ SEC EDGAR                                                        │
│   SEC filings from publicly traded competitors · Free · 10/sec    │
│   Material events, executive transitions, financial disclosures   │
│                                                                    │
│ ☑ Congress.gov                                                     │
│   Congressional hearings, nominations, bill activity · Free       │
│   Defense committee terrain and political appointee tracking      │
│                                                                    │
│                                          [ Continue ]   [ Back ]  │
└──────────────────────────────────────────────────────────────────┘
```

**Operator action:** Confirm or adjust selection.

All five sources are checked by default. The framing ("Most operators enable all sources") sets the expectation; the per-source descriptions confirm value.

**Exit:** Continue → Step 4.

---

## Step 4 — Watchlist setup (3-5 minutes)

Step 4 branches based on operator's existing workspace state.

### Step 4a — If workspace has existing Opportunities (Scenario A)

```
┌──────────────────────────────────────────────────────────────────┐
│ WATCHLIST SETUP                                            4 of 5 │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Tell Corsair what to listen for on your behalf. We've analyzed    │
│ your 23 active pursuits to suggest a starting point.              │
│                                                                    │
│ CAPABILITIES                                                       │
│   ☑ NAICS 541330 Engineering Services    (12 pursuits)           │
│   ☑ NAICS 541512 Computer Systems Design (8 pursuits)            │
│   ☑ NAICS 541715 R&D in Phys/Eng/Life    (5 pursuits)            │
│   ☐ NAICS 541713 R&D in Biotechnology    (2 pursuits)            │
│                                                                    │
│ CUSTOMER AGENCIES                                                 │
│   ☑ Department of the Air Force (19 pursuits)                    │
│   ☑ DARPA                       (4 pursuits)                     │
│   ☑ Space Force                 (3 pursuits)                     │
│                                                                    │
│ COMPETITORS (from your adversary lists)                          │
│   ☑ Lockheed Martin    (8 pursuits)                              │
│   ☑ Northrop Grumman   (6 pursuits)                              │
│   ☑ Boeing             (4 pursuits)                              │
│                                                                    │
│ KEYWORDS                                                          │
│   ☑ AI / artificial intelligence (9 pursuits)                    │
│   ☑ autonomy            (7 pursuits)                             │
│                                                                    │
│ Want different choices? You can customize fully in the next       │
│ screen.                                                            │
│                                                                    │
│  [ Use this watchlist ]   [ Customize ]   [ Start blank ]         │
│  [ Back ]                                                          │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

Three paths forward:
- **Use this watchlist** — accept suggestions and proceed.
- **Customize** — opens the full Watchlist UX (per watchlist-ux v1) pre-populated with suggestions; operator edits and saves.
- **Start blank** — abandons suggestions; opens full Watchlist UX with empty state.

### Step 4b — If workspace is empty or has insufficient existing pursuits

```
┌──────────────────────────────────────────────────────────────────┐
│ WATCHLIST SETUP                                            4 of 5 │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Tell Corsair what to listen for on your behalf.                   │
│                                                                    │
│ Pick a starting point that's close to your work:                  │
│                                                                    │
│ ┌────────────────────────────┐  ┌────────────────────────────┐   │
│ │ DoD R&D Services            │  │ C4ISR                       │   │
│ │ Engineering, tech dev       │  │ Command, control, intel     │   │
│ │ [ Use this template ]       │  │ [ Use this template ]       │   │
│ └────────────────────────────┘  └────────────────────────────┘   │
│                                                                    │
│ ┌────────────────────────────┐  ┌────────────────────────────┐   │
│ │ Logistics & Sustainment     │  │ Construction & MILCON       │   │
│ │ Sustainment, logistics      │  │ Military construction       │   │
│ │ [ Use this template ]       │  │ [ Use this template ]       │   │
│ └────────────────────────────┘  └────────────────────────────┘   │
│                                                                    │
│ ┌────────────────────────────┐                                    │
│ │ Cyber & Information Security │                                  │
│ │ Cybersecurity services       │                                  │
│ │ [ Use this template ]        │                                  │
│ └────────────────────────────┘                                    │
│                                                                    │
│ Want to build it manually? [ Configure manually ]                 │
│                                                                    │
│  [ Back ]                                                          │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

Selecting a template applies its watchlist composition; operator can edit before continuing.

**Exit (both branches):** Save watchlist → Step 5.

---

## Step 5 — Initial sync and first Brief preview (operator-paced)

```
┌──────────────────────────────────────────────────────────────────┐
│ INITIAL SYNC                                               5 of 5 │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Corsair is now syncing your selected sources for the first time.  │
│                                                                    │
│ ◇ SAM.gov                       Initial backfill 0%               │
│ ◇ USASpending + DoD News        Initial backfill 0%               │
│ ◇ GAO Protest                   Connecting                         │
│ ◇ SEC EDGAR                     Connecting                         │
│ ◇ Congress.gov                  Connecting                         │
│                                                                    │
│ Initial backfill takes 30 minutes to several hours depending on   │
│ workspace size and source. You can close Corsair and come back —  │
│ the sync continues in the background.                             │
│                                                                    │
│ When initial sync completes, you'll see your first External       │
│ Intelligence Brief tomorrow morning.                              │
│                                                                    │
│  [ I'll check back later ]    [ Show me what's appearing live ]   │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

Two paths:
- **I'll check back later** — closes onboarding. Operator returns to normal Corsair view. Source Health shows initial-sync state. Brief shows External Intelligence section with "Initial sync in progress" message until first sync completes.
- **Show me what's appearing live** — opens a live progress view showing entities being created in real-time. Operator can watch the first 50-100 records ingest, see Opportunity titles, Award amounts, etc. Builds confidence that the system is working.

The live view updates every few seconds:
```
┌──────────────────────────────────────────────────────────────────┐
│ LIVE INGESTION                                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ SAM.gov: 142 opportunities so far                                 │
│  • Air Force AI Logistics RFP — posted 4 hours ago                │
│  • Space Force Satellite Operations Sources Sought — 8 hours ago  │
│  • DARPA Quantum Computing Phase II — yesterday                   │
│  • ...                                                            │
│                                                                    │
│ USASpending: 56 awards so far                                     │
│  • Lockheed Martin $145M F-35 sustainment — March 2026            │
│  • SAIC $50M cyber services — March 2026                          │
│  • ...                                                            │
│                                                                    │
│ Initial sync 18% complete · Estimated time remaining: 22 min      │
│                                                                    │
│  [ Close — sync continues in background ]                         │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

This live view is the activation moment — operator sees concrete data flowing for the first time.

**Exit:** Close → returns to normal Corsair. Sync continues. Source Health surfaces show progress.

---

## Post-onboarding: first morning Brief

The morning after onboarding (operator's next Brief view):

```
┌──────────────────────────────────────────────────────────────────┐
│ BRIEF                                                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Welcome back. This is your first External Intelligence Brief.     │
│                                                                    │
│ ── On your pursuits ──                                            │
│                                                                    │
│  ◆ Lockheed Martin awarded $145M F-35 sustainment contract        │
│  ◆ Air Force posted RFP for AI-enabled logistics platform         │
│                                                                    │
│ ── Adversary activity ──                                          │
│                                                                    │
│  ◍ Northrop Grumman filed GAO protest on Sentinel award           │
│                                                                    │
│ ── Customer terrain ──                                            │
│                                                                    │
│  ◊ Frank Kendall testified before HSAS on FY27 budget request     │
│                                                                    │
│ ── Your capability segment ──                                     │
│                                                                    │
│  • SAIC awarded $50M cyber services contract                      │
│                                                                    │
│ ── Source Health ──                                               │
│                                                                    │
│  ◆ All sources operational                                        │
│                                                                    │
│ ── First-time tip ──                                              │
│                                                                    │
│  Click any item to see why it surfaced and dig into details.      │
│  Don't see what you expected? Tune your watchlist in Settings.    │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

The first-time tip appears once and dismisses on dismiss or after 7 days.

---

# PART FOUR — FAILURE MODES AND RECOVERY PATHS

What can go wrong during onboarding and how to handle each.

## F-1 — Migration validation failure

Step 2 validation fails. Recovery:

```
┌──────────────────────────────────────────────────────────────────┐
│ MIGRATION VALIDATION ISSUE                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ The migration encountered an issue and was rolled back.           │
│                                                                    │
│ Details:                                                          │
│  3 orphan edges detected (links to entities that no longer       │
│  exist). These appear to be pre-existing data anomalies, not     │
│  caused by the migration.                                        │
│                                                                    │
│ Options:                                                          │
│                                                                    │
│  [ Show me the affected entities ] — review and fix              │
│  [ Skip and retry migration ] — proceed despite anomalies        │
│  [ Cancel migration ] — leave workspace as-is, exit onboarding   │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

The operator decides based on the nature of the anomaly. Most pre-existing data issues are recoverable.

## F-2 — Source authentication failure

Step 5 initial sync fails because an API key is invalid or User-Agent is wrong.

```
┌──────────────────────────────────────────────────────────────────┐
│ SOURCE CONNECTION ISSUE                                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Corsair couldn't authenticate with SEC EDGAR.                     │
│                                                                    │
│ The User-Agent header is required by SEC and must include a       │
│ valid contact email.                                              │
│                                                                    │
│  [ Continue without SEC EDGAR ]                                   │
│  [ Update User-Agent and retry ]                                  │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

Operator can proceed with a subset of sources; SEC EDGAR can be enabled later.

## F-3 — Operator abandons mid-flow

Operator closes browser or navigates away during onboarding. Recovery:

Onboarding state is persistent. Operator returns later and sees:

```
┌──────────────────────────────────────────────────────────────────┐
│ You started Phase 8.5 setup but didn't finish. Resume?            │
│                                                                    │
│ Progress: completed Step 2 of 5 (migration applied successfully). │
│                                                                    │
│ [ Resume from Step 3 ]    [ Start over ]    [ Skip for now ]      │
└──────────────────────────────────────────────────────────────────┘
```

State machine is forgiving — partial completion is normal.

## F-4 — Operator wants to opt out after partial setup

Operator decides Phase 8.5 isn't right after partial activation. Recovery:

Settings → Phase 8.5 → "Disable all external sources" option. This:
- Sets all source enable flags to false.
- Suspends scheduled syncs for this workspace.
- Preserves all migrated entities and external data already ingested.
- Allows re-enable any time.

If operator wants full reversal (undo migration):
- Settings → Phase 8.5 → "Roll back schema migration."
- Full rollback per migration spec.
- Workspace returns to pre-Phase-8.5 state.

---

# PART FIVE — ALTERNATE FLOWS

## Alt-A: Operator triggered from Source Health (Scenario C)

Operator clicks "External Intelligence" or Source Health when not yet activated. Skips Step 1 (orientation) since operator already knows what they're after; jumps to Step 2 (migration).

## Alt-B: Operator triggered from Watchlist Settings

Operator opens Settings → Watchlist before activating sources. Settings shows:

```
External sources are not yet active for this workspace.

You can configure a watchlist now (it'll be saved), but sources
won't sync until you complete Phase 8.5 setup.

[ Complete Phase 8.5 setup ]    [ Continue configuring watchlist ]
```

Either path is valid. Watchlist saves apply when sources are eventually enabled.

## Alt-C: Operator already migrated but not configured

Operator migrated workspace (Step 2 done) but didn't set up watchlist. Banner appears:

```
Phase 8.5 is partially configured. Set up watchlist to start
receiving External Intelligence.

[ Configure watchlist ]    [ Not now ]
```

Operator can complete in pieces.

---

# PART SIX — ONBOARDING METRICS

What to measure to know the flow is working.

## Activation metrics

- **Completion rate:** % of operators who start onboarding and reach Step 5.
- **Time to complete:** median minutes from Step 1 to Step 5.
- **Step abandonment:** which step has highest drop-off?
- **First Brief satisfaction:** % of operators who don't dismiss the first morning Brief items.

Phase 8.5 target completion rate: >75% (operators who start onboarding finish it). Median time to complete: <12 minutes.

## Health metrics post-onboarding

- **Day-1 retention:** does operator return the next day and open the Brief?
- **Week-1 watchlist tuning:** does operator edit their watchlist within the first week?
- **Week-1 dismissal rate:** if >50% of External Intelligence items get dismissed, watchlist is wrong.

Phase 8.5.8's dismissal feedback loop drives ongoing tuning.

## Failure metrics

- **Migration failure rate:** % of attempted migrations that don't complete cleanly.
- **Source auth failure rate at first sync:** indicates secrets management issue.
- **Onboarding restart count:** if operators are restarting the flow multiple times, the flow itself has issues.

Phase 8.5.8 target failure rates: <5% migration, <2% source auth, <1% multiple restarts.

These metrics live in Cloud Logging for operator dashboards. Phase 8.5 ships with basic instrumentation; analytics dashboards are Phase 9+.

---

# PART SEVEN — VOICE AND TONE

Doctrine §VIII applied to onboarding. Restrained, operational, adult.

## Tone examples

**Step 1 framing:**
- Not: "Welcome to Corsair's amazing new feature! 🎉"
- Yes: "Corsair can now listen to public defense procurement data on your behalf."

**Migration step:**
- Not: "Don't worry, this is super safe!"
- Yes: "The update is fully reversible. You can undo it anytime from Settings."

**Source selection:**
- Not: "Pick which sources you'd like to track"
- Yes: "Most operators enable all sources. You can disable any anytime."

**Watchlist suggest:**
- Not: "We made some smart suggestions for you!"
- Yes: "We've analyzed your 23 active pursuits to suggest a starting point."

**Initial sync:**
- Not: "Hang tight while we work our magic!"
- Yes: "Initial backfill takes 30 minutes to several hours depending on workspace size and source. You can close Corsair and come back — the sync continues in the background."

## Empty-state framing

Empty states tell the operator what's true without apologizing or alarming:
- Not: "Oh no, no sources are active yet!"
- Yes: "No external sources active yet."

- Not: "You haven't set up your watchlist — get on it!"
- Yes: "External sources sync but don't filter — you'll receive everything defense-related, which is too much to read."

The Sovereign respects directness over encouragement.

---

# PART EIGHT — ACCEPTANCE CRITERIA

The onboarding flow is shippable when:

1. **Entry banner** appears in the three documented scenarios (A, B, C).
2. **Step 1 orientation** clearly communicates what Phase 8.5 does and doesn't do.
3. **Step 2 migration** runs the migration per Phase 8.5.1 spec with real-time progress.
4. **Migration failure** produces the F-1 recovery flow with operator choice of options.
5. **Step 3 source selection** allows enabling/disabling individual sources with descriptions.
6. **Step 4a (with existing pursuits)** correctly surfaces suggested watchlist from operator's existing data.
7. **Step 4b (without existing pursuits)** offers all five default templates per Watchlist UX spec.
8. **Step 5 initial sync** triggers syncs and shows progress; offers "live view" path.
9. **Post-onboarding first Brief** includes the welcome tip the first time.
10. **Resume after abandonment** correctly restores partial state.
11. **Opt-out paths** correctly disable sources or roll back migration without data loss.
12. **Voice and microcopy** match Doctrine §VIII throughout.
13. **Time to complete** measurably <15 minutes for typical operator (test workspace and persona).

---

# PART NINE — OPEN IMPLEMENTATION QUESTIONS

## OIQ-1 — Forced vs. optional onboarding

**Question:** Should the operator be able to enable Phase 8.5 features without going through this guided flow? (E.g., a power user who knows what they're doing.)

**Proposal:** Yes. The flow is opt-in for guidance. Settings → Phase 8.5 → "Skip guided setup; configure manually" provides direct access to migration approval, source enable, watchlist editor without the flow.

**Recommendation:** Confirm.

## OIQ-2 — Operator-pause persistence

**Question:** If operator closes browser at Step 3, what state is preserved?

**Proposal:** Migration is persistent (Step 2 completion is durable). Source selection (Step 3) is a draft; not committed until Step 5. Watchlist (Step 4) is committed on save. When operator resumes, the flow jumps to first uncompleted step.

**Recommendation:** Confirm migration-persistent, source-selection-draft, watchlist-committed model.

## OIQ-3 — Live view detail depth

**Question:** Step 5's "Show me what's appearing live" view shows entity titles. Should it also show entity counts, dollar values, etc.?

**Proposal:** Phase 8.5 ships with titles + key fields (dollar amounts for Awards, dates for Opportunities). Richer detail is Phase 9+.

**Recommendation:** Confirm titles + key fields.

## OIQ-4 — First-Brief tip dismissal

**Question:** The "first-time tip" in the post-onboarding Brief — how is it dismissed?

**Proposal:** Auto-dismisses after 7 days. Manual dismiss via × button. Re-appears only if operator returns to onboarding flow (e.g., after a multi-month absence).

**Recommendation:** Confirm.

## OIQ-5 — Cross-workspace onboarding

**Question:** Operator with multiple workspaces — does each workspace require independent onboarding?

**Proposal:** Yes. Each workspace's Phase 8.5 activation is independent. Default templates and suggested settings carry from prior workspaces' configurations as proposals.

**Recommendation:** Confirm per-workspace.

## OIQ-6 — Onboarding analytics

**Question:** What instrumentation ships with onboarding for measuring activation metrics?

**Proposal:** Basic Cloud Logging events:
- `onboarding_started`
- `step_completed` (per step number)
- `step_abandoned` (per step number)
- `migration_completed`
- `watchlist_saved`
- `initial_sync_triggered`

Aggregation dashboards are Phase 9+.

**Recommendation:** Confirm basic instrumentation.

## OIQ-7 — Re-onboarding for new features

**Question:** When Corsair adds new Phase 8.x features (e.g., a new Tier 2 source becomes available), should operators see a new mini-onboarding for that feature?

**Proposal:** Yes. Pattern: new feature ships → workspace shows new feature banner → operator opts in to a smaller activation flow specific to that feature. Reuses onboarding components.

**Recommendation:** Confirm pattern; specific flows designed per feature.

---

# CLOSING NOTES

## Why a dedicated onboarding flow

The Phase 8.5 design produces a significant new capability in Corsair. Without dedicated onboarding, operators encounter the capability fragmented across multiple settings screens and surfaces. The flow consolidates the activation experience into one coherent narrative.

Doctrine §IV alignment is especially important here. The operator must finish onboarding more confident in Corsair than when they started. A fragmented activation experience destroys confidence; a guided flow builds it.

## Activation as the platform's first impression

For new operators (Scenario B), Phase 8.5 onboarding is often their first deep engagement with Corsair. Done well, it demonstrates the platform's restraint, clarity, and operational tone. Done poorly, it sends the wrong signal about everything that follows.

The flow's voice (Part Seven) is therefore not optional polish — it's part of the brand foundation.

## Cross-references

- Migration spec defines the safety contract this flow's Step 2 honors.
- Source Health UI defines the post-onboarding surface where source state lives.
- Watchlist UX defines the configuration experience this flow's Step 4 invokes.
- Brief synthesis defines what appears in the post-onboarding first Brief.
- Risk register's R-O1 (watchlist mis-configuration) is mitigated by Step 4's suggest/template paths.

## Implementation order

Onboarding implements alongside Phase 8.5.2 (framework) since it depends on the migration trigger HTTPS callable and source enable/disable mechanisms. The flow itself is client-side UI; underlying capabilities come from earlier sub-phases.

## Maintenance principle

This document is v1.0. As real operator usage surfaces friction points, the flow gets revised. Voice and microcopy are the most likely to need iteration; structural steps less so.

---

*End of onboarding flow design v1.0. Awaiting parallel build session implementation.*
