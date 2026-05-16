# CORSAIR PHASES 8.5.5–8.5.7 — SIGNAL-SOURCE INTEGRATIONS DEEP-DIVE

**Sources covered:** GAO Bid Protest (8.5.5) + SEC EDGAR (8.5.6) + Congress.gov (8.5.7)
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md), [`corsair-osint-architecture-v1.md`](corsair-osint-architecture-v1.md), [`corsair-osint-migration-v1.md`](corsair-osint-migration-v1.md), [`corsair-osint-award-integration-v1.md`](corsair-osint-award-integration-v1.md), [`corsair-osint-samgov-integration-v1.md`](corsair-osint-samgov-integration-v1.md), [`corsair-osint-functions-framework-v1.md`](corsair-osint-functions-framework-v1.md)
**Status:** Combined deep-dive for the three remaining Tier 1 sources. Treated together because they share a property: all three map exclusively to the existing Signal entity (no new top-level entity types). The per-source sections are correspondingly more focused than the SAM.gov or Award integration specs.

---

## Document Purpose

Three of the five Tier 1 sources produce Signals attached to existing entities (Person, Organization, Opportunity) rather than new top-level records. This makes their integration structurally simpler than 8.5.3 (which augments Opportunity reconciliation) or 8.5.4 (which introduces the Award entity). The simpler integration shape lets us combine the three specs into one document without sacrificing detail.

Each source section follows the same structure:
- What the source provides (intelligence content)
- API surface (endpoints, auth, rate limits)
- Signal entity shape (type-specific attrs)
- Schema mapping (source record → Signal)
- Special handling (source-specific quirks)
- Sub-phase sequencing
- Acceptance criteria
- Open implementation questions

Cross-source concerns (linkages between GAO and SAM.gov, EDGAR and Award entities, Congress.gov and Person trajectory) are covered in Part Four.

---

# PART ONE — GAO BID PROTEST (PHASE 8.5.5)

## What GAO Bid Protest provides

When a bidder loses a federal contract award, they may file a protest with the Government Accountability Office (GAO) challenging the agency's procurement decision. GAO publishes:
- **Protest filings** — daily-updated docket of new protests (protestor, awardee, agency, solicitation, status).
- **Decisions** — full-text written opinions when GAO rules on a protest (sustained, denied, dismissed, withdrawn, or settled).

For Corsair, this is high-signal intelligence:
- **Adversary intelligence** — when a tracked competitor protests an award, it tells the operator both that they lost and that they're aggressive about disputing.
- **Customer intelligence** — protest decisions reveal how an agency evaluated and what GAO found defensible.
- **Doctrine intelligence** — decision reasoning functions as quasi-doctrine for how the same agency will evaluate subsequent procurements.
- **Pursuit signal** — when an award the operator is tracking gets protested, the resulting reconsideration or corrective action affects the operator's own pursuit timing.

## API surface

GAO does not provide a formal API. The integration uses polite web scraping.

### Source URLs

```
Filings list:   https://www.gao.gov/legal/bid-protests/search
Decision page:  https://www.gao.gov/products/{decision-id}
Decision PDF:   https://www.gao.gov/assets/{decision-pdf-path}
```

### Auth

None required.

### Rate limits

No published limit. Corsair uses a polite 1 request per 2 seconds rate (configured in framework rate limiter as `capacity: 1, refillPerSecond: 0.5`).

### Scrape strategy

- **Filings list scrape (daily 9:00 AM ET):** Fetch the search page filtered to "filed in last 24 hours" → parse the HTML table → extract docket records.
- **Decision fetch (triggered):** When a tracked filing transitions to "decided" status, fetch the decision page → extract decision metadata → fetch decision PDF → extract text via `pdf-parse` library.
- **Status sweep (daily 10:00 AM ET):** For all tracked filings still in `pending` status, re-check status via individual decision page (status updates without new file generation).

### HTML structure

GAO's search results table rows have a consistent structure:
```html
<tr>
  <td><a href="/products/b-XXXXXX.X">B-XXXXXX.X</a></td>
  <td>Protestor Org Name</td>
  <td>Agency Name</td>
  <td>2026-05-10</td>      <!-- filed date -->
  <td>Pending</td>          <!-- status -->
  <td>{decision_date}</td>  <!-- empty if pending -->
</tr>
```

Decision pages have a structured header followed by the decision text:
```html
<header>
  <h1>Matter of: {Protestor}</h1>
  <p>File: B-XXXXXX.X</p>
  <p>Date: {decision date}</p>
</header>
<section class="decision-body">
  ... full decision text ...
</section>
```

Parsing tolerance: GAO occasionally updates its HTML structure. The parser logs warnings when expected selectors don't match and falls back to looser heuristics.

## Signal entity shape

GAO Bid Protest signals follow this structure:

```typescript
Signal {
  id:           string                              // 'sg_gao_' + docketNumber + suffix
  type:         'protest'
  subjectIds:   [protestorOrgId, awardeeOrgId?]
  relatedIds:   [solicitationOpportunityId?, agencyOrgId, awardId?]
  occurredAt:   timestamp                            // filing date
  attrs: {
    docketNumber:    string                          // 'B-XXXXXX.X'
    protestorName:   string                          // as filed (may differ from canonical Org name)
    protestorOrgId:  string                          // resolved Organization ID
    awardeeName:     string?
    awardeeOrgId:    string?
    agency:          string
    agencyOrgId:     string
    solicitationNum: string?
    status:          'pending' | 'decided' | 'dismissed' | 'withdrawn' | 'settled'
    filedAt:         timestamp
    decidedAt:       timestamp?
    outcome:         'sustained' | 'denied' | 'dismissed_partial' | 'dismissed_full' | 'withdrawn' | 'settled' | null
    decisionUrl:     string?
    decisionPdfUrl:  string?
    decisionTextHash: string?
    decisionTextStorage: string?                     // path in raw cache where extracted text lives
    correctiveAction: string?                        // text snippet describing agency action if any
    reconsiderationOf: string?                        // parent docket if this is a reconsideration
  }
  source: SourceProvenance
}
```

## Schema mapping

For each new filing:
1. Extract docket number, protestor name, agency, solicitation number (if present), filed date, status.
2. Resolve protestor name → existing Organization (or queue for review per framework's resolver).
3. Resolve agency name → existing government Organization (or auto-create).
4. If solicitation number resolves to a tracked Opportunity, add to `relatedIds`.
5. Create Signal with `status: 'pending'` and emit to Brief surface.

For each decision:
1. Fetch decision page; extract decided date, outcome, awardee (if not already known).
2. Fetch decision PDF; extract text; store in raw cache.
3. Compute hash; store on Signal.
4. Parse decision for corrective action language (regex on common patterns: "the agency will take corrective action," "the agency has agreed to," etc.).
5. Update Signal with `status: 'decided'`, outcome, decision URLs, text hash.
6. Emit Signal `signal_updated` to Brief surface.

## Special handling

### Reconsideration filings

GAO docket numbers use `.X` suffixes for reconsiderations (e.g., `B-420123.1` reconsiders `B-420123`). The parser detects `.1`, `.2`, `.3` suffixes and:
- Creates the new Signal with normal handling.
- Sets `attrs.reconsiderationOf` to the parent docket.
- Links via `relatedIds` to the parent Signal.

### Settled protests

Settled protests do not publish decision text. The Signal records `status: 'settled'` and `outcome: 'settled'` but `decisionUrl` and `decisionTextHash` remain null. Brief surface shows settlement notice without expecting decision content.

### Corrective action without formal decision

Agencies sometimes take corrective action that resolves a protest without GAO ruling. The protest is then dismissed (`status: 'dismissed'`, `outcome: 'dismissed_full'`) and corrective action text may be extracted from the docket entry rather than a decision PDF. The framework's parser handles both cases.

### Multi-protestor protests

A single docket may have multiple protestors challenging the same award. Each protestor is a separate `subjectIds[0]` entry in a single Signal, not multiple Signals. The Signal renders in the Brief as "N protestors filed against award X."

### Cross-reference to Court of Federal Claims (COFC)

Some protests are filed at COFC rather than GAO (or after GAO). COFC protests are not in GAO's docket. For Phase 8.5.5, only GAO is integrated. COFC is a future-tier consideration via PACER (which has its own access and cost model).

## Cross-source linkage

When a Signal's `attrs.solicitationNum` matches an existing Opportunity's `solicitationNumber` (from 8.5.3 SAM.gov data), the framework links automatically. Operator sees the protest associated with the Opportunity in both Brief and Inspector.

When a Signal's awardee resolves to an Organization that's the prime on an existing Award (from 8.5.4), link to that Award via `relatedIds`.

## Sub-phase sequencing for 8.5.5

| Sub-phase | Description | Days | Cumulative |
|---|---|---|---|
| 8.5.5.1 | GAO HTML scraper + parser | 3-4 | 3-4 |
| 8.5.5.2 | Decision PDF extraction | 2-3 | 5-7 |
| 8.5.5.3 | Signal mapping + Organization resolution | 2-3 | 7-10 |
| 8.5.5.4 | Status sweep + decision detection | 2 | 9-12 |
| 8.5.5.5 | Cross-source linkage (SAM.gov, Award) | 1-2 | 10-14 |
| 8.5.5.6 | Brief surface integration | 1-2 | 11-16 |

**Total Phase 8.5.5 estimate: 11-16 operator-days (~2-3 operator-weeks).**

## Acceptance criteria for 8.5.5

1. Daily filings scrape captures all new protests for the day with parse confidence > 0.90.
2. Decision text extracted accurately for ≥95% of issued decisions (sampling 20 decisions).
3. Signal records correctly link to existing Opportunities when solicitation numbers match.
4. Signal records correctly link to existing Awards when awardee Organizations match.
5. Reconsideration chains correctly tracked via `attrs.reconsiderationOf`.
6. Operator sees new protests in the Brief surface within 24 hours of GAO posting.
7. Operator can drill from a Signal to read full decision text.

## Open implementation questions for 8.5.5

### GIQ-1 — HTML structure change handling

GAO's site occasionally updates. When the scraper's expected selectors don't match:
- Log warning with `event: 'parser_fallback'`.
- Attempt looser heuristic parsing.
- If looser parsing also fails, emit Signal with `attrs.parseConfidence: 'low'` and queue raw HTML for manual review.

**Recommendation:** Confirm fallback + manual review pattern.

### GIQ-2 — Decision PDF storage

Per OQ-3 (URLs only): decision PDFs are referenced by URL but text is extracted and stored in raw cache. Operator can download PDF on click for reading the original.

**Recommendation:** Confirm.

### GIQ-3 — Settled-protest signal frequency

Settled protests are intelligence-rich (the agency conceded something) but lack public detail. Should Corsair surface every settlement to Brief, or only when settlement affects an Opportunity in operator's workspace?

**Proposal:** Surface to Brief only when associated with a tracked Opportunity or Award. Otherwise, store Signal silently for future cross-reference.

**Recommendation:** Confirm.

---

# PART TWO — SEC EDGAR (PHASE 8.5.6)

## What SEC EDGAR provides

The SEC's EDGAR system is the canonical filing repository for publicly traded U.S. companies. For Corsair, the relevant filings are:
- **8-K** (material events) — contract wins, leadership changes, litigation, material contract awards
- **10-K / 10-Q** (annual / quarterly reports) — defense segment performance, backlog data, risk factors mentioning specific programs
- **Form 4** (insider transactions) — executive officer and director equity transactions
- **DEF 14A** (proxy statements) — director/officer rosters, compensation, governance

Defense-relevant filers for the default watchlist (per OQ-7 confirmed): LMT, NOC, RTX, GD, BA, LHX, LDOS, BAH, CACI, SAIC, PSN, KBR, MAXM, MANT, PLTR, KTOS, AVAV, plus parent of Elbit Systems of America.

## API surface

EDGAR provides JSON endpoints under `data.sec.gov` and structured web pages under `sec.gov`.

### Endpoints

```
Submission history:  GET https://data.sec.gov/submissions/CIK{cik-zero-padded}.json
Full-text search:    GET https://efts.sec.gov/LATEST/search-index?q=&forms=&dateRange=
Filing index:        GET https://www.sec.gov/Archives/edgar/data/{cik}/{accession-no-dashes}/index.json
Filing document:     GET https://www.sec.gov/Archives/edgar/data/{cik}/{accession-no-dashes}/{filename}
Daily index:         GET https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{n}/master.idx
```

### Auth

No API key. **Mandatory User-Agent header** identifying Corsair with contact email:
```
User-Agent: Corsair Defense BD Intel mpoppa32@gmail.com
```

Missing or invalid User-Agent → IP ban risk.

### Rate limits

**Strict 10 requests/second.** Burst higher and SEC's fair-access systems will throttle or ban the IP.

Framework rate limiter configuration:
```typescript
sec_edgar: { capacity: 10, refillPerSecond: 10 }
```

Retry on 429 uses long backoffs (30s, 60s, 120s, 300s, 600s) per the framework spec for SEC.

### Submission history endpoint shape

`GET https://data.sec.gov/submissions/CIK0000936468.json` (Lockheed Martin):
```json
{
  "cik": "936468",
  "entityType": "operating",
  "sic": "3812",
  "sicDescription": "Search, Detection, Navigation, Guidance, Aeronautics Svcs",
  "name": "LOCKHEED MARTIN CORP",
  "tickers": ["LMT"],
  "exchanges": ["NYSE"],
  "filings": {
    "recent": {
      "accessionNumber": ["0000936468-26-000034", ...],
      "filingDate": ["2026-05-01", ...],
      "reportDate": ["2026-03-31", ...],
      "acceptanceDateTime": ["2026-05-01T16:30:21.000Z", ...],
      "form": ["10-Q", "8-K", "4", ...],
      "items": ["", "1.01,2.02,9.01", "", ...],
      "primaryDocument": ["lmt-20260331.htm", "lmt-8k-20260415.htm", ...]
    }
  }
}
```

Each filing's accession number is the primary key. Items field lists 8-K sub-items (e.g., `1.01` = Material Contract, `2.02` = Earnings Release).

## Signal entity shapes (per filing type)

### 8-K (Material Event)

```typescript
Signal {
  type: 'material_event'
  subjectIds: [filerOrgId]                    // resolved from CIK
  occurredAt: timestamp                        // filing date
  attrs: {
    cik:              string
    ticker:           string?
    accessionNumber:  string
    formType:         '8-K'
    items:            [string]                 // ['1.01', '2.02', ...]
    itemDescriptions: [string]                 // human-readable: ['Material Contract', 'Earnings Release']
    summary:          string                    // first paragraph or earnings highlight extracted
    documentUrl:      string
    filedAt:          timestamp
  }
}
```

### 10-K / 10-Q (Periodic Report)

```typescript
Signal {
  type: 'periodic_report'
  subjectIds: [filerOrgId]
  occurredAt: timestamp                         // filing date
  attrs: {
    cik:                  string
    ticker:               string?
    accessionNumber:      string
    formType:             '10-K' | '10-Q'
    reportDate:           timestamp             // period end
    documentUrl:          string
    extractedSections: {
      mdaSnippet:         string                 // Management's Discussion & Analysis first 2KB
      riskFactorsSnippet: string                 // Risk Factors section excerpt
      defenseSegment:     string?                // segment commentary referencing defense programs
      backlogTotal:       number?                // total backlog if extractable
      backlogDefense:     number?                // defense-segment backlog if reported separately
    }
    earningsCallTranscriptUrl: string?          // when available; sources vary
  }
}
```

### Form 4 (Insider Transaction)

```typescript
Signal {
  type: 'insider_transaction'
  subjectIds: [insiderPersonId, filerOrgId]
  occurredAt: timestamp                         // transaction date
  attrs: {
    cik:               string                   // issuer
    insiderCik:        string                   // person's reporting CIK
    insiderName:       string
    insiderTitle:      string                   // 'CEO', 'Director', 'CFO', etc.
    transactionCode:   string                   // 'P' (purchase), 'S' (sale), 'A' (grant), 'M' (option exercise), etc.
    transactionType:   string                   // human-readable
    shares:            number
    pricePerShare:     number?
    totalValue:        number?
    sharesOwnedAfter:  number?
    documentUrl:       string
  }
}
```

### DEF 14A (Proxy Statement)

```typescript
Signal {
  type: 'proxy_statement'
  subjectIds: [filerOrgId]
  occurredAt: timestamp
  attrs: {
    cik:               string
    accessionNumber:   string
    documentUrl:       string
    extractedRosters: {
      directors:       [{ name, age, since, committees, compensation? }]
      executiveOfficers: [{ name, age, title, compensation? }]
    }
  }
}
```

## Schema mapping logic

For each watchlist CIK, every 5 minutes:
1. Fetch `submissions/CIK{cik}.json`.
2. Compare against last-fetched accession numbers.
3. For new filings (since last fetch):
   - Determine form type.
   - Fetch primary document.
   - Run form-specific extractor.
   - Create Signal with appropriate type.
   - For Form 4: resolve insider Person (create if not exists with `source.system: 'sec_edgar'`).
4. Emit Signal updates to Brief.

## Special handling

### 8-K Item parsing

8-K filings list which items they cover via the `items` field. Common defense-relevant items:
- **1.01** — Entry into Material Definitive Agreement (often contract wins)
- **2.02** — Results of Operations (earnings)
- **5.02** — Departure/Appointment of Officers
- **7.01** — Regulation FD Disclosure (often news releases)
- **8.01** — Other Events (catch-all, sometimes program announcements)

Corsair tags Signals with the items array. Brief surface filters allow operator to see only specific item types.

### 10-K narrative extraction

10-K filings are 100-500-page documents. Extraction targets specific sections:
- Item 1 (Business) — segment descriptions
- Item 1A (Risk Factors) — program-specific risks
- Item 7 (MD&A) — operational discussion
- Item 7A (Quantitative/Qualitative Disclosures) — market risk

The extraction uses regex anchored on standard section headers. When extraction confidence is low (sections not found in expected format), the full filing URL is stored and the operator can read the original.

### Earnings call transcripts

SEC EDGAR does not host earnings call transcripts directly. However:
- Quarterly earnings press releases (8-K item 2.02) often link to transcript or supplemental materials.
- Many companies post transcripts on their investor relations websites.
- Third-party services (Seeking Alpha, Bloomberg) host transcripts but require subscription.

For Phase 8.5.6, Corsair links to the earnings press release. Transcript ingestion is a future-tier enhancement (likely Tier 3 with a paid source like Bloomberg).

### Form 4 person resolution

Form 4 names insiders. Insider resolution:
- Exact name match against existing Person records in workspace.
- Fuzzy match (Jaro-Winkler > 0.92) → match.
- No match → create new Person with `source.system: 'sec_edgar'` and attrs noting the insider role.

Insider Persons may already exist in workspace (CEO of a major prime is likely already a Person record). When match succeeds, Form 4 Signals link to existing Person. Operator's Posture-Layer observations on that Person enrich automatically.

### Subsidiary filers

Defense contractors with multiple SEC-registered subsidiaries (rare) may file as separate CIKs. Corsair stores parent-subsidiary relationships in Organization records. Filings from any subsidiary link to the parent Organization's Posture-Layer view.

## Cross-source linkage

When an 8-K item 1.01 (Material Contract) references a specific PIID or solicitation number (extractable from the filing text), Corsair links the Signal to the corresponding Award (8.5.4) or Opportunity (8.5.3).

When a 10-K mentions a specific program (e.g., "F-35"), the framework's program-name resolver can link the Signal to the program Organization (with `type: 'program'`).

## Sub-phase sequencing for 8.5.6

| Sub-phase | Description | Days | Cumulative |
|---|---|---|---|
| 8.5.6.1 | EDGAR client + watchlist config | 3-4 | 3-4 |
| 8.5.6.2 | 8-K extraction | 2-3 | 5-7 |
| 8.5.6.3 | 10-K / 10-Q extraction | 4-5 | 9-12 |
| 8.5.6.4 | Form 4 + insider Person resolution | 2-3 | 11-15 |
| 8.5.6.5 | DEF 14A + roster updates | 2-3 | 13-18 |
| 8.5.6.6 | Cross-source linkage + Brief integration | 2-3 | 15-21 |

**Total Phase 8.5.6 estimate: 15-21 operator-days (~3-4 operator-weeks).**

## Acceptance criteria for 8.5.6

1. 5-minute polling for watchlist CIKs runs without rate-limit errors (no 429s).
2. User-Agent header correctly included on every request; no SEC ban-risk warnings.
3. 8-K filings produce Signals with correct item parsing within 10 minutes of filing.
4. 10-K narrative sections extracted with > 80% success rate (anchor-based; failures fallback to raw URL).
5. Form 4 filings produce Signals with correct insider resolution (Person matched or created).
6. DEF 14A filings update roster information on filer Organizations.
7. Brief surface shows new filings within 15 minutes of submission.
8. Filings cross-linked to Awards/Opportunities when PIID/solicitation extractable.

## Open implementation questions for 8.5.6

### EIQ-1 — Earnings transcript sourcing

Free transcript sourcing is unreliable. Paid sources (Bloomberg, Seeking Alpha) require subscription.

**Proposal:** Phase 8.5.6 ships without transcript ingestion. Add transcript-source integration in Phase 9+ when budget allows.

**Recommendation:** Confirm.

### EIQ-2 — 10-K full-text storage

10-K full text is 500KB-2MB. Storing in RTDB is expensive.

**Proposal:** Store extracted sections in Signal `attrs.extractedSections`. Full text accessed via URL on operator click. No mirroring.

**Recommendation:** Confirm per OQ-3 pattern.

### EIQ-3 — Form 4 noise

Some executives have many Form 4 filings per year (stock option exercises, ESPP purchases). High noise.

**Proposal:** Brief surface filters Form 4 by:
- Insider title (only C-suite and directors by default)
- Transaction code (only sales > $1M by default)
- Operator can adjust per workspace.

**Recommendation:** Confirm filter defaults.

### EIQ-4 — Foreign private issuers (20-F filers)

Some defense suppliers are foreign filers using Form 20-F (e.g., BAE Systems via parent). Different form structure.

**Proposal:** Phase 8.5.6 covers 10-K/Q/8-K/4/DEF 14A only. 20-F is Phase 9+.

**Recommendation:** Confirm.

### EIQ-5 — CIK watchlist propagation

When operator adds a CIK to watchlist mid-phase, should historical filings backfill?

**Proposal:** Yes. New CIK watchlist additions trigger a one-time backfill of last 12 months of filings.

**Recommendation:** Confirm 12-month backfill on watchlist add.

---

# PART THREE — CONGRESS.GOV (PHASE 8.5.7)

## What Congress.gov provides

Congress.gov is the official Library of Congress site exposing congressional data via a well-documented API. For Corsair, the relevant data:
- **Committee hearings** — including witness lists, hearing materials, transcripts (when available).
- **Bills** — defense-relevant legislation (NDAAs, supplementals, defense appropriations).
- **Nominations** — Senate-confirmed DoD political appointees.
- **Member roster** — current congressional members with committee assignments.
- **Committee membership** — who sits on which defense committees.

This is the deepest cross-entity source — Congress.gov touches Persons (members, witnesses, nominees), Organizations (committees, agencies), and Edges (position_held, member_of, testimony_at).

## API surface

Well-documented REST API at `api.congress.gov`. Registration at api.congress.gov for free API key.

### Endpoints

```
GET /v3/committee/{chamber}/{committeeCode}             (committee detail)
GET /v3/committee/{chamber}/{committeeCode}/meeting     (committee meetings/hearings)
GET /v3/hearing/{congress}/{chamber}/{number}           (hearing detail with witnesses)
GET /v3/nomination/{congress}/{number}                  (nomination detail)
GET /v3/nomination/{congress}/{number}/committee        (nomination committee referrals)
GET /v3/nomination/{congress}/{number}/action           (nomination status timeline)
GET /v3/member                                          (current members)
GET /v3/member/{bioguideId}                             (member detail)
GET /v3/bill/{congress}/{billType}/{billNumber}         (bill detail)
GET /v3/bill/{congress}/{billType}/{billNumber}/actions (bill action history)
```

### Auth

API key via header `X-Api-Key: <key>` or query param `?api_key=<key>`.

### Rate limits

**5000 requests/hour.** Generous. Framework rate limiter:
```typescript
congress_gov: { capacity: 5, refillPerSecond: 1.389, dailyBudget: 5000 }
```

### Response shape examples

**Hearing detail:**
```json
{
  "hearing": {
    "chamber": "House",
    "committee": { "name": "Armed Services", "systemCode": "hsas00" },
    "congress": 119,
    "dates": [{ "date": "2026-05-12" }],
    "title": "Department of Defense Fiscal Year 2027 Budget Request",
    "number": "37",
    "url": "https://api.congress.gov/v3/hearing/119/house/37",
    "witnesses": [
      {
        "name": "Hon. Frank Kendall",
        "title": "Secretary of the Air Force",
        "organization": "Department of the Air Force"
      },
      {
        "name": "Gen. David Allvin",
        "title": "Chief of Staff",
        "organization": "United States Air Force"
      }
    ],
    "transcriptUrl": null,
    "documents": [
      { "type": "Witness Statement", "url": "..." }
    ]
  }
}
```

**Nomination detail:**
```json
{
  "nomination": {
    "congress": 119,
    "number": 234,
    "nominees": [{
      "ordinal": 1,
      "firstName": "Jane",
      "lastName": "Doe",
      "fullName": "Jane Doe",
      "position": "to be Under Secretary of Defense for Acquisition and Sustainment"
    }],
    "organization": "Department of Defense",
    "receivedDate": "2026-04-15",
    "committees": { "url": "https://api.congress.gov/v3/nomination/119/234/committee" },
    "latestAction": {
      "actionDate": "2026-05-08",
      "text": "Reported to the Senate by Senator Reed, Committee on Armed Services, without printed report."
    },
    "isPrivileged": false,
    "isCivilian": false
  }
}
```

## Signal entity shapes

### Hearing

```typescript
Signal {
  type: 'congressional_hearing'
  subjectIds: [committeeOrgId]
  relatedIds: [witnessPersonIds...]
  occurredAt: timestamp                          // hearing date
  attrs: {
    congress:        number
    chamber:         'house' | 'senate' | 'joint'
    committeeCode:   string
    committeeName:   string
    title:           string
    hearingNumber:   string
    witnesses: [
      {
        name:         string
        title:        string
        organization: string?
        personId:     string?              // resolved Person
        bioguideId:   string?              // if congressional member
        statementUrl: string?
      }
    ]
    transcriptUrl:   string?
    documentUrls:    [string]
    bills:           [billId]              // related bills mentioned
  }
}
```

### Nomination

```typescript
Signal {
  type: 'nomination'
  subjectIds: [nomineePersonId]
  relatedIds: [targetOrgId, committeeOrgId]
  occurredAt: timestamp                          // received date
  attrs: {
    congress:          number
    nominationNumber:  number
    nomineeName:       string
    position:          string
    targetOrgName:     string                 // 'Department of Defense' / etc.
    receivedAt:        timestamp
    committeeName:     string?
    confirmedAt:       timestamp?
    confirmationVote: { yea, nay, present }?
    status:            'pending' | 'confirmed' | 'returned' | 'withdrawn'
    isCivilian:        boolean
    isPrivileged:      boolean
    actionTimeline:    [{ actionDate, text }]
  }
}
```

### Bill action (defense-relevant)

```typescript
Signal {
  type: 'congressional_bill_action'
  subjectIds: [primarySponsorPersonId]
  relatedIds: [committeeOrgIds, cosponsorPersonIds]
  occurredAt: timestamp                          // latest action date
  attrs: {
    congress:        number
    billType:        string                     // 'hr' | 's' | 'hjres' | 'sjres'
    billNumber:      number
    title:           string
    actionType:      string                     // 'introduced' | 'reported' | 'passed' | 'vetoed' | etc.
    chamberAction:   string?
    sponsorPersonId: string
    sponsorParty:    string
    sponsorState:    string
    cosponsorCount:  number
    bipartisan:      boolean
    relatedTopics:   [string]                   // extracted from bill summary
    fullTextUrl:     string
  }
}
```

## Schema mapping logic

### Daily hearing sync

For each watchlist committee (from workspace config; defaults to HSAS, SASC, HAC-D, SAC-D, HPSCI, SSCI):
1. Fetch upcoming hearings for next 14 days.
2. Fetch recent past hearings for last 7 days.
3. For each new hearing:
   - Resolve committee Organization (create with `type: 'committee'` if needed).
   - For each witness:
     - Resolve to existing Person (create with `source.system: 'congress_gov'` if needed).
     - Resolve witness's organization to Corsair Organization.
     - Create `testimony_at` Edge: Person → committee Organization, with `start: hearingDate`, `attrs: { hearingTitle, hearingId, witnessTitle }`.
   - Create Signal.
4. Emit Brief updates.

### Daily nomination sync

For nominations referred to defense committees:
1. Fetch nominations received in last 7 days for SASC/HSAS (House doesn't confirm but tracks DoD nominees in committee oversight).
2. For each nomination:
   - Resolve nominee Person.
   - Resolve target Organization (e.g., DoD).
   - Create Signal with `status: 'pending'`.
3. For each previously-tracked nomination:
   - Check `actionTimeline` for status changes.
   - If confirmed: update Signal `status: 'confirmed'`, create `position_held` Edge (Person → targetOrg, `start: confirmedDate`, `attrs: { role: position, billet: ... }`).
   - If returned/withdrawn: update Signal status.
4. Emit updates.

### Weekly bill sync

For defense-relevant bills (NDAA, defense appropriations, supplementals, identified by committee referrals to defense committees):
1. Fetch bill action history.
2. For new actions (introduction, committee report, floor vote, conference report, signing):
   - Resolve sponsor Person.
   - Create Signal with action type.
3. Emit updates.

### Quarterly member roster refresh

For each committee in watchlist:
1. Fetch current membership.
2. Compare against stored membership.
3. Add new `member_of` Edges (Person → committee Organization).
4. Mark departed members' edges with `end: now`.

### Member detail enrichment

When a Person is created or referenced from Congress.gov:
1. Fetch member detail by Bioguide ID (if congressional member).
2. Populate Person attrs: party, state, district, served-from date, prior positions, education, military service (if recorded).
3. Update `source.system: 'congress_gov'`.

## Special handling

### Witness name resolution

Witnesses are listed with display names that include titles: "Hon. Frank Kendall," "Gen. David Allvin," etc. The resolver strips titles before fuzzy matching:
- Strip prefixes: "Hon.", "Gen.", "Adm.", "Lt. Gen.", "Maj. Gen.", "Brig. Gen.", "VAdm.", "RAdm.", "Capt.", "Lt. Col.", etc.
- Strip suffixes: "USAF (Ret.)", "USA (Ret.)", "Jr.", "III", etc.
- Fuzzy-match the cleaned name against existing Persons.

The original display name is preserved in Signal `attrs.witnesses[].name`.

### Joint hearings

Joint hearings (e.g., HSAS subcommittee with SASC subcommittee) appear in both chambers' hearing lists. The Signal records both committees in `subjectIds`. Deduplication by hearing title + date prevents duplicate Signals.

### Closed hearings

Some defense hearings are closed (classified). They appear in Congress.gov with limited public information (date, committee, often no witness list). Signal records what's available; operator notes "closed hearing" in the Signal text.

### QFRs (Questions for the Record)

Witness testimony often produces QFRs answered weeks after the hearing. Congress.gov sometimes hosts QFRs, sometimes only the agency does. Phase 8.5.7 captures QFRs when present at Congress.gov as additional documents on the existing hearing Signal.

### Multi-nominee nominations

A single nomination number may include multiple nominees (e.g., promotion lists for general officers). Each nominee is a separate `subjectIds[0]` entry. Multiple Persons may be created from one nomination.

### Privileged nominations (military)

`isPrivileged: true` indicates military promotions handled via en bloc voting. These are high-volume (hundreds at a time) and lower per-nominee signal. Default workspace config excludes privileged nominations from Brief surfacing (they go to a secondary "Promotions" view).

## Cross-source linkage

When a hearing's title mentions a specific program (e.g., "Sentinel ICBM Program Update"), the framework's program-name resolver links the Signal to the program Organization (with `type: 'program'`).

When a nomination confirms and creates a `position_held` Edge, the new appointee's name becoming visible in agency leadership rosters (via Plum Book Tier 2 source, future phase) is automatically detected.

When a bill (e.g., the NDAA) names specific programs in its text, future-phase enhancement may auto-link. For Phase 8.5.7, links are operator-driven.

## Sub-phase sequencing for 8.5.7

| Sub-phase | Description | Days | Cumulative |
|---|---|---|---|
| 8.5.7.1 | Congress.gov API client + watchlist config | 2-3 | 2-3 |
| 8.5.7.2 | Hearing sync + witness Person resolution | 3-4 | 5-7 |
| 8.5.7.3 | Nomination sync + position_held Edge | 3-4 | 8-11 |
| 8.5.7.4 | Bill action sync (defense-relevant bills) | 2-3 | 10-14 |
| 8.5.7.5 | Member roster + committee membership | 2-3 | 12-17 |
| 8.5.7.6 | Person attribute enrichment | 1-2 | 13-19 |
| 8.5.7.7 | Brief surface integration | 2-3 | 15-22 |

**Total Phase 8.5.7 estimate: 15-22 operator-days (~3-4 operator-weeks).**

## Acceptance criteria for 8.5.7

1. Daily hearing sync runs without rate-limit errors.
2. New hearings produce Signals with witness Persons resolved correctly (≥90% accuracy).
3. Nominations produce Signals with status transitions correctly tracked.
4. Confirmed nominations create `position_held` Edges with correct attrs.
5. Defense bill actions produce Signals for tracked bills.
6. Committee membership rosters refresh quarterly without manual intervention.
7. Person attributes (party, state, military service) populate when available.
8. Brief surface shows defense committee activity within 24 hours.
9. Closed hearings recorded with appropriate limited-data flags.

## Open implementation questions for 8.5.7

### CIQ-1 — Witness organization resolution

Some witnesses represent organizations not yet in workspace (e.g., a think tank witness from CSIS). Should Corsair auto-create the Organization?

**Proposal:** Yes, with `type: 'trade_assoc'` (for advocacy organizations) or `type: 'university'` (for academic) or `type: 'ffrdc'` / `type: 'other'`. Auto-creation marked `autoCreated: true` for operator review.

**Recommendation:** Confirm.

### CIQ-2 — Privileged nomination handling

Military en bloc promotion lists are noisy. Default exclusion from Brief?

**Proposal:** Yes by default; operator can opt in per workspace.

**Recommendation:** Confirm.

### CIQ-3 — Bill text searching

For NDAA-type bills (often >1000 pages), should Corsair extract program-specific mentions?

**Proposal:** Phase 8.5.7 stores bill metadata and links. Full-text program extraction is Phase 9+ (requires NLP for entity extraction at scale).

**Recommendation:** Confirm.

### CIQ-4 — Historical hearing backfill

When workspace first activates Congress.gov sync, how far back to backfill?

**Proposal:** 6 months backfill (per OQ-1 with adjustment — hearings are less time-sensitive than awards).

**Recommendation:** Confirm 6-month backfill.

### CIQ-5 — Member detail vs. on-demand fetch

Member roster is large (~535 currently sitting members). Fetching all member details preemptively is wasteful.

**Proposal:** Fetch member detail on first reference (when a member appears as hearing witness, bill sponsor, or committee member). Cache for 30 days.

**Recommendation:** Confirm on-demand pattern.

---

# PART FOUR — CROSS-SOURCE LINKAGE NOTES

The three Signal sources interconnect with each other and with the entity sources (SAM.gov 8.5.3, USAspending 8.5.4).

## Linkage map

```
┌─────────────────────┐
│  SAM.gov (8.5.3)    │
│  Opportunity        │◄────────────────┐
└─────────────────────┘                 │
        │                                │
        │ awarded_via                    │ protested_via
        ▼                                │
┌─────────────────────┐                 │
│  USAspending (8.5.4)│                 │
│  Award              │◄────────────────┤
└─────────────────────┘                 │
        │                                │
        │ recipient_is                   │
        ▼                                │
┌─────────────────────┐                 │
│  Organization       │                 │
│  (prime contractor) │                 │
└─────────────────────┘                 │
        │  ▲                             │
        │  │                             │
        │  │ executive_of                │
        │  │                             │
        │  ▼                             │
┌─────────────────────┐                 │
│  Person             │                 │
└─────────────────────┘                 │
        ▲                                │
        │                                │
   ┌────┴───────────┐                    │
   │ position_held  │                    │
   │ testimony_at   │                    │
   │ member_of      │                    │
   └────────────────┘                    │
        │                                │
        │ Created by                     │
        ▼                                │
┌─────────────────────┐                 │
│  Congress.gov (8.5.7)│                │
│  Signals + Edges    │                 │
└─────────────────────┘                 │
                                         │
                                         │
                            ┌────────────┴────────┐
                            │  GAO Protest (8.5.5) │
                            │  Signals             │
                            └─────────────────────┘

                            ┌─────────────────────┐
                            │  SEC EDGAR (8.5.6)  │
                            │  Signals + Person   │
                            └─────────────────────┘
```

## Specific linkage patterns

### GAO ↔ SAM.gov
- GAO docket cites a solicitation number.
- If that solicitation number matches a SAM.gov-tracked Opportunity, link Signal `relatedIds` to Opportunity.

### GAO ↔ USAspending
- GAO docket names a protested awardee.
- If awardee resolves to an Organization, and that Organization has an Award entity with matching PIID context, link Signal `relatedIds` to Award.

### SEC EDGAR ↔ USAspending
- 8-K item 1.01 (material contract) often mentions PIID or contract title.
- If PIID extractable, link Signal `relatedIds` to Award.

### SEC EDGAR ↔ Congress.gov
- An SEC filer's CEO testifies before a defense committee.
- Filer Organization's executives are tracked via DEF 14A.
- When that executive appears as Congress.gov witness, the witness resolution matches the executive Person, and `testimony_at` Edge attaches.

### Congress.gov ↔ all
- A confirmed appointee (Congress.gov) becomes the holder of a `position_held` Edge.
- That same Person may later issue 8-Ks (if they go to industry post-government) → SEC EDGAR linkage.
- That same Person may appear as customer in SAM.gov solicitations → Opportunity linkage via customer Person.

## Implementation note

Cross-source linkage logic lives in `functions/src/framework/crossSourceLinker.ts` and is invoked after each source's sync completes. It does not run on every record write (too expensive); it runs as a follow-up pass that re-evaluates recent records for newly possible matches.

Phase 8.5.5-8.5.7 ship with basic linkage (PIID matching, solicitation number matching). Deeper linkage (program name extraction, person executive-to-witness matching) is a follow-on Phase 8.5.8 concern.

---

# PART FIVE — COMBINED ACCEPTANCE CRITERIA

Phase 8.5.5, 8.5.6, 8.5.7 are each independently shippable when their respective per-source criteria are met. Combined acceptance for the Signal-source set:

1. All three sources running successfully on the operator's test workspace for 7 consecutive days.
2. All three sources reflected in the Source Health view with correct status.
3. Cross-source linkages working: a GAO protest references a SAM.gov solicitation → linked; an 8-K cites a PIID → linked to USAspending Award; a Congress.gov witness matches an SEC EDGAR-tracked executive → linked.
4. Brief surface shows entries from all three sources in a unified daily intelligence feed.
5. No Doctrine §VI violations: only public data ingested; no scraping of private information; no surveillance of individuals beyond their public roles.

---

# PART SIX — COMBINED OPEN IMPLEMENTATION QUESTIONS

Cross-source questions not specific to any one of the three.

### SIQ-1 — Signal entity volume and archive

Across three sources, a workspace may accumulate thousands of Signals per year. Long-term:
- Phase 8.5: retain indefinitely.
- Phase 9+: archive Signals older than 3 years to `signals_archive/`.

**Recommendation:** Confirm indefinite retention for Phase 8.5.

### SIQ-2 — Brief surface volume management

If all three Signal sources surface to Brief, daily volume could be 20-100 items. Filtering and prioritization matters.

**Proposal:** Default Brief filter:
- Top 5 GAO protests affecting tracked Awards/Opportunities.
- Top 5 SEC filings from watchlist CIKs with item filters (1.01, 5.02 for 8-K; sales > $1M for Form 4).
- Top 5 defense committee hearings and nominations.
- Operator can expand each category to full view.

**Recommendation:** Confirm tiered Brief layout.

### SIQ-3 — Cross-source linker invocation cadence

How often does the cross-source linker re-evaluate records?

**Proposal:** Daily at 11pm ET after all source syncs complete. Runs against records modified in last 7 days.

**Recommendation:** Confirm daily 11pm cadence.

### SIQ-4 — Person entity proliferation

Three Signal sources all create Person records on first reference. Without careful resolution, Person count grows fast.

**Mitigation:**
- Strong name normalization (titles, suffixes stripped).
- Fuzzy match against existing before create.
- Operator-review queue for ambiguous creates.
- Auto-created Persons flagged `autoCreated: true` for periodic operator review.

**Recommendation:** Confirm mitigations.

### SIQ-5 — Operator workspace exclusion

Some operators may not want SEC EDGAR sync (e.g., if their work is all private-side). Per-source enable/disable per workspace.

**Proposal:** Source enable/disable in workspace settings. Default: all sources enabled. Operator can disable specific sources without affecting others.

**Recommendation:** Confirm per-source enable/disable.

---

# CLOSING NOTES

## Why these three combine well

GAO, SEC EDGAR, and Congress.gov are the three Tier 1 sources that contribute Signals (time-ordered events) rather than primary entities (Opportunities or Awards). They round out the operator's intelligence picture — protests challenge the awards SAM.gov posts and USAspending records; executive moves reshape the Organizations involved; congressional testimony reveals the political terrain the Posture Layer maps.

The Signal-source set takes the operator's awareness from "what's available to bid on" (8.5.3) and "what was awarded to whom" (8.5.4) to "what is being challenged" (8.5.5), "what is being publicly disclosed" (8.5.6), and "what is being publicly stated" (8.5.7).

After 8.5.5/6/7 ship, Corsair has substantially complete external listening across the public-facing defense procurement ecosystem.

## Implementation order recommendation

8.5.5 (GAO) first: highest operator-impact per dollar; smallest scope; cleanest data shape.
8.5.6 (SEC EDGAR) second: medium scope; requires careful rate-limit discipline.
8.5.7 (Congress.gov) third: largest scope (touches three entity types); most cross-source linkage value.

Each can be developed in parallel by separate developers if available. Sequential development per the architecture sketch's estimate is sufficient otherwise.

## Cross-references

- Award integration (8.5.4) for PIID-based linkage patterns.
- SAM.gov integration (8.5.3) for solicitation-number-based linkage.
- Framework spec (8.5.2) for Signal entity write patterns and Person/Organization resolution helpers.
- Migration design (8.5.1) for entity model dependencies — these sources all assume E-2 (committee/lobby_firm/university/ffrdc subtypes available) and E-3 (Edge schema extension for start/end/attrs).

## Maintenance principle

This document is v1.0. As each sub-phase ships, the per-source section gets revised with real-world findings. Cross-source linkage section evolves as linkage logic matures.

---

*End of Signal-source integrations deep-dive v1.0. Awaiting parallel build session implementation across Phases 8.5.5, 8.5.6, 8.5.7.*
