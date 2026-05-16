# CORSAIR OSINT INTEGRATION — PHASE 8.5 ARCHITECTURE SKETCH

**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md)
**Status:** Architecture sketch — proposes structural decisions and per-source integration specs for Phase 8.5. Operator sign-off received 2026-05-15 on D-1, D-2, D-3 and all seven Open Questions (recommended positions confirmed). Doctrine and entity model positions are locked. Next step: Phase 8.5.1 schema migration design.

---

## Document Purpose

The companion research artifact catalogs 142 in-doctrine OSINT sources and tiers them by operator impact. This sketch is one level deeper: it answers *how* the Tier 1 five-source foundation actually attaches to Corsair's data model, what new entity shapes are required, what the ETL middleware looks like, and what sub-phase sequence Phase 8.5 should follow.

The sketch is structured in five parts:
1. **Doctrine sign-off block** — three calls the operator must lock before architecture work commits.
2. **Entity model extensions** — proposed schema changes (one new entity type, one subtype, two attribute extensions).
3. **ETL middleware architecture** — where the integration code runs, how scheduling works, how keys are managed.
4. **Per-source integration specs** — concrete API/auth/cadence/mapping for each Tier 1 source.
5. **Phase 8.5 sub-phase sequencing** — eight sub-phases with operator-week estimates and dependencies.

A final "Open Questions" section surfaces decisions deferred to operator judgment.

---

# PART ONE — DOCTRINE SIGN-OFF BLOCK

Three doctrine-application calls were flagged in Appendix A of the research artifact. They need explicit operator decisions before architecture commits, because the architecture below depends on the positions taken. Each is presented as a proposed position with reasoning. Operator can confirm or redirect.

## D-1 — LinkedIn and ToS-sensitive sources

**Proposed position:** Default-exclude third-party scrapers that violate platform Terms of Service. Support **manual operator import** paths (paste, CSV upload, Sales Navigator export) for LinkedIn-derived data. Corsair facilitates the operator's lawful workflow; Corsair does not run scrapers.

**Reasoning:**
- Doctrine §VI explicitly excludes features whose primary value depends on data acquired in violation of access controls.
- LinkedIn has litigated against scrapers and the legal landscape (hiQ Labs v. LinkedIn and successors) is unsettled.
- The operator already has lawful access to LinkedIn through her own subscription. The integration value is *normalization into Corsair entity model*, not *acquisition*.
- Self-published professional data accessed through normal platform use remains fully in-doctrine.

**Architectural implication:** No automated LinkedIn fetcher in the Cloud Functions stack. A manual import surface in Corsair handles paste/CSV/export-file paths. The operator pulls the data; Corsair shapes and stores it.

**Same position applies to:** ZoomInfo, Apollo, Lusha, RocketReach, Cognism (Appendix A-2); people-search aggregators (A-3); inbox-enrichment products (A-7); commercial social-listening configured for non-public content (A-4).

## D-2 — Award entity: new type vs. Signal attachment

**Proposed position:** Add a new entity type, `Award`. Do **not** model awards as Signals attached to Organizations.

**Reasoning:**
- Awards have a distinct lifecycle (active → expiring → expired/recompete) that needs queryable state, not just a historical record.
- Awards carry structured financial attributes (obligated amount, ceiling, mod history, period of performance) that Signals are not built for.
- Awards relate to *multiple* Organizations simultaneously — prime, subs, customer agency — and modeling those relationships as Edges off an Award is cleaner than attaching the same Signal to three Organizations.
- The recompete watch capability (a Tier 1 operator-impact deliverable) requires a queryable surface on `Award.popEnd`. A new entity type with indexed attributes gives that for free.
- Awards drive Opportunity creation: an expiring Award is a candidate Pursuit with incumbent already known. The Opportunity → Award linkage is bidirectional and needs first-class entity-edge handling.

**Alternative considered:** Awards as `type: "award"` Signals on Organization. Rejected because (a) Signal schema lacks the structured financial fields, (b) cardinality is wrong — Signal is one-to-one with a subject, Award is multi-party, (c) recompete watch becomes a Signal-query, which couples a query-time concern to the wrong primitive.

**Architectural implication:** Schema extension. Firebase RTDB path: `workspaces/{wsId}/awards/{awardId}`. Edge entities `award_prime`, `award_sub`, `award_customer` link Awards to Organizations.

## D-3 — Program entity: new type vs. Organization subtype

**Proposed position:** Model Programs as an Organization **subtype** (`type: "program"`), not a new top-level entity. Programs participate in the same relationship graph as Organizations.

**Reasoning:**
- A Program (e.g., "F-35 Joint Strike Fighter") behaves structurally like an Organization: it has a name, persists across years, has leadership Persons attached, has relationships to other Organizations (program office, prime, subs), can be referenced by Signals.
- Adding `type: "program"` to the existing Organization type set keeps the relationship graph uniform — same Edge primitives work without special-casing.
- Avoids introducing a fourth top-level entity type when the existing one accommodates the shape.

**Alternative considered:** New Program entity with explicit Organization relationships. Rejected because it doubles the relationship-modeling work for no semantic gain — Programs *are* organizations in the operator's mental model.

**Architectural implication:** Existing Organization schema extended with a `type` enumeration that includes `program`. Program-specific attributes (program element code, ACAT level, MDAP status, FYDP funding) attach to the Organization record as a `programAttrs{}` substructure.

---

## Operator sign-off — RECEIVED 2026-05-15

- [x] **D-1 CONFIRMED:** Default-exclude third-party scrapers; manual operator import for ToS-sensitive sources. Applies to LinkedIn, ZoomInfo, Apollo, Lusha, RocketReach, Cognism, people-search aggregators (Spokeo / BeenVerified / Whitepages), inbox-enrichment products, and commercial social-listening configured for non-public content.
- [x] **D-2 CONFIRMED:** Award is a new top-level entity type. Schema E-1 locked.
- [x] **D-3 CONFIRMED:** Program is an Organization subtype with `type: 'program'`. Schema E-2 enum extension locked.

Architecture work proceeds on these positions. Future Doctrine amendments would require a new architecture-sketch revision, not a retroactive edit to v1.

---

# PART TWO — ENTITY MODEL EXTENSIONS

Four schema changes are required to support Tier 1 integration. They are minimal and additive — no existing entity shape is broken.

## Change E-1 — New `Award` entity type

```
Award {
  id:              string  // 'aw_' + hash(piid)
  type:            'award'
  piid:            string  // contracting officer PIID
  modNumber:       string  // most-recent modification number
  primeOrgId:      string  // FK → Organization (recipient)
  customerOrgId:   string  // FK → Organization (awarding agency)
  parentAwardId:   string? // FK → Award (for task orders under IDV)
  awardType:       enum    // 'definitive_contract' | 'idv' | 'task_order' | 'grant' | 'cooperative_agreement' | 'bpa_call'
  obligated:       number  // total obligated dollars
  baseAndAllOptionsValue: number
  naics:           string
  psc:             string
  setAside:        string?
  placeOfPerf:     { state, country, city?, zip? }
  popStart:        timestamp
  popEnd:          timestamp
  awardedAt:       timestamp
  lastModifiedAt:  timestamp
  source:          SourceProvenance  // see E-4
  modifications:   [{ modNumber, dollarDelta, modifiedAt, reasonCode, description }]
  attachments:     [{ url, name, fetchedAt }]  // links only, no mirrored files
}
```

Firebase path: `workspaces/{wsId}/awards/{awardId}`

Indexed-for-query attributes: `popEnd` (recompete watch), `customerOrgId` (per-customer adversary view), `primeOrgId` (competitor wins), `naics` + `psc` (capability filter), `awardedAt` (recency).

## Change E-2 — `Organization.type` enumeration extension

```
Organization.type ∈ {
  'company',     // existing
  'government',  // existing
  'program',     // NEW — DoD/agency program (F-35, Sentinel, etc.)
  'committee',   // NEW — FACA committee, congressional committee, advisory body
  'lobby_firm',  // NEW — registered lobbying firm
  'university',  // NEW — academic institution (for SBIR/research linkages)
  'ffrdc',       // NEW — federally funded R&D center
  'trade_assoc', // NEW — trade association (NDIA, AFCEA, etc.)
  'other'        // existing fallback
}
```

For `type: 'program'`, optional substructure:
```
programAttrs {
  programElement:  string?  // PE code from R-1
  acatLevel:       enum?    // 'ACAT I' | 'ACAT II' | 'ACAT III' | null
  mdap:            boolean?
  fydpFunding:     { [fy: string]: number }  // R-1 line item funding by FY
}
```

For `type: 'committee'`:
```
committeeAttrs {
  charter:      string?
  meetingFreq:  string?
  publicReports: boolean
}
```

These are additive — existing 'company' / 'government' records are unaffected.

## Change E-3 — `Edge` schema extension for time-bounded relationships

Current Edge: `{ id, source, target, label, dir, notes }`

Proposed extension: `{ id, source, target, label, dir, notes, start?, end?, attrs? }`

Where:
- `start` and `end` are timestamps (epoch ms) marking the duration the edge was active. Null `end` = currently active.
- `attrs` is a free-form object for edge-specific metadata (e.g., for a `position_held` edge: `{ role: 'Director, Combat Systems', billet: 'SES-3' }`).

Use cases this unlocks:
- `position_held` edges (Person → government Organization) with start/end dates from Plum Book and Senate confirmations.
- `awarded` edges (Award → Organization) with award-date and mod-date attributes.
- `lobbying_engagement` edges (Organization → lobby_firm) with quarter-of-record and issues array.
- `testimony_at` edges (Person → committee Organization) with hearing-date and hearing-title attributes.

Existing edges without start/end/attrs continue to work unchanged.

## Change E-4 — Source provenance attribute (all externally derived entities)

Every entity created or updated from an external source carries:

```
source: {
  system:      string   // 'sam_gov' | 'usaspending' | 'gao_protest' | 'sec_edgar' | 'congress_gov' | 'dod_news' | 'operator_import' | 'operator_manual'
  externalId:  string   // canonical ID in source system (PIID, CIK, etc.)
  url:         string?  // direct URL to source record where available
  fetchedAt:   timestamp
  refreshedAt: timestamp
  hash:        string?  // content hash to detect changes without full diff
}
```

**Why this matters:**
- Citation: every external claim has a clickable source link in the operator's view. Doctrine §IV: "the platform never knows better than her" — she can always verify.
- Refresh logic: ETL jobs query `source.refreshedAt < cutoff` to decide what to re-fetch.
- Conflict resolution: when operator-input contradicts external data, `source.system === 'operator_manual'` always wins. Operator's read is sacred.
- Audit: when an external system changes its data and our cached version is stale, `hash` mismatch flags it.

This attribute applies to: Award, Signal, Organization (when created from external source), Person (when created from external source), Edge (when created from external source).

Operator-created entities have `source.system: 'operator_manual'` and never get auto-overwritten by external feeds.

---

# PART THREE — ETL MIDDLEWARE ARCHITECTURE

External feeds cannot run in the browser. CORS restricts most APIs, scheduled execution requires a backend, API keys cannot live in client code. A middleware tier is required.

## Proposed architecture: Firebase Cloud Functions (2nd gen) with scheduled triggers

**Why this stack:**
1. Corsair already uses Firebase RTDB for persistence and Firebase Auth for identity. Functions stay inside the existing trust boundary.
2. Cloud Functions 2nd gen supports `onSchedule(cron)` triggers natively. No separate scheduler service needed.
3. API keys live in Firebase Functions config (`firebase functions:config:set`) — never in client code, never in git.
4. RTDB writes from Functions use the Admin SDK with full read/write privilege scoped to the workspace path.
5. Cloud Logging captures errors with structured payloads for an operator-facing health view.
6. Pricing: at expected source-fetch volumes (low thousands of API calls/day per workspace), Functions costs are minimal (~$5-15/month per active workspace at Tier 1 sources).

**Alternatives considered:**
- *GitHub Actions cron + static JSON cache:* Cheap and simple but no per-workspace data isolation. Rejected — Corsair is multi-tenant by workspace.
- *Cloud Run + Pub/Sub scheduler:* More flexible but adds a service to the operations footprint. Rejected — Functions covers the scheduled-fetch use case with less infrastructure.
- *Operator-local agent (Electron/desktop tool):* Eliminates server entirely but requires every operator to run an agent, complicates upgrades, breaks the single-file-app simplicity. Rejected — Corsair's web-first model is a feature.
- *External worker on Heroku/Render:* Same problem as Cloud Run plus extra vendor relationship. Rejected.

## Repository layout

A new top-level directory in the FLi-Network repo:

```
FLi-Network/
├── FLiIntel.html                       (existing — client app)
├── js/corsair/                         (existing — client ES modules)
├── functions/                          (NEW — Cloud Functions source)
│   ├── package.json
│   ├── index.js                        (entry — registers all scheduled functions)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── rtdb.js                 (Admin SDK wrapper, workspace path helpers)
│   │   │   ├── sourceProvenance.js     (E-4 attribute helper)
│   │   │   ├── rateLimit.js            (per-source token bucket)
│   │   │   ├── retry.js                (exponential backoff)
│   │   │   └── logging.js              (structured Cloud Logging helper)
│   │   ├── sources/
│   │   │   ├── samGov.js               (T1-1)
│   │   │   ├── usaSpending.js          (T1-2a)
│   │   │   ├── dodNewsContracts.js     (T1-2b)
│   │   │   ├── gaoProtest.js           (T1-3)
│   │   │   ├── secEdgar.js             (T1-4)
│   │   │   └── congressGov.js          (T1-5)
│   │   └── jobs/                       (scheduled-trigger entry points)
│   │       ├── samGovHourly.js
│   │       ├── usaSpendingNightly.js
│   │       ├── dodNewsBusinessDaily.js
│   │       ├── gaoProtestDaily.js
│   │       ├── secEdgarFrequent.js
│   │       └── congressGovDaily.js
│   └── tests/                          (per-source unit tests with API fixtures)
└── corsair-osint-*.md                  (research and architecture artifacts)
```

Functions deploy via `firebase deploy --only functions:<name>` from the repo root.

## Workspace-scoped data paths

Externally fetched data writes to two paths per workspace:

```
workspaces/{wsId}/
├── sources/{system}/
│   ├── raw/{recordId}                  (raw fetched payload + provenance)
│   ├── lastSync                        (timestamp of last successful sync)
│   ├── lastError?                      (most recent error if non-null)
│   └── config                          (operator-set filters: NAICS, agencies, etc.)
├── awards/{awardId}                    (normalized Award entities)
├── nodes/{nodeId}                      (existing — Organization, Person, Program)
├── links/{linkId}                      (existing — Edges)
├── opportunities/{oppId}               (existing — Opportunity entities)
└── signals/{signalId}                  (existing — Signal entities)
```

The raw cache exists for debugging and re-normalization without re-fetching. Storage cost is negligible (~MB per workspace at Tier 1 volumes).

## Watchlist configuration model

Each source needs a per-workspace configuration: which NAICS codes, which agencies, which ticker symbols, which committee endpoints. Config lives at:

```
workspaces/{wsId}/sources/{system}/config
```

Initial config UI: operator-edited JSON in a Corsair settings page. Future: structured form per source. For Phase 8.5, JSON-edit is acceptable.

## API key management

Keys live in Firebase Functions config:
```
firebase functions:config:set \
  sam_gov.api_key="..." \
  congress_gov.api_key="..." \
  sec_edgar.user_agent="Corsair Defense BD Intel (contact@corsairhq.io)"
```

USAspending, GAO, and DoD News do not require keys. SEC EDGAR requires a User-Agent header per their fair-access policy but no key.

Keys are *application-level* (one key per source per Corsair deployment), not per-workspace. Operators do not need their own keys. Rate limits are managed at the application level by the middleware.

## Rate limit handling

Per-source token-bucket rate limiters in `functions/src/lib/rateLimit.js`. Limits configured per source:

| Source | Limit | Implementation |
|---|---|---|
| SAM.gov | 1000/hour, 10/sec | Token bucket; 429 → exponential backoff |
| USAspending | 1000/hour | Per-IP limited; backoff on 429 |
| DoD News | No published limit | Polite 1-req-per-2-sec scrape |
| GAO Protest | No published limit | Polite 1-req-per-2-sec scrape |
| SEC EDGAR | 10/sec | Strict; required User-Agent; 429 = ban-risk |
| Congress.gov | 5000/hour | Token bucket; 429 → exponential backoff |

## Error handling and operator-facing health view

Every Function call emits structured logs to Cloud Logging:
```
{
  source: 'sam_gov',
  workspace: 'ws_abc123',
  jobId: 'samGovHourly-2026-05-15T13:00:00Z',
  status: 'success' | 'partial' | 'failure',
  recordsFetched: number,
  recordsUpserted: number,
  errors: [{ code, message, recordId? }],
  durationMs: number
}
```

A Corsair-internal "Source Health" view (added under the Brief surface) reads `workspaces/{wsId}/sources/{system}/lastSync` and `lastError` and surfaces:

- Last successful sync per source (with age — green if < cadence interval, amber if 1-3x, red if > 3x)
- Most recent error message if non-null and within last 24 hours
- Number of records ingested in the last 24 hours per source

Doctrine §IV: "If the platform does not know something with confidence, it does not pretend to." A stale source has to be visibly stale. The operator must always be able to ask "is Corsair currently listening?" and get a truthful answer in one glance.

---

# PART FOUR — PER-SOURCE INTEGRATION SPECS

Five sub-specs, one per Tier 1 source. Each follows the same structure: API surface, auth, rate limits, cadence, schema mapping, edge cases.

## T1-1 — SAM.gov Opportunities API

### API surface
- Base URL: `https://api.sam.gov/opportunities/v2/search`
- Key endpoints used:
  - `/opportunities/v2/search` — search active and archived opportunities
  - `/entity-information/v3/entities` — vendor registration lookup by UEI/CAGE
  - `/opportunities/v2/{noticeId}/resources` — opportunity attachment list

### Auth
- API key via header `X-API-KEY` (registration at sam.gov, free).
- One application-level key shared across workspaces.

### Rate limits
- 1000 requests/hour, 10 requests/second.
- 429 response → exponential backoff: 2s, 4s, 8s, 16s, 32s, then fail-job.

### Cadence
- **Hourly fetch** of opportunities posted in the last 24 hours, filtered by operator's configured NAICS and agency watchlist. Hourly because operators reading the Daily Brief want fresh data within an hour of posting.
- **Daily full refresh** of opportunities in the operator's watchlist that have not been refreshed in 7 days (catches amendments, deadline extensions, status changes).
- **On-demand fetch** when operator opens an Opportunity in Corsair and the cached version is > 1 hour old.

### Schema mapping

SAM.gov opportunity record → Corsair Opportunity entity:

| SAM.gov field | Corsair attribute |
|---|---|
| `noticeId` | `source.externalId` |
| `title` | `Opportunity.title` |
| `solicitationNumber` | `Opportunity.solicitationNumber` (new attr) |
| `fullParentPathName` | `Opportunity.customerOrgId` (resolve to Organization with `type: 'government'`) |
| `naicsCode` | `Opportunity.naics` |
| `classificationCode` | `Opportunity.psc` |
| `typeOfSetAsideDescription` | `Opportunity.setAside` |
| `responseDeadLine` | `Opportunity.dueDate` |
| `description` | `Opportunity.description` (truncated to first 50KB; full text in raw cache) |
| `type` | `Opportunity.noticeType` (`presol` / `sources_sought` / `combined_synopsis_solicitation` / `solicitation` / etc.) |
| `placeOfPerformance` | `Opportunity.placeOfPerf` |
| `resourceLinks` | `Opportunity.attachments[]` (URLs only) |

Each new Opportunity is created at stage `awareness` and assigned to the workspace's default operator unless an operator-configured rule matches a different assignment.

### Edge cases
- **Amendments:** SAM.gov amendments have new `noticeId`s but reference the original via `relatedNotices`. Corsair treats the original Opportunity as the canonical record and attaches amendments as Signals (`type: "opportunity_amendment"`) linked to it.
- **Attachment fetch:** Opportunity attachments may be large PDFs. Phase 8.5 stores attachment URLs only — operator fetches on click. Future phase may mirror to Firebase Storage for offline access.
- **Sources Sought vs. solicitations:** Both shape into Opportunity entities but with different `noticeType`. Operator can filter the Pipeline view by type.
- **Vendor registration linkage:** When an Opportunity references a specific contractor (e.g., sole-source notices), the `entity-information` endpoint resolves UEI/CAGE to an Organization. Cache lookups in `sources/sam_gov/entity_lookup_cache`.

### Dependency on E-changes
- No new entity types required. Opportunity entity exists.
- Source provenance attribute (E-4) required.

---

## T1-2 — USAspending.gov + DoD News Contract Announcements

This is two sources because they serve the same purpose (award intelligence) with different timing characteristics: DoD News gives same-day for $7M+ awards; USAspending gives complete data with 24-72hr lag.

### Source A: USAspending.gov API

**API surface:**
- Base URL: `https://api.usaspending.gov/api/v2/`
- Key endpoints used:
  - `/search/spending_by_award/` — primary award search with filters
  - `/awards/{generated_unique_award_id}/` — individual award detail
  - `/subawards/` — subcontract reporting (FFATA)
  - `/recipient/{recipient_id}/` — recipient organization detail

**Auth:** None. Public API.

**Rate limits:** 1000 requests/hour per IP. Backoff on 429.

**Cadence:**
- **Nightly sync** of awards posted in the last 7 days, filtered by operator's competitor list (Organization watch) + customer list (agency watch) + NAICS list.
- **Weekly sync** of subaward data (FFATA reporting lags, so weekly catches the new sub-data).
- **Monthly recompete-watch refresh** — fetch all awards with `popEnd` within the next 18 months in operator's NAICS/customer watchlist. Drives the Pipeline surface's recompete-watch derived view.

**Schema mapping:**

USAspending award → Corsair Award entity:

| USAspending field | Corsair attribute |
|---|---|
| `generated_unique_award_id` | `Award.id` (after hashing) |
| `Award ID` (piid) | `Award.piid` |
| `recipient_name` + `recipient_id` | resolved to `Award.primeOrgId` (Organization) |
| `awarding_agency_name` + `awarding_sub_agency_name` | resolved to `Award.customerOrgId` (Organization with `type: 'government'`) |
| `award_type_code` | `Award.awardType` |
| `total_obligation` | `Award.obligated` |
| `current_total_value_of_award` | `Award.baseAndAllOptionsValue` |
| `naics_code` | `Award.naics` |
| `product_or_service_code` | `Award.psc` |
| `type_of_set_aside` | `Award.setAside` |
| `period_of_performance_start_date` | `Award.popStart` |
| `period_of_performance_current_end_date` | `Award.popEnd` |
| `date_signed` | `Award.awardedAt` |
| `last_modified_date` | `Award.lastModifiedAt` |
| `transaction_obligated_amounts` (transactions array) | `Award.modifications[]` |

Subaward records (FFATA-reported):
- Create `award_sub` Edge: source=Award, target=Sub Organization, `attrs: { dollarValue, ffataReportDate, naics }`
- If the sub Organization doesn't exist yet, create it (with `source.system: 'usaspending'`).

Recompete watch derived view: `SELECT * FROM Awards WHERE popEnd BETWEEN now AND now+18mo AND naics IN ${operator.watchlist} ORDER BY popEnd ASC`. Implementation: Firebase RTDB indexed query on `popEnd`.

**Edge cases:**
- **IDV vs. task orders:** IDVs (indefinite delivery vehicles) are parent awards; task orders are children. Both are Award entities, linked via `Award.parentAwardId`. Recompete watch surfaces task orders by `popEnd` not the parent IDV.
- **Recipient disambiguation:** USAspending's recipient_id changes over time as DUNS-to-UEI migration completes. Corsair stores both legacy DUNS and current UEI as Organization attributes and reconciles cross-source matches by both.
- **Modification chains:** Award modifications can grow the dollar value, extend the PoP, or close the award. Each modification is an entry in `Award.modifications[]` and the top-level `obligated` / `popEnd` reflect the latest mod.
- **Recipient hierarchy:** A subsidiary recipient should roll up to its parent for adversary-tracking purposes. Use D&B family-tree or operator-flagged manual linkage. Phase 8.5 starts with no rollup; operator can mark `Organization.parentOrgId` manually.

### Source B: DoD News Contract Announcements

**Source:** `https://www.defense.gov/News/Contracts/` (HTML page, no API).

**Auth:** None.

**Rate limits:** No published limit. Polite scrape: 1 request per 2 seconds, business-daily fetch.

**Cadence:**
- **Business-daily fetch** at 7pm ET (DoD publishes the day's announcements between 5-6pm ET typically). Catches all $7M+ awards announced that day.
- One scrape per business day; weekends and federal holidays skipped.

**Schema mapping:**

Each contract announcement has a structured format:
```
{Contractor name}, {city, state} (PIID), is being awarded a {dollar value} {contract type} for {description}. {Place of performance.} {Estimated completion date.} {Contracting authority/agency.}
```

Parse → create Award entity with:
- `Award.piid` from the announcement
- `Award.obligated` from dollar value
- `Award.primeOrgId` resolved from contractor name (lookup Organization, create if missing)
- `Award.customerOrgId` resolved from contracting authority
- `Award.awardedAt` = announcement date
- `source.system: 'dod_news'`, `source.url` = DoD News page anchor for that day

**Reconciliation with USAspending:**
- When USAspending later returns the same award (matched by PIID), update the Award record. Set `source.system: 'usaspending'` (more authoritative) but preserve `source.firstSeenAt: <dod_news fetch date>`.
- This gives the operator a "first known" timestamp from DoD News while later enrichment fills in subs, mods, full structured data.

**Edge cases:**
- **Award announcements without PIIDs:** Some announcements use legacy contract numbers. Match by contractor + dollar + date as fallback.
- **Multi-award announcements:** A single announcement may award to multiple contractors. Parse each separately.
- **Unannounced classifications:** Some classified awards don't appear in DoD News or USAspending. Operator-input only for those.

### Dependency on E-changes
- **E-1 (Award entity):** Required. This is the source that proves the case for the Award type.
- **E-4 (source provenance):** Required.

---

## T1-3 — GAO Bid Protest Docket

### API surface
- No formal API. Public web scrape of:
  - `https://www.gao.gov/legal/bid-protests/search` — protest filings list
  - Individual protest decision pages and PDFs

### Auth
- None. Polite scrape with User-Agent identifying Corsair.

### Rate limits
- No published limit. Polite cadence: 1 request per 2 seconds.

### Cadence
- **Daily scrape** of new protest filings.
- **Daily check** for newly issued decisions on tracked protests (a protest's status transitions: filed → pending → decided/dismissed/withdrawn).
- **On-decision: fetch decision PDF and extract text** for storage in raw cache.

### Schema mapping

Protest filing → Signal entity:

```
Signal {
  id:           string
  type:         'protest'
  subjectIds:   [protestor_org_id, awardee_org_id]  // resolved from names
  relatedIds:   [solicitation_id?, agency_org_id]
  occurredAt:   timestamp  // filing date
  attrs: {
    docketNumber:   'B-XXXXXX.X'
    protestor:      string  // org name as filed
    awardee:        string?
    agency:         string
    solicitation:   string?
    status:         'pending' | 'decided' | 'dismissed' | 'withdrawn' | 'settled'
    filedAt:        timestamp
    decidedAt:      timestamp?
    outcome:        'sustained' | 'denied' | 'dismissed_partial' | 'dismissed_full' | 'withdrawn' | 'settled' | null
    decisionUrl:    string?
    decisionTextHash: string?
  }
  source: SourceProvenance
}
```

When decision is issued:
- Fetch PDF
- Extract text via pdf-parse or similar
- Store full text in `workspaces/{wsId}/sources/gao_protest/decisions/{docketNumber}/text`
- Update Signal `attrs.outcome` and `attrs.decisionTextHash`

### Edge cases
- **Multi-protestor protests:** A single docket may have multiple protestors. Each is a separate Signal-subject; one Signal record with multiple `subjectIds`.
- **Protest of a protest decision (reconsideration):** GAO uses `.X` suffixes on docket numbers. Treat each as separate Signal linked to the parent by `relatedIds`.
- **Court of Federal Claims protests (COFC):** Not in GAO docket. Future-tier work (Tier 3) via PACER. Phase 8.5 covers GAO only.
- **Organization-name resolution:** Protest filings use organization names in free-text form. Fuzzy-match against Corsair Organization records; create new Organization with `source.system: 'gao_protest'` if no match (flag for operator review).

### Dependency on E-changes
- E-4 (source provenance): Required.
- No new entity types required.

---

## T1-4 — SEC EDGAR (Publicly Traded Primes and Competitors)

### API surface
- Base URLs:
  - `https://data.sec.gov/submissions/CIK{cik}.json` — submission history per filer
  - `https://www.sec.gov/cgi-bin/browse-edgar` — search interface (legacy, used for company-name → CIK lookup)
  - `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/` — actual filing documents

### Auth
- None, but **mandatory User-Agent header** identifying Corsair with contact email. SEC enforces fair-access policy.
- Header format: `User-Agent: Corsair Defense BD Intel contact@corsairhq.io` (or operator-configured equivalent).
- Failure to include valid User-Agent → IP-ban risk.

### Rate limits
- 10 requests/second. Strict.
- Exceeding → temporary IP ban. Backoff aggressively on 429: 30s, 60s, 120s.

### Cadence
- **Every 5 minutes** poll for new filings on watchlist CIKs (10-K/10-Q/8-K/Form 4 for filers in operator's competitor list).
- **Daily** index file fetch (`https://www.sec.gov/Archives/edgar/full-index/`) for new filings system-wide that match keyword/company criteria the operator has set.

### Watchlist setup
- Operator-configured list of CIKs (Central Index Keys) or ticker symbols (resolved to CIK via the company-name search).
- Initial default watchlist seed (operator can edit): Lockheed Martin (LMT), Northrop Grumman (NOC), RTX, General Dynamics (GD), Boeing (BA), L3Harris (LHX), Leidos (LDOS), Booz Allen Hamilton (BAH), CACI, SAIC, Parsons, KBR, Maximus, ManTech, Peraton (private — skip), Anduril (private — skip), Palantir (PLTR), Kratos (KTOS), AeroVironment (AVAV), Elbit Systems of America (parent ESLT).

### Schema mapping

Per filing type:

**8-K (material event):**
```
Signal {
  type: 'material_event'
  subjectIds: [filer_org_id]
  occurredAt: filingDate
  attrs: {
    accessionNumber, formType: '8-K', items: [Item 1.01, 2.02, etc.],
    summary: extractedFirstParagraph,
    documentUrl: filing URL
  }
}
```

**10-K / 10-Q (annual / quarterly):**
- Extract MD&A section and risk-factors section.
- Extract any "Government Contracts" or "Defense" segment commentary.
- Signal entity with `type: 'periodic_report'`, attrs include extracted segment text + backlog data when present.

**Form 4 (insider transactions):**
- Signal entity with `type: 'insider_transaction'`, attrs include person (officer/director), shares, transaction code, value.
- Resolve filer Person → existing Corsair Person record (or create with `source.system: 'sec_edgar'`).

**DEF 14A (proxy statement):**
- Extract director/officer roster, compensation tables.
- Update Organization's directors/officers (Person edges) with current titles.

### Edge cases
- **Filer is a subsidiary:** SEC filings are typically by ultimate parent. Subsidiary contracts traced via USAspending need parent-child Organization linkage (E-2's `Organization.parentOrgId` for explicit linkage; D&B family-tree for backfill).
- **Foreign filers (20-F):** Some defense suppliers are foreign filers. Different form types; lower priority for Phase 8.5.
- **Large 10-K text:** 10-K filings can be 100-500 pages. Store text-extracted sections only; reference full PDF URL.

### Dependency on E-changes
- E-4 (source provenance): Required.
- No new entity types required.

---

## T1-5 — Congress.gov API (Defense Committee Activity)

### API surface
- Base URL: `https://api.congress.gov/v3/`
- Key endpoints used:
  - `/committee/{chamber}/{committeeCode}` — committee metadata and members
  - `/committee-meeting/{congress}/{chamber}` — hearings list
  - `/hearing/{congress}/{chamber}/{number}` — hearing detail with witness list
  - `/nomination/{congress}/{number}` — nomination records (DoD political appointees)
  - `/member/{bioguideId}` — congressional member detail
  - `/bill/{congress}/{billType}/{billNumber}` — bill detail (for NDAA tracking)

### Auth
- API key via header `X-Api-Key` (registration at api.congress.gov, free).

### Rate limits
- 5000 requests/hour.
- 429 → exponential backoff: 2s, 4s, 8s.

### Watchlist (committees of interest)
Hardcoded initial set; operator can extend:
- **House:**
  - House Armed Services Committee (HSAS) — `committeeCode: hsas00`
  - House Appropriations Subcommittee on Defense — `committeeCode: hsap02`
  - House Intelligence Committee (HPSCI) — `committeeCode: hlig00`
  - House Foreign Affairs — `committeeCode: hsfa00` (selectively for capability-relevant hearings)
- **Senate:**
  - Senate Armed Services Committee (SASC) — `committeeCode: ssas00`
  - Senate Appropriations Subcommittee on Defense — `committeeCode: ssap02`
  - Senate Intelligence Committee (SSCI) — `committeeCode: slin00`
  - Senate Foreign Relations — `committeeCode: ssfr00` (selectively)

### Cadence
- **Daily fetch** of new hearings in watchlist committees.
- **Daily fetch** of new nominations referred to SASC/HSAS.
- **Weekly fetch** of bill activity (NDAA, defense appropriations bills, supplementals).
- **Quarterly fetch** of committee membership rosters (catches mid-Congress changes).

### Schema mapping

**Hearing → Signal entity:**
```
Signal {
  type: 'congressional_hearing'
  subjectIds: [committee_org_id]
  relatedIds: [witness_person_ids...]
  occurredAt: hearingDate
  attrs: {
    title, congress, session, chamber, committeeCode,
    witnesses: [{ name, role, organization, bioguideId? }],
    transcriptUrl, recordUrl,
    relatedBills: [billIds...]
  }
}
```

For each witness:
- Resolve to existing Person (fuzzy-match by name + organization) or create new Person with `source.system: 'congress_gov'`.
- Create `testimony_at` Edge (Person → committee Organization) with `start: hearingDate`, `attrs: { hearingTitle, hearingId }`.

**Nomination → Signal entity:**
```
Signal {
  type: 'nomination'
  subjectIds: [nominee_person_id]
  relatedIds: [target_org_id]  // the position's agency
  occurredAt: nominationDate
  attrs: {
    position: '...',
    referredTo: 'SASC' | 'SSAS' | etc.,
    confirmedAt: timestamp?,
    confirmationVote: { yea, nay, present }?
  }
}
```

When nomination confirms:
- Update Signal `attrs.confirmedAt`.
- Create `position_held` Edge (Person → target_org) with `start: confirmationDate`, `attrs: { role, billet }`.

**Committee membership → Organization with member Person edges:**
- For each committee, create or update Organization with `type: 'committee'`.
- For each member, create or update `member_of` Edge (Person → committee Organization) with `start`, `end?`, `attrs: { role: 'Chair' | 'Ranking' | 'Member', subcommittees: [...] }`.

### Edge cases
- **Witness name resolution:** Congressional hearings list witnesses by displayed name (e.g., "Hon. Frank Kendall, Secretary of the Air Force"). Fuzzy-match against existing Persons; create with note if unresolved.
- **QFRs (Questions for the Record):** Sometimes published weeks after hearings. Tracked as separate Signal `type: 'qfr'` linked back to the hearing.
- **Joint hearings:** Single hearing across two committees. Create one Signal with both committees in `subjectIds`.

### Dependency on E-changes
- E-2 (Organization.type extension) for `'committee'` type.
- E-3 (Edge schema extension) for `testimony_at` and `position_held` edges with start/end.
- E-4 (source provenance): Required.

---

# PART FIVE — PHASE 8.5 SUB-PHASE SEQUENCING

The Tier 1 integration is decomposable into eight sub-phases. The sequence respects dependencies: schema changes precede source integrations that need them; foundational sources precede dependent ones.

## Phase 8.5.1 — Entity model extensions (1-2 operator-weeks)
Implements E-1, E-2, E-3, E-4 in the client schema and adds migration handling for existing workspaces (existing nodes get a default `source.system: 'operator_manual'`).

**Deliverables:**
- New Award entity type in client and in RTDB schema.
- Organization.type enumeration extension with new subtypes.
- Edge schema extension with optional start/end/attrs fields.
- Source provenance attribute on Signal, Award, and operator-importable entity types.
- Migration script for existing workspaces.

**Operator-impact moment:** None directly user-facing; foundation for everything that follows.

**Dependencies:** None.

**Risk note:** Schema migration is the highest-risk step in 8.5. Existing workspaces must not lose data. Operator should test-deploy to a non-production workspace first.

---

## Phase 8.5.2 — Cloud Functions scaffolding (1-2 operator-weeks)
Sets up the `functions/` directory, deployment pipeline, scheduled-trigger pattern, error logging, rate-limit utility, retry utility, and source-config schema.

**Deliverables:**
- `functions/` initialized with Firebase CLI.
- Admin SDK wrapper (`functions/src/lib/rtdb.js`) with workspace path helpers.
- Per-source rate-limiter and retry utilities.
- Structured Cloud Logging helper.
- "Source Health" surface in the Brief reading `sources/{system}/lastSync`.
- One smoke-test scheduled function deploying successfully (no-op cron).

**Operator-impact moment:** Source Health view appears in the Brief; shows "no sources configured" state until subsequent phases add real sources.

**Dependencies:** 8.5.1.

---

## Phase 8.5.3 — SAM.gov integration (1-2 operator-weeks)
First real source. Lowest schema risk (Opportunity entity already exists).

**Deliverables:**
- `functions/src/sources/samGov.js` + `functions/src/jobs/samGovHourly.js`.
- Operator-configurable watchlist (NAICS, agencies) at `workspaces/{wsId}/sources/sam_gov/config`.
- Opportunity entities populated from SAM.gov filtered to watchlist.
- Source Health view reflects sam_gov status.
- Brief surface shows new opportunities posted in last 24 hours.

**Operator-impact moment:** "Operator sees new solicitations in her Pipeline within an hour of SAM.gov posting, pre-filtered by her NAICS watchlist."

**Dependencies:** 8.5.1, 8.5.2.

---

## Phase 8.5.4 — USAspending + DoD News Contract Announcements (2-3 operator-weeks)
First use of the new Award entity type. Both sources integrated together because they reconcile.

**Deliverables:**
- `functions/src/sources/usaSpending.js`, `functions/src/sources/dodNewsContracts.js`.
- Nightly USAspending sync + business-daily DoD News scrape.
- Award entities populated with reconciliation logic (DoD News first-seen, USAspending authoritative).
- Subaward Edge data from FFATA.
- Recompete-watch derived view (Pipeline surface filter showing awards with `popEnd` within 18 months in operator's watchlist).
- Source Health entries for both sources.

**Operator-impact moment:** "Operator sees competitor's same-day large awards; gets monthly recompete-watch list of expiring contracts in her capability area."

**Dependencies:** 8.5.1 (Award entity), 8.5.2, 8.5.3 (Organization records benefit from SAM.gov vendor registrations already cached).

---

## Phase 8.5.5 — GAO Bid Protest (2 operator-weeks)
Signal-only integration. Polite scrape pattern.

**Deliverables:**
- `functions/src/sources/gaoProtest.js` + daily scheduled job.
- Daily docket scrape and decision-text extraction.
- Signal entities for protests with subject linkage to protestor + awardee Organizations.
- Brief surface shows new protest filings affecting Organizations in operator's watchlist.

**Operator-impact moment:** "Operator sees protest filings on awards her adversaries have won — and reads decision text when GAO rules."

**Dependencies:** 8.5.1, 8.5.2.

---

## Phase 8.5.6 — SEC EDGAR (1-2 operator-weeks)
Signal-only. Higher rate-limit discipline than other sources.

**Deliverables:**
- `functions/src/sources/secEdgar.js` + 5-minute scheduled job.
- Watchlist of publicly traded competitor CIKs with operator-editable list.
- Signal entities for 8-K, 10-K/Q, Form 4, DEF 14A.
- Earnings-call transcript extraction (where available) attached to 10-Q Signal.

**Operator-impact moment:** "Operator sees publicly traded competitors' material events within minutes of filing; sees insider transactions for tracked executives."

**Dependencies:** 8.5.1, 8.5.2.

---

## Phase 8.5.7 — Congress.gov (2 operator-weeks)
Uses E-2 (committee subtype) and E-3 (edge extensions). Most schema-touching of the five.

**Deliverables:**
- `functions/src/sources/congressGov.js` + daily scheduled job.
- Defense committee Organizations populated with current membership.
- Hearing Signals with witness linkage.
- Nomination Signals with position-held edge creation on confirmation.
- Brief surface shows upcoming defense committee hearings.

**Operator-impact moment:** "Operator sees who is testifying to which defense committee on what topic; sees DoD political appointee nominations as they are referred."

**Dependencies:** 8.5.1, 8.5.2.

---

## Phase 8.5.8 — Daily Brief integration of external signals (2-3 operator-weeks)
Pulls all five sources into a unified Daily Brief that operates on the operator's watchlist.

**Deliverables:**
- Brief surface section "External Intelligence (last 24h)" with grouped feeds per source.
- Entity-linked summary: when a Signal references a Person/Organization in operator's workspace, render with deep-link to entity.
- Recompete-watch list as a Brief section.
- Operator can toggle source visibility per workspace.

**Operator-impact moment:** "Operator opens Corsair in the morning and sees one consolidated Brief that compresses 24 hours of external defense intelligence into a workspace-scoped view she can read in 5 minutes."

**Dependencies:** 8.5.3 through 8.5.7.

---

## Sequencing summary

| Sub-phase | Sources | Weeks | Cumulative |
|---|---|---|---|
| 8.5.1 | Schema extensions | 1-2 | 1-2 |
| 8.5.2 | Cloud Functions scaffolding | 1-2 | 2-4 |
| 8.5.3 | SAM.gov | 1-2 | 3-6 |
| 8.5.4 | USAspending + DoD News | 2-3 | 5-9 |
| 8.5.5 | GAO Protest | 2 | 7-11 |
| 8.5.6 | SEC EDGAR | 1-2 | 8-13 |
| 8.5.7 | Congress.gov | 2 | 10-15 |
| 8.5.8 | Daily Brief integration | 2-3 | 12-18 |

**Total Phase 8.5 estimate: 12-18 operator-weeks.** 8.5.3 through 8.5.7 can partially parallelize if the operator has more than one developer-equivalent working on integration.

---

# PART SIX — OPEN QUESTIONS

Decisions deferred to operator judgment, with the reasoning behind why they are deferred.

## OQ-1 — Backfill scope
**Question:** When SAM.gov / USAspending / GAO / EDGAR / Congress.gov are first integrated, how far back should we backfill historical data?

**Considered options:**
- *No backfill:* Only forward-going data from integration date. Fastest deploy, less historical context.
- *6 months back:* Captures recent recompete signal but not long-arc patterns.
- *2 years back:* Captures most active capture cycles.
- *5+ years back:* Long-arc trajectory analysis enabled.

**Recommendation:** Default 2 years for USAspending (recompete cycle), 1 year for the others. Operator can request additional backfill per source.

**Deferral reason:** Storage cost and initial-fetch volume scale with backfill depth. Operator should make the cost/value tradeoff explicitly.

## OQ-2 — Per-workspace vs. global watchlists
**Question:** Should the NAICS / agency / ticker watchlists be per-workspace (each workspace independently configured) or organization-wide (shared across workspaces)?

**Recommendation:** Per-workspace. Each workspace represents a distinct operator's terrain. Sharing watchlists would couple unrelated operators' contexts.

**Deferral reason:** Decision is partly product-shape. Operator may want a "shared watchlist library" pattern with per-workspace override later.

## OQ-3 — Attachment storage strategy
**Question:** Do we mirror PDF attachments (solicitations, GAO decision PDFs, SEC filings) to Firebase Storage, or only store URLs?

**Considered options:**
- *URLs only:* Cheapest. Operator fetches on click. Risk: source URL changes or content disappears.
- *Mirror to Firebase Storage:* More storage cost; durable.
- *Mirror only operator-flagged attachments:* Hybrid — operator marks an attachment as "save" and Corsair mirrors it.

**Recommendation:** URLs only for Phase 8.5. Add operator-flagged mirroring in a follow-on phase if real-world experience reveals lost content.

**Deferral reason:** Storage-cost vs. content-durability tradeoff is hard to estimate without observing real workspace data.

## OQ-4 — Multi-tenant API key consumption
**Question:** As Corsair adds more workspaces, will SAM.gov's 1000/hour and Congress.gov's 5000/hour limits become bottlenecks?

**Analysis:** At 1000/hour SAM.gov, with operator watchlists generating ~50 fetches/hour, a single Corsair key supports ~20 active workspaces before approaching limits. Beyond that, the keys become bottlenecks.

**Recommendation:** Phase 8.5 ships with single application key. Plan for per-tier key sharding (e.g., separate keys for free-tier and paid-tier workspaces) when workspace count exceeds 15.

**Deferral reason:** Bottleneck timing is unknown until workspaces grow. Defensible to ship Phase 8.5 with single key.

## OQ-5 — Operator-curated overrides
**Question:** When external data conflicts with operator's knowledge (e.g., USAspending lists a contractor as "won" but the operator knows the award was protested and overturned), how does Corsair handle the conflict?

**Proposed model:**
- External-source entities never overwrite operator-edited fields.
- Conflict surface in Source Health: "USAspending claims X; operator says Y. Reconcile?"
- Operator can pin a field as "operator-authoritative" — future external updates leave it untouched.

**Deferral reason:** Conflict-resolution UI is a meaningful design surface that benefits from operator-input. Phase 8.5 implements basic "operator-pin wins" logic; richer reconciliation is later.

## OQ-6 — Source Health placement
**Question:** Does the Source Health view live in the Brief, in the Theater (as a corner overlay), or in its own surface?

**Recommendation:** Brief surface for Phase 8.5. The Brief is where the operator reads about what the platform has noticed; source freshness is part of that. A small "sources" panel below the Daily Brief is sufficient.

**Deferral reason:** Surface placement is a design call the operator should make.

## OQ-7 — Initial CIK watchlist composition
**Question:** Which publicly traded firms ship as the default SEC EDGAR watchlist?

**Recommendation:** The list proposed in T1-4 (LMT, NOC, RTX, GD, BA, LHX, LDOS, BAH, CACI, SAIC, PSN, KBR, MAXM, MANT, PLTR, KTOS, AVAV, plus parent of Elbit Systems of America).

**Deferral reason:** Operator-specific. May want a different default depending on capability area.

---

## Open Questions — sign-off received 2026-05-15

All seven OQ recommendations confirmed by operator. Locked positions:

- **OQ-1:** Backfill depth — USAspending 2 years, others 1 year. Per-source override available.
- **OQ-2:** Watchlists are per-workspace. Shared-watchlist-library deferred to post-8.5.
- **OQ-3:** Attachment storage — URLs only for Phase 8.5. Operator-flagged mirroring deferred.
- **OQ-4:** Single application-level API key per source for Phase 8.5. Per-tier sharding revisited at 15+ workspaces.
- **OQ-5:** Operator-pin-wins on conflicts. External feeds never overwrite operator-edited fields.
- **OQ-6:** Source Health view lives in the Brief surface.
- **OQ-7:** Default SEC EDGAR watchlist as listed above. Operator can edit per workspace.

---

# CROSS-REFERENCES

This sketch covers Tier 1 (5 sources). The research artifact's Tier 2 (15 sources) and Tier 3 (long-tail) require their own architecture sketches when Phase 9 or later integration phases begin. Key Tier 2 architecture work expected:

- **Phase 8.6 (proposed):** Tier 2 paid sources (Inside Defense subscription, GovWin if budget allows) — requires authenticated-fetch patterns not in Phase 8.5.
- **Phase 8.7 (proposed):** Tier 2 PDF-heavy sources (DoD Comptroller budget exhibits, DSB/DBB/DIB reports, RAND/CSIS analyses) — requires structured PDF parsing infrastructure.
- **Phase 8.8 (proposed):** Tier 2 conference exhibitor scrapes — annual schedule per conference; mostly low-frequency.

Appendix C of the research artifact (capability gaps) remains operator-input-only. The Posture Layer's `tells[]`, `byPursuit{}`, and `influenceReads` schemas already in place support this work; no schema changes needed.

---

## Maintenance principle

This document is the Phase 8.5 architecture target. As implementation surfaces real constraints, the document gets revised to v1.1, v1.2, etc., with change logs at the head. Once Phase 8.5 ships, the document becomes historical: future architecture sketches address subsequent integration phases.

---

*End of architecture sketch v1.0. Awaiting operator sign-off on Doctrine and Entity Model sections.*
