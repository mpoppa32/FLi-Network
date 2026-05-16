# CORSAIR PHASE 8.5.3 — SAM.gov INTEGRATION DEEP-DIVE

**Sources covered:** SAM.gov Opportunities API + SAM.gov Entity Registration API
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md), [`corsair-osint-architecture-v1.md`](corsair-osint-architecture-v1.md), [`corsair-osint-migration-v1.md`](corsair-osint-migration-v1.md), [`corsair-osint-award-integration-v1.md`](corsair-osint-award-integration-v1.md)
**Status:** Deep-dive spec for the Tier 1 anchor source. SAM.gov is the spine of the Pipeline surface. This document is the formal target for Phase 8.5.3 implementation.

---

## Document Purpose

The architecture sketch covers SAM.gov at sketch level. This document goes deep on the integration that establishes the "external source feeds an existing entity type" pattern.

Why SAM.gov gets the second deep-dive:
1. **Pipeline spine.** Opportunity is Corsair's centerpiece entity. SAM.gov is its canonical external source. Get this right, the Pipeline surface gains substantially.
2. **Pattern complement to Award.** Award integration (8.5.4) creates a new entity type. SAM.gov integration (8.5.3) augments an existing one. The two together establish both patterns the rest of Phase 8.5 needs.
3. **Operator-created vs. external reconciliation.** Operators already create Opportunities by hand. SAM.gov adds Opportunities the operator hasn't yet seen. Reconciling these without overwriting operator work is structurally interesting and important.
4. **Notice type taxonomy.** SAM.gov publishes seven primary notice types (presol, sources sought, combined synopsis, solicitation, special notice, justification, award). Each maps to Corsair's pipeline stages differently. Getting this taxonomy right is foundational.
5. **Attachment density.** RFP packages can be 20-50 files (SOO, SOW, PWS, CDRLs, Section L/M, Q&A logs). How Corsair handles these without becoming a document store is a design question this spec answers.

This spec is the formal target for Phase 8.5.3. The build session reads this document and produces code that conforms to it.

---

# PART ONE — OPPORTUNITY LIFECYCLE AND SAM.gov NOTICE TYPES

The existing Corsair Opportunity has a 10-stage pipeline (locked by operator 2026-05-14):
```
awareness → tracking → engaged → rfp → proposal → negotiation → submitted → award → won | lost
```

SAM.gov notices map to these stages but the mapping is not 1:1. A single pursuit may be associated with multiple SAM.gov notices over time, each representing a different point in the capture cycle.

## SAM.gov notice type taxonomy

| SAM.gov `type` value | Common name | Stage indicator | Typical Corsair mapping |
|---|---|---|---|
| `p` | Presolicitation | Pre-RFP advance notice | `awareness` or `tracking` |
| `r` | Sources Sought | Market research request | `awareness` |
| `g` | Sale of Surplus Property | (skip — out of defense BD scope) | n/a |
| `s` | Special Notice | Catch-all (industry days, capability briefings) | `awareness` or `tracking` |
| `k` | Combined Synopsis/Solicitation | Simplified-acquisition RFP | `rfp` |
| `o` | Solicitation | Full RFP | `rfp` |
| `u` | Justification | Sole-source justification | `tracking` (informational) |
| `a` | Award Notice | Award announcement | `award` or `won` (depending on perspective) |
| `m` | Modification/Amendment | Amendment to prior notice | Updates existing record |
| `i` | Intent to Bundle Requirements | Bundling notice | `awareness` |
| `f` | Foreign Government Standard | (rare — FMS-specific) | `awareness` |

For Corsair's Tier 1 scope, the meaningful notice types are: `p`, `r`, `s`, `k`, `o`, `u`, `a`, `m`. Workspace config defaults to subscribing to all except `g` and `f`.

## Why notice types matter operationally

Different notice types tell the operator different things:
- **Sources Sought (`r`)** — Customer is doing market research. Earliest signal. Operator may submit a capability statement or RFI response. No commitment to bid yet.
- **Presolicitation (`p`)** — Customer is preparing to issue RFP. Often includes draft SOW. Operator should be in capture planning if this is a watchlist match.
- **Solicitation (`o`)** — Full RFP. The "race is on" moment. Operator must have bid/no-bid decision soon.
- **Combined Synopsis (`k`)** — Simplified acquisition (under $250k typically). Faster cycle. Smaller dollar but valuable for small business operators.
- **Justification (`u`)** — Customer is justifying sole-source to incumbent. For the non-incumbent operator, this is a "you've lost this round" signal but also intelligence on customer/incumbent relationship.
- **Award (`a`)** — Customer announced award. Useful for non-DoD-News-tracked awards (under $7.5M threshold).
- **Modification (`m`)** — Amendment to prior notice. Critical for deadline tracking and scope shifts.

## Opportunity lifecycle state in SAM.gov context

Corsair extends the existing Opportunity with a SAM.gov-specific lifecycle attribute:

```
Opportunity.samgovLifecycle ∈ {
  null,                  // operator-created; no SAM.gov linkage
  'tracked',             // SAM.gov notice exists and is open for response
  'response_window_closed',  // response deadline passed; awaiting award
  'awarded',             // award notice posted
  'cancelled',           // SAM.gov shows cancelled
  'archived'             // SAM.gov archived this notice
}
```

This is distinct from the existing `stage` (operator's capture stage). One Opportunity has both — SAM.gov tells us where the *solicitation* is in its public lifecycle; `stage` tells us where the *operator's capture* is.

---

# PART TWO — SAM.gov API DEEP SURFACE

SAM.gov exposes a REST API at `api.sam.gov`. API key required (free registration at sam.gov/api/registration). Rate-limited at 1000 requests/hour and 10 requests/second.

## Endpoint surface

### Endpoint 2.1 — GET `/opportunities/v2/search`

Primary opportunity search endpoint.

**Query parameters (most relevant):**
- `api_key` — required
- `limit` — max 1000 per request (default 25)
- `offset` — pagination
- `postedFrom` / `postedTo` — date range (MM/DD/YYYY format)
- `responseDeadLineFrom` / `responseDeadLineTo` — response deadline range
- `noticeId` — specific notice
- `solnum` — solicitation number
- `noticeType` — comma-separated type codes (`p,r,s,k,o,u,a,m`)
- `naics` — comma-separated NAICS codes
- `classificationCode` — comma-separated PSC codes
- `typeOfSetAside` — set-aside type code
- `state` / `country` — place of performance filter
- `deptname` / `subtier` / `org` — agency filter
- `ptype` — alternative notice type filter
- `active` — `Yes` or `No` for active-only filter
- `archived` — include archived
- `award.amount.from` / `award.amount.to` — for award notices

**Response shape (abbreviated):**
```json
{
  "totalRecords": 1247,
  "limit": 100,
  "offset": 0,
  "opportunitiesData": [
    {
      "noticeId": "abc123def456...",
      "title": "F-35 Sustainment Support Services",
      "solicitationNumber": "FA8611-25-R-0042",
      "fullParentPathName": "DEPARTMENT OF DEFENSE.DEPT OF THE AIR FORCE.AFMC.AFLCMC...",
      "fullParentPathCode": "017.5700.057300.057360...",
      "postedDate": "2026-04-15",
      "type": "Solicitation",
      "baseType": "Solicitation",
      "archiveType": "auto15",
      "archiveDate": "2026-09-30",
      "typeOfSetAsideDescription": "Total Small Business Set-Aside (FAR 19.5)",
      "typeOfSetAside": "SBA",
      "responseDeadLine": "2026-06-10T17:00:00-04:00",
      "naicsCode": "541330",
      "naicsCodes": ["541330", "541512"],
      "classificationCode": "AC11",
      "active": "Yes",
      "award": null,
      "pointOfContact": [
        {
          "fax": null,
          "type": "primary",
          "email": "kosgt@us.af.mil",
          "phone": "555-123-4567",
          "title": "Contract Specialist",
          "fullName": "Jane Smith"
        }
      ],
      "description": "https://api.sam.gov/...description URL...",
      "organizationType": "OFFICE",
      "officeAddress": {
        "zipcode": "45433",
        "city": "WRIGHT PATTERSON AFB",
        "countryCode": "USA",
        "state": "OH"
      },
      "placeOfPerformance": {
        "streetAddress": null,
        "city": { "code": "26000", "name": "Fort Worth" },
        "state": { "code": "TX", "name": "TEXAS" },
        "zip": "76101",
        "country": { "code": "USA", "name": "UNITED STATES" }
      },
      "additionalInfoLink": null,
      "uiLink": "https://sam.gov/opp/abc123def456...",
      "links": [
        {"rel": "self", "href": "https://api.sam.gov/opportunities/v2/search?noticeid=abc123..."}
      ],
      "resourceLinks": [
        "https://api.sam.gov/opportunities/v1/resources/files/abc123..."
      ],
      "relatedNotices": [
        {"noticeId": "prior-presol-id", "type": "Presolicitation"}
      ]
    }
  ],
  "links": [...]
}
```

**Key observations:**
- `noticeId` is the SAM.gov canonical ID — primary key for Corsair's external ID linkage.
- `description` is a URL, not the description text. Separate fetch required.
- `resourceLinks` is an array of attachment URLs (each requires separate fetch to download the actual file).
- `relatedNotices` is the amendment-chain backbone — links to prior or amended notices.
- `fullParentPathName` and `fullParentPathCode` give the agency hierarchy as dotted paths.

### Endpoint 2.2 — GET `/opportunities/v1/noticedesc`

Fetches the full description text for an opportunity.

**Query parameters:**
- `api_key` — required
- `noticeid` — the `noticeId` from search results

**Response shape:**
```json
{
  "description": "Full HTML description text..."
}
```

The description is HTML, not plain text. Corsair stores raw HTML in the raw cache and a sanitized plain-text version in the Opportunity record.

### Endpoint 2.3 — GET `/opportunities/v1/resources/files/{resourceId}`

Fetches a specific attachment file by resource ID.

For Phase 8.5.3, Corsair stores attachment URLs only, not the files themselves (per OQ-3 confirmed: URLs only). The actual download happens when the operator clicks the attachment link.

### Endpoint 2.4 — GET `/entity-information/v3/entities`

Vendor (UEI/CAGE) registration lookup.

**Query parameters:**
- `api_key` — required
- `ueiSAM` — UEI search
- `cageCode` — CAGE code search
- `legalBusinessName` — name search (fuzzy)
- `samRegistered` — filter to currently-registered entities
- `includeSections` — comma list of sections to include in response (`entityRegistration`, `coreData`, `assertions`, `repsAndCerts`, `pointsOfContact`)

**Response shape (abbreviated):**
```json
{
  "totalRecords": 1,
  "entityData": [
    {
      "entityRegistration": {
        "samRegistered": "Yes",
        "ueiSAM": "ABC123DEF456",
        "cageCode": "1A2B3",
        "dodaac": null,
        "legalBusinessName": "LOCKHEED MARTIN CORPORATION",
        "dbaName": null,
        "purposeOfRegistrationCode": "Z2",
        "registrationStatus": "Active",
        "registrationDate": "2014-04-01",
        "lastUpdateDate": "2025-12-15",
        "registrationExpirationDate": "2026-12-15",
        "activationDate": "2024-12-16",
        "ueiStatus": "Active",
        "ueiCreationDate": "2022-04-01"
      },
      "coreData": {
        "entityInformation": {
          "entityURL": "https://www.lockheedmartin.com",
          "entityDivisionName": null,
          "entityStartDate": "1995-08-30",
          "fiscalYearEndCloseDate": "0101",
          "submissionDate": "2024-11-30"
        },
        "physicalAddress": {...},
        "mailingAddress": {...},
        "congressionalDistrict": "08",
        "businessTypes": [...],
        "naicsList": [
          {"naicsCode": "336411", "naicsDescription": "...", "sbaSmallBusiness": "N", "isPrimary": "Y"},
          ...
        ]
      }
    }
  ]
}
```

This endpoint is the source of truth for vendor registration. Useful for resolving recipient orgs cited in award notices and for the operator's adversary research.

### Endpoint 2.5 — GET `/entity-information/v4/exclusions`

Excluded parties lookup (SAM.gov exclusion list, formerly EPLS).

**Query parameters:**
- `api_key` — required
- `ueiSAM` / `cageCode` / `legalBusinessName` — search by identity

Used to flag if an Organization in the operator's workspace appears on the federal exclusion list (debarment, suspension, etc.). High-signal posture indicator if it occurs.

## Auth

API key via:
- Query parameter: `?api_key=<key>` (preferred in v2)
- OR header: `X-Api-Key: <key>` (some endpoints)

Registration: free at sam.gov/api/registration. One application-level key for Corsair deployment, not per-operator.

## Rate limits and politeness

- **Hard limit:** 1000 requests/hour per API key.
- **Burst limit:** 10 requests/second.
- **429 response:** Standard rate-limit response. `Retry-After` header may be present.
- **Backoff:** Exponential — 5s, 15s, 60s, 300s, then job-skip.
- **Concurrency:** Corsair limits to 3 concurrent requests per workspace job.

For a workspace tracking 500 active opportunities with hourly refresh, the request budget breaks down as:
- New posts hourly sweep: ~1 request (filtered search) + ~5 description fetches for new postings = 6 requests/hr
- Tracked-opportunity refresh: 500 records / 24 hours = ~21 requests/hr
- Daily full refresh: ~50 requests once daily

Total: ~30 requests/hour normal operation. Well within the 1000/hour limit. At ~30 workspaces this becomes ~900 requests/hour — close to limit and triggers OQ-4's per-tier sharding plan.

## Pagination

`limit` max 1000, but pagination beyond ~10,000 results becomes inefficient. For high-volume workspaces, narrow filters via NAICS or agency rather than relying on pagination.

For the hourly sweep, Corsair uses `postedFrom` set to (now - 2 hours) and `postedTo` set to now, with watchlist NAICS and agency filters. This typically returns under 100 results, easily handled in 1-2 pages.

---

# PART THREE — OPPORTUNITY ENTITY EXTENSIONS

The existing Corsair Opportunity (per the current FLiIntel.html schema):

```
Opportunity {
  id:               string
  name:             string         // title
  agency:           string         // free text (e.g., "Department of the Air Force")
  vehicle:          string         // contract vehicle if known
  value:            string         // free text (e.g., "$50M", "TBD", "ID/IQ")
  stage:            string         // OPP_STAGES key
  stageEnteredAt:   timestamp
  exitCriteriaChecks: { [stage]: { [gateKey]: boolean } }
  notes:            string
  solicitationNumber: string?
  meetings:         [string]       // meeting IDs
  posture: {
    adversaries:    [string]       // org IDs
  }
  updatedAt:        string
  // ... other operator-input fields
}
```

Phase 8.5.3 adds the following attributes, all additive:

```
Opportunity {
  // ... existing fields preserved unchanged

  // SAM.gov linkage
  samgovNoticeId:           string?
  samgovUiLink:             string?   // sam.gov/opp/<noticeId>
  samgovNoticeType:         string?   // 'p' | 'r' | 's' | 'k' | 'o' | 'u' | 'a' | 'm'
  samgovBaseType:           string?   // human-readable: 'Presolicitation', 'Solicitation', etc.
  samgovPostedDate:         timestamp?
  samgovArchiveDate:        timestamp?
  samgovResponseDeadline:   timestamp?
  samgovLifecycle:          enum?     // see Part One

  // Normalized fields parallel to free-text equivalents
  customerOrgId:            string?   // FK → Organization (resolved from fullParentPathName)
  agencyHierarchy:          [string]  // e.g., ['DoD', 'Air Force', 'AFMC', 'AFLCMC']
  agencyHierarchyCodes:     [string]  // dotted path codes
  naicsCodes:               [string]
  pscCodes:                 [string]
  setAsideCode:             string?
  setAsideDescription:      string?
  placeOfPerf: {
    country:                string
    state:                  string?
    city:                   string?
    zip:                    string?
  }
  estimatedValueNumeric:    number?   // if extractable from description or award notice
  estimatedValueCurrency:   'USD'

  // Description
  descriptionText:          string    // sanitized plain text
  descriptionHtml:          string?   // raw HTML in raw cache; first 50KB cached on record

  // Points of contact (DOCTRINE NOTE: government POCs only, never operator's contact list)
  samgovPocs: [
    {
      type:      string         // 'primary' | 'secondary'
      title:     string
      fullName:  string
      email:     string
      phone:     string?
    }
  ]

  // Attachments (URLs only)
  attachments: [
    {
      resourceUrl:  string
      filename:     string?
      size:         number?
      mimetype:     string?
      observedAt:   timestamp
    }
  ]

  // Amendment chain
  relatedNotices: [
    {
      noticeId:  string
      type:      string
      direction: 'parent' | 'amended_by' | 'amends' | 'sibling'
    }
  ]
  amendmentNumber:    number?    // 0 = original, 1 = first amendment, etc.
  isLatestVersion:    boolean    // true on the most recent amendment; false on superseded

  // Source provenance (from migration E-4)
  source: SourceProvenance

  // Reconciliation with operator-created Opportunities
  reconciliation: {
    operatorCreatedAt:   timestamp?  // if this Opp was operator-created BEFORE SAM.gov match
    samgovMatchedAt:     timestamp?  // when SAM.gov data was associated
    matchConfidence:     number?     // 0.0-1.0
    matchMethod:         string?     // 'piid' | 'solnum' | 'manual' | 'fuzzy'
    operatorOverrides:   [string]    // field names operator has manually set; sync skips these
  }
}
```

## Field provenance discipline

The new fields are populated by SAM.gov. The existing fields (`name`, `agency`, `value`, `notes`, `vehicle`, `solicitationNumber`) are operator-input or SAM.gov-derived depending on origin:

- **Operator-created Opportunity:** All existing fields are operator-set. SAM.gov-specific fields are null until match.
- **SAM.gov-sourced Opportunity:** Existing fields are populated from SAM.gov data on first sync. After that, if the operator edits a field, the field name goes into `reconciliation.operatorOverrides[]` and subsequent syncs do not overwrite it.

The free-text `agency` field shows the human-readable agency name (from `fullParentPathName`); the canonical Organization reference lives in `customerOrgId`. Both coexist for back-compat with existing rendering code.

The free-text `value` is operator-set ("$50M", "TBD", "5-year ID/IQ"). The numeric `estimatedValueNumeric` is set by Corsair when SAM.gov provides a parseable value (mostly from award notices). When both exist, the Inspector surface shows operator's text and surfaces the numeric as a tooltip.

## Posture Layer compatibility

The existing `posture.adversaries[]` on Opportunity continues to work unchanged. When a SAM.gov-sourced Opportunity matches against an existing Award where the incumbent is known, the incumbent Organization ID is *proposed* as an adversary (operator confirms before adding). This is the same pattern as 8.5.4's Proposed Pursuits.

---

# PART FOUR — NOTICE TYPE HANDLING

Each notice type is treated slightly differently in terms of mapping, default stage, and follow-up behavior.

## Type R — Sources Sought

**Indicator of:** Customer doing market research. No commitment to buy.

**Default stage:** `awareness`

**Special handling:**
- Sources Sought often have shorter response deadlines (14-30 days).
- Operator typically responds with a capability statement (RFI response).
- Corsair flags Sources Sought in the Brief with high priority — these are pre-RFP intelligence opportunities.
- If a Sources Sought is followed within 6 months by a Presolicitation or Solicitation with similar text, Corsair proposes linking them (`relatedNotices` typically does this automatically but informal sources sought often don't link explicitly).

**Operator behavior:**
- Often the operator wants to *write a response* against this notice. Corsair stores the response draft as an attachment to the Opportunity (operator-input only).

## Type P — Presolicitation

**Indicator of:** RFP coming. Customer signaling timing and scope. Often includes draft SOW/PWS.

**Default stage:** `tracking` (assumes the operator is past awareness if they've found this in their watchlist)

**Special handling:**
- Draft SOW/PWS attachments are high-value. Operator should review.
- Presol typically links forward to the eventual Solicitation via `relatedNotices`. When the linked Solicitation appears, Corsair updates the Opportunity to the new noticeId and increments `amendmentNumber`.

## Type O — Solicitation

**Indicator of:** Full RFP released. Race is on.

**Default stage:** `rfp`

**Special handling:**
- Response deadline is critical. Surface prominently. Calendar integration (future phase) creates calendar event.
- Attachment set is typically large (10-50 files). All URLs cached; operator clicks to download.
- Q&A Amendments (`m` type referencing this) are tracked separately and rolled up into a Q&A log view.

## Type K — Combined Synopsis/Solicitation

**Indicator of:** Simplified-acquisition RFP. Usually under $250k. Faster cycle.

**Default stage:** `rfp`

**Special handling:**
- Shorter response deadlines (often 5-15 days).
- Often single-attachment (the synopsis itself).
- Operator may want to mark "no-bid" quickly. Pipeline UI supports rapid no-bid with one click on `k` notices.

## Type S — Special Notice

**Indicator of:** Catch-all. Industry days, capability briefings, advisory committee meetings, contract vehicle announcements.

**Default stage:** `awareness` (since the relevance to a specific pursuit is unclear)

**Special handling:**
- Operator review required to determine whether this notice maps to an existing pursuit or is informational.
- Corsair surfaces these in a "Special Notices in your watchlist" Brief section rather than auto-creating Opportunities.

## Type U — Justification

**Indicator of:** Sole-source justification. The customer is announcing intent to award without competition.

**Default stage:** `tracking` (informational, not a pursuit the operator can engage on absent protest)

**Special handling:**
- The named sole-source recipient becomes a posture-layer datapoint.
- Operator may choose to protest. Corsair tracks the justification as a Signal and links to any subsequent GAO protest filing (when 8.5.5 is integrated).
- High-value intelligence even when not actionable as a pursuit — reveals customer/incumbent dynamics.

## Type A — Award Notice

**Indicator of:** Award has been made. Typically smaller-dollar awards (under DoD News's $7.5M threshold).

**Default stage:** `award` or `won` / `lost` depending on whether the awardee matches operator's workspace

**Special handling:**
- The award amount, if present in the notice, populates `estimatedValueNumeric`.
- The awardee Organization is resolved. If the awardee is the operator's own organization → stage = `won`. If a tracked competitor → stage = `lost`.
- For Awards-under-$7.5M segment, SAM.gov is the primary feed (DoD News doesn't cover these).
- Reconciles against USAspending (8.5.4) when the same PIID surfaces there.

## Type M — Modification/Amendment

**Indicator of:** Amendment to a prior notice. Most common: deadline extensions, Q&A responses, SOW clarifications.

**Default stage:** No stage change — updates the parent Opportunity in place.

**Special handling:**
- `relatedNotices` identifies the parent.
- The parent Opportunity is updated: `samgovNoticeId` may shift to the latest amendment, `amendmentNumber` increments, `relatedNotices[]` accumulates.
- Q&A amendments are extracted into a separate `qAndA[]` array on the Opportunity (see Part Six).
- Deadline extensions update `samgovResponseDeadline` and emit a Signal (`type: 'opportunity_deadline_extended'`) for the Brief.

## Type I — Intent to Bundle

**Indicator of:** Customer intends to bundle multiple smaller requirements into a larger one. Small-business-impact notice.

**Default stage:** `awareness`

**Special handling:**
- Useful for small-business operators tracking when customer behavior is consolidating.
- Surfaced in Brief with a "Bundling alert" badge.

---

# PART FIVE — AMENDMENT AND VERSIONING LOGIC

The relationship between a "notice" (SAM.gov atomic unit) and an "Opportunity" (Corsair pursuit-level abstraction) is many-to-one over time.

A typical pursuit lifecycle on SAM.gov:
```
[Sources Sought R-001]
        │
        │ 4 months later
        ▼
[Presolicitation P-001] ────── linked via relatedNotices
        │
        │ 2 months later
        ▼
[Solicitation O-001] ────────── linked via relatedNotices
        │
        │ Q&A round 1
        ▼
[Amendment M-001 amending O-001]
        │
        │ Q&A round 2 + deadline extension
        ▼
[Amendment M-002 amending O-001]
        │
        │ Award decision
        ▼
[Award Notice A-001 referencing O-001]
```

Corsair canonicalizes this into a single Opportunity entity that evolves over time, with each notice creating events on the entity.

## Canonicalization rule

The canonical Opportunity is associated with the **active solicitation notice** if one exists, otherwise the most recent presolicitation or sources sought.

When a new notice arrives:
1. Check `relatedNotices` for any reference to an existing Corsair Opportunity (via its `samgovNoticeId`).
2. If matched: update the existing Opportunity (don't create new).
3. If not matched but solicitation number matches: update existing.
4. If not matched but text-similarity to existing watchlist Opportunities is high: queue for operator review.
5. If no match: create new Opportunity.

## Amendment versioning

For each amendment to an existing Opportunity:
- `Opportunity.relatedNotices[]` appends the new notice with `direction: 'amends'`.
- The Opportunity's `samgovNoticeId` updates to the new notice ID (the canonical pointer follows the latest amendment).
- `Opportunity.amendmentNumber` increments.
- A Signal (`type: 'opportunity_amendment'`) is created with subjectIds = [opportunityId] and attrs describing what changed.
- The Brief surface includes new amendments in the "External Intelligence" section.

## What gets compared between amendments

When an amendment arrives, Corsair computes a delta against the prior version:
- Description: text diff (stored as `Signal.attrs.descriptionDiff`)
- Response deadline: before/after timestamps
- Attachments: added/removed files
- POCs: changes to contact list
- SOW/PWS attachments specifically: stored as separate versioned blobs in raw cache

The delta becomes the Signal's `attrs.changes[]` array, surfaced to operator.

## Tracking deadline extensions specifically

Deadline extensions are the most operationally important amendment type. The operator's bid/no-bid timing depends on it.

When an amendment changes `responseDeadLine`:
1. Old deadline preserved in `Opportunity.deadlineHistory[]` array.
2. New deadline becomes `Opportunity.samgovResponseDeadline`.
3. Signal emitted with `type: 'opportunity_deadline_extended'` (or `_advanced` if shortened).
4. If the operator had a calendar event tied to the old deadline, the event is updated (future-phase integration; for 8.5.3, Signal-only).
5. Surfaces in Brief with prominent badge: "Deadline changed: X → Y".

## Q&A log handling

Amendments often consist of Q&A responses to bidder questions. Corsair extracts these into a structured Q&A log:

```
Opportunity.qAndA = [
  {
    questionNumber: 1,
    question: "...",
    answer: "...",
    issuedAt: <amendment date>,
    sourceAmendmentId: <noticeId of the amendment>
  },
  ...
]
```

The Q&A log is the highest-value capture intelligence content in many RFPs — the customer's clarifications reveal evaluation priorities, contract-vehicle preferences, and incumbent advantages.

Extraction: regex + heuristics on amendment description text. Q&A typically follows patterns like:
- `Q1: <text>` / `A1: <text>`
- `Question 1: <text>` / `Answer 1: <text>`
- Numbered list with embedded responses

When extraction confidence is low (no clear pattern), the full amendment text is preserved and the operator manually reads. No silent failures.

---

# PART SIX — ATTACHMENT HANDLING

SAM.gov RFP packages can be 20-50 separate files. Common attachment types in defense BD:

| Attachment | What it is | Capture-intelligence value |
|---|---|---|
| Section L | Instructions to offerors | Critical — defines what to submit |
| Section M | Evaluation factors | Critical — defines what wins |
| SOW / PWS / SOO | Scope description | Critical — defines what to do |
| CDRLs (Contract Data Requirements) | Deliverables list | Major |
| Section J Attachments | Various attachments | Variable |
| J&A | Justification & Authorization | Useful for sole-source notices |
| Past Performance template | Format for past-perf citations | Useful |
| Q&A log / Bidder Questions document | Cumulative questions and answers | High |
| Pre-proposal Conference notes | Industry day materials | High |
| Draft RFP | Pre-final solicitation | High when present |
| FFRDC reports | Referenced supporting docs | Variable |

## URL-only policy (per OQ-3 confirmed)

For Phase 8.5.3, Corsair stores attachment URLs only. Reasons:
- Storage cost: a single RFP package can be 50-200MB. At 500 active Opportunities per workspace, mirroring would be 25-100GB per workspace.
- Durability concern: SAM.gov occasionally re-hosts files at new URLs after amendments. Corsair URL cache could go stale.
- Doctrine: operator-input data is sacred; SAM.gov-provided files are not.

The Inspector surface displays each attachment with a clickable link and the file's name, size, and observed-at timestamp. Operator click triggers fetch from SAM.gov.

## Attachment categorization

Each attachment is auto-categorized when possible. Detection rules:
- Filename contains "section_L", "secl", "instructions_to_offerors" → category: `section_l`
- Filename contains "section_M", "secm", "evaluation" → category: `section_m`
- Filename contains "sow", "pws", "soo" → category: `scope`
- Filename contains "cdrl" → category: `cdrls`
- Filename contains "j&a", "ja", "justification" → category: `justification`
- Filename contains "q&a", "qanda", "questions" → category: `qa_log`
- Otherwise: `other`

Category is shown in the Inspector surface for fast scanning. Operator can override category.

## Q&A log files specifically

When a Q&A log file is detected and operator clicks to view, Corsair offers to extract structured Q&A entries from the file via a future-phase parser (not in 8.5.3 scope; 8.5.3 just identifies and surfaces the file).

## Attachment freshness

When an amendment arrives that adds or modifies attachments:
- New attachments are added to `Opportunity.attachments[]` with `observedAt: now`.
- Removed attachments are kept in `attachments[]` but flagged `removedAt: <amendment date>`. Operator can see them in a "Removed in amendment" view.
- Modified attachments (same filename, different size/checksum) are tracked as new entries with `versionedFrom: <prior attachment URL>`.

---

# PART SEVEN — OPERATOR-CREATED vs. EXTERNAL OPPORTUNITY RECONCILIATION

The reconciliation challenge: operators create Opportunities manually for pursuits they're tracking before SAM.gov posts. When SAM.gov eventually posts the corresponding notice, Corsair must merge intelligently.

## Match scenarios

**Scenario A: Operator has solicitation number**
- Operator created Opportunity with `solicitationNumber: "FA8611-25-R-0042"`.
- SAM.gov publishes notice with `solicitationNumber: "FA8611-25-R-0042"`.
- **Match:** exact solicitation number. Confidence 1.0.
- **Action:** Update existing Opportunity with SAM.gov data, populate `customerOrgId`, `naicsCodes`, etc.

**Scenario B: Operator has solicitation number, slight format variation**
- Operator created Opportunity with `solicitationNumber: "FA8611 25 R 0042"` (spaces instead of dashes).
- SAM.gov uses `FA8611-25-R-0042`.
- **Match:** normalized solicitation match. Confidence 0.95.
- **Action:** Update existing Opportunity. Surface the format difference in a one-time notification for operator review.

**Scenario C: Operator has no solicitation number, but name and customer match**
- Operator created Opportunity with `name: "F-35 Sustainment Support"` and `agency: "Air Force"`.
- SAM.gov publishes notice with title "F-35 Sustainment Support Services" at Air Force.
- **Match:** title fuzzy-match + agency match. Confidence 0.80.
- **Action:** Queue for operator review. Operator confirms or rejects.

**Scenario D: Multiple operator-created candidates, one SAM.gov notice**
- Operator has two Opportunities: "F-35 Sustainment Phase 1" and "F-35 Sustainment Phase 2".
- SAM.gov publishes "F-35 Sustainment Support Services" matching both at low confidence.
- **Match:** ambiguous. Confidence < 0.7.
- **Action:** Queue for operator review with both candidates. Operator selects one or rejects both (creating new Opportunity from SAM.gov).

**Scenario E: SAM.gov publishes a notice operator never tracked**
- No operator-created Opportunity matches.
- **Action:** Create new Opportunity from SAM.gov data with `stage: 'awareness'` (or `tracking` if Presol/Solicitation already, see Part One mapping).

## Match algorithm

For each new SAM.gov notice:
1. Exact solicitation number match against operator's Opportunities → confidence 1.0.
2. Normalized solicitation number match → confidence 0.95.
3. SAM.gov `noticeId` match against any prior associated Opportunity → confidence 1.0.
4. Fuzzy title + customer agency match → confidence 0.4-0.85 based on string similarity.
5. NAICS + customer + dollar-range proximity → low-confidence supporting signal.

**Auto-merge threshold:** confidence ≥ 0.95.
**Operator-review threshold:** confidence 0.70 to 0.95.
**No-match:** confidence < 0.70 → create new Opportunity.

## Merge logic

When matched (auto or operator-confirmed):

```
function merge(operatorOpp, samgovData) {
  const opp = { ...operatorOpp };

  // SAM.gov-specific fields populated unconditionally
  opp.samgovNoticeId = samgovData.noticeId;
  opp.samgovUiLink = samgovData.uiLink;
  opp.samgovNoticeType = samgovData.type;
  opp.samgovBaseType = samgovData.baseType;
  opp.samgovPostedDate = samgovData.postedDate;
  opp.samgovResponseDeadline = samgovData.responseDeadLine;
  opp.samgovLifecycle = deriveSamgovLifecycle(samgovData);

  // Normalized fields populated if not operator-overridden
  if (!opp.reconciliation?.operatorOverrides?.includes('customerOrgId')) {
    opp.customerOrgId = resolveCustomerOrg(samgovData);
  }
  if (!opp.reconciliation?.operatorOverrides?.includes('agencyHierarchy')) {
    opp.agencyHierarchy = parseHierarchy(samgovData.fullParentPathName);
  }
  if (!opp.reconciliation?.operatorOverrides?.includes('naicsCodes')) {
    opp.naicsCodes = samgovData.naicsCodes;
  }
  // ... similarly for psc, setAside, placeOfPerf

  // Free-text fields preserved if operator has set them
  if (!opp.name || opp.name === '') opp.name = samgovData.title;
  // operator-set `name` is not overwritten

  if (!opp.agency || opp.agency === '') opp.agency = samgovData.fullParentPathName.split('.')[0];
  // operator-set `agency` is not overwritten

  if (!opp.solicitationNumber) opp.solicitationNumber = samgovData.solicitationNumber;

  // Description: SAM.gov text appended to operator's notes if operator has notes,
  // OR set as descriptionText if Operator has no notes yet
  if (!opp.descriptionText) {
    opp.descriptionText = sanitizeHtml(samgovData.description);
  }
  // operator's `notes` (free-form context) is never overwritten

  // Attachments: SAM.gov attachments merged into operator's attachment list,
  // SAM.gov-sourced ones marked as such, deduplicated by URL
  opp.attachments = mergeAttachments(opp.attachments || [], samgovData.attachments);

  // Reconciliation marker
  opp.reconciliation = {
    operatorCreatedAt: opp.created || opp.createdAt,
    samgovMatchedAt: now(),
    matchConfidence: <confidence>,
    matchMethod: <method>,
    operatorOverrides: opp.reconciliation?.operatorOverrides || []
  };

  // Source provenance reflects dual origin
  opp.source = {
    system: 'samgov',
    externalId: samgovData.noticeId,
    url: samgovData.uiLink,
    fetchedAt: now(),
    refreshedAt: now(),
    hash: hash(samgovData)
  };

  return opp;
}
```

## Operator override tracking

When the operator manually edits a field on a SAM.gov-sourced Opportunity (or a previously merged Opportunity), the field name is added to `reconciliation.operatorOverrides[]`. Subsequent syncs check this list and skip overriding those fields.

UI behavior: when the operator clicks "Edit" on a field that was last sourced from SAM.gov, a small badge appears: "This field is SAM.gov-sourced. Editing will mark it operator-overridden and future SAM.gov updates won't change it."

This is Doctrine §IV alignment: operator's authority over her own judgment is sacred. Once she's made a deliberate choice, the platform respects it.

---

# PART EIGHT — OPPORTUNITY → ORGANIZATION RESOLUTION

SAM.gov data references organizations in several ways:
- **Customer agency** via `fullParentPathName` (dotted-path string) and `fullParentPathCode` (dotted-path numeric codes).
- **Vendor** in award notices via UEI/CAGE.
- **Sole-source recipient** in justification notices via name + UEI.

## Customer agency resolution

`fullParentPathName` example: `"DEPARTMENT OF DEFENSE.DEPT OF THE AIR FORCE.AFMC.AFLCMC.HQ AFLCMC"`

This represents a hierarchy. Each level should be an Organization with `type: 'government'`:
- Level 0: DEPARTMENT OF DEFENSE (cabinet department)
- Level 1: DEPT OF THE AIR FORCE (service branch)
- Level 2: AFMC (Air Force Materiel Command)
- Level 3: AFLCMC (Air Force Life Cycle Management Center)
- Level 4: HQ AFLCMC (specific office)

Each level is an Organization. Edges of type `subtier_of` link Level N → Level N-1.

Resolution algorithm:
1. Split `fullParentPathName` by `.` to get levels.
2. For each level, check if an Organization with that name exists.
3. If exists, use it. If not, create with `type: 'government'`, `source.system: 'samgov'`.
4. Create `subtier_of` Edges between consecutive levels (if not already present).
5. The Opportunity's `customerOrgId` is set to the deepest level resolved (the actual contracting office).

## Pre-seeded government hierarchy

To avoid creating duplicate top-level Organizations across workspaces, Corsair pre-seeds the major DoD hierarchy at workspace initialization (in Phase 8.5.1 Step 4):
- Department of Defense (and its subdivisions: OSD, Joint Staff, etc.)
- Department of the Army (with major commands)
- Department of the Navy (with USN and USMC)
- Department of the Air Force (with USAF and Space Force)
- Major defense agencies (DLA, DISA, DTRA, MDA, DARPA, DCMA, DCAA, etc.)

Each pre-seeded Organization has a canonical name and code. SAM.gov resolution maps to these canonical entries.

## Vendor resolution (for award notices)

Award notices include vendor identification:
- `award.awardee` (object with name, UEI, address)

Resolution:
1. UEI exact match against existing Organizations (`Organization.uei`).
2. Name normalized match (same algorithm as Part Six of the Award integration doc).
3. Fuzzy match → operator review.
4. No match → auto-create.

This mirrors the Award integration doc's logic; reusable code.

## Set-aside as Organization-attribute

SAM.gov set-aside types are not Organizations but rather categorizations affecting who can bid. Examples:
- SBA — Total Small Business Set-Aside
- WOSB — Women-Owned Small Business
- VOSB — Veteran-Owned Small Business
- SDVOSB — Service-Disabled Veteran-Owned Small Business
- HUBZONE — HUBZone Set-Aside
- 8A — 8(a) Set-Aside
- None — Full and Open

The Opportunity stores `setAsideCode` and `setAsideDescription`. The watchlist config can filter by set-aside type (e.g., "show only 8(a) opportunities").

## Place-of-performance handling

The `placeOfPerformance` shape from SAM.gov:
```
{
  "city": { "code": "26000", "name": "Fort Worth" },
  "state": { "code": "TX", "name": "TEXAS" },
  "zip": "76101",
  "country": { "code": "USA", "name": "UNITED STATES" }
}
```

Normalized to Corsair shape:
```
placeOfPerf: {
  country: "USA",
  state: "TX",
  city: "Fort Worth",
  zip: "76101"
}
```

Place of performance enables congressional-district filtering (future phase) and geographic competitive analysis. Phase 8.5.3 just stores; downstream phases query.

---

# PART NINE — WATCHLIST CONFIGURATION

Each workspace has a per-workspace SAM.gov watchlist that determines which notices ingest. Config lives at:

```
workspaces/{wsId}/sources/sam_gov/config
```

## Config schema

```
{
  initializedAt: timestamp,
  naics: [string],              // primary NAICS codes
  naicsIncludeAdjacent: boolean, // include codes in same 4-digit group
  agencies: [
    {
      level: 'toptier' | 'subtier' | 'office',
      code: string,
      name: string
    }
  ],
  agenciesExclude: [...],        // hard excludes from broader matches
  setAsides: [string],           // filter by set-aside; empty = all
  noticeTypes: [string],          // ['p','r','s','k','o','u','a','m'] typically
  pscCodes: [string],             // optional PSC filter
  states: [string],               // optional place-of-performance filter
  keywords: [string],             // optional title keyword filter
  excludeKeywords: [string],
  dollarThresholdFloor: number?, // ignore notices below this estimated value
  responseDeadlineMaxDays: number?, // ignore notices with deadline past this many days out
  savedSearches: [
    {
      id: string,
      name: string,
      filters: { ... subset of above },
      enabled: boolean
    }
  ]
}
```

## Saved searches as named watchlists

The operator can define multiple saved searches within a single workspace. Each saved search is treated as an independent filter applied during sync. A notice matching ANY saved search ingests.

Example saved searches:
- "Air Force AI/ML pursuits" → NAICS 541512 + agency=USAF + keywords=["AI","machine learning","artificial intelligence"]
- "SBIR Phase III recompetes" → setAsides=["SBIR"] + noticeTypes=["a"]
- "Sources Sought - my capability" → noticeTypes=["r"] + NAICS in [primary list]

Each saved search has its own enabled toggle. Disabled searches don't ingest but config is preserved.

## Default seed config

At workspace initialization (Phase 8.5.1 Step 4), config is empty (per OQ-7 confirmed: no auto-seed). Operator populates via Settings UI.

Suggested seed values surfaced in the UI as templates:
- "DoD R&D services" → NAICS 541330, 541512, 541713, 541715
- "C4ISR" → NAICS 541512 + PSC AD80, AD81, AD82
- "Logistics" → NAICS 488510, 493110, 541614
- "Construction" → NAICS 236220, 237310 + PSC Y1AA

Operator clicks template → fields populate → operator edits and saves.

## Watchlist change propagation

When the operator changes the watchlist:
1. New filter is saved immediately.
2. Subsequent hourly sync uses the new filter.
3. Operator can trigger an immediate "Run sync now with new filter" to backfill the change.
4. Existing Opportunities outside new filter scope are not removed (operator may still want to track them); they're flagged `outOfWatchlist: true` for display filtering.

## Watchlist sharing (deferred)

Per OQ-2 (confirmed), watchlists are per-workspace, not shared. A future enhancement may add a "watchlist template library" pattern but Phase 8.5.3 does not implement.

---

# PART TEN — REFRESH AND UPDATE LOGIC

Once SAM.gov sync is established, ongoing updates keep Opportunities current.

## Sync cadences

| Sync type | Cadence | Scope |
|---|---|---|
| Hourly delta sync | Every hour | Posts since last sync, filtered by watchlist |
| Daily tracked-Opportunity refresh | Daily at 2 AM ET | All Opportunities with active SAM.gov linkage |
| Amendment detection | Hourly (as part of delta sync) | New `m`-type notices referencing tracked Opps |
| On-demand fetch | Operator action | Single Opportunity refresh |

## Hourly delta sync

Each hour:
1. Compute window: `postedFrom = (lastSyncAt - 30min)`, `postedTo = now`. Overlap is a safety margin against clock skew.
2. For each saved search in workspace config:
   - Query SAM.gov with search's filters + the time window.
   - Page through results.
   - For each notice, run reconciliation (Part Seven) and either merge into existing or create new.
3. Update `workspaces/{wsId}/sources/sam_gov/lastSync = now`.

## Daily tracked-Opportunity refresh

Tracked Opportunities are those with `samgovNoticeId != null` and `samgovLifecycle ∈ {'tracked', 'response_window_closed'}` (i.e., still active in SAM.gov).

For each tracked Opportunity:
1. Fetch its current state from `/opportunities/v2/search?noticeid=<noticeId>`.
2. Compare to stored hash.
3. If changed, apply updates per reconciliation rules.
4. If notice is now archived (`active: 'No'` or past `archiveDate`), transition `samgovLifecycle` to `response_window_closed` or `archived`.
5. If notice is gone (404), flag for operator review (rare; usually means notice was withdrawn).

## Amendment detection

During hourly sync, any `m`-type notice is checked for `relatedNotices` references to existing Corsair Opportunities. When found:
1. Update parent Opportunity per Part Five logic.
2. Append to `Opportunity.relatedNotices[]`.
3. Compute delta and emit Signal.

## On-demand fetch

When operator opens an Opportunity in Inspector or the Pipeline detail view:
1. Check `Opportunity.source.refreshedAt`.
2. If older than 1 hour, fetch latest from SAM.gov and refresh.
3. If freshly synced, display cached.

This gives the operator confidence that what she sees is current within an hour.

## Status transition handling

SAM.gov notice states map to `Opportunity.samgovLifecycle`:
- `active: 'Yes'` + `responseDeadLine` in future → `tracked`
- `active: 'Yes'` + `responseDeadLine` passed → `response_window_closed`
- `active: 'No'` → `archived` (with `responseDeadLine` consulted to determine if also `response_window_closed`)
- Cancellation notice (`type: 'm'` with cancellation keyword) → `cancelled`

State transitions emit Signals for the Brief.

## Award notice reconciliation with Award entities (cross-source)

When a SAM.gov award notice (`type: 'a'`) is ingested:
1. Check if a matching Award entity exists in `workspaces/{wsId}/awards/` (by PIID).
2. If yes: the Opportunity links to the Award via `Opportunity.linkedAwardId`. Opportunity stage transitions to `won` (if operator's org) or `lost` (if competitor).
3. If no: emit Signal indicating a SAM.gov award notice exists without USAspending confirmation yet. Future USAspending sync will populate Award entity.

This is the cross-source linkage between 8.5.3 (Opportunities) and 8.5.4 (Awards).

---

# PART ELEVEN — PHASE 8.5.3 SUB-PHASE SEQUENCING

Seven sub-sub-phases.

## Sub-phase 8.5.3.1 — Opportunity schema extensions (2-3 days)

**Scope:**
- Add new fields to existing Opportunity schema (Part Three).
- Migration handling for existing operator-created Opportunities (default `source.system: 'operator_manual'`, empty `reconciliation.operatorOverrides[]`).
- Client-side rendering of new fields in Inspector surface.

**Deliverables:**
- Schema migration script as part of (or follow-on to) Phase 8.5.1.
- Inspector shows new SAM.gov-specific fields when present.
- Operator-edit flow respects `operatorOverrides` tracking.

**Operator-impact moment:** No visible change yet; foundation only.

**Dependencies:** Phase 8.5.1 complete.

---

## Sub-phase 8.5.3.2 — SAM.gov Cloud Function (5-7 days)

**Scope:**
- `functions/src/sources/samGov.js` with API client, rate-limiting, retry.
- `functions/src/jobs/samGovHourly.js` as scheduled trigger.
- Reading watchlist config per workspace.
- Query construction per saved search.
- Initial ingestion logic (no reconciliation yet — naive create).

**Deliverables:**
- Working hourly fetch producing new Opportunities in test workspace.
- Source Health view reflecting SAM.gov sync status.

**Operator-impact moment:** "Operator sees new SAM.gov notices appearing as Opportunities in the Pipeline within an hour of posting, filtered by her saved searches."

**Dependencies:** 8.5.3.1, 8.5.2 (Cloud Functions scaffolding).

---

## Sub-phase 8.5.3.3 — Customer Organization resolution (3-4 days)

**Scope:**
- `fullParentPathName` parsing.
- Government hierarchy auto-creation.
- Pre-seed of major DoD hierarchy at workspace init.
- Vendor (UEI/CAGE) resolution for award notices.

**Deliverables:**
- New Opportunities have populated `customerOrgId` and `agencyHierarchy`.
- Government Organization graph populated incrementally.

**Operator-impact moment:** "Operator can navigate from an Opportunity to its customer Organization with one click; sees the agency hierarchy."

**Dependencies:** 8.5.3.2.

---

## Sub-phase 8.5.3.4 — Operator-created reconciliation logic (4-6 days)

**Scope:**
- Match algorithm (Part Seven).
- Auto-merge for high-confidence matches.
- Reconciliation queue for low-confidence matches.
- Operator override tracking (`reconciliation.operatorOverrides[]`).
- Operator review UI in Brief.

**Deliverables:**
- Operator-created Opportunities matched to SAM.gov notices when high-confidence.
- Operator can review and confirm/reject ambiguous matches.
- Operator edits to merged Opportunities are not overwritten on subsequent syncs.

**Operator-impact moment:** "Operator's existing Opportunities augment with SAM.gov data automatically when matches are confident; ambiguous matches surface for one-click review."

**Dependencies:** 8.5.3.2, 8.5.3.3.

---

## Sub-phase 8.5.3.5 — Amendment versioning and Q&A log (4-6 days)

**Scope:**
- `m`-type notice handling.
- `relatedNotices[]` chain tracking.
- Amendment delta computation.
- Deadline-extension Signal emission.
- Q&A log extraction from amendment text.

**Deliverables:**
- Amendments update parent Opportunities without creating duplicates.
- Deadline changes surface in Brief.
- Q&A entries extracted into structured log on Opportunity.

**Operator-impact moment:** "Operator sees deadline changes immediately; reads Q&A in structured format rather than re-reading each amendment."

**Dependencies:** 8.5.3.2.

---

## Sub-phase 8.5.3.6 — Attachment URL handling (2-3 days)

**Scope:**
- `resourceLinks[]` parsing.
- Attachment categorization (Section L, Section M, SOW, CDRLs, etc.).
- Inspector surface attachment list with categories.
- Operator override of category.

**Deliverables:**
- Opportunity Inspector shows categorized attachment list.
- Click-through to SAM.gov for each attachment.

**Operator-impact moment:** "Operator scans attachment list by category, identifies Section L/M quickly, opens what's needed."

**Dependencies:** 8.5.3.2.

---

## Sub-phase 8.5.3.7 — Brief surface integration (3-4 days)

**Scope:**
- Daily Brief section "External Intelligence — Opportunities (last 24h)":
  - New SAM.gov notices matching watchlist
  - Amendments to tracked Opportunities (deadline changes prominent)
  - Award notices for tracked Opportunities
  - Sources Sought as separate sub-section (pre-RFP intelligence)
- Reconciliation queue indicator
- Saved search performance summary

**Deliverables:**
- Brief populated with SAM.gov-derived intelligence.
- Click-through from Brief items to Opportunity detail.

**Operator-impact moment:** "Operator opens Corsair in the morning and sees yesterday's SAM.gov activity organized by relevance to her watchlist."

**Dependencies:** 8.5.3.4, 8.5.3.5.

---

## Sequencing summary

| Sub-phase | Description | Days | Cumulative |
|---|---|---|---|
| 8.5.3.1 | Schema extensions | 2-3 | 2-3 |
| 8.5.3.2 | SAM.gov Cloud Function | 5-7 | 7-10 |
| 8.5.3.3 | Customer Org resolution | 3-4 | 10-14 |
| 8.5.3.4 | Operator-created reconciliation | 4-6 | 14-20 |
| 8.5.3.5 | Amendment versioning + Q&A | 4-6 | 18-26 |
| 8.5.3.6 | Attachment URLs | 2-3 | 20-29 |
| 8.5.3.7 | Brief integration | 3-4 | 23-33 |

**Total Phase 8.5.3 estimate: 23-33 operator-days (~5-7 operator-weeks).** Similar scope to 8.5.4 despite Opportunity being an existing entity — the reconciliation work and amendment handling are non-trivial.

---

# PART TWELVE — ACCEPTANCE CRITERIA

Phase 8.5.3 is shippable when all of the following are demonstrably true on the operator's test workspace:

1. **Hourly SAM.gov sync runs successfully** for 7 consecutive days without rate-limit errors.
2. **Opportunities populate from watchlist matches** — new SAM.gov notices matching saved searches appear in Pipeline within 2 hours of posting.
3. **Notice type taxonomy is correctly applied** — each notice type maps to its appropriate default stage and behavior per Part Four.
4. **Government Organization hierarchy is populated** — opening an Opportunity shows agency hierarchy from cabinet down to contracting office.
5. **Operator-created Opportunities augment correctly** — when an operator-created Opportunity has a matching SAM.gov notice, the existing record updates without duplicate creation.
6. **High-confidence matches auto-merge** — 90%+ of operator-created Opportunities with exact solicitation numbers correctly match their SAM.gov notices.
7. **Low-confidence matches queue for review** — ambiguous matches surface in operator review queue rather than auto-merging incorrectly.
8. **Operator overrides are respected** — once the operator edits a SAM.gov-sourced field, subsequent syncs do not overwrite it.
9. **Amendments update parents correctly** — `m`-type notices update the parent Opportunity without creating duplicate records.
10. **Deadline changes are surfaced prominently** — deadline-extension Signals appear in the Brief with badge.
11. **Q&A log extraction works** — for amendments containing Q&A in standard formats, structured Q&A entries populate `Opportunity.qAndA[]`.
12. **Attachment URLs are cached** — Inspector surface shows the attachment list with categories; click-through to SAM.gov works.
13. **Source Health view reflects sync state** — green when recent, amber when stale, red when failing.
14. **Cross-source Award linkage works** — when a SAM.gov award notice references a PIID matching an existing Award entity (from 8.5.4), the Opportunity links to the Award.
15. **No operator-input fields** (`notes`, `value`, custom tags) are overwritten by sync.
16. **Doctrine §VI compliance** — no scraping of private data; only public SAM.gov data ingested.

When all 16 criteria are met, Phase 8.5.3 is accepted and Phase 8.5.4 (if not already complete) or Phase 8.5.5 (GAO Bid Protest) can commence.

---

# PART THIRTEEN — OPEN IMPLEMENTATION QUESTIONS

Decisions specific to 8.5.3 that benefit from operator review.

## SIQ-1 — Treatment of Sources Sought (`r` notices)

**Question:** Should every Sources Sought matching watchlist auto-create an Opportunity, or should it just surface in the Brief without creating an Opportunity?

**Tradeoff:** Auto-creating Opps populates the Pipeline faster but inflates the operator's tracked-pursuit count with informational notices. Brief-only is cleaner but loses the structured tracking.

**Proposal:** Hybrid — Sources Sought auto-create at stage `awareness` but are visually distinct in Pipeline (a "Pre-RFP intelligence" badge). Operator can promote to `tracking` or dismiss.

**Recommendation:** Confirm hybrid pattern.

## SIQ-2 — Watchlist initial population assist

**Question:** When the operator first opens the SAM.gov config UI, should Corsair offer to populate the watchlist from the operator's existing Opportunity NAICS and customer agencies?

**Proposal:** Yes. The "Suggest watchlist from your current pursuits" button reads existing Opportunities' inferred NAICS (from `notes` keywords) and agencies, proposes a watchlist, operator edits and saves.

**Recommendation:** Confirm.

## SIQ-3 — Description HTML vs. plain text storage

**Question:** Store both raw HTML and sanitized plain text, or only one?

**Proposal:** Store sanitized plain text on the Opportunity record (used for display). Raw HTML in `sources/sam_gov/raw/{noticeId}/description.html` for debugging and re-sanitization if extraction misses something.

**Recommendation:** Confirm dual storage.

## SIQ-4 — Q&A log extraction confidence threshold

**Question:** What confidence threshold for auto-extracting Q&A entries vs. surfacing raw text?

**Proposal:** Auto-extract when extraction confidence > 0.85 (clear numbered Q/A pattern detected). Below that, surface as a single Signal with full amendment text and a "Q&A may be present — review manually" flag.

**Recommendation:** Confirm 0.85 threshold with operator review surface for sub-threshold extractions.

## SIQ-5 — Sale of Surplus Property exclusion default

**Question:** Should `g`-type notices ever be ingested?

**Proposal:** Excluded by default. Operator can opt in per workspace if relevant (rare).

**Recommendation:** Confirm default exclusion.

## SIQ-6 — Cross-workspace Organization deduplication

**Question:** When workspace A has resolved "AIR FORCE MATERIEL COMMAND" as an Organization and workspace B's SAM.gov sync sees the same agency, do they share the Organization or each maintain their own?

**Proposal:** Per-workspace Organizations. Each workspace has its own government hierarchy. No cross-workspace sharing (Corsair's tenancy model is workspace-isolated).

**Tradeoff:** Cross-workspace sharing would reduce data duplication but break workspace isolation.

**Recommendation:** Confirm per-workspace.

## SIQ-7 — Description-from-URL fetch lag

**Question:** SAM.gov returns description as a URL, not inline text. Fetching the description is a separate API call. Should every new notice trigger an immediate description fetch, or queue for batch?

**Proposal:** Immediate fetch for notices matching saved searches (high relevance); batch nightly fetch for notices that arrived in broader filters but didn't match a specific saved search (lower relevance).

**Tradeoff:** Immediate fetch increases per-notice cost; batch fetch delays operator's read of the full description by up to 24 hours.

**Recommendation:** Confirm immediate fetch for saved-search-matched notices.

## SIQ-8 — Watchlist NAICS code wildcards

**Question:** Support NAICS prefix matching (e.g., `5413*` matches all 5413xx codes)?

**Proposal:** Yes. Watchlist NAICS field accepts both exact codes and prefix-with-asterisk patterns. Storage as string; query expansion happens at sync time.

**Recommendation:** Confirm wildcard support.

## SIQ-9 — Archived-notice handling

**Question:** When a SAM.gov notice transitions to archived status (after `archiveDate`), what happens to the associated Opportunity?

**Proposal:** Opportunity remains in workspace; `samgovLifecycle: 'archived'`. Operator decides whether to keep tracking (e.g., for institutional record) or dismiss. Default: keep.

**Recommendation:** Confirm keep-by-default.

## SIQ-10 — Watchlist conflict with operator-created Opps

**Question:** If the operator manually creates an Opportunity and chooses a stage like `proposal`, then SAM.gov auto-matches and the SAM.gov notice would imply `rfp` per Part One mapping — does the stage change?

**Proposal:** Operator-set stage wins. SAM.gov stage mapping is the default for SAM.gov-sourced new Opportunities only; never overrides an existing operator-set stage.

**Recommendation:** Confirm.

---

# CLOSING NOTES

## Why SAM.gov gets this depth of spec

SAM.gov is the Pipeline surface's external lifeblood. Every other Phase 8.5 sub-phase contributes signal *around* Opportunities; SAM.gov contributes Opportunities themselves. If the Pipeline surface fails to feel reliable after 8.5.3, the rest of Phase 8.5 doesn't recover — operator confidence in the platform's ability to listen to the world is decided here.

The reconciliation logic in Part Seven is the most consequential part of this spec. Operators do not want their carefully tracked pursuits disrupted by an automated feed. They do not want the same pursuit to appear twice in their Pipeline because Corsair couldn't match operator-created and SAM.gov-sourced records. Getting this right is the difference between a feature operators love and a feature they turn off.

## Implementation order recommendation

Sub-phase order in Part Eleven is the recommended sequence. Validation pause points:
- After 8.5.3.2: Verify new SAM.gov notices appear in the Pipeline correctly.
- After 8.5.3.4: Verify operator-created/SAM.gov reconciliation works correctly on the operator's real workspace.
- After 8.5.3.7: Validate the full Brief surface integration on the operator's morning workflow.

The operator should personally test the reconciliation flow with one of his own existing Opportunities before this ships to production.

## Cross-references

- Award integration (8.5.4): linkage via `Opportunity.linkedAwardId` when SAM.gov award notices reference USAspending-tracked PIIDs.
- GAO Protest (8.5.5): linkage via solicitation number when protests reference SAM.gov-tracked solicitations.
- Congress.gov (8.5.7): no direct linkage; congressional hearings sometimes reference specific solicitations but not via structured ID.

## Maintenance principle

This document is v1.0. Revisions to v1.1, v1.2 as implementation surfaces real constraints. The 16 acceptance criteria in Part Twelve are the formal contract.

---

*End of SAM.gov integration deep-dive v1.0. Awaiting operator review of acceptance criteria and open implementation questions before parallel build session begins 8.5.3 implementation.*
