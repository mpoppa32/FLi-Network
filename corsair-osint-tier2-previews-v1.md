# CORSAIR PHASE 8.6+ — TIER 2 SOURCE INTEGRATION PREVIEWS

**Scope:** Capsule specs for the 15 Tier 2 sources that come after Phase 8.5 ships
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md), all Phase 8.5 artifacts
**Status:** Preview specs — not yet full deep-dives. Each Tier 2 source gets a capsule spec sufficient to plan Phase 8.6+ sequencing. Full deep-dives are written when each source moves into active build.

---

## Document Purpose

The research catalog (research-v1) lists 142 in-doctrine sources tiered by operator impact. Phase 8.5 covers the five Tier 1 anchor sources comprehensively. This document previews the 15 Tier 2 sources — the next round of integration after Phase 8.5 ships.

Why preview now rather than wait:
1. **Sequencing visibility.** The operator should see the next-tier roadmap to make informed decisions about Phase 8.5 scope.
2. **Pattern identification.** Tier 2 sources fall into shared integration patterns. Identifying patterns early lets Phase 8.5 framework support them with minimal incremental work.
3. **Subscription planning.** Some Tier 2 sources require paid subscriptions. The operator can plan procurement during Phase 8.5 build.
4. **Doctrine review.** Tier 2 includes more gray-zone sources than Tier 1. Doctrine review timing benefits from advance preview.

Each source gets a capsule spec: what it is, why valuable, integration pattern, schema mapping outline, doctrine considerations, Phase 8.6+ assignment.

The previews intentionally do not produce full deep-dives (the level of Phase 8.5.3 SAM.gov or Phase 8.5.4 Award integration docs). Full deep-dives are written when each source moves into active build.

---

# PART ONE — INTEGRATION PATTERNS

Tier 2 sources fall into five integration patterns. Identifying the patterns reveals shared infrastructure that the Phase 8.5 framework should support to accommodate Tier 2 without re-invention.

## Pattern A — Government structured API
Same shape as Tier 1's SAM.gov, USAspending, Congress.gov. Public APIs, auth via API key, JSON responses. Phase 8.5 framework handles these natively.

Tier 2 sources in this pattern:
- Federal Advisory Committee Database (FACA)
- DSCA FMS Notifications API (when released)
- House Lobbying Disclosure (LD-2 bulk XML)
- Senate Confirmations (already via congress.gov but expanded scope)
- Federal Register (already touched in Tier 1; expanded watchlist)

Estimated effort per source: 1-2 operator-weeks each.

## Pattern B — Web scrape (polite, structured HTML)
Same shape as Tier 1's GAO Bid Protest and DoD News. Public web pages, HTML scraping with polite rate, parser per source.

Tier 2 sources in this pattern:
- DoD Comptroller Budget Materials index pages
- Service-branch news (Army.mil, Navy.mil, AF.mil, etc.)
- Think tank publication lists (CSIS, RAND, CNAS, etc.)
- DSB / DBB / DIB report indexes
- COCOM public news sites
- DPC Policy Memos page
- DoD IG and service IG report listings

Estimated effort per source: 1-2 operator-weeks each.

## Pattern C — PDF-heavy extraction
Sources whose primary content is in PDFs requiring text extraction and structured parsing. Examples: DoD Comptroller R-1/P-1/O-1 budget exhibits, DSB / DBB / DIB reports, GAO program reports.

Pattern requires:
- PDF text extraction infrastructure (pdf-parse or pdfjs)
- Table extraction for structured budget data
- Multi-page document handling
- Image extraction (for documents with figures)

Estimated effort per source: 3-5 operator-weeks (PDF infrastructure shared across sources).

Infrastructure investment: 1-2 weeks for first PDF source; subsequent PDF sources benefit.

## Pattern D — Paid subscription with bespoke client
Sources requiring authenticated access via vendor-specific clients. Examples: Inside Defense, GovWin IQ, Janes, Bloomberg Government.

Pattern requires:
- Vendor-specific auth (OAuth, API tokens, basic auth, scraping with session cookies)
- Subscription cost evaluation
- Per-vendor compliance with terms of service
- Potentially per-operator credentials vs. application-level

Estimated effort per source: 3-6 operator-weeks (variable based on vendor's API quality).

## Pattern E — Manual operator import
Per Doctrine §VI / D-1 sign-off, sources that would otherwise require ToS-violating scraping must be imported manually by the operator. Examples: LinkedIn-derived team rosters, conference exhibitor lists (when no public structured data exists).

Pattern requires:
- Operator-facing import UI (paste, CSV upload, screenshot)
- Normalization logic per source type
- Persistent storage with operator-import provenance

Estimated effort: 2-3 operator-weeks for the unified manual-import surface (one-time investment, multiple source types benefit).

---

# PART TWO — TIER 2 SOURCE PREVIEWS

Each source gets a capsule covering: what it is, why valuable, integration pattern, schema mapping outline, doctrine considerations, Phase 8.6+ phase assignment.

---

## T2-1 — Federal Advisory Committee Database (FACA)

**Source:** facadatabase.gov
**Pattern:** A (Government structured API)
**Phase 8.6+ assignment:** Phase 8.6.1 (first Tier 2 source — high value, low effort)

**What it is:** All federal advisory committees (e.g., Defense Business Board, Defense Science Board, Defense Innovation Board, capability-specific FACAs) with charters, memberships, meeting records, recommendations.

**Why valuable:** Reveals who has the ear of the agency on specific topics. The DBB / DSB / DIB / capability-area committee memberships are public-domain Posture intelligence indicators.

**Integration outline:**
- API: facadatabase.gov provides JSON endpoints for committees, members, meetings.
- Auth: none.
- Rate limit: not strictly enforced; polite use.
- Cadence: weekly sync.
- Schema mapping:
  - Committee record → Organization with `type: 'committee'` and `committeeAttrs`
  - Member record → Person + `member_of` Edge (Person → committee Organization, with start/end dates)
  - Meeting record → Signal with `type: 'committee_meeting'`
  - Recommendation report → Signal with `type: 'committee_recommendation'`

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator can see who sits on which advisory committee affecting her customer or her capability area, with historical depth."

---

## T2-2 — DSCA FMS Notifications

**Source:** dsca.mil/major-arms-sales
**Pattern:** B (Web scrape; structured HTML notifications)
**Phase 8.6+ assignment:** Phase 8.6.2 (for FMS-active operators) / Tier 3 (otherwise)

**What it is:** Foreign Military Sales notifications to Congress with platform, country, dollar value, contractor.

**Why valuable:** FMS notifications precede actual award sometimes by years. Leading indicator of partner-nation capability investment.

**Integration outline:**
- Scrape: dsca.mil/major-arms-sales/(year) pages.
- Parser: extracts notification per entry (country, platform, dollar, contractor, MDE designation).
- Cadence: weekly (notifications post irregularly).
- Schema mapping:
  - FMS notification → Signal with `type: 'fms_notification'`
  - Linked Organizations: customer country (new entity subtype `type: 'foreign_government'`), prime contractor, platform manufacturer
  - For tracked aerospace/defense programs, FMS notifications link to platform Organizations (programs)

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees FMS pipeline 1-3 years ahead for platforms in her capability area."

---

## T2-3 — DoD Comptroller Budget Materials (R-1 / P-1 / O-1 / M-1)

**Source:** comptroller.defense.gov; annual budget release
**Pattern:** C (PDF-heavy extraction)
**Phase 8.6+ assignment:** Phase 8.6.3 (high value but high effort; sequenced after PDF infrastructure establishes)

**What it is:** Annual DoD budget justification books with line-item funding by service, program element, and project.

**Why valuable:** Program-element-level funding data is irreplaceable for budget environment analysis. PB-X to Enacted deltas reveal congressional priorities.

**Integration outline:**
- Annual fetch: budget book PDFs from comptroller.defense.gov.
- PDF extraction: table parsing per program element.
- Schema mapping:
  - Program → Organization with `type: 'program'` and `programAttrs.fydpFunding` populated
  - Year-over-year funding changes → Signal with `type: 'budget_change'`
  - PB-to-Enacted deltas → Signal with `type: 'congressional_mark'` (when conference report data available)
- Cadence: annual at PB release; supplemental as Enacted versions update.

**Doctrine considerations:** Public data; clear. PDF parsing fidelity should be validated against original source.

**Operator-impact moment:** "Operator can see funding velocity per program element across the FYDP, with year-over-year deltas."

**Infrastructure investment:** First Tier 2 source requiring PDF extraction infrastructure. Sets up `framework/pdfExtraction.ts` module reusable for subsequent PDF sources.

---

## T2-4 — Inside Defense / Inside the Pentagon / Inside the Army / Navy / Air Force / Missile Defense

**Source:** insidedefense.com (paid subscription)
**Pattern:** D (Paid subscription with bespoke client)
**Phase 8.6+ assignment:** Phase 8.6.4 (high operator-impact; depends on subscription procurement)

**What it is:** Insider reporting on DoD program management, acquisition decisions, congressional defense activity. Industry insiders read this; few aggregators include it.

**Why valuable:** Frequently includes program-level detail that doesn't appear in mainstream defense press. Operators consistently cite Inside Defense as worth the cost.

**Integration outline:**
- Auth: subscription credentials. Per-operator or per-deployment.
- Source format: web articles + email digest + RSS (some paywalled).
- Integration approach: RSS for headlines; full-article fetch with operator's session cookie for paywalled content.
- Schema mapping:
  - Article → Signal with `type: 'trade_press_article'`
  - Entity extraction (Persons, Organizations mentioned) via NER
  - Topic tagging via article metadata

**Doctrine considerations:** Subscription content; respect terms of service. No scraping beyond what the subscription permits. Doctrine D-1 default-exclude does NOT apply because operator has lawful subscription.

**Cost:** Paid-mid (~$2k-$8k/yr per publication; bundle pricing available).

**Operator-impact moment:** "Operator sees program-management reporting that does not appear in free defense press, entity-linked to her workspace."

**Subscription decision:** Operator decision; recommended but not mandatory. Phase 8.6.4 has dependency on subscription procurement.

---

## T2-5 — Service-branch News Sites

**Source:** army.mil, navy.mil, af.mil, marines.mil, spaceforce.mil, uscg.mil
**Pattern:** B (Web scrape via RSS aggregation)
**Phase 8.6+ assignment:** Phase 8.6.5 (bundled scrape framework)

**What it is:** Service-branch press releases, command-level news, exercise announcements, leadership announcements.

**Why valuable:** Leadership change announcements drive `posture.trajectory` and `tells[]` updates. Below-the-fold service news catches developments not in mainstream defense press.

**Integration outline:**
- RSS per service (most services publish RSS).
- Aggregator function pulls all services into unified feed.
- Entity extraction (Person, Organization mentions) via NER.
- Schema mapping:
  - Article → Signal with `type: 'service_news'`
  - Leadership announcements → also create `position_held` Edge transitions

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees command leadership transitions across services in her Daily Brief."

---

## T2-6 — Defense Think Tank Publications (CSIS, RAND, CNAS, Hudson, AEI, Brookings, Heritage, Atlantic Council, Stimson)

**Source:** csis.org, rand.org, cnas.org, etc.
**Pattern:** B (Web scrape; per-organization RSS)
**Phase 8.6+ assignment:** Phase 8.6.6 (bundled think-tank aggregator)

**What it is:** Reports, briefs, commentary, analyst dossiers from major defense think tanks.

**Why valuable:** Think tank publications often pre-stage policy direction 6-18 months before formal decisions. Analyst transitions from think tanks to government positions are leading indicators.

**Integration outline:**
- RSS per think tank (most publish RSS).
- Aggregator with per-tank topic tagging.
- Schema mapping:
  - Publication → Signal with `type: 'analysis_publication'`
  - Author resolution → Person record
  - Topic tags from publication metadata
- Filter at watchlist level (operator picks which tanks/topics to track).

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees the analytical center-of-mass of public defense thinking on her capability area."

**Bundled approach:** One framework module handles all think tanks via per-source config (RSS URL, topic-tag mapping). Adding new think tanks in Phase 9+ is config-only.

---

## T2-7 — Mitchell Institute (AFA) / NDU Press / Aerospace Center for Space Policy / Service Affiliate Publications

**Source:** mitchellaerospacepower.org, ndupress.ndu.edu, aerospace.org/csps
**Pattern:** B (Web scrape; per-organization RSS or quarterly publication listings)
**Phase 8.6+ assignment:** Phase 8.6.7

**What it is:** Topical monographs and policy papers from service-affiliated think tanks.

**Why valuable:** Mitchell Institute monographs are written by retired senior airmen and frequently preview Air Force capability priorities 12-24 months before formal announcement. Similar pattern for other service affiliates.

**Integration outline:**
- Same as T2-6 (bundled into think-tank aggregator) with affiliate-source classification.

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator gets early preview of service-chief priorities via retired-senior-officer monographs."

---

## T2-8 — DSB / DBB / DIB Reports

**Source:** acq.osd.mil/dsb, dbb.defense.gov, innovation.defense.gov
**Pattern:** C (PDF-heavy extraction)
**Phase 8.6+ assignment:** Phase 8.6.8 (after PDF infrastructure)

**What it is:** Independent advisory body reports on defense capability, business processes, innovation. These bodies recommend policy that often drives subsequent acquisition strategy.

**Why valuable:** Recommendations frequently anticipate 12-24-month policy direction. Membership rosters reveal current senior thinking.

**Integration outline:**
- Periodic fetch (quarterly to annual cadence).
- PDF extraction for report content.
- Cross-reference with FACA database (T2-1) for membership.
- Schema mapping:
  - Report → Signal with `type: 'advisory_body_report'`
  - Membership → reuses FACA Person records
  - Recommendations → extracted as Signal `attrs.recommendations[]`

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees senior advisory body recommendations 12-24 months before they show up in budget actions."

---

## T2-9 — House Lobbying Disclosure (LD-1, LD-2)

**Source:** lda.senate.gov (bulk XML)
**Pattern:** A (Bulk download with structured parsing)
**Phase 8.6+ assignment:** Phase 8.6.9

**What it is:** Quarterly lobbying disclosures with registrant, client, issues, congressional contacts, lobbyists.

**Why valuable:** Reveals which competitor is paying which lobbyist on which issue. Cross-referencing with congressional members and bills produces a high-fidelity influence map.

**Integration outline:**
- Bulk quarterly XML downloads.
- Parsing produces structured records: registrant Organization, client Organization, registered lobbyists (Persons), issues (free text), congressional contacts.
- Schema mapping:
  - LD-2 filing → Signal with `type: 'lobbying_disclosure'`
  - Edge: client Organization → lobby firm Organization (with `type: 'lobby_firm'`), `attrs: { quarter, amount, issues }`
  - Edge: lobbyist Person → lobby firm Organization, `member_of` with revolving-door history if traceable

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees which competitor is paying which lobbyist to influence which issue."

---

## T2-10 — Plum Book + Senate Confirmations + Federal Vacancies

**Source:** plumbook.gov + congress.gov (already in Tier 1) + gao.gov/legal/other-legal-work/federal-vacancies-reform-act
**Pattern:** Mixed (A for structured congressional data, B for plumbook PDF / web data)
**Phase 8.6+ assignment:** Phase 8.6.10 (augments Congress.gov from Tier 1)

**What it is:** Comprehensive political-appointee tracking across DoD and other agencies.

**Why valuable:** Plum Book establishes baseline of presidentially-appointed positions; Senate confirmations track changes; Federal Vacancies tracker flags when acting officials exceed statutory limits.

**Integration outline:**
- Plum Book: PDF extraction at release (every 4 years; supplemental updates).
- Senate confirmations: already in Congress.gov sync (Tier 1).
- Federal Vacancies: periodic GAO report tracking.
- Schema mapping (augments existing):
  - Plum Book positions → Position records linking Person to government Organization
  - Vacancy alerts → Signal with `type: 'vacancy_alert'` when acting tenure exceeds limit

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees political-appointee transitions across DoD with historical depth and statutory-limit flags."

---

## T2-11 — Industry Association Public Rosters (NDIA divisions, AFCEA chapters, AUSA councils, AFA components)

**Source:** ndia.org, afcea.org, ausa.org, afa.org
**Pattern:** B (Web scrape of public-facing rosters)
**Phase 8.6+ assignment:** Phase 8.6.11

**What it is:** Industry association division/chapter leadership rosters. Identifies the few hundred industry practitioners actively shaping capability discussions in each area.

**Why valuable:** Subcommittee co-chair pairings (one industry, one government) reveal partnerships not visible elsewhere. Division leadership rosters are quasi-public Posture indicators.

**Integration outline:**
- Per-association scheduled scrape of public-facing roster pages.
- Schema mapping:
  - Division/chapter → Organization with `type: 'committee'` (within parent trade association Organization)
  - Member → Person + `member_of` Edge with role attribute (Chair / Vice Chair / Member)

**Doctrine considerations:** Public-facing data only. Member-only directories (behind login) are out-of-scope. Public speaker rosters and division leadership are clearly public.

**Operator-impact moment:** "Operator sees who chairs the NDIA division or AFCEA chapter that matters to her capability area."

---

## T2-12 — Major Defense Conference Programs and Exhibitor Lists

**Source:** ausa.org/events/ausa-annual-meeting, navyleague.org/sea-air-space, etc.
**Pattern:** B (Annual structured scrape per conference)
**Phase 8.6+ assignment:** Phase 8.6.12

**What it is:** Exhibitor lists, speaker rosters, session abstracts for major shows: AUSA Annual, AFA Air Space Cyber, Sea-Air-Space, AFCEA WEST, SOFIC, I/ITSEC, Space Symposium, others.

**Why valuable:** Exhibitor lists reveal the segment landscape better than any commercial database. Speaker rosters identify the practitioners agencies trust to brief publicly. Cross-conference tracking profiles a competitor's go-to-market posture.

**Integration outline:**
- Annual scrape per conference (configured per show).
- Schema mapping:
  - Conference → Organization with `type: 'committee'` + `committeeAttrs.conferenceYear`
  - Exhibitor → Organization records (auto-create if new)
  - Speaker → Person record + `testimony_at`-style Edge to conference Organization
- Year-over-year diff: which competitors exhibited at AUSA but not Sea-Air-Space, etc.

**Doctrine considerations:** Public-facing data only. Member-only programs are out-of-scope.

**Operator-impact moment:** "Operator can compare adversary's conference exhibition footprint year-over-year."

---

## T2-13 — Reagan National Defense Forum / Halifax / Aspen Security Forum Participant Lists

**Source:** reaganfoundation.org, halifaxtheforum.org, aspensecurityforum.org
**Pattern:** B (Annual web scrape)
**Phase 8.6+ assignment:** Phase 8.6.13

**What it is:** Participant lists, panel rosters, session recordings for major senior-defense forums.

**Why valuable:** These forums gather the senior defense ecosystem annually. Panel participation is a status signal. Same individuals appearing in Halifax + Reagan + Aspen are the durable senior class.

**Integration outline:**
- Same as T2-12 (annual scrape per forum).
- Schema mapping: same pattern.

**Doctrine considerations:** Public-facing data only.

**Operator-impact moment:** "Operator sees who's in the senior defense policy community circulating at these forums."

---

## T2-14 — GAO Reports (program-level, not bid protests)

**Source:** gao.gov/reports-testimonies
**Pattern:** B (Web scrape; RSS available)
**Phase 8.6+ assignment:** Phase 8.6.14 (augments GAO Bid Protest from Tier 1)

**What it is:** Audit and evaluation reports across programs, agencies, and policy areas. The annual "Weapon Systems Annual Assessment" and the "High-Risk List" are particularly valuable.

**Why valuable:** GAO findings affecting specific programs or contractors are public-domain Posture indicators. Adverse findings are leading indicators of contractor trouble.

**Integration outline:**
- RSS + scheduled fetch.
- PDF extraction for report content (where needed).
- Cross-reference with Award entities (USAspending) and Program entities to surface relevant findings.
- Schema mapping:
  - Report → Signal with `type: 'oversight_finding'`
  - Linked entities: Organizations (contractors named), Programs (program elements named)

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees GAO findings affecting her capability area within hours of release."

---

## T2-15 — DPC Policy Memos + DFARS Rule Changes + DoD IG / Service IG Reports

**Source:** acq.osd.mil/dpap, federalregister.gov, oig.osd.mil, service-specific IG sites
**Pattern:** B (Web scrape; RSS where available)
**Phase 8.6+ assignment:** Phase 8.6.15 (consolidated policy + oversight feed)

**What it is:** Policy memos and oversight reports affecting acquisition policy and specific contractors.

**Why valuable:** Class deviations affect specific contract types and dollar thresholds — often quietly. Oversight findings drive contractor risk assessments.

**Integration outline:**
- DPC: monthly scrape of policy memos page.
- DFARS: Federal Register filter (already in Tier 1).
- IG reports: per-service IG portal scrape.
- Schema mapping:
  - Policy memo → Signal with `type: 'policy_signal'`
  - IG report → Signal with `type: 'oversight_finding'`

**Doctrine considerations:** Public data; clear.

**Operator-impact moment:** "Operator sees policy changes affecting her contract types and oversight findings on her competitors."

---

# PART THREE — PHASE 8.6+ ROUGH SEQUENCING

Tier 2 sources sequenced by combination of value and infrastructure dependency.

## Phase 8.6.1 — FACA (highest value, lowest effort)
- 1-2 weeks
- Pattern A; no new infrastructure
- Validates the Tier 2 onboarding cadence

## Phase 8.6.2 — DSCA FMS Notifications
- 1-2 weeks
- Pattern B; existing scraper framework
- High value for FMS-active operators

## Phase 8.6.3 — DoD Comptroller Budget Materials
- 4-5 weeks (includes PDF infrastructure investment)
- Pattern C; first PDF-heavy source
- Establishes `framework/pdfExtraction.ts` reusable for subsequent sources

## Phase 8.6.4 — Inside Defense (subscription dependent)
- 3-4 weeks (when subscription procured)
- Pattern D; first paid source
- Establishes subscription auth pattern reusable

## Phase 8.6.5 — Service-branch News (RSS aggregator)
- 1-2 weeks
- Pattern B; bundled scrape
- Quick win

## Phase 8.6.6 — Think Tank Publications (RSS aggregator)
- 2-3 weeks
- Pattern B; bundled scrape with per-tank config
- Recurring value

## Phase 8.6.7 — Mitchell Institute / NDU Press / Aerospace CSPS
- 1 week (bundled into 8.6.6 aggregator)
- Pattern B; config addition

## Phase 8.6.8 — DSB / DBB / DIB Reports
- 2-3 weeks (after PDF infrastructure)
- Pattern C
- Cross-references with FACA (8.6.1)

## Phase 8.6.9 — House Lobbying Disclosure
- 2-3 weeks
- Pattern A; bulk XML processing
- Independent of others

## Phase 8.6.10 — Plum Book + Federal Vacancies
- 2 weeks
- Pattern A/B mixed; augments Congress.gov sync

## Phase 8.6.11 — Industry Association Rosters
- 3-4 weeks (per-association scraping)
- Pattern B
- Workspace-rich Posture-Layer feed

## Phase 8.6.12 — Major Conference Programs
- 4-6 weeks across major shows (annual cadence)
- Pattern B per show
- Year-over-year competitive intelligence

## Phase 8.6.13 — Reagan / Halifax / Aspen Forums
- 1-2 weeks
- Pattern B; bundled
- Status-signal mapping

## Phase 8.6.14 — GAO Reports (non-protest)
- 2-3 weeks
- Pattern B; augments GAO Protest sync infrastructure

## Phase 8.6.15 — DPC + DFARS + IG Reports (policy and oversight feed)
- 3-4 weeks (multi-source coordination)
- Pattern B
- Consolidated regulatory/oversight surface

## Total Phase 8.6 estimate: 30-50 operator-weeks for full Tier 2 set.

Parallelizable: 8.6.1, 8.6.2, 8.6.5, 8.6.6, 8.6.10, 8.6.13 can largely run in parallel (independent integrations). PDF-dependent sources (8.6.3, 8.6.8) gate on 8.6.3 completing first.

Calendar-time estimate with 2 parallel developer-equivalents: 4-6 months.

---

# PART FOUR — TIER 3 OVERVIEW

The research catalog identifies many Tier 3 sources beyond the Tier 2 set. Phase 8.7+ scope. Brief overview:

## Long-tail government open data
- DLA DIBBS (sustainment/supply chain segment)
- USACE Contracts (MILCON segment)
- DTIC Public Reports (decades of FFRDC research)
- AFWERX / SOFWERX / NavalX award databases
- DIU CSO Tracker
- SBIR.gov + DoD SBIR/STTR (already lightly covered in Tier 2 via Discipline 4)
- NASA NSPIRES (dual-use technology)
- NSF / NIH / DOE research awards (dual-use research)

## Specialized commercial sources
- HigherGov / GovTribe (alternate SAM.gov wrappers)
- Crunchbase / PitchBook (defense-tech startup tracking)
- D&B family-tree (ownership verification)
- OpenCorporates (worldwide entity registry)
- ProPublica Nonprofit Explorer (Form 990 lookups)
- IDA / CNA / MITRE public publications (FFRDC reports)

## High-cost commercial intelligence
- Janes (capability and platform data)
- Aviation Week Intelligence Network (for aerospace-segment operators)
- GovWin IQ (if budget supports)
- Bloomberg Government

## International / allied markets
- UK Contracts Finder / Find a Tender
- EU TED (Tenders Electronic Daily)
- Canada Buys
- AusTender
- NATO Support and Procurement Agency

## Specialized geospatial / asset tracking
- ADS-B Exchange / FlightRadar24 (aviation industrial base)
- MarineTraffic (maritime industrial base)
- Planet Labs / Maxar (commercial satellite imagery)

## Specialized news and media
- War on the Rocks (essays and podcasts)
- Defense Daily / Aviation Week (defense aerospace trades)
- GDELT Project (international event context)

Each Tier 3 source has its own integration cost. The roadmap principle: integrate Tier 3 sources when an operator-week of effort produces a clear operator-impact moment for at least one active pursuit. Speculation is not the bar; demonstrated need is.

---

# PART FIVE — DOCTRINE CONSIDERATIONS FOR TIER 2

Tier 2 includes more gray-zone consideration than Tier 1.

## Cleared (clearly in-doctrine)
- All Pattern A government structured API sources
- All Pattern B web scrape sources of public-facing government data
- All Pattern C PDF extraction of public government documents
- Paid subscription content (operator has lawful access)

## Gray-zone considerations

### G-1 — Industry association member-only directories
Some industry association directories are member-only (login required). Per Doctrine §VI / D-1 (default-exclude scrapers): excluded from automated integration. Operator may manually import if member-status confers access.

### G-2 — Conference attendee lists vs. exhibitor lists
Exhibitor lists are public marketing data; clear. Attendee lists (full registration roster) are typically member-only or conference-controlled; gray.

**Recommendation:** Integrate exhibitor lists and speaker rosters only. Attendee lists require operator-level subscription and manual import.

### G-3 — Inside Defense / similar paid subscriptions
Doctrine D-1 default-excludes third-party scrapers. Paid subscriptions are different: operator has lawful access through subscription. Integration is in-doctrine when respecting publisher terms of service.

**Recommendation:** Phase 8.6.4 integrates Inside Defense via RSS + paywalled content within subscription terms. No scraping that bypasses paywall.

### G-4 — Aggregated personal data (D&B family-tree, OpenCorporates with personal info)
D&B provides ownership data including officer names. OpenCorporates aggregates state registries. Personal info in these sources is technically public but aggregation creates gray-zone.

**Recommendation:** For Phase 8.7+ scope, evaluate per-source whether personal information aggregation exceeds Doctrine §VI thresholds. Default-include for organizational data; operator review for personal-info-bearing fields.

### G-5 — Patent and research data on individual inventors
USPTO and arXiv data identify individual inventors and researchers. Public data but aggregation creates Person dossiers.

**Recommendation:** Aggregate at Organization level (which firms hold which patents). Individual inventor data surfaces only when operator drills into specific records.

---

# PART SIX — OPEN IMPLEMENTATION QUESTIONS

## T2Q-1 — Tier 2 prioritization

Operator's actual pursuit space may not match the generic Tier 2 prioritization in Part Three. Workspace-specific Tier 2 prioritization?

**Proposal:** Default Phase 8.6 sequence as listed. Operator can request reordering based on her capability segment.

**Recommendation:** Confirm default sequence with operator-override option.

## T2Q-2 — PDF infrastructure investment

Pattern C requires PDF extraction infrastructure. First-source investment is significant (1-2 weeks of dedicated work).

**Proposal:** Invest in `framework/pdfExtraction.ts` as a Phase 8.6.3 prerequisite. Use a hybrid extraction approach: pdf-parse for text + tabula-js for tables.

**Recommendation:** Confirm pdf-parse + tabula-js for v1.

## T2Q-3 — Subscription procurement timing

Inside Defense and similar subscriptions require procurement decisions. Timing matters for Phase 8.6.4.

**Proposal:** Operator evaluates subscriptions during Phase 8.5 build (3-4 months runway). Procurement decision before Phase 8.6.4 commences.

**Recommendation:** Operator-driven; no specific timing constraint.

## T2Q-4 — Industry association ToS review

Some associations may have ToS restrictions on scraping public-facing pages. Per-association review.

**Proposal:** Phase 8.6.11 includes legal review of each association's ToS before scraping. Manual import fallback for any association with restrictive ToS.

**Recommendation:** Confirm per-association ToS review.

## T2Q-5 — Conference exhibitor list refresh cadence

Conferences are annual. Once-per-year scrape sufficient or quarterly check for last-minute changes?

**Proposal:** Annual scrape + supplemental scrape 2 weeks before event start (catches late-confirmed exhibitors and speakers).

**Recommendation:** Confirm annual + pre-event supplemental.

## T2Q-6 — Tier 3 source individual specs

Each Tier 3 source eventually needs its own capsule spec when active build begins. Not all 70+ Tier 3 sources will integrate; selection based on operator demand.

**Proposal:** Tier 3 capsule specs written on operator request, one at a time as integration begins.

**Recommendation:** Confirm just-in-time Tier 3 spec writing.

## T2Q-7 — Cross-tier source linkage

Tier 2 sources cross-reference with Tier 1 (e.g., FACA membership cross-references with Plum Book and Congress.gov; GAO Reports cross-reference with Awards). How does the cross-source linker evolve?

**Proposal:** Phase 8.6 each sub-phase adds its source's cross-linkage rules to the linker. Linker grows monotonically.

**Recommendation:** Confirm incremental linker growth.

---

# CLOSING NOTES

## Why preview rather than full spec

Each Tier 2 source could merit a full deep-dive (10-15k words each). Writing all 15 now would produce 150-225k additional words of specification ahead of implementation. That's premature optimization.

Capsule specs are sufficient to:
- Reveal patterns that inform Phase 8.5 framework design
- Reveal subscription decisions the operator should make
- Reveal Doctrine considerations needing operator review
- Reveal effort estimates for Phase 8.6 planning

Full deep-dives are written when each source moves into active build, with real-world findings shaping the spec.

## Cross-references

- Research catalog (research-v1) Tier 2 entries (15 sources marked Tier 2 in the document)
- Functions framework (functions-framework-v1) — Pattern A/B/C/D/E plug into the framework
- Migration spec (migration-v1) — E-2 Organization subtype extension includes types needed by Tier 2 (committee, lobby_firm, university, ffrdc, trade_assoc)

## Maintenance principle

This document is v1.0. As Tier 2 sources move into active build, individual sources get promoted from capsule to full deep-dive. New capsule entries added for newly-considered Tier 2 sources.

When a Tier 2 source's full deep-dive ships, this document's entry is marked "→ see full deep-dive at [doc path]."

---

*End of Tier 2 source previews v1.0.*
