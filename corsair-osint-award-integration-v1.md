# CORSAIR PHASE 8.5.4 — AWARD ENTITY INTEGRATION DEEP-DIVE

**Sources covered:** USAspending.gov + DoD News Contract Announcements
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md), [`corsair-osint-architecture-v1.md`](corsair-osint-architecture-v1.md), [`corsair-osint-migration-v1.md`](corsair-osint-migration-v1.md)
**Status:** Deep-dive spec — drills into the most schema-novel and operationally consequential Tier 1 integration. Doubles as the reference implementation pattern that the other four Tier 1 source specs will mostly follow with source-specific variations.

---

## Document Purpose

The architecture sketch covers the Tier 1 five-source integration at sketch level. This document goes one level deeper on the integration that defines the new Award entity type and surfaces the most edge cases: USAspending.gov for authoritative federal contract data + DoD News Contract Announcements for same-day $7M+ award alerts.

Why this pair gets the first deep-dive:
1. **Schema novelty.** The Award entity is the only new top-level entity type in Phase 8.5. SAM.gov maps to existing Opportunity; GAO/EDGAR/Congress.gov map to existing Signal. Award is where the real new structural work lives.
2. **Operator impact.** Recompete watch — derived from `Award.popEnd` filtered by operator's NAICS — is the single highest-impact deliverable in Phase 8.5. Operators consistently identify "what's about to recompete in my space" as the question with the most leverage.
3. **Edge case density.** IDV-to-task-order parenting, FFATA subaward lag, DUNS-to-UEI reconciliation, mod-chain semantics, recipient name normalization, multi-recipient awards, classified award invisibility — all the structural ambiguities cluster here.
4. **Reconciliation pattern.** DoD News first-seen + USAspending authoritative is the prototype for any future multi-source integration pattern in Corsair.

This spec is the formal target for Phase 8.5.4 implementation. The build session reads this document and produces code that conforms to it.

---

# PART ONE — THE AWARD ENTITY LIFECYCLE

The Award entity is not a static record. It has a lifecycle with explicit states, transition triggers, and operational meaning per state. Capture managers think in terms of these states even when they don't articulate the model.

## States

```
Award.lifecycleState ∈ {
  'provisional',     // DoD News announced but USAspending hasn't confirmed yet
  'active',          // USAspending confirmed, currently performing
  'expiring',        // popEnd within 18 months — recompete-watch candidate
  'expired',         // popEnd passed; no successor recorded
  'recompeted',      // a successor Award has been awarded (same NAICS/customer/scope)
  'terminated',      // T4D (default) or T4C (convenience) — early termination
  'unknown'          // partial data only; classification deferred
}
```

The `expiring` state is the linchpin for recompete watch. Awards transition to `expiring` when `popEnd - now < 18 months`. Awards transition to `expired` automatically when `popEnd` passes. An award becomes `recompeted` when an operator (or, future-phase, an automated heuristic) links a successor Award.

## State machine

```
[no record]
    │
    │ DoD News announcement matched
    ▼
[provisional]
    │
    │ USAspending API confirms PIID match
    ▼
[active] ──────────────────────────────────┐
    │                                      │
    │ popEnd - now < 18mo                  │ termination notice
    ▼                                      ▼
[expiring]                            [terminated]
    │
    │ popEnd passes
    ▼
[expired]
    │
    │ operator (or future heuristic) links successor
    ▼
[recompeted]
```

`unknown` is a catch-all for records with insufficient data (e.g., DoD News announcement that USAspending never confirms — possibly classified or aggregated under a different PIID).

## Transition triggers

| From | To | Trigger |
|---|---|---|
| (none) | provisional | DoD News parse extracts new PIID |
| (none) | active | USAspending API returns new award |
| provisional | active | USAspending PIID match confirmed |
| provisional | unknown | 30 days elapsed without USAspending confirmation |
| active | expiring | Daily check: `popEnd - now < 18 months` |
| expiring | expired | Daily check: `popEnd < now` |
| expiring | terminated | USAspending shows `last_modified_date` change with mod reason code matching T4D/T4C patterns |
| active | terminated | Same as above |
| expired | recompeted | Operator action: link successor Award |
| terminated | recompeted | Operator action: link successor Award (rare) |

All transitions are recorded in `Award.lifecycleTransitions[]`:
```
{
  fromState: 'active',
  toState: 'expiring',
  transitionedAt: <timestamp>,
  reason: 'popEnd within 18 months',
  triggeredBy: 'system' | 'operator:<userId>'
}
```

## Why state matters operationally

The Sovereign's recompete watch is driven by `expiring` state. Her competitive intelligence on adversaries reads from `active` and `expiring` awards by competitor Organization. Her post-award debrief work on lost pursuits relies on `recompeted` linkages back to predecessor Awards.

Confidence principle (§IV) implication: state should always be visible and explainable. The operator clicks an Award and sees its current state, the transition history that got it there, and (for `expiring`) the days remaining until `popEnd`. Nothing is hidden.

## Posture Layer integration

When an Award enters `expiring` state, the system optionally proposes a candidate Opportunity:
- New Opportunity at stage `awareness`
- `Opportunity.posture.adversaries[]` pre-populated with the Award's prime Organization (the incumbent)
- `Opportunity.notes` populated with reference to the source Award and PoP end date
- Operator confirms or dismisses; nothing is committed without operator action

This is the Doctrine-aligned shape: Corsair surfaces; operator decides. The candidate Opportunity sits in a "Proposed Pursuits" inbox in the Pipeline surface; operator promotes to active pursuit with one click or dismisses with one click.

---

# PART TWO — USASPENDING.GOV API DEEP SURFACE

USAspending exposes a comprehensive REST API at `api.usaspending.gov/api/v2/`. No authentication required. Rate-limited per-IP at 1000 requests/hour. Returns JSON.

The architecture sketch listed the headline endpoints. This section covers them exhaustively with query parameters, response shapes, pagination, and the specific patterns Corsair uses.

## Endpoint surface

### Endpoint 2.1 — POST `/api/v2/search/spending_by_award/`

The primary award discovery endpoint. Returns awards matching filter criteria.

**Request shape:**
```json
{
  "filters": {
    "award_type_codes": ["A", "B", "C", "D"],
    "time_period": [
      { "start_date": "2024-05-15", "end_date": "2026-05-15" }
    ],
    "agencies": [
      { "type": "awarding", "tier": "toptier", "name": "Department of Defense" }
    ],
    "naics_codes": ["541330", "541512", "541715"],
    "psc_codes": ["AC11", "AC12"],
    "recipient_search_text": ["Lockheed Martin"],
    "place_of_performance_locations": [{"country": "USA", "state": "VA"}],
    "set_aside_type_codes": ["SBA"]
  },
  "fields": [
    "Award ID",
    "Recipient Name",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Award Amount",
    "Total Outlays",
    "NAICS",
    "PSC",
    "Period of Performance Start Date",
    "Period of Performance Current End Date",
    "Description",
    "Place of Performance"
  ],
  "page": 1,
  "limit": 100,
  "sort": "Award Amount",
  "order": "desc",
  "subawards": false
}
```

**Response shape (abbreviated):**
```json
{
  "results": [
    {
      "internal_id": 12345678,
      "Award ID": "FA8650-23-C-1234",
      "generated_internal_id": "CONT_AWD_FA8650-23-C-1234_9700_-NONE-_-NONE-",
      "Recipient Name": "LOCKHEED MARTIN CORPORATION",
      "Awarding Agency": "Department of Defense",
      "Awarding Sub Agency": "Department of the Air Force",
      "Award Amount": 145000000.00,
      "Total Outlays": 87000000.00,
      "NAICS": "336411",
      "PSC": "1510",
      "Period of Performance Start Date": "2023-09-15",
      "Period of Performance Current End Date": "2027-09-14",
      "Description": "RESEARCH AND DEVELOPMENT - AIRCRAFT - ADVANCED DEVELOPMENT...",
      "Place of Performance": { "state_code": "TX", "country_code": "USA" }
    }
  ],
  "page_metadata": {
    "page": 1,
    "next": 2,
    "previous": null,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

**Award type codes (relevant subset):**
- `A` — BPA Call
- `B` — Purchase Order
- `C` — Delivery Order (task order under IDV)
- `D` — Definitive Contract
- `IDV_A` through `IDV_E` — IDV vehicle types (FSS, GWAC, etc.)

For Corsair's Tier 1 capture intelligence, the request filter usually combines `award_type_codes: ['A','B','C','D']` (excludes IDVs themselves; task orders covered) with NAICS and agency filters from the operator's watchlist.

### Endpoint 2.2 — GET `/api/v2/awards/{generated_unique_award_id}/`

Individual award detail. Returns the comprehensive record for one award, including modification history.

**Response shape (abbreviated):**
```json
{
  "id": 12345678,
  "generated_unique_award_id": "CONT_AWD_FA8650-23-C-1234_9700_-NONE-_-NONE-",
  "piid": "FA8650-23-C-1234",
  "parent_award_piid": null,
  "type": "D",
  "type_description": "Definitive Contract",
  "category": "contract",
  "description": "...",
  "total_obligation": 145000000.00,
  "base_and_all_options_value": 287000000.00,
  "date_signed": "2023-09-15",
  "period_of_performance": {
    "start_date": "2023-09-15",
    "end_date": "2027-09-14",
    "last_modified_date": "2025-03-04"
  },
  "recipient": {
    "recipient_hash": "abc123...",
    "recipient_name": "LOCKHEED MARTIN CORPORATION",
    "recipient_unique_id": "ABC123XYZ",
    "parent_recipient_unique_id": "PARENT001",
    "business_categories": ["category_business", "category_corporate_entity"]
  },
  "awarding_agency": {
    "toptier_agency": { "name": "Department of Defense", "code": "097" },
    "subtier_agency": { "name": "Department of the Air Force", "code": "5700" },
    "office_agency_name": "AFLCMC"
  },
  "place_of_performance": { "state_code": "TX", "city_name": "FORT WORTH", "country_code": "USA" },
  "naics_hierarchy": { "primary_naics": { "code": "336411", "description": "..." } },
  "psc_hierarchy": { "base_code": { "code": "1510", "description": "..." } },
  "executive_details": { "officers": [] },
  "latest_transaction_contract_data": {
    "modification_number": "P00009",
    "action_date": "2025-03-04",
    "action_type_description": "ADDITIONAL WORK"
  }
}
```

The mod history is reachable via a related endpoint (`/api/v2/awards/{id}/transactions/`).

### Endpoint 2.3 — GET `/api/v2/awards/{generated_unique_award_id}/transactions/`

All modifications and transactions on one award. Each transaction is a discrete change event.

**Response shape:**
```json
{
  "results": [
    {
      "modification_number": "P00000",
      "type": "D",
      "action_date": "2023-09-15",
      "action_type": "INITIAL",
      "action_type_description": "...",
      "federal_action_obligation": 87000000.00,
      "transaction_unique_id": "...",
      "transaction_description": "INITIAL AWARD..."
    },
    {
      "modification_number": "P00001",
      "type": "D",
      "action_date": "2024-01-15",
      "action_type": "B",
      "action_type_description": "SUPPLEMENTAL AGREEMENT FOR WORK WITHIN SCOPE",
      "federal_action_obligation": 25000000.00,
      "transaction_description": "..."
    }
    // ...
  ],
  "page_metadata": { "page": 1, "next": null, "hasNext": false }
}
```

### Endpoint 2.4 — POST `/api/v2/subawards/`

FFATA-reported subaward data. Subcontracts under prime awards over $30k.

**Request shape:**
```json
{
  "filters": {
    "award_unique_id": "CONT_AWD_FA8650-23-C-1234_9700_-NONE-_-NONE-"
  },
  "page": 1,
  "limit": 100
}
```

**Response shape:**
```json
{
  "results": [
    {
      "subaward_id": "...",
      "subaward_number": "SUB001",
      "sub_recipient_name": "ANALYTIC SERVICES INC",
      "sub_recipient_unique_id": "DEF456GHI",
      "amount": 12500000.00,
      "subaward_action_date": "2024-02-15",
      "naics_code": "541330",
      "subaward_description": "ENGINEERING SERVICES IN SUPPORT OF..."
    }
  ]
}
```

**FFATA reporting lag:** Subaward reports are due 30 days after the month in which the sub-award is made, but compliance is uneven. Subaward data typically lags primary award data by 30-180 days. Corsair handles this by separating the subaward sync (weekly) from the primary award sync (nightly).

### Endpoint 2.5 — GET `/api/v2/recipient/{recipient_hash}/`

Recipient organization detail. Used for resolving recipient names to canonical Organization records and surfacing parent-subsidiary relationships.

**Response shape:**
```json
{
  "name": "LOCKHEED MARTIN CORPORATION",
  "alternate_names": ["LOCKHEED MARTIN CORP", "LOCKHEED MARTIN"],
  "duns": "...",
  "uei": "ABC123XYZ",
  "parent_id": "PARENT001",
  "parent_name": null,
  "business_types": [...],
  "location": { "address_line_1": "...", "state_code": "MD", "country_code": "USA" }
}
```

### Endpoint 2.6 — GET `/api/v2/agency/{toptier_code}/`

Agency detail. Used for resolving agency names and codes to canonical government Organization records.

## Rate limiting and politeness

- **Rate limit:** 1000 requests/hour per IP. Enforced server-side.
- **429 response:** Returns immediately with `Retry-After` header (seconds). Corsair respects this header strictly.
- **Backoff:** On 429 without `Retry-After`, exponential backoff: 30s, 60s, 120s, 240s, then alert and skip-cycle.
- **User-Agent:** USAspending does not require User-Agent but Corsair sends `User-Agent: Corsair Defense BD Intel <ops-email>` as a politeness practice.
- **Concurrent requests:** Corsair limits to 4 concurrent requests against USAspending per workspace job to avoid burstiness.

## Pagination

Default limit is 10; max is 100. Corsair uses `limit: 100` for bulk fetches. `page_metadata.hasNext` drives the loop. Practical limit: ~500 pages per query (50k results) before query becomes inefficient — at that point, narrow the filter.

## Bulk download alternative

USAspending offers bulk CSV downloads at `https://www.usaspending.gov/download_center/custom_award_data`. For initial historical backfill (2-year USAspending backfill per OQ-1), bulk download is more efficient than paginating 50k results through the API.

**Approach for 8.5.4 backfill:** First sync uses bulk download (one-time, ~2GB CSV per workspace's filter set). Ongoing daily syncs use the API (smaller deltas, more responsive).

The bulk-download workflow:
1. Operator approves backfill scope per workspace.
2. Cloud Function constructs a custom download URL with the workspace's filter set.
3. Downloads ZIP to a Cloud Storage staging bucket.
4. Streams CSV records into RTDB as Award entities.
5. Marks backfill complete; ongoing sync takes over via API.

Backfill is a one-time operation; subsequent days use the API.

## When to use API vs. bulk

| Use case | Recommended method |
|---|---|
| Initial 2-year backfill per workspace | Bulk download |
| Daily delta sync (new + modified awards) | API |
| Real-time on-demand fetch (operator opens an Award) | API |
| Recompete-watch refresh | API with `popEnd` filter |
| Subaward sync | API (subaward bulk download exists but is unwieldy) |
| Recipient detail lookup | API per recipient |

---

# PART THREE — DOD NEWS CONTRACT ANNOUNCEMENTS

DoD News publishes a daily contract announcement page at `https://www.defense.gov/News/Contracts/` listing all DoD contract actions over $7.5M (the threshold was raised from $7M to $7.5M effective FY 2024).

## Publishing cadence

- **Frequency:** Business days only (Mon-Fri, excluding federal holidays).
- **Time:** Typically posted between 5:00-6:30 PM ET. The page URL for a specific date is `defense.gov/News/Contracts/Contract/Article/{article-id}/` where article IDs are sequential.
- **Catch-up:** Occasionally the day's announcements post the following morning.

Corsair fetches at 7:00 PM ET business days, with a 6:00 AM ET fallback sweep to catch late posts.

## HTML structure

A day's announcements page contains:
- One H1 heading: "Contracts For {Date}"
- One ordered or unordered list of services in fixed order: ARMY, NAVY, AIR FORCE, DEFENSE LOGISTICS AGENCY, MISSILE DEFENSE AGENCY, U.S. SPECIAL OPERATIONS COMMAND, U.S. TRANSPORTATION COMMAND, DEFENSE INFORMATION SYSTEMS AGENCY, WASHINGTON HEADQUARTERS SERVICES, etc.
- Under each service heading, a list of announcement paragraphs.

Each announcement paragraph follows a structured (but informal) sentence pattern:

```
{COMPANY NAME}, {CITY, STATE} ({PIID}), is being awarded {AWARD TYPE} 
{CONTRACT TYPE} {DOLLAR VALUE} for {DESCRIPTION}. {PLACE OF PERFORMANCE}. 
{ESTIMATED COMPLETION DATE}. {CONTRACTING AUTHORITY} is the contracting activity.
```

Example:
```
Lockheed Martin Aeronautics Co., Fort Worth, Texas (FA8611-24-D-0001), is being 
awarded a $145,000,000 firm-fixed-price contract for F-35 sustainment support. 
Work will be performed in Fort Worth, Texas, and is expected to be completed 
Sept. 14, 2027. Air Force Life Cycle Management Center, Wright-Patterson Air 
Force Base, Ohio, is the contracting activity.
```

## Parser design

The parser extracts six structured fields from each paragraph plus the service-of-record from the section heading:

1. **Company name** — text before the first comma.
2. **Location** — text between first comma and opening parenthesis.
3. **PIID** — text within parentheses; regex `[A-Z0-9]{2,}-[0-9]{2}-[A-Z]-[0-9]{4}` (typical format) with fallbacks for non-standard formats.
4. **Dollar value** — regex `\$[0-9,]+(?:\.[0-9]+)?` after "awarded" / "modification of" / etc.
5. **Description** — clause from "for" through the sentence-ending period.
6. **Contracting authority** — clause matching "{ENTITY} is the contracting activity" at end of paragraph.
7. **Place of performance** — clause matching "Work will be performed in {LOCATION}".

Each extraction has a confidence score (0.0-1.0). If overall confidence < 0.7, the announcement is added to an operator-review queue rather than auto-creating a provisional Award.

## Format variations

Different services use slightly different phrasings:

| Variation | Example phrasing |
|---|---|
| Modification | "...is being awarded a modification (P00012)..." |
| Joint venture | "Lockheed Martin/Boeing Joint Venture, ..." |
| Multi-award | "Lockheed Martin (FA8611-24-D-0001), Boeing (FA8611-24-D-0002), and ..." |
| Subcontractor identified | "...will subcontract approximately 35% of the work to..." |
| Foreign Military Sales | "...This contract involves foreign military sales to Australia." |
| Classified | "...for classified support." (no detailed description) |

The parser handles each variation. Multi-award announcements produce one Award entity per awardee (with shared description, customer, etc., differing by PIID and dollar share).

## Multi-contractor handling

A single announcement awarding the same scope of work to multiple contractors simultaneously is common (multiple-award IDIQ awards). Each contractor gets its own Award entity:
- Shared: description, customer agency, work-location summary, completion date
- Distinct: PIID, dollar value, prime Organization

The Awards are linked via a `co_awarded_with` Edge with `attrs: { announcementId, dateAnnounced }`.

## Reconciliation flag

Each DoD News-sourced Award is created with:
- `lifecycleState: 'provisional'`
- `source.system: 'dod_news'`
- `source.firstSeenAt: <fetch timestamp>`

When the nightly USAspending sync runs and finds a matching PIID, the Award is updated:
- `lifecycleState: 'active'` (assuming popEnd is in the future)
- `source.system: 'usaspending'` (more authoritative)
- `source.firstSeenAt` preserved
- `source.confirmedAt: <USAspending fetch timestamp>`
- All other fields refreshed from USAspending (more complete data)

If USAspending never returns a matching PIID within 30 days, Award transitions to `lifecycleState: 'unknown'` and the operator is notified (the announcement may have been for a classified or sole-source action that USAspending excludes).

## Edge cases

- **Modifications announced via DoD News:** When DoD News announces a mod (e.g., "P00012 modification of $25M"), Corsair looks up the parent PIID in existing Awards and appends to `modifications[]`. If parent Award doesn't exist yet, the announcement is queued for reconciliation after the next USAspending sync.
- **Withdrawn announcements:** Occasionally DoD News retroactively withdraws an announcement (typo, premature posting). Corsair monitors for HTTP 404 on previously-fetched announcement IDs and marks affected Awards for operator review.
- **Holiday gaps:** Multi-day batches occasionally appear after holidays. Parser handles N consecutive days in one fetch session.

---

# PART FOUR — AWARD ENTITY SCHEMA (DETAILED)

The architecture sketch listed the Award shape. This section adds field-by-field detail, defaults, indexing, and provenance.

## Complete schema

```
Award {
  // Identity
  id:                    string         // 'aw_' + hash(generated_unique_award_id || piid+date)
  type:                  'award'        // entity type discriminator
  generated_unique_id:   string         // USAspending canonical ID
  piid:                  string         // contracting officer PIID
  parentPiid:            string?        // for task orders under IDV
  parentAwardId:         string?        // FK → Award (for task orders)

  // Lifecycle
  lifecycleState:        enum           // see Part One
  lifecycleTransitions:  [LifecycleTransition]

  // Classification
  awardType:             enum           // 'A' | 'B' | 'C' | 'D' | 'IDV_A' | ...
  awardCategory:         enum           // 'contract' | 'grant' | 'cooperative_agreement' | 'idv'

  // Parties
  primeOrgId:            string         // FK → Organization
  primeRecipientHash:    string         // USAspending recipient_hash
  primeUei:              string?        // current UEI
  primeDuns:             string?        // legacy DUNS if known
  primeParentOrgId:      string?        // FK → Organization (parent recipient)
  customerOrgId:         string         // FK → Organization (sub-agency / contracting activity)
  customerToptierOrgId:  string         // FK → Organization (cabinet department)

  // Financials
  obligated:             number         // total obligated dollars (sum of mods)
  baseAndAllOptionsValue: number        // potential value including all options
  totalOutlays:          number?        // actually paid out (lags obligation)
  currency:              'USD'          // always USD for federal awards

  // Classification (capability)
  naics:                 string         // primary NAICS code
  psc:                   string         // primary PSC code
  setAside:              string?        // set-aside type code
  setAsideDescription:   string?

  // Timing
  awardedAt:             timestamp      // date_signed
  popStart:              timestamp      // period_of_performance.start_date
  popEnd:                timestamp      // period_of_performance.current_end_date (latest mod)
  lastModifiedAt:        timestamp      // most recent mod date

  // Location
  placeOfPerf: {
    country:             string         // 'USA' typically
    state:               string?        // state_code
    city:                string?        // city_name
    zip:                 string?        // zip code if available
  }

  // Description
  description:           string         // truncated to 2KB; full text in raw cache

  // Modifications
  modifications:         [Modification]

  // Subawards
  subawards:             [SubawardRef]  // FFATA-reported sub-awardees
  subawardsLastSyncAt:   timestamp?     // when subawards last refreshed

  // Attachments
  attachments:           [{ url, name, fetchedAt }]  // URLs only

  // Operator extensions
  operatorNotes:         string?        // operator-input notes; never overwritten
  operatorTags:          [string]       // operator-input tags
  workspaceAdversaryFor: [string]       // FK → Opportunity IDs that consider this Award's prime an adversary

  // Provenance
  source: SourceProvenance              // see migration doc E-4
  reconciliation: {
    dodNewsId:           string?        // article ID of DoD News announcement if applicable
    firstSeenAt:         timestamp
    firstSeenSource:     string         // 'dod_news' | 'usaspending'
    confirmedAt:         timestamp?
    confirmedSource:     string?        // 'usaspending' typically
    matchConfidence:     number?        // 0.0-1.0 for DoD News → USAspending match
  }
}
```

## Substructure: Modification

```
Modification {
  modNumber:             string         // e.g., 'P00009', 'A00001'
  modifiedAt:            timestamp      // action_date
  obligationDelta:       number         // signed; can be negative (deobligation)
  cumulativeObligated:   number         // running total at this mod
  popEndAfter:           timestamp      // new popEnd after this mod (may differ from prior)
  actionType:            string         // USAspending action_type code
  actionTypeDescription: string         // free-text description
  description:           string         // mod-specific description if available
  source: SourceProvenance
}
```

## Substructure: SubawardRef

```
SubawardRef {
  subawardNumber:        string
  subRecipientName:      string
  subOrgId:              string?        // FK → Organization (if resolved)
  amount:                number
  reportedAt:            timestamp      // FFATA report date
  subawardActionDate:    timestamp      // when the sub-action took place
  naics:                 string?
  description:           string
  source: SourceProvenance
}
```

## Substructure: LifecycleTransition

```
LifecycleTransition {
  fromState:             string
  toState:               string
  transitionedAt:        timestamp
  reason:                string
  triggeredBy:           string         // 'system' | 'operator:<userId>' | 'usaspending_sync' | 'dod_news_match'
}
```

## Field-by-field provenance

Every Award field is sourceable to one of: DoD News, USAspending, derived, or operator-input.

| Field | DoD News provides | USAspending provides | Derived | Operator-input |
|---|---|---|---|---|
| `id` | ✓ (provisional ID) | ✓ (canonical) | | |
| `piid` | ✓ | ✓ | | |
| `parentPiid` | rarely | ✓ | | |
| `lifecycleState` | | | ✓ (state machine) | |
| `awardType` | | ✓ | partial inference from DoD News | |
| `awardCategory` | | ✓ | | |
| `primeOrgId` | ✓ (provisional) | ✓ (authoritative) | resolution step | |
| `primeUei` | | ✓ | | |
| `customerOrgId` | ✓ (provisional) | ✓ (authoritative) | resolution step | |
| `obligated` | ✓ (provisional total) | ✓ (authoritative running total) | | |
| `baseAndAllOptionsValue` | rarely | ✓ | | |
| `naics` | | ✓ | | |
| `psc` | | ✓ | | |
| `setAside` | partial | ✓ | | |
| `awardedAt` | ✓ | ✓ | | |
| `popStart` | rarely | ✓ | | |
| `popEnd` | ✓ (provisional) | ✓ (authoritative) | | |
| `placeOfPerf` | partial | ✓ | | |
| `description` | partial | ✓ | | |
| `modifications` | partial (announces individual mods) | ✓ (full history) | | |
| `subawards` | | ✓ (FFATA) | | |
| `operatorNotes` | | | | ✓ |
| `operatorTags` | | | | ✓ |
| `workspaceAdversaryFor` | | | ✓ (from Opportunity links) | partial |

The reconciliation rule: when USAspending data is available, it overrides DoD News data for that field. Operator-input fields are never overwritten by either source.

## Indexed-for-query attributes in RTDB

RTDB doesn't support compound indexes natively but supports single-field ordered queries. Corsair structures secondary-index paths to support the queries it needs:

```
workspaces/{wsId}/awards/{awardId}                       (canonical Award record)
workspaces/{wsId}/awardsByPopEnd/{epochDay}/{awardId}    (for recompete watch)
workspaces/{wsId}/awardsByPrime/{orgId}/{awardId}        (competitor wins)
workspaces/{wsId}/awardsByCustomer/{orgId}/{awardId}     (per-customer view)
workspaces/{wsId}/awardsByNaics/{naics}/{awardId}        (capability filter)
workspaces/{wsId}/awardsByState/{state}/{awardId}        (geo filter)
workspaces/{wsId}/awardsByLifecycle/{state}/{awardId}    (state-based queries)
```

These secondary indexes are written by the same Cloud Function that writes the canonical record. Storage is duplicative but RTDB read performance benefits substantially. Estimated storage overhead per Award: ~2KB canonical record + ~200B index entries.

## Storage size estimates

At expected workspace volumes:
- Active Award record: ~2-4 KB (with modifications)
- Award with 20 modifications + 50 subawards: ~15-25 KB
- Workspace with 5000 tracked Awards: ~50-100 MB
- RTDB free tier limit (1 GB): supports 10-20 workspaces at this scale
- Production deployment uses Blaze plan (pay-per-GB); cost is negligible

---

# PART FIVE — RECONCILIATION LOGIC

The DoD News + USAspending pair is Corsair's prototype for multi-source reconciliation. Other source pairs (e.g., GAO protest filing + GAO decision) will reuse this pattern.

## Reconciliation principle

A single real-world event (a contract award) appears in multiple sources at different times with different fidelity. Corsair's reconciliation logic:
1. Track each appearance of the event as a separate observation.
2. Match observations to the same real-world event via shared identifiers.
3. Merge into a single Award entity with provenance preserved for each field.
4. Update authoritative-source data over provisional-source data.
5. Never lose the operator's view of when Corsair first knew about an event.

## Match key

The match key for DoD News → USAspending is the PIID. PIIDs are agency-assigned and unique per contract action. When DoD News extracts a PIID, the USAspending nightly sync queries for that PIID directly.

**Match confidence rules:**
- **High confidence (1.0):** Exact PIID match.
- **Medium confidence (0.7-0.95):** PIID matches but with normalization (one source has dashes, other doesn't; one source uses uppercase, other doesn't).
- **Low confidence (0.4-0.7):** PIID partial match + same prime + same date within 7 days.
- **No match (<0.4):** No PIID match; treat as separate events.

Awards with match confidence < 0.7 are added to an operator-review queue. The operator confirms or rejects the match.

## Merge rules

When a match is confirmed:

```
function merge(provisional, authoritative) {
  return {
    id: authoritative.id,                                    // canonical
    piid: authoritative.piid,                                // canonical
    lifecycleState: deriveFromAuthoritative,                 // recomputed
    lifecycleTransitions: [...provisional.transitions, newTransition('provisional', 'active')],
    primeOrgId: authoritative.primeOrgId || provisional.primeOrgId,
    customerOrgId: authoritative.customerOrgId || provisional.customerOrgId,
    obligated: authoritative.obligated,                      // authoritative wins
    naics: authoritative.naics,                              // authoritative wins
    description: authoritative.description || provisional.description,
    operatorNotes: provisional.operatorNotes,                // operator-input preserved
    operatorTags: provisional.operatorTags,                  // operator-input preserved
    source: {
      system: 'usaspending',
      externalId: authoritative.generated_unique_id,
      url: authoritative.url,
      fetchedAt: authoritative.fetchedAt,
      refreshedAt: now(),
      hash: hash(authoritative)
    },
    reconciliation: {
      dodNewsId: provisional.reconciliation.dodNewsId,
      firstSeenAt: provisional.reconciliation.firstSeenAt,
      firstSeenSource: 'dod_news',
      confirmedAt: now(),
      confirmedSource: 'usaspending',
      matchConfidence: 1.0
    }
  };
}
```

**Field-level merge precedence:**
1. Operator-input fields always win (operatorNotes, operatorTags, workspaceAdversaryFor when operator-set).
2. Authoritative source (USAspending) wins over provisional source (DoD News) on factual fields.
3. Provisional source preserved as historical reference (`reconciliation.firstSeenAt`).

## Provenance through merges

Each Award field tracks its source. This is what `source.system` on the Award record represents — but a future enhancement (out of scope for 8.5.4) is per-field provenance:
```
fieldProvenance: {
  obligated: 'usaspending',
  description: 'dod_news',          // if USAspending description was empty
  operatorNotes: 'operator_manual',
  ...
}
```

For Phase 8.5.4, top-level `source.system` is sufficient. Per-field provenance is a Phase 9+ enhancement.

## Operator review queue

Low-confidence matches and unmatched DoD News provisionals are queued at:
```
workspaces/{wsId}/awards/_reconciliation_queue/{awardId} = {
  awardId,
  reason: 'low_confidence_match' | 'no_match' | 'multi_candidate_match',
  candidates: [{ otherAwardId, confidence, matchedFields }],
  queuedAt: timestamp
}
```

Operator views this queue in a Brief-surface section ("Award reconciliation: N items need review"). Each item has options:
- Confirm match: merge as above.
- Reject match: keep as separate Awards.
- Defer: re-queue for 7 days; if still no match after 30 days from initial provisional, transition to `lifecycleState: 'unknown'`.

---

# PART SIX — ORGANIZATION RESOLUTION

Each Award has up to four Organization linkages (prime, parent of prime, customer subtier, customer toptier). Plus N subaward Organizations. Plus potentially co-prime Organizations for multi-award announcements. Organization resolution is the highest-volume relational work in 8.5.4.

## Resolution algorithm

For each recipient name encountered:

1. **Exact match check.** Query `workspaces/{wsId}/nodes` where `name === recipientName` and `type ∈ ['company', 'government', 'university', 'ffrdc']`. If found, return matched Organization.
2. **Normalized exact match.** Normalize the name (strip "Inc.", "LLC", "Corp.", "Co.", "Corporation", "Company"; uppercase; strip punctuation). Compare against normalized names of existing Organizations. If matched, return.
3. **UEI/DUNS match.** If USAspending provides a UEI and an existing Organization has the same UEI, match.
4. **Fuzzy match.** Compute Jaro-Winkler similarity against all existing Organizations. If best match > 0.92, queue for operator review with the candidate. If > 0.88 but < 0.92, queue with multiple candidates.
5. **No match.** Create new Organization with `source.system: 'usaspending'` (or `dod_news`), populate name, UEI, location.

## Name normalization

Common suffixes stripped:
- Corporate: `Inc.`, `Inc`, `LLC`, `L.L.C.`, `Corp.`, `Corporation`, `Co.`, `Company`, `Ltd.`, `Limited`, `Holdings`, `Group`
- Legal: `, A {STATE} Corporation`, `, A Delaware Corporation`, etc.
- Punctuation: commas, periods, double-spaces collapsed

Example normalizations:
- `LOCKHEED MARTIN CORPORATION` → `lockheed martin`
- `Lockheed Martin Corp.` → `lockheed martin`
- `LOCKHEED MARTIN AERONAUTICS CO., FORT WORTH, TX` → `lockheed martin aeronautics`
- `Boeing Defense, Space & Security` → `boeing defense space security`

Normalization is applied for matching only; the original name is preserved in the Organization record as `name` with an `alternateNames[]` array accumulating variants observed across sources.

## DUNS-to-UEI handling

USAspending records have both DUNS (legacy) and UEI (current) where available. UEIs were mandated April 2022; pre-2022 records may have DUNS only. Corsair's Organization record stores both:
```
Organization {
  ...
  uei: string?
  duns: string?
  alternateNames: [string]
  uei_history: [{ uei, observedAt }]   // tracks UEI changes
}
```

When a name match is ambiguous but UEI matches, UEI wins. When DUNS migrates to UEI for the same entity, Corsair updates the canonical UEI and preserves the DUNS in history.

## Multi-recipient awards

Joint ventures and partnerships appear as single recipients on the prime award but represent multiple underlying Organizations. Patterns:
- `"LOCKHEED MARTIN/BOEING JOINT VENTURE"` → split into prime JV Organization plus member Organizations linked via `jv_member_of` Edges.
- `"NORTHROP GRUMMAN-BOEING TEAM"` → similar.

Detection: substring match for `"JOINT VENTURE"`, `"JV"`, `"TEAM"`, `"PARTNERSHIP"`, `"-"` between two known prime names. Detected JVs are queued for operator review before auto-splitting.

## Parent-subsidiary rollup

USAspending's `parent_recipient_unique_id` identifies the corporate parent for a given recipient. Corsair stores this as `Organization.parentOrgId` (creating the parent if not present).

For competitor tracking, the operator may want to roll up subsidiary wins to the parent (e.g., wins by "Lockheed Martin Aeronautics Co." count toward "Lockheed Martin Corporation"). Phase 8.5.4 supports this via a derived query: when querying Awards by `primeOrgId`, optionally include Awards where `primeParentOrgId === queriedOrgId`.

## Foreign recipient handling

Some defense contracts go to foreign-owned U.S. subsidiaries (BAE Systems Inc., Elbit Systems of America, Rheinmetall American, etc.). These get standard `company` type Organizations. The foreign parent linkage is tracked via `Organization.parentOrgId` if USAspending records the parent.

True foreign recipients (direct awards to non-U.S. entities, rare for prime contracts but common for FMS sub-actions) get `Organization.country` set appropriately and a `non_us_recipient: true` flag.

## Government Organization resolution

Customer agency Organizations follow a parallel resolution path:
- USAspending's `toptier_agency.name` + `code` resolves to a canonical Organization with `type: 'government'`.
- USAspending's `subtier_agency.name` + `code` resolves similarly, linked to its toptier via `subtier_of` Edge.
- USAspending's `office_agency_name` (when present) resolves to a sub-Organization linked via `office_of` Edge.

For Phase 8.5.4, the entire DoD hierarchy (Army, Navy, Air Force, Marine Corps, Space Force, Defense Agencies) is seeded at workspace creation time with canonical IDs. Awards link to these canonical government Organizations rather than auto-creating duplicates.

---

# PART SEVEN — RECOMPETE WATCH

The recompete watch is Phase 8.5.4's marquee operator-facing deliverable. The Sovereign wants a daily-refreshed list of expiring contracts in her capability area, with the incumbents identified, sorted by recompete urgency.

## Derived view shape

```
RecompeteWatch {
  workspaceId:          string
  generatedAt:          timestamp
  horizonMonths:        number     // operator-configurable, default 18
  filterApplied: {
    naics:              [string]
    customerOrgIds:     [string]
    minDollarThreshold: number
  }
  results: [
    {
      awardId:          string
      piid:             string
      primeOrgId:       string
      primeName:        string
      customerOrgId:    string
      customerName:     string
      naics:            string
      psc:              string
      obligated:        number
      popEnd:           timestamp
      daysToPopEnd:     number
      description:      string
      lifecycleState:   'expiring'
      hasProposedOpp:   boolean    // whether a candidate Opportunity has been created
      proposedOppId:    string?
    }
  ]
  totalResultCount: number
}
```

## Query construction

The query reads from the `awardsByPopEnd/` secondary index:
```
const cutoff = nowEpochDay + (horizonMonths * 30);
const fromDay = nowEpochDay;
const candidateIds = await rtdb
  .child(`workspaces/${wsId}/awardsByPopEnd`)
  .orderByKey()
  .startAt(String(fromDay))
  .endAt(String(cutoff))
  .once('value');

// Fetch full Award records for candidates
const awards = await Promise.all(candidateIds.map(fetchAward));

// Apply additional filters (NAICS, customer, dollar threshold)
const filtered = awards.filter(a => {
  return operatorWatchlist.naics.includes(a.naics)
      && operatorWatchlist.customerOrgIds.includes(a.customerOrgId)
      && a.obligated >= operatorWatchlist.minDollarThreshold;
});

return filtered.sort((a, b) => a.popEnd - b.popEnd);
```

The query is bounded (only awards with popEnd in the next 18 months) so performance scales with workspace size.

## Refresh cadence

- **Generated on-demand** when operator opens the Recompete Watch surface.
- **Pre-generated nightly** as part of the USAspending sync job, written to `workspaces/{wsId}/derivedViews/recompeteWatch`.
- **Invalidated** when watchlist config changes, when an Award's popEnd changes (via mod), or when an Award transitions states.

The pre-generated nightly version is the default render; on-demand fetch shows freshness ("last generated at: ...") and offers a refresh button.

## Surfacing in the Brief

The Daily Brief surface includes a "Expiring contracts in your watchlist" section:
- Top 5 by days-to-popEnd (most urgent first)
- One-line per item: `{customer} • {prime} • {naics} • ${value} • expires in {days} days`
- Click to open full Recompete Watch view

## Surfacing in the Pipeline (candidate Opportunities)

For each expiring Award without an existing Opportunity covering its recompete:
- A candidate Opportunity is automatically proposed (not created until operator approves)
- Proposal lives in `workspaces/{wsId}/proposedOpportunities/{proposalId}` until operator promotes
- Pipeline surface shows proposed Opportunities in a dedicated "Proposed Pursuits" lane to the left of `awareness`

Each proposed Opportunity carries:
```
ProposedOpportunity {
  sourceAwardId:     string
  proposedAt:        timestamp
  proposedStage:     'awareness'   // always starts at awareness
  customerOrgId:     string        // copied from Award
  incumbentOrgId:    string        // = Award.primeOrgId
  naics:             string
  estimatedValue:    number        // = Award.baseAndAllOptionsValue
  popEndPredecessor: timestamp     // = Award.popEnd
  expectedSolicitationWindow: { start, end }  // typically popEnd - 9mo to popEnd - 3mo
  notes:             string        // template-generated from Award details
  proposedAdversaries: [string]    // = [Award.primeOrgId] (the incumbent)
}
```

Operator promotion creates a real Opportunity with:
- `Opportunity.posture.adversaries[]` = `proposedAdversaries`
- `Opportunity.notes` = `notes` + operator additions
- Stage starts at `awareness`
- `stageEnteredAt` = now

## Operator dismissal

Operator can dismiss a proposed Opportunity (e.g., "we don't pursue this NAICS / not interesting / already covered by another pursuit"). Dismissal:
- Sets `dismissed: true, dismissedAt: now, dismissReason: <operator text>`
- Removes from Proposed Pursuits lane
- Award is marked `recompeteWatchDismissed: true` so future syncs don't re-propose

Dismissal is reversible — operator can un-dismiss from a Dismissed Proposals view.

## Adversary auto-population

The `proposedAdversaries: [Award.primeOrgId]` pre-population is the Doctrine §V "We surface, we do not prescribe" applied to a derived intelligence. Corsair surfaces: "the incumbent on the expiring contract is X." Operator decides: pursue, decline, or modify the adversary set.

---

# PART EIGHT — REFRESH AND UPDATE LOGIC

Once Awards are initially synced, ongoing maintenance keeps them current.

## Change detection via hash

Each Award record stores `source.hash` — a content hash of the authoritative fields. On each USAspending sync:
1. Fetch current record from USAspending.
2. Compute hash of relevant fields (obligated, popEnd, lastModifiedAt, mod count).
3. Compare to stored `source.hash`.
4. If different, update Award record with new field values, append any new modifications, increment `source.refreshedAt`, store new hash.
5. If unchanged, update `source.refreshedAt` only (proves the sync ran).

This avoids RTDB writes on unchanged records (saves bandwidth and rate-limit budget).

## Mod-driven updates

When a new modification appears (USAspending `latest_transaction_contract_data.modification_number` differs from any in `Award.modifications[]`):
1. Fetch transactions endpoint for the Award.
2. Append all new modifications to `Award.modifications[]`.
3. Update `Award.obligated` from latest cumulative obligation.
4. Update `Award.popEnd` if the latest mod changed it.
5. If `popEnd` changed and Award was in `expiring` state, recompute `lifecycleState`.
6. If `popEnd` extended past the 18-month horizon, transition back to `active` and add LifecycleTransition entry.
7. Emit Signal (`type: 'award_modification'`) linked to Award.

The Signal lets the operator notice that an Award has changed without re-reading the full Award record.

## Award termination handling

USAspending modifications can include termination action types:
- T4D — Termination for Default
- T4C — Termination for Convenience
- Termination Settlement
- Closeout

When a termination mod is detected:
1. Award transitions to `lifecycleState: 'terminated'`.
2. `terminationType: 'T4D' | 'T4C' | 'Settlement' | 'Closeout'` field added.
3. Emit Signal (`type: 'award_terminated'`) linked to Award and prime Organization.
4. If a candidate Opportunity was proposed from this Award (recompete watch), the proposal is updated with the termination context.

T4D specifically is a high-signal event for the operator — defaults are rare and indicate contractor performance issues. Daily Brief surfaces T4D events prominently.

## Subaward reconciliation (FFATA lag)

The weekly subaward sync re-fetches subaward data for all Awards modified in the last 90 days (subawards lag the prime). Sync logic:
1. For each Award, fetch current subaward set from USAspending.
2. Compare to stored `Award.subawards[]`.
3. Add new subawards, update existing ones (amount changes), flag removed ones (rare).
4. For new subawards, resolve sub-recipient Organization (creating if needed).
5. Create `award_sub` Edge from Award → sub-Organization.
6. Update `Award.subawardsLastSyncAt`.

The 90-day window catches most reporting lag without re-checking ancient Awards unnecessarily.

## Stale-record cleanup

Awards in `lifecycleState: 'expired'` for more than 24 months without operator-input (no notes, tags, or linkages to active Opportunities) are eligible for archive. Archive moves the Award from `workspaces/{wsId}/awards/{id}` to `workspaces/{wsId}/awards_archive/{id}`. Archive is reversible.

Archive does not happen automatically in Phase 8.5.4 — it's a Phase 9+ feature. Phase 8.5.4 just retains all Awards indefinitely.

## Watchlist change handling

When the operator changes the workspace's USAspending watchlist config (NAICS, agencies, competitors):
1. Subsequent syncs use the new config.
2. Existing Awards already in the workspace are not removed.
3. A one-time "backfill new watchlist scope" job runs the next sync cycle to pull historical data matching the newly added scope (subject to OQ-1's 2-year limit).
4. Awards no longer in watchlist scope are kept but flagged `outOfScope: true` for display filtering.

The operator can manually purge `outOfScope: true` Awards from a Workspace Settings cleanup view.

---

# PART NINE — PHASE 8.5.4 SUB-PHASE SEQUENCING

The Award integration is decomposable into six sub-sub-phases. Sequenced to deliver operator-visible value incrementally.

## Sub-phase 8.5.4.1 — Award entity client-side support (3-5 days)

**Scope:**
- Client code recognizes the `Award` entity type and renders it in Inspector, Theater, and Table surfaces.
- Award read paths only (no write UI yet — Cloud Function will write).
- Empty-state messaging when workspace has no Awards.

**Deliverables:**
- `js/corsair/award.js` module with rendering helpers.
- Inspector surface "Award" detail view.
- Table surface "Awards" tab with sortable columns (popEnd ascending default).
- Theater surface Award nodes (rendered as a distinct shape from Person / Organization).

**Operator-impact moment:** Workspace shows "0 awards" in Table — surface exists, awaiting data.

**Dependencies:** Phase 8.5.1 (Award entity type registered).

---

## Sub-phase 8.5.4.2 — USAspending Cloud Function (5-7 days)

**Scope:**
- `functions/src/sources/usaSpending.js` implementing API client, pagination, retry, rate-limit handling.
- `functions/src/jobs/usaSpendingNightly.js` as scheduled trigger.
- Bulk-download backfill flow for initial 2-year history.
- Daily delta sync via API.
- Award entity creation/update with provenance.
- Organization resolution and creation (basic — exact match + fuzzy match against existing).
- Secondary index writes.

**Deliverables:**
- Working nightly sync producing Awards in test workspace.
- Source Health view reflecting USAspending sync status.

**Operator-impact moment:** "Operator sees Awards populated in Table; can sort by popEnd; can drill into individual Awards."

**Dependencies:** 8.5.4.1.

---

## Sub-phase 8.5.4.3 — DoD News Cloud Function (3-5 days)

**Scope:**
- `functions/src/sources/dodNewsContracts.js` implementing HTML scraper and parser.
- `functions/src/jobs/dodNewsBusinessDaily.js` as scheduled trigger.
- Provisional Award creation with `source.system: 'dod_news'`.

**Deliverables:**
- Daily DoD News scrape running successfully.
- Provisional Awards appearing in workspace alongside USAspending-sourced Awards.

**Operator-impact moment:** "Operator sees DoD-announced large awards on the same business day they post."

**Dependencies:** 8.5.4.1, 8.5.4.2.

---

## Sub-phase 8.5.4.4 — Reconciliation logic (4-6 days)

**Scope:**
- Match algorithm (Part Five).
- Auto-confirm high-confidence matches.
- Reconciliation queue for low-confidence matches.
- Merge logic preserving provenance.
- Operator-facing reconciliation queue UI in the Brief.

**Deliverables:**
- DoD News Awards transitioning from `provisional` to `active` upon USAspending confirmation.
- Operator can review and confirm/reject ambiguous matches.

**Operator-impact moment:** "Operator can trust that Awards in the workspace are deduplicated and authoritative."

**Dependencies:** 8.5.4.2, 8.5.4.3.

---

## Sub-phase 8.5.4.5 — Recompete watch (5-7 days)

**Scope:**
- Derived view generation (Part Seven).
- Pipeline surface "Proposed Pursuits" lane.
- Candidate Opportunity creation with incumbent pre-population.
- Operator promote / dismiss actions.

**Deliverables:**
- Recompete Watch surface showing expiring contracts in operator's watchlist.
- Proposed Opportunities appearing in Pipeline.
- Operator can promote a proposal to a real Opportunity with one click.

**Operator-impact moment:** "Operator sees a daily-refreshed list of expiring contracts in her capability area, with incumbents identified and one-click pursuit creation."

**Dependencies:** 8.5.4.4 (reconciled Awards) and existing Opportunity entity infrastructure.

---

## Sub-phase 8.5.4.6 — Brief surface integration (3-4 days)

**Scope:**
- Daily Brief section "External Intelligence — Awards (last 24h)":
  - New Awards in watchlist
  - Significant modifications (>20% obligation change or popEnd shift > 6 months)
  - Terminations (T4D, T4C)
  - New Subawards
- "Reconciliation queue: N items" indicator
- "Expiring soon (top 5)" snapshot

**Deliverables:**
- Brief surface populated with Award-derived intelligence.
- Click-through from Brief items to full entity views.

**Operator-impact moment:** "Operator opens Corsair in the morning and sees yesterday's relevant award activity in one consolidated read."

**Dependencies:** 8.5.4.5.

---

## Sequencing summary

| Sub-phase | Description | Days | Cumulative |
|---|---|---|---|
| 8.5.4.1 | Award client support | 3-5 | 3-5 |
| 8.5.4.2 | USAspending function | 5-7 | 8-12 |
| 8.5.4.3 | DoD News function | 3-5 | 11-17 |
| 8.5.4.4 | Reconciliation | 4-6 | 15-23 |
| 8.5.4.5 | Recompete watch | 5-7 | 20-30 |
| 8.5.4.6 | Brief integration | 3-4 | 23-34 |

**Total Phase 8.5.4 estimate: 23-34 operator-days (~5-7 operator-weeks).** Falls within the architecture sketch's 2-3 week estimate for the sub-phase if scope is interpreted as 8.5.4.2 + 8.5.4.4 only and the rest absorbed into earlier or later sub-phases. The fuller scope here gives a more accurate read.

---

# PART TEN — ACCEPTANCE CRITERIA

Phase 8.5.4 is shippable when all of the following are demonstrably true on the operator's test workspace:

1. **USAspending nightly sync runs successfully** for 7 consecutive days without rate-limit errors or data corruption.
2. **DoD News business-daily sync runs successfully** for 5 consecutive business days, capturing all announcements on each fetch.
3. **Award entity records render correctly** in Inspector, Table, and Theater surfaces.
4. **Modifications array populates accurately** — sum of `modifications[].obligationDelta` equals `Award.obligated`.
5. **Secondary indexes are consistent** — every record in `awardsByPopEnd`, `awardsByPrime`, etc., resolves to an existing canonical Award.
6. **Reconciliation matches are accurate** — sampling 20 DoD News Awards that subsequently appear in USAspending, ≥18 of 20 (90%) auto-match at high confidence; remainder go to operator review queue and are correctly classifiable by operator.
7. **Organization resolution works** — sampling 50 new recipient names, ≥45 of 50 (90%) match to existing Organizations or correctly auto-create new ones; remainder queue for operator review.
8. **Recompete watch surfaces** correctly:
   - Awards with `popEnd` in the next 18 months and matching watchlist filters appear.
   - Awards outside the watchlist do not appear.
   - Sort order is `popEnd` ascending.
9. **Proposed Opportunities** are created with correct incumbent pre-population.
10. **Operator can promote** a proposed Opportunity to a real Opportunity with one click; the resulting Opportunity has correct adversary pre-population.
11. **Operator can dismiss** a proposed Opportunity; dismissed proposals do not re-appear.
12. **Source Health view** correctly reflects sync status: green when recent, amber when stale, red when failing.
13. **Brief surface integration** shows yesterday's award activity in the workspace.
14. **No operator-input fields** (operatorNotes, operatorTags, manual Organization edits) are overwritten by sync.
15. **Doctrine §VI compliance** — no scraping of private data, no aggregation of private contact info, no surveillance of individuals.

When all 15 criteria are met, Phase 8.5.4 is accepted and Phase 8.5.5 (GAO Bid Protest) can commence.

---

# PART ELEVEN — OPEN IMPLEMENTATION QUESTIONS

Decisions specific to 8.5.4 that benefit from operator review before code commits.

## AIQ-1 — Initial backfill query construction

**Question:** For the 2-year historical backfill (OQ-1 confirmed), should Corsair fetch all Awards in the operator's watchlist scope at once (potentially 50k+ records) or page incrementally over multiple days?

**Proposal:** Incremental backfill over 7 days — fetch ~7000 records/day for 7 days to spread the rate-limit load. Each day's records are made operator-visible as they ingest. Backfill marker is set when complete.

**Tradeoff:** Faster all-at-once backfill (1-2 days) risks hitting rate limits and blocks the daily sync from running on top of it. Slower incremental backfill (7 days) keeps daily sync working concurrently.

**Recommendation:** Confirm incremental 7-day backfill.

## AIQ-2 — Subaward Organization auto-creation

**Question:** When a subaward names a sub-recipient that doesn't exist as an Organization in the workspace, should Corsair auto-create the Organization with no operator review?

**Proposal:** Auto-create with `source.system: 'usaspending'` and `autoCreated: true` flag. Operator can review auto-created Organizations in a settings view.

**Tradeoff:** Auto-creation populates the graph faster but risks duplicate Organizations from naming inconsistencies. Manual review slows graph growth but maintains cleanliness.

**Recommendation:** Confirm auto-create with autoCreated flag and operator review surface.

## AIQ-3 — JV detection threshold

**Question:** When the recipient name contains JV-suggestive substrings (`"JOINT VENTURE"`, `"JV"`, `"-"`), should Corsair auto-split or always queue for operator review?

**Proposal:** Always queue for operator review. Auto-splitting risks incorrect Organization assignments.

**Recommendation:** Confirm operator review for all detected JVs.

## AIQ-4 — Recompete proposal frequency

**Question:** Should every expiring Award generate a Proposed Opportunity, or only those above a dollar threshold or matching specific filters?

**Proposal:** Operator-configurable threshold. Default: any expiring Award above $1M in operator's watchlist. Below threshold: appears in Recompete Watch list but no Proposed Opportunity auto-generated.

**Recommendation:** Confirm $1M default with operator-configurable threshold.

## AIQ-5 — Termination as Signal vs. Award attribute

**Question:** Termination events (T4D, T4C) are surfaced as both an Award attribute (`lifecycleState: 'terminated'`) and a Signal. Is the Signal redundant?

**Proposal:** Keep both. Award attribute is the state; Signal is the discoverable event. Brief surface reads Signals (better fit for time-ordered intelligence stream); Award detail view reads attribute.

**Recommendation:** Confirm dual representation.

## AIQ-6 — Hash field composition

**Question:** What fields are included in `source.hash` for change detection?

**Proposal:** `hash = sha256(obligated + popEnd + lastModifiedAt + modifications.length + description.slice(0,500))`. Excludes operator-input fields. Excludes subawards (separately tracked).

**Recommendation:** Confirm proposed composition.

## AIQ-7 — Operator notes propagation through merges

**Question:** When a DoD News provisional Award is matched to a USAspending authoritative Award, and the operator had added notes to the provisional, those notes should survive the merge. Confirmed in Part Five. But: what if the operator had also added notes to an UNRELATED USAspending Award that turned out to be the match — how do we surface that?

**Proposal:** Pre-merge alert: "You have notes on Award X (USAspending). DoD News provisional Y is proposed to match X. Confirm match?" Operator confirms before merge proceeds. Notes from both records preserved with provenance.

**Recommendation:** Confirm pre-merge alert pattern.

## AIQ-8 — Display of provisional vs. authoritative

**Question:** Should provisional Awards (DoD News-only) be visually distinct in the Table surface from authoritative Awards?

**Proposal:** Yes. A small "provisional" badge appears next to Awards with `lifecycleState: 'provisional'`. Once confirmed, badge disappears. Operator can filter to provisional-only via Table column filter.

**Recommendation:** Confirm visual distinction.

## AIQ-9 — Multi-source future-proofing

**Question:** Phase 8.5.4 establishes the multi-source reconciliation pattern. Should the schema include explicit room for a third source per Award (e.g., a future GovWin integration also reports the same award)?

**Proposal:** Yes. `Award.reconciliation` becomes a more general structure:
```
reconciliation: {
  firstSeenAt: timestamp,
  firstSeenSource: string,
  sources: [
    { system: 'dod_news', externalId: ..., observedAt: ..., confidence: ... },
    { system: 'usaspending', externalId: ..., observedAt: ..., confidence: ... },
    // potential future: { system: 'govwin', externalId: ..., observedAt: ..., confidence: ... }
  ],
  authoritativeSource: 'usaspending'
}
```

**Recommendation:** Confirm generalized structure now to avoid schema thrash later.

---

# CLOSING NOTES

## Why this source pair gets the deepest spec

USAspending + DoD News is the proof point for everything else in Phase 8.5:
- Proves the new Award entity type works in practice.
- Proves multi-source reconciliation works (DoD News → USAspending merge).
- Proves the operator-impact moment of recompete watch.
- Establishes patterns the other four Tier 1 source specs (SAM.gov, GAO, EDGAR, Congress.gov) will reuse with source-specific variations.

If 8.5.4 ships successfully and the operator validates that recompete watch genuinely shapes her capture work, the rest of Phase 8.5 has cover air. If 8.5.4 reveals fundamental issues with the Award model or the reconciliation pattern, the rest of 8.5 stops and re-plans.

## Implementation order recommendation

Sub-phase order in Part Nine is the recommended sequence. Operator validation at 8.5.4.2 (USAspending sync working) is the first major milestone. Validation at 8.5.4.5 (Recompete Watch surfacing) is the second. Validation at 8.5.4.6 (Brief integration) is acceptance.

The build session should pause for operator validation after 8.5.4.2 and 8.5.4.5 specifically — these are the steps where operator-visible behavior is most consequential.

## Maintenance principle

This document is v1.0 — first draft of the Phase 8.5.4 implementation target. Revisions to v1.1, v1.2 happen as implementation surfaces real constraints. The 15 acceptance criteria in Part Ten are the formal contract; revisions to acceptance criteria require operator-approved amendment, not unilateral implementer relaxation.

---

*End of Phase 8.5.4 deep-dive v1.0. Awaiting operator review of acceptance criteria and open implementation questions before the parallel build session begins 8.5.4 implementation.*
