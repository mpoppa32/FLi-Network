# CORSAIR PHASE 8.5 — TESTING STRATEGY

**Scope:** Test plan for Phase 8.5 implementation across migration, framework, per-source integrations, and operator-facing surfaces
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** All Phase 8.5 spec artifacts, particularly the framework spec and migration design
**Status:** Test strategy spec. Defines test layers, fixture management, per-sub-phase test scenarios, and acceptance verification approach. Build session uses this document to construct the test suite.

---

## Document Purpose

Each spec document includes acceptance criteria. This document consolidates those criteria into a runnable test strategy:
- What test types exist (unit, integration, end-to-end)
- How fixtures are managed (recorded API responses, golden files, mock workspaces)
- Per-source test scenarios that exercise both happy path and edge cases
- How acceptance criteria translate to specific test cases
- How tests run (locally, in CI, against staging)

The strategy is implementation-language-agnostic but assumes Vitest as the test runner (per Functions framework spec FIQ-5).

---

# PART ONE — TEST LAYERS

Four layers, each serving a distinct verification purpose.

## L-1 — Unit tests (fastest, narrowest)

Scope: Single function or class in isolation. Mocked dependencies. Run in milliseconds.

Coverage targets:
- `framework/*.ts` modules — every public function tested
- `sources/*/mapper.ts` and `sources/*/parser.ts` — schema mapping correctness
- `sources/*/reconciler.ts` — match logic correctness
- `framework/types/*` — type constructors and validators

Run frequency: every save during development (watch mode); on every commit in CI.

## L-2 — Integration tests (medium scope, medium speed)

Scope: Multiple components composed. Real Firebase Emulator. Mocked external HTTP via fixtures.

Coverage targets:
- Full source sync flow (fetch fixture → parse → map → write to emulated RTDB → verify state)
- Reconciliation flows (multiple records, match logic, merge outcomes)
- Migration steps (apply → validate → rollback)
- Rate limiter behavior under simulated load
- Cross-source linker outcomes

Run frequency: on every commit in CI; manually during development for affected areas.

## L-3 — End-to-end tests (full scope, slowest)

Scope: Real Cloud Functions deployment in staging. Real external APIs (staging keys where applicable; production read-only APIs otherwise).

Coverage targets:
- Scheduled job invocations succeed end-to-end
- Source Health view reflects accurate state
- Brief synthesis produces expected output structure
- Migration runs on a real staging workspace without corruption
- Operator-initiated actions (Force Refresh, Disable) function correctly

Run frequency: nightly in CI against staging; manually before production deploy.

## L-4 — Operator validation (manual, slowest, highest fidelity)

Scope: Operator personally tests features in their test workspace.

Coverage targets:
- Source Health UI matches design
- Watchlist configuration UX matches design
- First-time onboarding flow completes without confusion
- Daily Brief contents feel relevant
- Edge cases (R-O1 mis-configuration, R-T2 HTML changes) handled gracefully

Run frequency: at each sub-phase acceptance milestone (per acceptance criteria in each spec).

---

# PART TWO — FIXTURE MANAGEMENT

Tests need recorded data. Fixtures are the recorded inputs.

## Fixture types

### F-A — Source API response fixtures

Recorded JSON or HTML from real source APIs. Stored in `functions/fixtures/{source}/`:

```
functions/fixtures/samGov/
├── search-results-airforce-naics541512.json     (typical search response)
├── search-results-empty.json                     (zero results)
├── notice-detail-presol.json                     (one notice)
├── notice-detail-solicitation.json
├── notice-detail-amendment.json
├── notice-description.json                       (description endpoint)
├── entity-registration-lockheed.json
├── error-401-invalid-key.json                    (auth failure)
├── error-429-rate-limit.json                     (rate limit response)
└── error-500-server.json                         (transient error)

functions/fixtures/dodNewsContracts/
├── daily-page-typical.html                       (normal day)
├── daily-page-empty.html                         (holiday)
├── daily-page-multi-award.html                   (multi-contractor announcement)
├── daily-page-modification.html                  (mod announcement)
├── daily-page-jv.html                            (JV contractor)
├── daily-page-fms.html                           (FMS notice)
├── daily-page-malformed.html                     (HTML structure change)
└── daily-page-classified.html                    (classified contract)

functions/fixtures/usaSpending/
├── awards-search-typical.json
├── award-detail.json
├── award-transactions.json
├── subawards.json
├── recipient-detail.json
└── error-cases/

... etc per source
```

### F-B — Workspace state fixtures

JSON dumps of workspace state for testing migrations and reconciliation:

```
functions/fixtures/workspaces/
├── empty-workspace.json                          (fresh workspace, no entities)
├── small-workspace.json                          (50 entities, basic shape)
├── medium-workspace.json                         (500 entities, varied shapes)
├── large-workspace.json                          (5000 entities, edge cases)
├── workspace-with-anomalies.json                 (orphan edges, malformed records)
├── workspace-pre-migration.json                  (no source provenance)
└── workspace-post-migration.json                 (migration complete; expected end state)
```

### F-C — Cross-source linkage fixtures

Records that demonstrate cross-source linkage scenarios:

```
functions/fixtures/crossSource/
├── samgov-solicitation-with-gao-protest.json     (linked Opportunity + Signal)
├── samgov-award-with-usaspending-match.json      (linked Opportunity + Award)
├── usaspending-award-with-sec-filing.json        (linked Award + Signal)
└── congress-witness-as-sec-executive.json        (linked Person + Edge)
```

## Fixture recording

Fixtures are recorded from real source data and committed to the repo. Recording approach:

1. **Initial capture:** Use the source's actual API/web (with valid credentials) to fetch a representative response. Save to `fixtures/`.
2. **Sanitize:** Remove any PII (operator-side contact info), normalize dates if needed.
3. **Annotate:** Add a `.meta.json` file alongside each fixture documenting:
   - When it was captured
   - From what URL/query
   - What scenario it represents (typical / edge case / error)

4. **Refresh periodically:** Quarterly review of fixtures to catch source-side format changes that would invalidate fixtures.

## Fixture loading in tests

A shared helper:
```typescript
function loadFixture(source: string, name: string): any {
  const path = `fixtures/${source}/${name}`;
  return JSON.parse(fs.readFileSync(path, 'utf-8'));
}

function loadHtmlFixture(source: string, name: string): string {
  const path = `fixtures/${source}/${name}`;
  return fs.readFileSync(path, 'utf-8');
}
```

Tests reference fixtures by name; the helper handles path resolution.

## Fixture-versus-live testing

Most tests use fixtures (deterministic, fast, no rate-limit risk). A small set of "smoke tests" use live source APIs to verify:
- Source API still responds with the expected schema (catches breaking changes early)
- Auth credentials still work
- Rate limiter respects the source's actual limits

Smoke tests run weekly in CI, separate from the main test suite.

---

# PART THREE — UNIT TEST SCENARIOS

Per-module unit test scenarios. Not exhaustive; representative coverage.

## Framework unit tests

### `framework/rateLimit.ts`
- `consumeTokens` returns success when bucket has capacity
- `consumeTokens` returns failure when bucket is empty
- `consumeTokens` correctly computes refill since last call
- Concurrent `consumeTokens` calls handle atomically (no over-consumption)
- Daily budget enforced separately from per-second budget
- 429 with Retry-After respects the header

### `framework/retry.ts`
- Retries on retriable status codes (408, 429, 500-504)
- Does not retry on non-retriable (4xx not 429)
- Backoff delays match config
- Total deadline halts retries past the limit
- Per-attempt timeout aborts that attempt without halting retry
- Exhausted retries propagate the final error correctly

### `framework/errors.ts`
- 429 categorized as `rate_limited`
- 401/403 categorized as `auth_failed`
- 4xx (not 429) categorized as `permanent`
- 5xx categorized as `transient`
- Network errors categorized as `transient`
- SchemaValidationError categorized as `schema_mismatch`
- DoctrineViolationError categorized as `doctrine_violation`

### `framework/provenance.ts`
- `attachProvenance` adds source object to entity
- `attachProvenance` preserves existing fields
- `attachProvenance` does not overwrite existing source.system if present
- Provenance source.fetchedAt always set
- Provenance source.refreshedAt always set to current time

### `framework/rtdb.ts`
- Workspace path helpers produce correct paths
- Multi-path update batching respects 500-item limit
- Hash-based change detection skips writes when unchanged
- Operator override-preserving merge preserves operator-set fields

### `framework/hashing.ts`
- Hash is stable for same input
- Hash differs for different inputs
- Hash respects field selection (excludes operator-input fields)
- Object key order doesn't affect hash (deterministic serialization)

## Source-specific unit tests

### `sources/samGov/mapper.ts`
- Maps notice record to Opportunity with all expected fields
- Handles missing optional fields gracefully
- Notice type codes correctly translate to baseTypes
- Place of performance correctly normalized
- Set-aside descriptions correctly populated
- `fullParentPathName` correctly parsed into hierarchy array
- Attachments URL list correctly extracted

### `sources/samGov/reconciler.ts`
- Exact solicitation number match → confidence 1.0
- Normalized solicitation match → confidence 0.95
- Title fuzzy match + agency match → confidence 0.7-0.85
- Operator-set fields not overwritten by sync
- `operatorOverrides[]` correctly tracked on field-by-field merge
- New Opportunity creation when no match

### `sources/usaSpending/mapper.ts`
- Award record correctly maps to Award entity
- Modifications array sums correctly to obligated total
- IDV / task order parenting populates `parentAwardId`
- Recipient name normalized
- Place of performance correctly populated
- Award type code translates to type enum

### `sources/usaSpending/awardReconciler.ts`
- DoD News PIID match to USAspending → confidence 1.0
- Normalized PIID match → confidence 0.95
- Provisional Award merges to authoritative
- Operator-input notes preserved through merge
- First-seen timestamp preserved
- Source.system updates to authoritative source

### `sources/dodNewsContracts/parser.ts`
- Typical announcement parses with confidence > 0.9
- Multi-contractor announcement produces separate Awards
- JV contractor flagged for review
- FMS announcement extracts country
- Classified announcement produces low-confidence Award
- Modification announcement extracts mod number
- Malformed HTML falls back gracefully

### `sources/gaoProtest/parser.ts`
- Docket entry correctly parses
- Status transitions correctly tracked
- Reconsideration suffixes (.1, .2) correctly handled
- Multi-protestor protests produce single Signal with multiple subjects
- Decision text extraction from PDF

### `sources/secEdgar/filingParser.ts`
- 8-K item codes correctly extracted
- 10-K narrative sections correctly extracted (where present)
- Form 4 transaction codes correctly parsed
- DEF 14A roster extraction works
- Malformed filings handled gracefully

### `sources/congressGov/hearingMapper.ts`
- Hearing record maps to Signal with witnesses
- Witness names with titles correctly normalized
- Joint hearings produce single Signal with multiple committees
- Closed hearings recorded with limited-data flag

### `sources/congressGov/nominationMapper.ts`
- Nomination maps to Signal with `pending` status
- Confirmation triggers status update and Edge creation
- Multi-nominee nominations produce multiple Persons
- Privileged nominations correctly flagged

---

# PART FOUR — INTEGRATION TEST SCENARIOS

Integration tests exercise multiple components together. All run against Firebase Emulator with mocked HTTP via fixtures.

## INT-1 — Full SAM.gov sync

Scenario: A fresh workspace with empty Opportunity collection runs a SAM.gov sync against a fixture set of 50 notices.

Setup:
- Empty workspace
- Watchlist config with 3 NAICS, 2 agencies
- Mock SAM.gov returns 50 matching notices from fixture

Expected outcome:
- 50 Opportunities created in workspace
- Each has correct source provenance
- Each maps to correct customer Organization (which may auto-create)
- Source Health shows ◆ Operational with `lastSync` recent
- No errors logged

## INT-2 — Operator-created reconciliation

Scenario: Workspace has 5 existing Opportunities created by operator. SAM.gov sync brings in 50 notices, 3 of which match existing Opportunities.

Setup:
- Workspace with 5 Opportunities (matching scenarios A, B, C, D, E from SAM.gov spec Part Seven)
- SAM.gov fixture returns 50 notices including matches for the 5

Expected outcome:
- 3 high-confidence matches auto-merge; operator notes preserved
- 1 low-confidence match queues for review
- 1 ambiguous match queues with multiple candidates
- 47 new Opportunities created
- Operator's existing 5 Opportunities each have correct `reconciliation.matchConfidence`

## INT-3 — Amendment versioning

Scenario: SAM.gov originally posts a Solicitation; later posts an Amendment that changes the deadline.

Setup:
- Workspace receives Solicitation notice via sync
- Second sync brings the Amendment notice

Expected outcome:
- After first sync: Opportunity exists with original deadline
- After second sync: Opportunity's `samgovResponseDeadline` updated
- `relatedNotices[]` includes both notices
- Signal of type `opportunity_deadline_extended` created
- `deadlineHistory[]` records the change
- `amendmentNumber` incremented

## INT-4 — DoD News + USAspending reconciliation

Scenario: DoD News announces a $100M award. Two days later, USAspending returns the same award with full structured data.

Setup:
- Day 1: DoD News scrape produces provisional Award
- Day 3: USAspending sync returns the same PIID

Expected outcome:
- After Day 1: Award exists with `lifecycleState: 'provisional'`, source DoD News
- After Day 3: Award updated to `lifecycleState: 'active'`, source USAspending
- `reconciliation.firstSeenSource: 'dod_news'`
- `reconciliation.firstSeenAt` preserved from Day 1
- `reconciliation.confirmedSource: 'usaspending'`
- All structured fields (NAICS, place of performance, etc.) populated
- Secondary indexes (`awardsByPopEnd`, `awardsByPrime`, etc.) all written

## INT-5 — Recompete watch derived view

Scenario: Workspace has 100 Awards, 15 of which have `popEnd` within 18 months and match watchlist filters.

Setup:
- Workspace populated with 100 Award entities (mix of expired, active, expiring)
- Watchlist config with relevant NAICS and customer

Expected outcome:
- Recompete Watch query returns 15 Awards
- Sort order is popEnd ascending
- Filter correctly excludes Awards outside watchlist scope
- Each result includes incumbent (primeOrgId)
- For each, a Proposed Pursuit is created in `proposedOpportunities/`
- Proposed Pursuit has incumbent in `proposedAdversaries[]`

## INT-6 — GAO protest with cross-source linkage

Scenario: GAO protest references a solicitation number matching an existing Opportunity in workspace.

Setup:
- Workspace has Opportunity with `solicitationNumber: 'FA8611-25-R-0042'`
- GAO scrape produces protest filing referencing the same solicitation

Expected outcome:
- Signal created with `type: 'protest'`
- Signal's `relatedIds[]` includes the matching Opportunity ID
- Brief surface shows the protest linked to the Opportunity
- Cross-source linker correctly identified the match

## INT-7 — Rate limiter under load

Scenario: 30 workspaces simultaneously trigger SAM.gov sync.

Setup:
- 30 workspaces with active configs
- Mock SAM.gov accepts up to 10 req/sec, 1000 req/hour
- Each workspace makes ~40 requests in its sync

Expected outcome:
- Total requests across 30 workspaces = 1200, exceeding hourly limit
- Rate limiter throttles correctly: first 1000 succeed at full speed; remaining 200 queue
- No 429 errors propagated to job-level failures
- Some workspaces' syncs delayed (visible in Source Health)
- Total job duration extended but no syncs fail

## INT-8 — Migration end-to-end

Scenario: Run Phase 8.5.1 migration on a fixture workspace with 4287 entities.

Setup:
- Fixture workspace from `fixtures/workspaces/medium-workspace.json` (post-Phase-7 state, no source provenance)

Expected outcome:
- Step 1: All entities get source provenance with `system: 'operator_manual'`
- Step 4: `awards/` collection initialized; six source config paths created
- Step 5: Validation passes all hard checks (V-1, V-5, V-6)
- Validation reports zero soft failures (no orphan edges, no invalid stages)
- `migrations/8.5.1/completedAt` set
- Workspace migration marker shows correct entity counts

## INT-9 — Migration rollback

Scenario: Run migration, then roll back. Verify state matches pre-migration.

Setup:
- Same as INT-8

Expected outcome:
- After migration: state matches expected post-migration
- After rollback: state matches pre-migration exactly
- No data loss or corruption
- Migration marker removed
- Source config paths removed (since no data written to them yet)
- All entity `source` and `migration` fields removed

## INT-10 — Brief synthesis with full source set

Scenario: Workspace with signals from all five sources runs Brief synthesis.

Setup:
- Workspace with realistic mix of recent Signals, Awards, Opportunities
- Watchlist appropriately configured
- Operator pursuit relationships set up

Expected outcome:
- Synthesis runs successfully
- Output has all five categories populated (or empty-state for unpopulated)
- Relevance scoring correctly prioritizes pursuit-linked items
- Deduplication prevents same event from appearing twice
- Soft caps respected
- "Why this surfaced" data is preserved for each item

---

# PART FIVE — END-TO-END TEST SCENARIOS

E2E tests run on staging Cloud Functions against real (or near-real) external sources.

## E2E-1 — Source connectivity smoke

Scenario: For each source, verify Corsair can authenticate and fetch a single record.

Steps:
1. Trigger one-record sync per source via HTTPS callable.
2. Verify auth succeeds.
3. Verify response shape matches expected schema.
4. Log results.

Frequency: weekly in CI.

Failure mode: source API breaking change. Manual intervention required.

## E2E-2 — Daily sync per source

Scenario: Each scheduled job runs its daily/hourly cadence successfully against staging workspace.

Steps:
1. Wait for scheduled trigger.
2. Verify function completes within timeout.
3. Verify records ingested into staging workspace.
4. Verify Source Health updated.

Frequency: continuous (passive monitoring).

## E2E-3 — Migration on staging workspace

Scenario: Deploy migration to staging, run on staging workspace, validate.

Steps:
1. Staging workspace populated with synthetic but realistic data.
2. Operator (test user) triggers migration via UI.
3. Verify migration completes successfully.
4. Verify validation passes.
5. Run rollback.
6. Verify pre-migration state restored.

Frequency: before each production deploy.

## E2E-4 — Operator force-refresh

Scenario: Operator clicks "Force refresh now" on a source. Verify behavior.

Steps:
1. Note current `lastSync` timestamp.
2. Trigger force refresh via UI.
3. Verify progress indicator appears.
4. Verify `lastSync` updates upon completion.
5. Verify any new records appear in workspace.

Frequency: as part of pre-prod sanity check.

## E2E-5 — Disable + re-enable source

Scenario: Operator disables a source, then re-enables.

Steps:
1. Disable SAM.gov via UI.
2. Wait for next scheduled sync time.
3. Verify SAM.gov did NOT sync.
4. Re-enable SAM.gov via UI.
5. Wait for next scheduled sync time.
6. Verify SAM.gov DID sync.

Frequency: pre-prod.

## E2E-6 — Cross-source linkage end-to-end

Scenario: Verify a real GAO protest links to a real SAM.gov solicitation that the workspace tracks.

Steps:
1. Workspace tracks a known active solicitation.
2. Wait for or inject a GAO protest referencing the same solicitation.
3. Verify Brief surface shows the protest linked to the Opportunity.

Frequency: when a suitable real-world scenario exists.

---

# PART SIX — PER-SUB-PHASE TEST PLANS

Mapping spec acceptance criteria to specific test cases.

## Phase 8.5.1 Migration tests

From migration v1 acceptance criteria, the test cases:
- T-1 Fresh workspace migration → INT-8
- T-2 Re-run on migrated workspace → custom unit test
- T-3 Partial completion → custom integration test
- T-4 Mid-flight failure → custom integration test with injected timeout
- T-5 Concurrent operator activity → integration test with simulated concurrent writes
- T-6 Rollback → INT-9
- T-7 Validation failure path → custom integration test with injected anomaly

All seven must pass on the operator's test workspace before production migration.

## Phase 8.5.2 Framework tests

From framework v1 acceptance criteria, test cases group into:
- 13 unit-test bundles covering each framework module
- Integration test for end-to-end mock SourceClient (acceptance criterion 13)
- Staging deploy verification (acceptance criteria 11-12)

## Phase 8.5.3 SAM.gov tests

From samgov-integration v1 acceptance criteria:
- 16 distinct test cases covering criteria 1-16
- INT-1, INT-2, INT-3 cover the highest-priority scenarios
- Additional unit tests for notice type taxonomy, attachment categorization, Q&A log extraction

## Phase 8.5.4 Award integration tests

From award-integration v1 acceptance criteria:
- 15 distinct test cases covering criteria 1-15
- INT-4, INT-5 cover reconciliation and recompete watch
- Additional unit tests for lifecycle state transitions, modification mapping

## Phase 8.5.5/6/7 Signal source tests

From signal-sources v1, per-source acceptance criteria:
- GAO: ~7 test cases (parsing, decision extraction, cross-source linkage)
- SEC EDGAR: ~8 test cases (per filing type, rate limiting strictness)
- Congress.gov: ~9 test cases (hearings, nominations, committees, members)

## Phase 8.5.8 Brief synthesis tests

From brief-synthesis v1 acceptance criteria:
- 14 distinct test cases covering criteria 1-14
- INT-10 covers full synthesis pipeline
- Unit tests for relevance scoring algorithm, dedup logic

## Source Health UI tests

From source-health-ui v1 acceptance criteria:
- Visual state rendering tests (per glyph)
- Layout rendering tests (collapsed, list, detail)
- Interaction tests (click, hover, keyboard)
- Edge case rendering tests (E-1 through E-6)

UI tests use Vitest with React Testing Library (or equivalent for the actual UI framework).

## Watchlist UX tests

From watchlist-ux v1 acceptance criteria:
- Per-dimension editor tests
- Saved search composition tests
- Template application tests
- Volume estimate accuracy tests (over time)
- Suggest-from-pursuits tests

## Onboarding flow tests

From onboarding-flow v1 acceptance criteria:
- Per-step rendering tests
- Branching path tests (Scenario A, B, C)
- Failure recovery tests (F-1 through F-4)
- Resume after abandonment test
- Voice/tone audit (manual review against Part Seven)

---

# PART SEVEN — CI/CD INTEGRATION

How tests run in continuous integration.

## CI pipeline structure

```
On commit:
  1. Lint + type-check                    (10s)
  2. Unit tests                            (30s)
  3. Integration tests (Firebase emulator) (3-5 min)
  4. Build artifacts                       (1 min)

On PR merge to main:
  Same as on commit, plus:
  5. Smoke tests (live source APIs)        (2 min)
  6. Deploy to staging                     (3 min)

Nightly (cron):
  7. E2E tests against staging             (15 min)
  8. Performance tests (sync timing)       (10 min)

Before production deploy:
  9. Operator manual validation             (operator-paced)
```

## Test pyramid distribution

Expected test count distribution:
- Unit: ~400-500 tests (fast, narrow)
- Integration: ~30-50 tests (slower, broader)
- E2E: ~10-15 tests (slowest, broadest)
- Manual: per acceptance criterion validation pass

Total runtime in CI: ~10 minutes for full unit + integration; ~25 minutes including E2E.

## Test failure handling

- Unit test failure: blocks merge.
- Integration test failure: blocks merge.
- Smoke test failure: alerts but does not block merge (source-side issues are not Corsair-side bugs).
- E2E test failure on nightly: investigation required before next production deploy.

## Coverage targets

- Framework modules: ≥90% line coverage.
- Source mappers and parsers: ≥85%.
- Source reconcilers: ≥85%.
- UI surfaces: ≥70% (UI testing is brittle; focus on logic).
- Overall: ≥80%.

Coverage measured via Vitest's built-in coverage. Reports published in CI.

---

# PART EIGHT — TESTING THE TESTS

Some tests are easy to write wrong. Common pitfalls and how to avoid them.

## Trap 1: Fixtures going stale

Fixtures recorded once, never refreshed. Source-side changes invalidate them silently.

Mitigation:
- Quarterly fixture-refresh task.
- Smoke tests catch source format drift before it breaks production.
- `fixtures/{source}/.meta.json` records capture date; review fixtures > 6 months old.

## Trap 2: Mocked components hide real issues

Unit tests pass; integration breaks because mocks didn't simulate the real component faithfully.

Mitigation:
- Integration tests use real Firebase Emulator (not mocked RTDB).
- Mock external HTTP only; mock framework modules sparingly.

## Trap 3: Reconciliation tests miss edge cases

Reconciliation logic is complex; happy-path tests don't surface real bugs.

Mitigation:
- Property-based testing for reconciliation (generate random reasonable inputs; verify invariants).
- Adversarial test cases: deliberately tricky names, dates, identifiers.

## Trap 4: Doctrine compliance not testable in CI

Doctrine §VI compliance is conceptual; CI can't verify it directly.

Mitigation:
- Static analysis: search source code for known anti-patterns (scraping URLs, private-data field names).
- Operator review at each acceptance milestone (L-4 validation).
- Risk register entry R-D1 monitors for inadvertent ingestion.

## Trap 5: Tests becoming bottleneck

Excessive test count slows CI; developers stop running tests locally.

Mitigation:
- Watch mode for unit tests during dev (only re-run affected tests).
- Parallelize CI test stages.
- Trim or skip flaky tests rather than letting them slow everything.

---

# PART NINE — ACCEPTANCE VERIFICATION APPROACH

How each spec's acceptance criteria get verified.

## Verification levels

Each acceptance criterion is verified at one of:
- **Automated:** unit + integration + E2E tests pass; CI confirms.
- **Manual-with-fixture:** test workspace state matches expected post-action state; verifiable via inspection.
- **Manual-judgment:** UI/UX/voice criteria require operator review against design specs.

## Verification record

For each sub-phase shipped, a verification record:

```
## Phase 8.5.X Verification Record
Sub-phase: [name]
Verified at: [date]
Verified by: [operator]

Acceptance criteria status:
  1. [criterion text] — [PASS / FAIL / PARTIAL] — [note]
  2. ...

Test results:
  - Unit tests: [X / Y passing]
  - Integration tests: [X / Y passing]
  - E2E tests: [X / Y passing]
  - Manual validation: [Yes / No]

Sub-phase shipped: [Yes / No]
Sign-off: [operator signature/initials]
```

Records committed to `FLi-Network/verification-records/8.5.X-verification.md`.

## Defect handling

If an acceptance criterion fails:
1. Bug filed.
2. Sub-phase NOT considered shipped until fix lands.
3. Re-verification of affected criteria after fix.
4. Verification record updated with fix details.

No sub-phase ships with failing acceptance criteria. The criteria are the contract.

---

# PART TEN — OPEN IMPLEMENTATION QUESTIONS

## TIQ-1 — Test framework choice

Per framework spec FIQ-5: Vitest recommended over Jest. Build session may override.

**Recommendation:** Confirm Vitest.

## TIQ-2 — UI test framework

If TypeScript + React: Vitest + React Testing Library. If TypeScript + Vue or other: equivalents.

**Recommendation:** Match the UI framework choice (which is part of the existing FLiIntel.html stack — vanilla JS with ES modules).

## TIQ-3 — Performance test scope

Should Phase 8.5 include explicit performance tests (timing benchmarks per source sync)?

**Proposal:** Yes for the framework (rate limiter, batch writes). Not for individual source syncs in Phase 8.5 (premature optimization).

**Recommendation:** Confirm framework-only performance testing.

## TIQ-4 — Property-based testing scope

Property-based testing is powerful but slow to set up. Where to use it?

**Proposal:** Reconciliation logic (highest correctness-critical path). Skip elsewhere for Phase 8.5.

**Recommendation:** Confirm reconciliation-only property testing.

## TIQ-5 — Live-source smoke test scope

How many live-source smoke tests to run weekly?

**Proposal:** One per source per week. Minimal request count (1 request per smoke test).

**Recommendation:** Confirm one per source per week.

## TIQ-6 — Coverage enforcement

Should CI fail builds that don't meet coverage targets?

**Proposal:** Yes, with override for justified exceptions.

**Recommendation:** Confirm enforced coverage with overrides.

## TIQ-7 — Test data privacy

Workspace state fixtures may contain operator-recognizable patterns even when sanitized.

**Proposal:** All fixtures use synthetic but realistic-looking data. No real operator workspace ever exported to fixtures.

**Recommendation:** Confirm synthetic-only fixtures.

## TIQ-8 — Manual validation cadence

Operator manual validation at each sub-phase milestone is heavy. Can some be deferred?

**Proposal:** Operator validates 8.5.1 (migration — high stakes) and 8.5.4 (Award — schema-novel). Other sub-phases get operator's spot-check rather than full validation.

**Recommendation:** Confirm tiered validation requirement.

---

# CLOSING NOTES

## Why testing strategy matters

Phase 8.5 touches operator's existing data and produces new operator-facing intelligence. The trust contract is high. A bug that surfaces wrong intelligence in the Brief, or worse corrupts operator data during migration, destroys the trust Doctrine §IV requires.

Testing is the discipline that makes the contract holdable. Without it, the platform's confidence-building purpose collides with reality.

## Cross-references

- Risk register's R-T5 (migration corruption) is mitigated primarily through migration test scenarios T-1 through T-7.
- Risk register's R-T6 (reconciliation merges) is mitigated through property-based testing of reconciliation logic.
- Risk register's R-T2 (HTML structure changes) is mitigated through smoke tests + parser fallback patterns.

## Maintenance principle

This document is v1.0. As implementation surfaces new test scenarios worth automating, the document gets revised. Per-source test plans get the most frequent revisions as edge cases emerge.

---

*End of testing strategy v1.0.*
