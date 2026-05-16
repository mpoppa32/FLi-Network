# CORSAIR SOURCE HEALTH UI DESIGN

**Scope:** Operator-facing surface for monitoring external source health and freshness
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md), [`corsair-osint-architecture-v1.md`](corsair-osint-architecture-v1.md), [`corsair-osint-migration-v1.md`](corsair-osint-migration-v1.md), [`corsair-osint-functions-framework-v1.md`](corsair-osint-functions-framework-v1.md)
**Status:** Design artifact (not a spec). Defines how the operator sees whether Corsair is currently listening to the world, and what to do when it isn't.

---

## Document Purpose

The spec documents define what data flows in and how it's stored. This document defines how the operator sees the state of the flow itself — whether it's working, whether it's stale, whether it has stopped.

Per Doctrine §IV: "Hide uncertainty when unproductive; surface it when operational." External-source health is the most operational form of uncertainty in Phase 8.5. The operator's confidence in Corsair's external listening depends on the platform being honest about when it cannot listen.

This is a design artifact rather than a spec. It describes:
- Visual states and what each means
- Layout in the Brief surface
- Interaction patterns
- Brand voice in health-related messaging
- Edge case handling

The Phase 8.5.2 framework writes the data this UI consumes. This document is what the build session uses when implementing the UI itself.

---

# PART ONE — DESIGN PRINCIPLES (DOCTRINE ALIGNMENT)

Five principles, all derived from Doctrine §IV (Confidence Principle) and §V (Product Design Principles).

## P-1 — Honest, not alarming

When a source is failing, the operator must know. But the surface should not alarm her when the failure is recoverable and Corsair is already working on it.

Concrete:
- A single rate-limit hit that recovers within an hour is invisible (the operator doesn't need to know).
- A source down for 6+ hours is amber (the operator should know).
- A source failing authentication is red (the operator must intervene).

The distinction is whether the situation is *operational* (the operator can do something about it) vs. *transient* (Corsair handles it). Operational surfaces; transient hides.

## P-2 — Plain language

Doctrine §IV: "No ambiguous metrics. Every number in the platform has a defined meaning the operator can state in plain language."

Concrete:
- Not "Source health score: 0.74"
- Yes "Last successful sync: 3 hours ago"
- Not "Service degradation detected"
- Yes "USAspending sync failed twice — retrying in 5 minutes"

Every state on this surface should be expressible in one sentence the operator could say aloud.

## P-3 — Action-orientation

Doctrine §V: "We surface, we do not prescribe." But for operational state, the operator benefits from knowing what action is available, even if the platform doesn't insist on it.

Concrete:
- "USAspending API key invalid. **[Update key]**" — surfaces problem and offers the action; doesn't insist she take it.
- "GAO scrape returned malformed HTML. Corsair will retry next cycle. **[View error]**" — surfaces, offers, doesn't insist.

The action button is offered, not pushed. Operator can ignore it.

## P-4 — Recoverable defaults

Doctrine §IV: "Defaults to recoverable actions. Every operator action should be reversible or recoverable for at least one session."

Concrete:
- "Disable source" is reversible (re-enable any time).
- "Force refresh now" is recoverable (just runs an extra sync).
- "Update API key" requires confirmation (not reversible if the new key is wrong).

## P-5 — Stillness when healthy

When all sources are running normally, the Source Health surface should be quiet. No animated icons, no flashing, no badges. Healthy state should be reassuring through absence, not through validation.

Concrete:
- Healthy sources render in a muted "paper" color (--t2 from Corsair palette).
- Only stale, errored, or attention-needed sources draw the eye.
- The surface itself is collapsible — once the operator confirms all is well, she can fold it away.

---

# PART TWO — INFORMATION ARCHITECTURE

## Where Source Health lives

Per Architecture sketch OQ-6 (confirmed): the Source Health view lives in the **Brief surface**.

Within the Brief, Source Health is a fixed section below the Daily Brief content and above the pass-down notes section:

```
┌──────────────────────────────────────────────────┐
│  BRIEF                                            │
│  ┌────────────────────────────────────────────┐  │
│  │  Daily Brief                                │  │
│  │  (existing content — pursuit updates,       │  │
│  │   meetings, decisions to make)              │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  External Intelligence (last 24h)           │  │
│  │  (existing content — new awards, protests,  │  │
│  │   filings, hearings from external sources)  │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  Source Health         ◆ All sources       │  │
│  │  (this design)         operational           │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  Pass-down notes                            │  │
│  │  (existing content)                         │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## Relationship to other surfaces

- **Theater:** does not show Source Health. The Theater is the field of awareness over the operator's terrain; sync state is not terrain.
- **Table:** shows a per-source last-sync timestamp in the column header of any column derived from external data. Hovering reveals "Last refreshed: X ago." Click-through opens Brief surface to Source Health.
- **Posture:** does not show Source Health directly. Sources that feed Posture (Congress.gov nominations creating position_held edges, etc.) are visible only through the Brief surface.
- **Inspector:** individual entity views show "Source: SAM.gov · refreshed 12 minutes ago" as a small footer line. Click opens Brief to Source Health.

This pattern keeps Source Health in one place (the Brief) while making it discoverable from anywhere relevant.

## Hierarchy of detail

Three levels:
1. **Surface state** (always visible in Brief): one-line aggregate — "◆ All sources operational" / "○ 1 source stale" / "● 2 sources failing"
2. **List view** (one click): per-source status with last-sync time and one-line status text
3. **Detail view** (one more click per source): full recent sync history, error log, config link, manual refresh

---

# PART THREE — VISUAL STATE DESIGN

## Per-source status states

Six states, with strict definitions and visual treatments. Visual treatments use existing Corsair palette tokens (defined in project memory):

### ◆ Operational (healthy)
- **Meaning:** Source synced successfully within its expected cadence.
- **Trigger:** `lastSync` within (cadence × 1.5). E.g., SAM.gov hourly sync is operational if `lastSync` is within last 90 minutes.
- **Color:** muted paper `--t2: #b5ad9f` (existing token). The diamond ◆ glyph is from existing brand vocabulary.
- **No animation. No badge. Calm.**

### ○ Stale (delayed but recovering)
- **Meaning:** Source missed its expected sync but framework's retry logic is working.
- **Trigger:** `lastSync` between (cadence × 1.5) and (cadence × 3), AND `lastError.retriable === true` OR no `lastError` recorded.
- **Color:** paper-2 `--t3: #7d7669` — slightly faded.
- **Subtle dot ○ glyph; no animation.**

### ◍ Attention (degraded)
- **Meaning:** Source has been failing for an extended period; operator should be aware.
- **Trigger:** `lastSync` more than (cadence × 3) ago, OR consecutive sync failures > 5.
- **Color:** amber `--gold: #d4823a` (existing brand token).
- **Glyph ◍ indicates partial/degraded state. Still no animation.**

### ● Stopped (failing, operator-blocking)
- **Meaning:** Source cannot sync without operator intervention.
- **Trigger:** `lastError.category` in {`auth_failed`, `config_invalid`, `schema_mismatch`, `doctrine_violation`}.
- **Color:** muted red — a new token introduced for this surface: `--alert: #b34040` (matches the existing `lost` stage color).
- **Glyph ● solid; brief outline pulse on first appearance to indicate operator action required, then static.**

### ◌ Disabled (operator-chose to turn off)
- **Meaning:** Operator explicitly disabled the source for this workspace.
- **Trigger:** Source's enable flag is false in workspace config.
- **Color:** very muted, almost background — `--paper-3` (new token, between --t3 and --rule).
- **Glyph ◌ hollow; entire row de-emphasized.**

### ◇ Initializing (first sync pending)
- **Meaning:** Source is enabled but has never completed a successful sync. Either freshly enabled, or first sync is still in progress.
- **Trigger:** No `lastSync` recorded AND source is enabled.
- **Color:** paper `--t2`, same as Operational.
- **Glyph ◇ outline; no animation.**

## State priority for surface aggregate

The Brief surface aggregate shows the most-attention-needed state across all sources:
- Any ● → Surface shows "● N sources need attention"
- Otherwise any ◍ → "◍ N sources degraded"
- Otherwise any ○ → "○ N sources delayed"
- Otherwise any ◇ → "◇ Initializing N sources"
- Otherwise → "◆ All sources operational" (in --t2 muted; this is the still state)

Disabled (◌) sources are not counted in surface aggregate.

## Color and typography tokens

All visual states use existing Corsair palette tokens defined in project memory:
- Backgrounds: `--bg: #070d18`, `--s1: #0a1020`
- Rules: `--rule: #1a2236`, `--rule-2: #25304a`
- Text: `--text: #f4ede0` (bone), `--t2: #b5ad9f` (paper), `--t3: #7d7669` (paper-2)
- Amber accent: `--gold: #d4823a`, `--gold-light: #f0a560`, `--gold-dark: #b86b2a`

New tokens introduced specifically for Source Health:
- `--alert: #b34040` (muted red for ● state — matches existing `lost` stage color for consistency)
- `--paper-3: #5a5450` (deeper muted text for ◌ disabled state)

Typography:
- Source name: `font-mono` uppercase tracking +0.05em (existing brand pattern for data labels)
- Status text: `font-body` regular (existing default)
- Timestamps: `font-mono` tabular-nums (existing pattern for numeric data)

---

# PART FOUR — LAYOUT: PRIMARY VIEW (SURFACE AGGREGATE)

The default visible state in the Brief.

## Collapsed state (default when all operational)

```
┌────────────────────────────────────────────────────────────────┐
│ SOURCE HEALTH                              ◆ All operational  ▾│
└────────────────────────────────────────────────────────────────┘
```

- Single line. Section title left, aggregate state right with expand toggle.
- Click anywhere on the line expands to list view.
- Diamond glyph muted; entire line in --t2.

## Aggregate states (collapsed)

When sources need attention, the right side carries the most attention-needed state:

```
┌────────────────────────────────────────────────────────────────┐
│ SOURCE HEALTH                          ◍ 2 sources degraded  ▾│
└────────────────────────────────────────────────────────────────┘
```

Color of the glyph and text matches the state being summarized.

## Auto-expand triggers

The section auto-expands (without operator click) when:
- A source transitions to ● state for the first time.
- A source has been ● for more than 24 hours and operator has not viewed the surface.
- Operator opens Brief in the morning and any non-Operational sources exist.

Auto-expand is one-time per session. Once operator collapses it manually, it stays collapsed until the next session.

---

# PART FIVE — LAYOUT: LIST VIEW (EXPANDED)

When operator expands the section, all sources show in a list.

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│ SOURCE HEALTH                          ◍ 2 sources degraded  ▴│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ◆ SAM.GOV                          Synced 47 minutes ago        │
│   Hourly delta sync · 1,243 records this week              ▸    │
│                                                                  │
│ ◆ USASPENDING.GOV                 Synced 6 hours ago            │
│   Nightly · 89 new awards last sync                        ▸    │
│                                                                  │
│ ◍ DOD NEWS CONTRACTS              Synced 2 days ago             │
│   Business-daily · Failed 3 consecutive syncs              ▸    │
│   Last error: HTML structure changed                            │
│                                                                  │
│ ◆ GAO BID PROTEST                 Synced 14 hours ago           │
│   Daily · 3 new protests this week                         ▸    │
│                                                                  │
│ ◍ SEC EDGAR                       Synced 23 minutes ago         │
│   5-minute polling · Rate limit reached; backed off        ▸    │
│                                                                  │
│ ◆ CONGRESS.GOV                    Synced 5 hours ago            │
│   Daily · 12 new hearings, 2 nominations this week         ▸    │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

## Per-source row breakdown

Each row has three lines:
1. **Header line:** Glyph + source name (mono uppercase) + last-sync timestamp (right-aligned, --t2).
2. **Context line:** Cadence description · activity summary, in --t3.
3. **Status line (only when not Operational):** One sentence in plain language about the current state.

The chevron `▸` at the right of each row opens the detail view.

## Cadence descriptions

Each source has a short cadence label:
- SAM.gov: "Hourly delta sync"
- USAspending: "Nightly"
- DoD News: "Business-daily"
- GAO Protest: "Daily"
- SEC EDGAR: "5-minute polling"
- Congress.gov: "Daily"

## Activity summary

What the source has produced recently. Examples:
- SAM.gov: "1,243 records this week" (new + updated Opportunities)
- USAspending: "89 new awards last sync"
- DoD News: "5 awards announced yesterday"
- GAO Protest: "3 new protests this week"
- SEC EDGAR: "2 new filings today"
- Congress.gov: "12 new hearings, 2 nominations this week"

When activity is zero, show: "No new records" (not "0 records" — plain language).

## Timestamp formatting

- Within 5 minutes: "Synced just now"
- 5 minutes – 1 hour: "Synced 47 minutes ago"
- 1 hour – 24 hours: "Synced 6 hours ago"
- 24 hours – 7 days: "Synced 2 days ago"
- 7+ days: "Synced May 8" (absolute date in month-day format)

Mono tabular-nums for the time portion (existing brand pattern).

## Disabled sources

```
│ ◌ MY-CUSTOM-SOURCE                Disabled                      │
│   Operator turned off · Re-enable in Workspace Settings    ▸    │
```

Disabled rows appear at the bottom of the list (below all enabled sources) and are muted further with --paper-3 text.

---

# PART SIX — LAYOUT: DETAIL VIEW (PER-SOURCE)

Clicking the chevron on any source row opens the detail view. This is a modal/drawer (existing Corsair pattern; same surface as Inspector).

## Detail view structure

```
┌────────────────────────────────────────────────────────────────┐
│ SAM.GOV                                              [ Close × ]│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│   STATUS                  ◆ Operational                          │
│   LAST SYNC               2026-05-15 13:47 UTC (47 min ago)     │
│   NEXT EXPECTED           2026-05-15 14:47 UTC (12 min from now)│
│   API BUDGET              183 / 1000 today (18%)                │
│                                                                  │
│   ── Recent sync history ──                                      │
│                                                                  │
│   13:47   ◆   24 records upserted, 0 errors           4.2s      │
│   12:47   ◆   18 records upserted, 0 errors           3.8s      │
│   11:47   ◆   31 records upserted, 0 errors           5.1s      │
│   10:47   ◆   22 records upserted, 1 errored (review) 4.7s      │
│   09:47   ◆   12 records upserted, 0 errors           2.9s      │
│                                                                  │
│   [ View all sync history ]                                     │
│                                                                  │
│   ── Configuration ──                                            │
│                                                                  │
│   Watchlist NAICS         12 codes                              │
│   Watchlist agencies       4 agencies                            │
│   Saved searches          3 active                              │
│                                                                  │
│   [ Edit watchlist ]                                            │
│                                                                  │
│   ── Actions ──                                                  │
│                                                                  │
│   [ Force refresh now ]                                         │
│   [ Disable this source ]                                       │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

## Detail view components

### Status panel (top)
Four lines of summary metrics:
- **Status** — current state with glyph
- **Last sync** — absolute timestamp with relative parenthetical
- **Next expected** — calculated from cadence; shown only if Operational
- **API budget** — daily token consumption (only for sources with quota — SAM.gov, Congress.gov, USAspending)

### Recent sync history (middle)
Last 5 sync attempts with:
- Time (HH:MM)
- Status glyph
- One-line outcome (records upserted, errored count)
- Duration (xx.xs)

"View all sync history" expands to last 100 syncs in a paginated list.

### Configuration summary
Three lines summarizing the workspace's config for this source:
- Watchlist scope
- Saved-search count

"Edit watchlist" opens a separate configuration modal (not part of Source Health UI; existing settings pattern).

### Actions
- **Force refresh now** — triggers immediate sync. Disabled if a sync is currently running. Shows progress: "Syncing... (12s elapsed)".
- **Disable this source** — confirmation prompt: "Disable SAM.gov sync for this workspace? You can re-enable any time." On confirm, source enters ◌ state.

## Error state detail view

When source is in ◍ or ● state, the detail view shows additional sections:

```
┌────────────────────────────────────────────────────────────────┐
│ DOD NEWS CONTRACTS                                   [ Close × ]│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│   STATUS                  ◍ Degraded (3 consecutive failures)   │
│   LAST SYNC               2026-05-13 19:00 UTC (2 days ago)    │
│   NEXT ATTEMPT            2026-05-15 19:00 UTC (in 5 hours)    │
│                                                                  │
│   ── Current issue ──                                            │
│                                                                  │
│   HTML structure changed on defense.gov/News/Contracts.         │
│   Corsair's parser cannot reliably extract announcements        │
│   from the current page format.                                  │
│                                                                  │
│   This typically resolves when the source's site updates        │
│   to a format the parser recognizes, or when Corsair's parser  │
│   is updated to handle the new format.                          │
│                                                                  │
│   [ View raw response ]    [ Report to dev ]                    │
│                                                                  │
│   ── Recent error history ──                                     │
│                                                                  │
│   2026-05-13 19:00   ●  Parse failure: no announcements found  │
│   2026-05-12 19:00   ●  Parse failure: structure mismatch      │
│   2026-05-11 19:00   ●  Parse failure: structure mismatch      │
│   2026-05-10 19:00   ◆  Last successful sync — 87 records      │
│                                                                  │
│   [ View all error history ]                                    │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

## ● Stopped state detail (operator action required)

```
┌────────────────────────────────────────────────────────────────┐
│ SEC EDGAR                                            [ Close × ]│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│   STATUS                  ● Stopped — operator action needed    │
│   LAST SYNC               2026-05-15 09:14 UTC (5 hours ago)   │
│   SYNC HALTED             User-Agent header rejected            │
│                                                                  │
│   ── What happened ──                                            │
│                                                                  │
│   The SEC EDGAR system requires a User-Agent header that         │
│   identifies the application and includes a contact email.      │
│   The configured User-Agent does not meet SEC's fair-access     │
│   requirements.                                                  │
│                                                                  │
│   Until this is resolved, SEC EDGAR sync is paused. Other       │
│   sources continue to operate normally.                          │
│                                                                  │
│   ── What you can do ──                                          │
│                                                                  │
│   Update the User-Agent in Settings to include a valid email.   │
│                                                                  │
│   [ Open SEC EDGAR settings ]                                   │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

The ● state explicitly tells the operator: this is paused, here's why, here's what to do. No alarming language; no urgency theater; just clear operational state.

---

# PART SEVEN — OPERATOR ACTIONS

Five categories of operator action available from Source Health:

## A-1 — Force refresh
- Available from: list view per source row (small refresh icon next to chevron); detail view (button).
- Behavior: triggers immediate sync via HTTPS callable function. UI shows progress in real-time.
- Reversibility: not destructive; just runs the sync.

## A-2 — Disable / enable source
- Available from: detail view (Actions section).
- Behavior: writes feature flag for source × workspace. Next scheduled job checks flag and skips workspace.
- Reversibility: re-enable from same place.

## A-3 — Edit watchlist / config
- Available from: detail view ("Edit watchlist" button).
- Behavior: opens separate Workspace Settings modal (existing pattern). Source-specific config UI is the operator's main interaction surface for tuning sync behavior.
- Reversibility: standard form edit; can undo changes before save.

## A-4 — View raw response
- Available from: detail view, only when source is in error state.
- Behavior: shows the most recent raw response from the source's API (for diagnosing parsing issues).
- Reversibility: read-only.

## A-5 — Report to developer
- Available from: detail view, only when source is in error state with category `schema_mismatch` or `permanent`.
- Behavior: opens a pre-filled email or GitHub issue (operator's choice in workspace settings) with the raw response and error context.
- Reversibility: standard email/issue submit.

---

# PART EIGHT — EDGE CASES

Specific UI states for non-default scenarios.

## E-1 — No sources configured (first-time operator)

```
┌────────────────────────────────────────────────────────────────┐
│ SOURCE HEALTH                                                  ▾│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│   No external sources active yet.                               │
│                                                                  │
│   Corsair can listen to public defense procurement data:        │
│   solicitations, awards, protests, executive moves,             │
│   congressional activity.                                        │
│                                                                  │
│   [ Set up external sources ]                                   │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

The setup button leads to a guided flow (separate UI design) that walks the operator through Phase 8.5.1 migration approval and initial source configuration.

## E-2 — Migration in progress

When Phase 8.5.1 migration is running for the workspace:

```
┌────────────────────────────────────────────────────────────────┐
│ SOURCE HEALTH                                                  ▾│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ◇ Workspace migration in progress                              │
│                                                                  │
│   Step 1 of 5 — Updating existing records                       │
│   ████████████░░░░░░░░░░░░ 2,143 of 4,287 entities             │
│                                                                  │
│   This takes a few minutes. External sources will activate      │
│   when migration completes.                                      │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

Progress bar updates in real-time. Phase 8.5.1's structured logging payload includes count progress that this UI reads.

## E-3 — Daily quota exhausted

When a source has hit its daily API budget:

```
│ ◍ SAM.GOV                          Synced 4 hours ago           │
│   Hourly delta sync · Daily API quota reached              ▸    │
│   Will resume at 00:00 UTC (in 7 hours)                         │
```

Detail view explains:
```
   STATUS                  ◍ Daily quota exhausted
   LAST SYNC               2026-05-15 10:00 UTC (4 hours ago)
   QUOTA RESETS            2026-05-16 00:00 UTC (in 7 hours)
   TODAY'S CONSUMPTION    1,000 / 1,000 (100%)

   ── What happened ──

   SAM.gov allows 1,000 API requests per day. Today's sync
   activity reached that limit. Corsair will resume syncing
   when the daily quota resets at UTC midnight.

   ── Why this happens ──

   This typically occurs after an initial backfill or after
   a major watchlist expansion. Steady-state usage is well
   under the daily limit.

   No action required. Sync will resume automatically.
```

The "no action required" framing reassures the operator.

## E-4 — Multi-error state

When multiple sources are simultaneously in error states:

```
┌────────────────────────────────────────────────────────────────┐
│ SOURCE HEALTH                       ● 3 sources need attention ▾│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ● SEC EDGAR                     Auth failed                   │
│      User-Agent header rejected                            ▸    │
│                                                                  │
│   ● USASPENDING.GOV               Network timeout 4× in row    │
│      Will retry in 12 minutes                              ▸    │
│                                                                  │
│   ◍ DOD NEWS CONTRACTS            Parse failure 3× in row      │
│      HTML structure changed                                ▸    │
│                                                                  │
│   ◆ SAM.GOV                       Synced 47 minutes ago         │
│   ◆ GAO BID PROTEST               Synced 14 hours ago           │
│   ◆ CONGRESS.GOV                  Synced 5 hours ago            │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

Errored sources sort to top; operational sources sort to bottom. The aggregate state in the header reflects the most-attention-needed sub-state.

## E-5 — Doctrine violation detected

The most serious error category. Doctrine §VI compliance failure.

```
┌────────────────────────────────────────────────────────────────┐
│ SOURCE HEALTH                  ● Doctrine compliance issue    ▴│
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ● USASPENDING.GOV               Sync paused                   │
│      Detected data shape inconsistent with Doctrine §VI    ▸    │
│      Operator review required                                    │
│                                                                  │
```

Detail view:
```
   STATUS                  ● Doctrine compliance issue
   SYNC PAUSED             2026-05-15 13:00 UTC
   CATEGORY                doctrine_violation

   ── What happened ──

   USAspending.gov sync returned data that appears to include
   non-public information beyond the standard public award
   record format. Corsair paused this sync to prevent ingesting
   data that may not be appropriate under Doctrine §VI
   (What We Will Never Build).

   ── What you can do ──

   Review the raw response below. If the data is in fact
   public and the violation detection was a false positive,
   approve continued ingestion. Otherwise, the sync remains
   paused until the source's data shape is verified.

   [ View raw response ]    [ Approve continued sync ]
```

Doctrine violations are the only category that requires explicit operator approval to continue. Even if the violation is a false positive, the operator must consciously approve — Doctrine §IV: "the platform never knows better than her."

## E-6 — Source intentionally retired

If a source becomes obsolete or is replaced by a successor (e.g., USAspending v3 API replaces v2):
```
│ ◌ USASPENDING.GOV (v2)            Retired                       │
│   Replaced by USASPENDING.GOV (v3) on 2026-XX-XX           ▸   │
```

The retired source's historical data is preserved; the source row remains visible so operator can understand the history.

---

# PART NINE — INTERACTION PATTERNS

## Hover states

- **List view source row:** subtle background `--rule` lighten. Cursor: pointer.
- **Chevron `▸`:** rotates 90° on hover; on click rotates 90° more to `▾` and detail view opens.
- **Glyph (status icon):** tooltip on hover shows full state description ("Operational since 09:14 UTC").
- **Timestamp:** tooltip on hover shows absolute timestamp ("2026-05-15 13:47:23 UTC").

## Click-through paths

- **Click on row anywhere** → detail view opens.
- **Click on "Edit watchlist"** → Workspace Settings modal opens to that source's config section.
- **Click on a record-count link** (e.g., "1,243 records this week") → navigates to Table surface filtered to that source's records, last 7 days.
- **Click on the section title "SOURCE HEALTH"** → toggles collapsed/expanded.

## Keyboard shortcuts

Building on Corsair's existing `⌘[/⌘]` history navigation pattern:
- `⌘+H` → focus jumps to Source Health section in Brief.
- `Esc` from detail view → returns to list view.
- `⌘+R` (when detail view is open) → triggers Force refresh.

## Background refresh behavior

The Source Health surface itself refreshes every 30 seconds (when the Brief surface is the active surface). It reads `lastSync`, `lastError`, and `dailyConsumed` paths from RTDB.

When a source state transitions while the operator is viewing:
- Visual: row updates in place with a subtle 200ms fade.
- No sound, no animation, no toast notification.
- If the transition is from ◆ to ●, the surface aggregate auto-expands.

---

# PART TEN — BRAND VOICE IN HEALTH MESSAGING

Doctrine §VIII voice principles applied to operational messaging:
- Restrained. Operational. Adult.
- Never theatrical, never apologetic, never marketing.
- The platform is a senior intelligence officer briefing a senior commander.

## Voice examples — healthy states

**Not:** "Everything's running smoothly! 🟢"
**Yes:** "All sources operational"

**Not:** "Yay, 47 new awards came in today!"
**Yes:** "89 new awards last sync"

## Voice examples — degraded states

**Not:** "Uh oh, something went wrong with DoD News!"
**Yes:** "DOD NEWS CONTRACTS — HTML structure changed"

**Not:** "We're trying really hard to fix the SEC issue!"
**Yes:** "SEC EDGAR — User-Agent header rejected. Update in Settings."

## Voice examples — error explanations

**Not:** "Oops! The connection to USAspending timed out. Don't worry, we'll try again!"
**Yes:** "USAspending.gov network timeout. Will retry in 12 minutes."

**Not:** "Critical error! All hands on deck!"
**Yes:** "Doctrine compliance issue detected. Sync paused pending review."

## Voice examples — operator-facing actions

**Not:** "Click here to fix this NOW!"
**Yes:** "Update the User-Agent in Settings to include a valid email."

**Not:** "Don't worry, you can always undo this!"
**Yes:** "Disable SAM.gov sync for this workspace? You can re-enable any time."

## Microcopy patterns

- Time references: "Synced 47 minutes ago" (concrete duration, not "recently" or "a while back").
- Cause-and-effect: "{What happened.} {What it means.} {What you can do, if anything.}" — three short sentences in that order.
- Avoid imperative without context: not "Click here." Rather "[ Update settings ]" as a button.
- Pluralization is explicit: "1 source needs attention" vs. "2 sources need attention."

---

# PART ELEVEN — ACCEPTANCE CRITERIA

The Source Health UI is shippable when:

1. **All six visual states** render correctly in the Brief surface with the documented glyphs and colors.
2. **Aggregate state in header** correctly reflects the most-attention-needed sub-state across enabled sources.
3. **List view** sorts errored sources above operational sources.
4. **Detail view** shows recent sync history, configuration summary, and applicable actions.
5. **Error states** render with plain-language explanations and operator-action options where applicable.
6. **Auto-expand triggers** work correctly (new ● state, ● state >24h unviewed, morning Brief open with non-Operational sources).
7. **Force refresh action** triggers immediate sync and shows progress.
8. **Disable / enable actions** correctly write feature flags and trigger source skip on next job.
9. **Doctrine violation state** correctly requires explicit operator approval before continuing.
10. **Background refresh** updates view every 30 seconds without flicker.
11. **Voice and microcopy** match the brand voice principles in Part Ten throughout.
12. **Keyboard shortcuts** (⌘+H, ⌘+R, Esc) function as documented.

---

# PART TWELVE — OPEN IMPLEMENTATION QUESTIONS

## UIQ-1 — Detail view as modal vs. drawer

**Question:** Should the detail view open as a centered modal or as a side drawer?

**Tradeoff:** Modal interrupts the Brief view (operator's morning context disappears behind the modal). Drawer keeps Brief partially visible but takes screen space.

**Proposal:** Side drawer from right, 480px wide. Operator can keep reading the Brief while reviewing source details.

**Recommendation:** Side drawer.

## UIQ-2 — How long to show transient state changes

**Question:** When a source briefly transitions to ○ then back to ◆ (transient stale → recovered), should the UI flash that transition?

**Proposal:** No flash. The state at the moment of view is what matters. History view shows the transient if operator drills in.

**Recommendation:** Static rendering of current state.

## UIQ-3 — Auto-collapse after sustained healthy state

**Question:** If all sources have been operational for 24+ hours, should the section auto-collapse to save screen space?

**Proposal:** No. The operator chooses collapse state explicitly; the system doesn't decide for her. Doctrine §IV: "the platform never knows better than her."

**Recommendation:** No auto-collapse beyond first-time expand.

## UIQ-4 — Cross-workspace source health rollup

**Question:** Operator may have multiple workspaces (current + test). Should there be a global "all my workspaces" health view?

**Proposal:** Out of scope for Phase 8.5. Per-workspace view only. Cross-workspace dashboards are Phase 9+ as the operator's use grows.

**Recommendation:** Defer.

## UIQ-5 — Mobile rendering

**Question:** Corsair is desktop-primary. Does Source Health render usefully on mobile?

**Proposal:** Phase 8.5 ships desktop-only rendering. Mobile responsive design is a separate effort.

**Recommendation:** Desktop-only for now; design accommodates mobile in v2.

## UIQ-6 — Surfacing in surfaces other than Brief

**Question:** Should the surface aggregate (e.g., "◍ 2 sources degraded") appear elsewhere, like a top-bar status indicator visible from any surface?

**Tradeoff:** Visibility from anywhere is valuable for operator awareness; persistent status indicators add UI noise.

**Proposal:** Add a tiny status dot in the existing top bar (next to workspace name) that reflects aggregate state. Click navigates to Brief → Source Health.

**Recommendation:** Confirm top-bar dot, low-visibility design (4px diameter dot, same color tokens as glyphs).

## UIQ-7 — Sound notification on ● transitions

**Question:** Should a sound play when a source transitions to ● state?

**Proposal:** No. Doctrine §VIII: "Never theatrical." Sound notifications are alarm theater. Operator finds the state on her next view of the Brief, which she opens regularly anyway.

**Recommendation:** No sound.

## UIQ-8 — Long-term sync history retention

**Question:** "View all sync history" in detail view — how far back?

**Proposal:** Last 90 days, paginated. Beyond that, history is in Cloud Logging for audit purposes but not surfaced in operator UI.

**Recommendation:** Confirm 90 days.

---

# CLOSING NOTES

## Why this surface matters disproportionately

The Source Health view is small in screen area but critical in role. It is the operator's only window into whether Corsair's external listening is working. Without it, when external feeds silently fail, the operator's intelligence picture becomes stale and she has no way to know.

Doctrine §IV's confidence principle has its sharpest application here. The operator must always be able to ask "is Corsair currently listening?" and get a truthful answer in one glance. If she opens the Brief and the surface aggregate says "◆ All operational," that statement must be true. If something is wrong, she must see it without having to dig.

The other intelligence surfaces (Theater, Table, Posture, Brief content itself) all depend on Source Health being trustworthy. If the operator stops trusting that Corsair is listening, she'll start checking the sources manually — defeating the entire purpose of the integration.

## Implementation order recommendation

The Source Health UI is part of Phase 8.5.2 (Cloud Functions framework). The framework writes the data; the client UI reads it. Implementation can parallelize across the two:

- Framework team implements `sourceHealth.ts` writing the canonical state.
- Client team implements the UI consuming the state.
- Integration test verifies the loop.

After 8.5.2 ships, sources go live progressively (8.5.3, 8.5.4, etc.) and each adds itself to the Source Health view as it activates.

## Voice review

The voice examples in Part Ten should be reviewed against the broader Corsair brand voice work. They're aligned with Doctrine §VIII as I understand it but the operator may want to refine specific phrasings.

## Maintenance principle

This document is v1.0. As real operator usage of Phase 8.5 surfaces UI gaps or voice issues, the document gets revised. Visual states defined here are the contract — adding new visual states requires explicit revision.

---

*End of Source Health UI design v1.0. Awaiting parallel build session implementation.*
