# CORSAIR OSINT — WATCHLIST CONFIGURATION UX DESIGN

**Scope:** Operator-facing UX for configuring what each source ingests per workspace
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** All per-source deep-dives, [`corsair-osint-source-health-ui-v1.md`](corsair-osint-source-health-ui-v1.md), [`corsair-osint-brief-synthesis-v1.md`](corsair-osint-brief-synthesis-v1.md)
**Status:** Design artifact for the configuration surface where the operator tells each source what to fetch. Per-source watchlist specs in the source deep-dives define the underlying config schemas; this document defines the unified operator-facing UX.

---

## Document Purpose

Each per-source spec defines its own configuration schema (SAM.gov has NAICS / agencies / set-asides; SEC EDGAR has CIK watchlist; Congress.gov has committee codes; etc.). But the operator does not want to manage five separate configuration screens — she wants one Watchlist surface that tells her what Corsair is listening for on her behalf, and lets her tune it.

This document designs that unified surface. It is design, not spec — describes layout, interaction, and brand voice for configuration. The underlying schema lives in the source specs.

Why a unified watchlist UX matters:
1. **Activation cost.** Setting up five separate configurations is a barrier to operator adoption. A unified UX with templates lowers the activation effort.
2. **Cross-source coherence.** When the operator adds NAICS 541512 to her capability segment, that probably applies to multiple sources at once. Unified UX makes the cross-source application natural.
3. **Tunability.** Operator can see at a glance what she's listening for. Tuning is iterative; the UX should encourage iteration rather than discourage it.
4. **Doctrine alignment.** Doctrine §IV: "The operator's authority over her own judgment is sacred." The watchlist is where she expresses that judgment in concrete terms.

---

# PART ONE — THE WATCHLIST CONCEPT

A watchlist is the operator's declared interest — what Corsair should listen for on her behalf. It composes from multiple dimensions:

## Watchlist dimensions

**Capabilities (NAICS / PSC codes)**
- The "what" of the operator's pursuit space
- Applied across SAM.gov, USAspending, GAO Protest, SBIR (Tier 2)

**Customer agencies**
- The "who" the operator pursues
- Applied across SAM.gov, USAspending, GAO Protest, Congress.gov (via committee oversight)

**Competitors (Organizations)**
- Specific firms the operator tracks as adversaries
- Applied across USAspending (their wins), SEC EDGAR (their filings if public), GAO Protest (their protest filings)

**Members of Congress (Persons)**
- Specific representatives/senators with capability oversight on operator's pursuits
- Applied across Congress.gov

**Geographies (states, congressional districts)**
- Where pursuits are based or work is performed
- Applied across SAM.gov, USAspending

**Keywords**
- Free-text terms in opportunity titles, hearing titles, filings
- Applied across SAM.gov, Congress.gov, SEC EDGAR

**Set-asides**
- Small business categories (SBA, WOSB, VOSB, SDVOSB, HUBZONE, 8a)
- Applied to SAM.gov, USAspending

**Dollar thresholds**
- Minimum/maximum award value filters
- Applied to USAspending, DoD News, SAM.gov

## Watchlists are workspace-scoped

Per Architecture OQ-2 (confirmed): each workspace has its own watchlist. No cross-workspace sharing in Phase 8.5. The operator's "Air Force AI pursuits" workspace has different watchlist than her "Army logistics" workspace.

## Watchlists compose source filters

Each source spec defines how watchlist dimensions translate into its API filter. The Watchlist UX is the operator-facing layer; per-source translation is in the source specs.

Examples:
- Capability "NAICS 541512" → SAM.gov `naics: 541512` filter; USAspending `naics_codes: [541512]` filter; SBIR.gov `topic_codes` filter (when integrated).
- Competitor "Lockheed Martin" → USAspending `recipient_search_text: 'Lockheed Martin'`; SEC EDGAR CIK 936468; GAO Protest party name match.

---

# PART TWO — WATCHLIST SURFACE STRUCTURE

The Watchlist surface lives in Workspace Settings as a top-level tab. Access path:

```
Corsair → Workspace menu → Settings → Watchlist
```

Or via keyboard shortcut `⌘+⇧+W`.

## Top-level layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ WATCHLIST                                            Workspace: My Pursuits│
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ Tell Corsair what to listen for on your behalf.                           │
│                                                                            │
│ ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐│
│ │ ◆ Capabilities      │  │ ◆ Customer agencies │  │ ◆ Competitors       ││
│ │                     │  │                     │  │                     ││
│ │ 4 NAICS · 2 PSCs    │  │ 3 agencies          │  │ 7 organizations     ││
│ │                     │  │                     │  │                     ││
│ │ [ Edit ]            │  │ [ Edit ]            │  │ [ Edit ]            ││
│ └─────────────────────┘  └─────────────────────┘  └─────────────────────┘│
│                                                                            │
│ ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐│
│ │ ◆ Members of Congress│  │ ◆ Geographies       │  │ ◆ Keywords          ││
│ │                     │  │                     │  │                     ││
│ │ 12 members          │  │ 4 states            │  │ 8 terms             ││
│ │                     │  │                     │  │                     ││
│ │ [ Edit ]            │  │ [ Edit ]            │  │ [ Edit ]            ││
│ └─────────────────────┘  └─────────────────────┘  └─────────────────────┘│
│                                                                            │
│ ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐│
│ │ ◆ Set-asides        │  │ ◆ Dollar thresholds │  │ ◆ Saved searches    ││
│ │                     │  │                     │  │                     ││
│ │ All set-asides      │  │ ≥ $100k             │  │ 3 saved             ││
│ │                     │  │                     │  │                     ││
│ │ [ Edit ]            │  │ [ Edit ]            │  │ [ Edit ]            ││
│ └─────────────────────┘  └─────────────────────┘  └─────────────────────┘│
│                                                                            │
│ ── How this watchlist applies to sources ──                               │
│                                                                            │
│ SAM.gov          ◆ Capabilities · Customer agencies · Set-asides · Keywords│
│ USAspending      ◆ Capabilities · Customer agencies · Competitors · Dollar │
│ DoD News         ◆ All filters apply (single feed for all sources)        │
│ GAO Protest      ◆ Competitors · Customer agencies                         │
│ SEC EDGAR        ◆ Competitors (resolved to CIKs)                          │
│ Congress.gov     ◆ Members of Congress · Keywords                          │
│                                                                            │
│ [ Suggest watchlist from existing pursuits ]                              │
│ [ Apply a template ]                                                       │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

## Layout principles

**Eight dimension cards** arranged in a 3-column grid. Each shows current state with a one-line summary and an Edit button. The eighth card (Saved searches) is a meta-dimension that composes from others.

**Source application footer** explicitly lists which dimensions affect which source. Doctrine §IV: no mystery. The operator can always see which filters apply where.

**Two assist actions:**
- "Suggest watchlist from existing pursuits" reads operator's current Opportunities and proposes a watchlist
- "Apply a template" offers pre-built watchlists for common defense BD segments

## When empty

For a new workspace with no watchlist set:

```
│ WATCHLIST                                                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ Corsair has no watchlist yet for this workspace.                          │
│                                                                            │
│ External sources sync but don't filter — you'll receive everything        │
│ defense-related, which is too much to read.                                │
│                                                                            │
│ Get started:                                                               │
│                                                                            │
│   [ Suggest from my existing pursuits ]                                    │
│   [ Start with a template ]                                                │
│   [ Configure dimension by dimension ]                                     │
│                                                                            │
```

The framing surfaces the consequence of an empty watchlist (too much noise) and offers three on-ramps.

---

# PART THREE — PER-DIMENSION EDITORS

Each dimension has its own editor modal. The pattern is consistent: chip-based list + add-input + suggested items.

## Capabilities editor

```
┌──────────────────────────────────────────────────────────────────┐
│ CAPABILITIES                                              [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Tell Corsair what capability areas you pursue.                    │
│                                                                    │
│ NAICS CODES                                                       │
│ [ 541330 Engineering Services × ]  [ 541512 Computer Systems × ] │
│ [ 541713 R&D in Bio × ]  [ 541715 R&D Phys/Eng × ]              │
│                                                                    │
│ Add NAICS:                                                        │
│ [_____________________________]  [ + Add ]                       │
│   ─ Type a NAICS code or description                              │
│                                                                    │
│ □ Include adjacent codes (same 4-digit group)                    │
│ □ Use wildcard matching (e.g., 5413*)                            │
│                                                                    │
│ ── PSC CODES (optional) ──                                       │
│ [ AC11 R&D Aircraft Adv Dev × ]  [ AC12 R&D Aircraft Eng Dev × ] │
│                                                                    │
│ Add PSC:                                                          │
│ [_____________________________]  [ + Add ]                       │
│                                                                    │
│ ── Suggested for your segment ──                                  │
│                                                                    │
│  + 541330 Engineering Services (you have this)                    │
│  + 541618 Other Management Consulting                             │
│  + 561621 Security Services                                       │
│  + 541611 Administrative Management                               │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

### Per-element interaction

**Chip with × button**: click × removes the chip.
**Add input**: type to search. Autocomplete shows matching NAICS codes by code or description. Click an autocomplete result to add as chip.
**Suggested items**: Corsair-suggested additions based on adjacent NAICS to existing list, or based on operator's existing Opportunities/Awards. Click + to add.
**Checkboxes**: toggle adjacent / wildcard matching.

### NAICS autocomplete

Type "engineering" → autocomplete suggests:
- 541330 Engineering Services
- 541310 Architectural Services
- 541350 Building Inspection Services
- etc., ranked by relevance

Type "541" → autocomplete suggests all 541xxx codes matching the prefix.

The autocomplete data is the full NAICS 2022 taxonomy, bundled into the Corsair client at build time (small dataset, ~3MB JSON).

## Customer agencies editor

```
┌──────────────────────────────────────────────────────────────────┐
│ CUSTOMER AGENCIES                                         [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Which agencies do you pursue?                                     │
│                                                                    │
│ Department of Defense                                              │
│   [ Department of the Air Force ]  ☑                              │
│     [ AFMC ]  ☑                                                   │
│       [ AFLCMC ]  ☑                                               │
│       [ AFGSC ]  ☐                                                │
│     [ ACC ]  ☐                                                    │
│     [ AMC ]  ☐                                                    │
│   [ Department of the Army ]  ☐                                  │
│   [ Department of the Navy ]  ☐                                  │
│   [ Space Force ]  ☑                                              │
│   [ Defense Agencies ]                                            │
│     [ DARPA ]  ☑                                                  │
│     [ DLA ]  ☐                                                    │
│     [ DTRA ]  ☐                                                   │
│     [ MDA ]  ☐                                                    │
│                                                                    │
│ Other agencies (search):                                          │
│ [_____________________________]                                  │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

### Hierarchical selection

Agency tree shows top-tier → subtier → office hierarchy. Operator can check at any level:
- Check at top level (e.g., Air Force): inherits all sub-levels.
- Check at subtier (AFMC): inherits all offices under that subtier.
- Check at office (AFLCMC): only that office.

When parent is checked, children show inherited state (light checkmark) but operator can override.

### Pre-seeded hierarchy

Per Migration v1 Step 4, the DoD hierarchy is pre-seeded at workspace initialization. This editor reads from that seeded structure. Other (non-DoD) agencies can be added via search.

## Competitors editor

```
┌──────────────────────────────────────────────────────────────────┐
│ COMPETITORS                                               [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Which organizations do you compete against?                       │
│                                                                    │
│ [ Lockheed Martin Corporation × ]   [ Northrop Grumman × ]       │
│ [ Raytheon Technologies × ]         [ Boeing × ]                  │
│ [ General Dynamics × ]              [ L3Harris × ]                │
│ [ Leidos × ]                                                      │
│                                                                    │
│ Add competitor:                                                   │
│ [_____________________________]  [ + Add ]                       │
│                                                                    │
│ ── Suggested adversaries ──                                       │
│                                                                    │
│ Based on your active pursuits:                                    │
│  + Booz Allen Hamilton (adversary on 2 pursuits)                  │
│  + CACI (adversary on 1 pursuit)                                  │
│  + SAIC (adversary on 1 pursuit)                                  │
│                                                                    │
│ ── Each competitor will be tracked across ──                      │
│  • USAspending: their contract awards                             │
│  • SEC EDGAR (if public): their material filings                  │
│  • GAO Protest: their protest filings                             │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

### Competitor → CIK resolution

When a competitor name is added, Corsair attempts to resolve it to a SEC EDGAR CIK if the firm is publicly traded:
- Exact match against the framework's CIK lookup (built from SEC EDGAR's company tickers index).
- On match: small "(NYSE: LMT)" indicator appears on the chip.
- On no match: chip is plain; SEC EDGAR will not track this competitor.

This resolution happens on Save, with a status indicator showing "Resolving... 5 of 7."

### Suggested adversaries

Read from operator's existing Opportunities' `posture.adversaries[]` to suggest organizations that frequently appear as adversaries.

## Members of Congress editor

```
┌──────────────────────────────────────────────────────────────────┐
│ MEMBERS OF CONGRESS                                       [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Which members shape your pursuit space?                           │
│                                                                    │
│ [ Sen. Jack Reed (D-RI) Chair, SASC × ]                          │
│ [ Sen. Roger Wicker (R-MS) Ranking, SASC × ]                     │
│ [ Rep. Mike Rogers (R-AL) Chair, HSAS × ]                        │
│ [ Rep. Adam Smith (D-WA) Ranking, HSAS × ]                       │
│                                                                    │
│ Add member:                                                       │
│ [_____________________________]  [ + Add ]                       │
│                                                                    │
│ ── Quick add committees ──                                        │
│ [ + Senate Armed Services full membership ]                       │
│ [ + House Armed Services full membership ]                        │
│ [ + Senate Appropriations Defense Subcommittee ]                  │
│ [ + House Appropriations Defense Subcommittee ]                   │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

### Quick add committees

For defense BD operators, the relevant members are typically the full membership of specific committees. Quick-add buttons populate the watchlist with all current members of a named committee.

When committee membership changes (Congress.gov sync detects), the operator is notified: "SASC membership changed: 2 new members added, 1 departed. Update your watchlist?" with one-click apply.

## Geographies editor

```
┌──────────────────────────────────────────────────────────────────┐
│ GEOGRAPHIES                                               [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Where do your pursuits play?                                      │
│                                                                    │
│ STATES                                                            │
│ [ Virginia × ]  [ Maryland × ]  [ District of Columbia × ]       │
│ [ Texas × ]                                                       │
│                                                                    │
│ [ + Add state ]                                                   │
│                                                                    │
│ CONGRESSIONAL DISTRICTS (optional)                                │
│ [ VA-08 × ]  [ VA-10 × ]                                          │
│                                                                    │
│ [ + Add district ]                                                │
│                                                                    │
│ ── How geography applies ──                                       │
│                                                                    │
│  • SAM.gov: place of performance filter                           │
│  • USAspending: place of performance filter                       │
│  • Congress.gov: members representing these districts/states     │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

## Keywords editor

```
┌──────────────────────────────────────────────────────────────────┐
│ KEYWORDS                                                  [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Free-text terms in titles, descriptions, hearings.                │
│                                                                    │
│ MUST INCLUDE (any of these triggers a match)                     │
│ [ artificial intelligence × ]  [ machine learning × ]            │
│ [ AI × ]  [ autonomy × ]  [ unmanned × ]                         │
│                                                                    │
│ [ + Add term ]                                                    │
│                                                                    │
│ MUST EXCLUDE (these suppress matches even if other criteria meet) │
│ [ training × ]  [ educational × ]                                 │
│                                                                    │
│ [ + Add exclusion ]                                               │
│                                                                    │
│ ── How keywords apply ──                                          │
│                                                                    │
│  • SAM.gov: title and description matching                        │
│  • Congress.gov: hearing titles and bill summaries                │
│  • SEC EDGAR: 8-K item summaries                                  │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

### Must-include vs. must-exclude

Keywords compose with other dimensions via AND. Must-include matches enrich the filter; must-exclude suppress.

Example: NAICS=541512 AND (title contains "AI" or "autonomy") AND (title does NOT contain "training") matches the operator's actual area without false positives from training-related contracts.

## Set-asides editor

Simple checklist:
```
[ ☑ Total Small Business (SBA) ]
[ ☑ Women-Owned Small Business (WOSB) ]
[ ☐ Veteran-Owned Small Business (VOSB) ]
[ ☑ Service-Disabled Veteran-Owned (SDVOSB) ]
[ ☐ HUBZone ]
[ ☑ 8(a) ]
[ ☑ None / Full and Open ]
```

By default all set-asides are selected (most permissive). Operator narrows to specific set-asides if relevant to their qualification.

## Dollar thresholds editor

```
MINIMUM CONTRACT VALUE         [ $100k ▾ ]
MAXIMUM CONTRACT VALUE         [ No max ▾ ]
                                
Awards below the minimum will not surface in your Brief but remain 
available in the Table for browsing.
```

Dropdown options: $10k / $100k / $500k / $1M / $5M / $10M / $50M / $100M / No min/max.

Operators tracking small-dollar pursuits might set $10k minimum; large primes might set $5M minimum to filter noise.

---

# PART FOUR — SAVED SEARCHES

Saved searches are named filter compositions that the operator uses across sources.

## Saved searches list

```
┌──────────────────────────────────────────────────────────────────┐
│ SAVED SEARCHES                                            [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Named filters that apply across sources.                          │
│                                                                    │
│ ☑ Air Force AI/ML pursuits                                  ▸    │
│   NAICS 541512 + Air Force + AI keywords                          │
│                                                                    │
│ ☑ DARPA emerging tech                                       ▸    │
│   NAICS 541715 + DARPA + ML/AI/autonomy keywords                  │
│                                                                    │
│ ☐ Allied FMS opportunities                                  ▸    │
│   FMS keyword + Allied countries + DSCA notifications             │
│                                                                    │
│ [ + Create new saved search ]                                    │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

Each saved search:
- Has a name (operator-set)
- Has an enable/disable toggle (☑/☐)
- Has its own composition of dimensions
- Independently triggers ingestion

## Saved search composition

Creating or editing a saved search:

```
┌──────────────────────────────────────────────────────────────────┐
│ NEW SAVED SEARCH                                          [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Name: [ Air Force AI/ML pursuits                              ]  │
│                                                                    │
│ COMPOSITION                                                       │
│                                                                    │
│ NAICS:                                                            │
│   ☑ Use workspace default capabilities                            │
│   ☐ Override with: [_______________________]                     │
│                                                                    │
│ Customer agencies:                                                │
│   ☐ Use workspace default agencies                                │
│   ☑ Override with: Air Force only                                 │
│                                                                    │
│ Keywords:                                                          │
│   ☐ Use workspace default keywords                                │
│   ☑ Override with: AI, machine learning, autonomy                 │
│                                                                    │
│ Notice types (SAM.gov only):                                      │
│   ☑ Presolicitation                                                │
│   ☑ Sources Sought                                                │
│   ☑ Solicitation                                                  │
│   ☐ Award notice                                                  │
│   ☐ Other                                                          │
│                                                                    │
│ ── Estimated daily volume ──                                      │
│ Based on similar filters: ~12 new items per day                   │
│                                                                    │
│                                          [ Cancel ]  [ Save ]     │
└──────────────────────────────────────────────────────────────────┘
```

### Inheritance vs. override

Each dimension can either inherit from the workspace-default watchlist or override for this saved search. Inheritance is the default; override is opt-in.

This means a saved search "Air Force AI" can narrow to Air Force only while inheriting the workspace's general capability list.

### Volume estimate

The platform estimates daily volume based on:
- Historical match rates from similar filter compositions
- Aggregate source volume divided by filter restrictiveness

Estimate displayed live as operator composes. Helps operator avoid creating filters that are too broad (200 items/day) or too narrow (1 item/year).

### Saved search use across sources

A saved search composes filters that apply to multiple sources. Source-by-source:
- **SAM.gov:** filters opportunity search via NAICS, customer, keywords, notice types
- **USAspending:** filters award search via NAICS, customer, dollar threshold (for award notices)
- **Congress.gov:** filters hearings via keywords (when no SAM.gov-specific fields apply)
- **SEC EDGAR:** doesn't use saved searches (operates on CIK list directly)
- **GAO Protest:** doesn't use saved searches (operates on watched competitors and customers)
- **DoD News:** doesn't use saved searches (single firehose, filtered post-fetch)

The framework's saved-search-apply logic knows which dimensions apply to which sources and composes accordingly.

---

# PART FIVE — DEFAULT TEMPLATES

For new workspaces or operators wanting a fast start, pre-built watchlist templates.

## Template gallery

```
┌──────────────────────────────────────────────────────────────────┐
│ WATCHLIST TEMPLATES                                       [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Start with a pre-built watchlist. You can customize after.        │
│                                                                    │
│ ┌─────────────────────────────────────────────┐                  │
│ │ DoD R&D Services                              │                 │
│ │                                               │                 │
│ │ Engineering, technology development, advanced │                 │
│ │ research services across DoD.                 │                 │
│ │                                               │                 │
│ │ Capabilities: 541330, 541512, 541713, 541715  │                 │
│ │ Customers: DoD components, DARPA              │                 │
│ │ Competitors: top defense services primes      │                 │
│ │                                               │                 │
│ │ [ Use this template ]                         │                 │
│ └─────────────────────────────────────────────┘                  │
│                                                                    │
│ ┌─────────────────────────────────────────────┐                  │
│ │ C4ISR                                          │                 │
│ │                                               │                 │
│ │ Command, control, communications, computers,  │                 │
│ │ intelligence, surveillance, reconnaissance.   │                 │
│ │                                               │                 │
│ │ Capabilities: 541512, 541519, AD80, AD81      │                 │
│ │ Customers: Air Force, Space Force, DARPA      │                 │
│ │ Competitors: C4ISR primes                     │                 │
│ │                                               │                 │
│ │ [ Use this template ]                         │                 │
│ └─────────────────────────────────────────────┘                  │
│                                                                    │
│ ┌─────────────────────────────────────────────┐                  │
│ │ Logistics & Sustainment                        │                 │
│ │                                               │                 │
│ │ Equipment sustainment, supply chain,           │                 │
│ │ logistics services, depot maintenance.        │                 │
│ │                                               │                 │
│ │ Capabilities: 488510, 493110, 541614          │                 │
│ │ Customers: DLA, USTRANSCOM, service depots    │                 │
│ │ Competitors: top sustainment primes           │                 │
│ │                                               │                 │
│ │ [ Use this template ]                         │                 │
│ └─────────────────────────────────────────────┘                  │
│                                                                    │
│ ┌─────────────────────────────────────────────┐                  │
│ │ Construction & MILCON                          │                 │
│ │                                               │                 │
│ │ Military construction, facility services,     │                 │
│ │ infrastructure development.                   │                 │
│ │                                               │                 │
│ │ Capabilities: 236220, 237310, PSC Y1AA        │                 │
│ │ Customers: USACE, NAVFAC, AFCEC               │                 │
│ │ Competitors: top MILCON primes                │                 │
│ │                                               │                 │
│ │ [ Use this template ]                         │                 │
│ └─────────────────────────────────────────────┘                  │
│                                                                    │
│ ┌─────────────────────────────────────────────┐                  │
│ │ Cyber & Information Security                   │                 │
│ │                                               │                 │
│ │ Cybersecurity services, information assurance,│                 │
│ │ security operations.                          │                 │
│ │                                               │                 │
│ │ Capabilities: 541512, PSC R425                │                 │
│ │ Customers: DoD CIO, NSA, CYBERCOM, DISA       │                 │
│ │ Competitors: top cyber services firms         │                 │
│ │                                               │                 │
│ │ [ Use this template ]                         │                 │
│ └─────────────────────────────────────────────┘                  │
│                                                                    │
│                                                  [ Close ]         │
└──────────────────────────────────────────────────────────────────┘
```

## Template application

When the operator selects a template:
1. Preview modal shows the full proposed watchlist composition.
2. Operator can edit before applying (remove items, add to existing).
3. "Apply" merges template into workspace watchlist.
4. If workspace already has watchlist items, operator chooses: replace / merge / add to.

Templates seed but don't lock — operator can modify freely after applying.

## Template maintenance

Templates are workspace-agnostic and maintained as part of Corsair platform code. Updates to templates (new NAICS codes added, agency renames) are reflected in the templates without affecting existing workspaces that already applied them.

If a template materially changes (substantial NAICS additions), operators who previously applied it see: "The 'DoD R&D Services' template has been updated. Review changes?" with option to merge new items.

---

# PART SIX — SUGGEST FROM EXISTING PURSUITS

The most-frequently-used assist action for operators who already have pursuits in the workspace.

## Suggest flow

```
┌──────────────────────────────────────────────────────────────────┐
│ SUGGEST WATCHLIST FROM YOUR PURSUITS                      [ × ]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Corsair has analyzed your 23 active pursuits to suggest a         │
│ watchlist that matches your existing work.                        │
│                                                                    │
│ CAPABILITIES (inferred from notes and metadata)                  │
│ [ ☑ NAICS 541330 ]  (appears in 12 pursuits)                     │
│ [ ☑ NAICS 541512 ]  (appears in 8 pursuits)                      │
│ [ ☑ NAICS 541715 ]  (appears in 5 pursuits)                      │
│ [ ☐ NAICS 541713 ]  (appears in 2 pursuits)                      │
│                                                                    │
│ CUSTOMER AGENCIES (inferred from agency field)                   │
│ [ ☑ Air Force ]      (19 pursuits)                               │
│ [ ☑ DARPA ]          (4 pursuits)                                │
│ [ ☑ Space Force ]    (3 pursuits)                                │
│ [ ☐ Marine Corps ]   (1 pursuit)                                 │
│                                                                    │
│ COMPETITORS (from posture.adversaries across pursuits)           │
│ [ ☑ Lockheed Martin ]  (adversary in 8 pursuits)                 │
│ [ ☑ Northrop Grumman ] (adversary in 6 pursuits)                 │
│ [ ☑ Boeing ]          (adversary in 4 pursuits)                  │
│ [ ☐ General Dynamics ] (adversary in 1 pursuit)                  │
│                                                                    │
│ KEYWORDS (inferred from pursuit titles and notes)                │
│ [ ☑ AI ]              (mentioned in 9 pursuits)                  │
│ [ ☑ autonomy ]        (mentioned in 7 pursuits)                  │
│ [ ☐ cyber ]           (mentioned in 3 pursuits)                  │
│                                                                    │
│                              [ Cancel ]  [ Apply selected ]       │
└──────────────────────────────────────────────────────────────────┘
```

## Inference rules

- **Capabilities:** NAICS codes extracted from pursuit metadata where set. Counts across pursuits.
- **Agencies:** parsed from `Opportunity.agency` field. Multiple agency variations (e.g., "Air Force" vs. "USAF" vs. "Department of the Air Force") normalize.
- **Competitors:** unique Organizations from `Opportunity.posture.adversaries[]` across all pursuits. Counts per Organization.
- **Keywords:** noun-phrase extraction from pursuit titles and notes. Filtered to defense-relevant terms via a curated vocabulary.

The threshold for suggesting (default): item appears in ≥3 pursuits.

Items below threshold appear unchecked (operator can opt in).

## After suggestion

The suggested watchlist applies as a starting point. Operator can edit per-dimension after applying. The suggest flow is non-destructive — won't replace existing watchlist items, just adds.

---

# PART SEVEN — WATCHLIST CHANGE PROPAGATION

When operator changes the watchlist:

## Immediate effect
- Workspace config updated in RTDB.
- Next scheduled sync (within hour for SAM.gov, etc.) uses the new filter.
- Existing entities in workspace are not removed (operator may still want them).

## Optional manual sync
- "Apply now" button after Save runs an immediate sync with the new filter.
- Useful when operator wants to see results of a new filter immediately.

## Out-of-scope flagging
- Existing entities that no longer match the new filter get flagged `outOfWatchlist: true`.
- Default view hides flagged entities; operator can show via filter toggle.
- Operator can purge `outOfWatchlist: true` entities in bulk via a settings action.

## Change history
- Every watchlist save creates an entry in `workspaces/{wsId}/watchlistHistory[]` with timestamp and diff from prior state.
- Operator can review history and revert if needed.

---

# PART EIGHT — INTERACTION PATTERNS AND VOICE

## Brand voice in this UX

Direct, operational, brand-aligned with Doctrine §VIII:
- Not: "Add an awesome NAICS code!"
- Yes: "Add NAICS."

- Not: "Your watchlist is empty! 😢"
- Yes: "Corsair has no watchlist yet for this workspace."

- Not: "Awesome choices! Let's apply this template!"
- Yes: "Applied. Sync will use the new watchlist on next run."

## Confirmation patterns

For destructive actions (clear watchlist, delete saved search, remove competitor):
- One-step undo via toast: "Removed Lockheed Martin from competitors. [ Undo ]"
- Toast persists 10 seconds; click Undo to restore.
- No confirmation modals for routine destructive actions; the undo path is the safety.

For irreversible actions (none in normal flow): would require explicit confirmation modal with destructive-action styling.

## Search and autocomplete patterns

All free-text add inputs (NAICS, agency, competitor, member) use the same pattern:
- Typing triggers autocomplete after 2 characters.
- Autocomplete shows top 8 matches with name + identifier.
- Enter selects top match; arrow keys navigate.
- Mouse click selects.

## Keyboard navigation

- `Tab` cycles through dimension cards on top-level.
- `Enter` on a card opens its editor.
- `Esc` closes any open editor.
- `⌘+S` saves the open editor.
- `⌘+Z` triggers Undo on the last destructive action.

---

# PART NINE — EDGE CASES

## E-1 — Operator with no active workspace

Workspaces tab grayed out / disabled until operator selects or creates a workspace.

## E-2 — Watchlist exceeds reasonable size

If watchlist grows beyond reasonable bounds (e.g., 500 NAICS codes, 50 competitors):
- Warning at save time: "Large watchlist may produce high signal volume. Consider tighter scope or saved searches for sub-segments."
- Save still allowed; the platform doesn't impose hard limits except for source-specific API constraints.

## E-3 — Source-incompatible filter

If a dimension is filled but no source uses it:
- Footer indicator: "This dimension is set but no enabled source uses it currently."
- Doesn't block save; just informational.

## E-4 — Operator-created saved search hits zero volume

If a saved search returns zero matches over 7 days:
- Notification: "Saved search 'Allied FMS opportunities' had no matches in 7 days. Filter may be too restrictive — review?"
- Operator can dismiss, disable the saved search, or open it for editing.

## E-5 — Watchlist conflicting with operator-created Opportunities

If a operator-created Opportunity has agency / NAICS not in the watchlist:
- Opportunity remains tracked normally (operator's creation always wins).
- Watchlist edit screen shows a notice: "You have 3 pursuits with agencies not in your watchlist (Marine Corps, Coast Guard). Add these agencies?"

## E-6 — Sources disabled at framework level

If a source is disabled at the framework feature-flag level (e.g., temporary global disable for SEC EDGAR due to maintenance):
- Source application footer shows: "SEC EDGAR — currently disabled at framework level. Watchlist saved but inactive for this source."

---

# PART TEN — ACCEPTANCE CRITERIA

1. **All eight dimensions** have functional editors with the documented chip-based UX.
2. **NAICS autocomplete** works against full NAICS 2022 taxonomy with ≤500ms response time.
3. **Agency hierarchical selection** correctly inherits and overrides at parent/child levels.
4. **Competitor CIK resolution** correctly identifies public competitors and indicates them on chips.
5. **Saved searches** save, edit, enable/disable, and apply correctly across sources.
6. **Five built-in templates** (DoD R&D, C4ISR, Logistics, MILCON, Cyber) are available and apply correctly.
7. **Suggest-from-existing-pursuits flow** infers reasonable suggestions from operator's existing data.
8. **Watchlist change propagation** updates RTDB config immediately; next scheduled sync uses new filter.
9. **Volume estimates** on saved searches are approximately accurate (within 50% of actual observed volume after 7 days).
10. **Watchlist history** is recorded and reversible.
11. **Out-of-watchlist flagging** correctly marks entities that no longer match.
12. **Voice and microcopy** match Doctrine §VIII throughout.
13. **Keyboard navigation** functional per Part Eight.
14. **Undo for destructive actions** via toast within 10-second window.

---

# PART ELEVEN — OPEN IMPLEMENTATION QUESTIONS

## WIQ-1 — NAICS taxonomy versioning

NAICS codes update periodically (2017 → 2022 → next).

**Proposal:** Bundle NAICS 2022 with the client. When a new version releases, update via client release. Existing watchlist codes that are deprecated in new NAICS are flagged.

**Recommendation:** Confirm.

## WIQ-2 — Geography dimension future expansion

Currently geography means state and congressional district. Should it also include:
- DoD installations (e.g., "everything at Wright-Patterson AFB")
- Foreign countries (for FMS)
- COCOM areas of responsibility

**Proposal:** Phase 8.5 ships with state + congressional district only. Installation, country, and COCOM AOR are Phase 9+ additions.

**Recommendation:** Confirm.

## WIQ-3 — Watchlist export/import

Operators may want to copy watchlist between workspaces (their primary and a backup, or sharing with a teammate's workspace).

**Proposal:** Phase 8.5.8 ships with export to JSON file + import from JSON file. Workspace-to-workspace direct copy is Phase 9+.

**Recommendation:** Confirm.

## WIQ-4 — Competitor / member resolution latency

When operator adds 20 competitors at once, CIK resolution takes seconds. UX impact?

**Proposal:** Asynchronous resolution after save. Chips initially show "Resolving..." badge; updates as resolution completes. Save itself is instant.

**Recommendation:** Confirm async resolution.

## WIQ-5 — Watchlist privacy

Watchlist data is in RTDB scoped to workspace. Workspace privileges already restrict who can read/write. Should watchlist have additional access controls?

**Proposal:** Phase 8.5 inherits workspace privileges. No additional layer.

**Recommendation:** Confirm.

## WIQ-6 — Default template granularity

Five templates listed. Should there be more (e.g., specific service sub-segments like "Air Force AI specifically")?

**Proposal:** Phase 8.5 ships with five general templates. Additional templates added based on operator feedback and observed common patterns.

**Recommendation:** Confirm 5-template MVP.

## WIQ-7 — Saved search volume estimation accuracy

Volume estimation is hard without real data.

**Proposal:** Phase 8.5 ships with conservative estimates based on overall source volume × filter restrictiveness heuristic. Refines over time as actual workspace usage provides ground truth.

**Recommendation:** Confirm heuristic for v1; refine in v2.

## WIQ-8 — Watchlist diff visualization

When operator changes the watchlist, can they see a diff against prior version?

**Proposal:** Yes. Watchlist History shows side-by-side comparison: prior state vs. new state with added / removed / changed items highlighted.

**Recommendation:** Confirm diff view.

---

# CLOSING NOTES

## Why this UX matters

The watchlist is where the operator tells Corsair what to listen for. If the watchlist UX is awkward, operators either skip configuration (and drown in irrelevant signal) or over-configure (and miss things outside their declared scope). Either failure mode undermines Phase 8.5's value.

Getting this UX right is also about activation cost. A new operator opens Corsair for the first time, sees the empty watchlist with three on-ramps (suggest, template, manual), and within 5 minutes has a working watchlist generating relevant Brief content. That activation moment is the first time Corsair feels like it's actually listening to her.

## Cross-references

- Each per-source spec defines the underlying schema; this UX is the composition layer.
- Architecture v1's E-4 (source provenance) is implicit — saved searches' source-attribution is preserved in resulting entities.
- Brief synthesis v1 (8.5.8) reads the watchlist via the same RTDB paths.

## Implementation order

The watchlist UX implements as part of Phase 8.5.2 (framework establishment) since all source integrations depend on it. Default templates load with Phase 8.5.2. Suggest-from-pursuits flow is implemented in 8.5.2 but feels meaningful only once Phase 8.5.3 begins ingesting data.

## Maintenance principle

This document is v1.0. The dimension structure (eight named dimensions) is the load-bearing design; revisions to autocomplete, templates, and voice are routine; revisions to the dimension structure require operator-approved amendment.

---

*End of Watchlist UX design v1.0. Awaiting parallel build session implementation.*
