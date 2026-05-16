# CORSAIR PHASE 8.5.2 — CLOUD FUNCTIONS FRAMEWORK SPEC

**Scope:** Shared infrastructure underlying all Tier 1 source integrations (8.5.3 SAM.gov, 8.5.4 USAspending + DoD News, 8.5.5 GAO Protest, 8.5.6 SEC EDGAR, 8.5.7 Congress.gov)
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md), [`corsair-osint-architecture-v1.md`](corsair-osint-architecture-v1.md), [`corsair-osint-migration-v1.md`](corsair-osint-migration-v1.md), [`corsair-osint-award-integration-v1.md`](corsair-osint-award-integration-v1.md), [`corsair-osint-samgov-integration-v1.md`](corsair-osint-samgov-integration-v1.md)
**Status:** Framework spec — defines the reusable middleware layer that all source integrations plug into. Without this framework, each per-source spec re-invents rate limiting, retry, secrets, and logging. With it, source integrations focus only on source-specific extraction and mapping.

---

## Document Purpose

The architecture sketch named the middleware stack (Firebase Cloud Functions 2nd gen with onSchedule triggers). The per-source deep-dives describe what each source produces and how its data maps to Corsair entities. This document fills the gap between the two: the reusable framework that turns the abstract architecture into a concrete pattern source integrations follow.

It is structured as a spec for the build session to implement. The spec is implementation-language-agnostic but assumes JavaScript/TypeScript on Node.js for compatibility with Firebase Cloud Functions. Where decisions branch between TypeScript and JavaScript, the spec recommends TypeScript for Phase 8.5.2 because:
- Schema definitions become enforceable types.
- Source clients implement a defined interface.
- Refactor safety as the framework matures.

The build session may choose JavaScript-only if TypeScript tooling adds disproportionate overhead; the framework patterns work either way.

---

# PART ONE — FRAMEWORK ARCHITECTURE OVERVIEW

## Why a shared framework

The five Tier 1 source integrations share substantial concerns:
- Auth and API key management
- Rate limiting (each source has limits; Corsair must respect them per source)
- Retry with exponential backoff on transient errors
- Structured logging for the Source Health view
- Workspace-scoped data writes with provenance
- Schema versioning and idempotent upserts
- Operator-config reading

Without a shared framework, each source's implementation re-invents these. With a shared framework:
- Each source's implementation reduces to ~300-500 lines of source-specific extraction and mapping logic.
- Cross-cutting concerns (logging, rate limits, secrets) live in one place where they can be improved once and inherited everywhere.
- New sources added in Phase 9+ inherit the entire framework with minimal additional scaffolding.

## What the framework provides

The framework provides nine concrete capabilities:
1. **SourceClient interface and base class** — every source integration extends this.
2. **Rate limiter** — token bucket with per-source configuration.
3. **Retry utility** — exponential backoff state machine.
4. **Secrets manager** — typed access to API keys with rotation support.
5. **Structured logger** — Cloud Logging integration with consistent payload shape.
6. **Error categorizer** — classifies errors as transient/permanent/partial for retry-vs-alert decisions.
7. **RTDB write helpers** — multi-path batched writes, provenance attachment, secondary index management.
8. **Workspace iterator** — drives a sync function across all approved workspaces with isolated state.
9. **Source Health writer** — maintains `workspaces/{wsId}/sources/{system}/lastSync` and `lastError` paths.

## What source-specific code provides

Each source's code provides:
- Source-specific API client (HTTP requests, response parsing).
- Source-specific schema mapping (external record → Corsair entity).
- Source-specific reconciliation logic (when applicable — Award/Opportunity have reconciliation needs that other sources don't).
- Source-specific configuration schema (what watchlist fields the source needs).

The boundary is clean: framework knows nothing about NAICS codes or PIIDs; source code knows nothing about RTDB paths or Cloud Logging payload shapes.

## Architectural principles

The framework follows four principles:

**Idempotency by default.** Every operation can be re-run without harm. Source syncs that succeed produce the same outcome on second run as on first run.

**Workspace isolation.** No source code reads or writes data outside its workspace's scope. Cross-workspace inference is explicitly out of scope.

**Operator-visible state.** Every operation that affects what the operator sees writes structured state that the Source Health view can consume.

**Doctrine §IV compliance.** When the framework doesn't know something with confidence (a sync failed, an API returned ambiguous data), it surfaces that state to the operator rather than pretending success.

---

# PART TWO — REPOSITORY LAYOUT

The architecture sketch sketched the `functions/` directory. This section makes the layout concrete.

```
FLi-Network/
├── FLiIntel.html                      (existing — client app, untouched by this work)
├── js/corsair/                        (existing — client ES modules)
├── functions/                         (NEW — Cloud Functions home)
│   ├── package.json                   (Node 20+, firebase-admin, firebase-functions)
│   ├── tsconfig.json                  (if TypeScript)
│   ├── .firebaserc                    (firebase project linkage)
│   ├── firebase.json                  (functions deploy config)
│   ├── .env.example                   (template; .env in .gitignore)
│   ├── README.md                      (build session entry point)
│   │
│   ├── src/
│   │   ├── index.ts                   (entry — registers all scheduled functions)
│   │   │
│   │   ├── framework/
│   │   │   ├── SourceClient.ts        (interface + abstract base class)
│   │   │   ├── rateLimit.ts           (token bucket implementation)
│   │   │   ├── retry.ts               (retry state machine)
│   │   │   ├── secrets.ts             (typed secret accessor)
│   │   │   ├── logger.ts              (structured Cloud Logging)
│   │   │   ├── errors.ts              (error categorization + types)
│   │   │   ├── rtdb.ts                (Admin SDK wrapper + path helpers)
│   │   │   ├── provenance.ts          (E-4 source-provenance helper)
│   │   │   ├── workspaceIterator.ts   (drives sync across approved workspaces)
│   │   │   ├── sourceHealth.ts        (writes /sources/{system}/lastSync + lastError)
│   │   │   ├── batchWrite.ts          (multi-path RTDB upserts)
│   │   │   ├── hashing.ts             (content-hash helpers for change detection)
│   │   │   └── types/
│   │   │       ├── entities.ts        (Award, Opportunity, etc. type defs)
│   │   │       ├── signals.ts         (Signal type variants)
│   │   │       └── provenance.ts      (SourceProvenance type)
│   │   │
│   │   ├── sources/
│   │   │   ├── samGov/
│   │   │   │   ├── client.ts          (SAM.gov-specific HTTP client)
│   │   │   │   ├── mapper.ts          (notice → Opportunity mapping)
│   │   │   │   ├── reconciler.ts      (operator-created vs. SAM.gov)
│   │   │   │   ├── config.ts          (config schema for SAM.gov)
│   │   │   │   └── index.ts           (exported SourceClient implementation)
│   │   │   ├── usaSpending/
│   │   │   │   ├── client.ts
│   │   │   │   ├── mapper.ts
│   │   │   │   ├── awardReconciler.ts (DoD News ↔ USAspending reconciliation)
│   │   │   │   ├── orgResolver.ts     (recipient name → Organization)
│   │   │   │   ├── config.ts
│   │   │   │   └── index.ts
│   │   │   ├── dodNewsContracts/
│   │   │   │   ├── client.ts          (HTML scraper)
│   │   │   │   ├── parser.ts          (announcement → provisional Award)
│   │   │   │   ├── config.ts
│   │   │   │   └── index.ts
│   │   │   ├── gaoProtest/
│   │   │   │   ├── client.ts
│   │   │   │   ├── parser.ts
│   │   │   │   ├── decisionExtractor.ts
│   │   │   │   ├── config.ts
│   │   │   │   └── index.ts
│   │   │   ├── secEdgar/
│   │   │   │   ├── client.ts
│   │   │   │   ├── filingParser.ts
│   │   │   │   ├── tickerResolver.ts
│   │   │   │   ├── config.ts
│   │   │   │   └── index.ts
│   │   │   └── congressGov/
│   │   │       ├── client.ts
│   │   │       ├── hearingMapper.ts
│   │   │       ├── nominationMapper.ts
│   │   │       ├── committeeResolver.ts
│   │   │       ├── config.ts
│   │   │       └── index.ts
│   │   │
│   │   ├── jobs/                      (scheduled trigger entry points)
│   │   │   ├── samGovHourly.ts
│   │   │   ├── usaSpendingNightly.ts
│   │   │   ├── usaSpendingSubawardWeekly.ts
│   │   │   ├── dodNewsBusinessDaily.ts
│   │   │   ├── gaoProtestDaily.ts
│   │   │   ├── secEdgarFrequent.ts
│   │   │   ├── congressGovDaily.ts
│   │   │   └── sourceHealthHourly.ts  (rolls up source state for the Brief view)
│   │   │
│   │   ├── migrations/
│   │   │   ├── migrate851.ts          (Phase 8.5.1 migration runner)
│   │   │   └── helpers.ts
│   │   │
│   │   └── http/                      (HTTPS callable functions for client interactions)
│   │       ├── triggerSync.ts         (operator-initiated source sync)
│   │       ├── triggerMigration.ts    (operator-initiated workspace migration)
│   │       ├── triggerInventory.ts    (operator-initiated migration pre-inventory)
│   │       └── triggerRollback.ts     (operator-initiated migration rollback)
│   │
│   ├── tests/
│   │   ├── framework/                 (framework unit tests)
│   │   ├── sources/                   (per-source unit tests with API fixtures)
│   │   └── integration/               (end-to-end tests against a Firebase emulator)
│   │
│   └── fixtures/                      (API response fixtures for testing)
│       ├── samGov/
│       ├── usaSpending/
│       ├── dodNewsContracts/
│       ├── gaoProtest/
│       ├── secEdgar/
│       └── congressGov/
└── corsair-osint-*.md                 (research and design artifacts)
```

## Per-directory responsibilities

**`functions/src/framework/`** — Cross-cutting infrastructure. Should never reference source-specific concepts.

**`functions/src/sources/{sourceName}/`** — Source-specific extraction and mapping. References framework modules but not other source modules.

**`functions/src/jobs/`** — Thin scheduled-trigger wrappers. Each job is a 20-50-line entry point that:
1. Loads the SourceClient.
2. Iterates approved workspaces.
3. Invokes `syncDelta` per workspace.
4. Logs aggregate outcomes.

**`functions/src/migrations/`** — One-time / phase-specific migration runners. Phase 8.5.1 lives here.

**`functions/src/http/`** — HTTPS callable functions for operator-initiated actions from the Corsair client. Auth-protected via Firebase Auth integration.

**`functions/tests/`** — Tests. Framework tests are unit-level; source tests use API response fixtures; integration tests run against the Firebase Emulator Suite.

**`functions/fixtures/`** — Recorded API responses from each source. Used as test inputs to avoid hitting live APIs in tests.

## Deployment grouping

Cloud Functions can be deployed individually or as groups. Recommended deployment groups:

```
firebase deploy --only functions:framework     (no functions deploy; pure shared code)
firebase deploy --only functions:samGov
firebase deploy --only functions:usaSpending
firebase deploy --only functions:dodNewsContracts
firebase deploy --only functions:gaoProtest
firebase deploy --only functions:secEdgar
firebase deploy --only functions:congressGov
firebase deploy --only functions:migrations
firebase deploy --only functions:http
```

Each scheduled function (e.g., `samGovHourly`) is its own deployable unit. Grouping is by source for ease of rollback (if SAM.gov has a problem, only SAM.gov functions need redeploy).

---

# PART THREE — PER-SOURCE ORCHESTRATION TEMPLATE

Every source integration extends a common interface. This standardization is what makes the framework valuable.

## The SourceClient interface

```typescript
interface SourceClient<TConfig, TRecord, TEntity> {
  // Identity
  readonly name: string;                    // 'samgov' | 'usaspending' | ...
  readonly displayName: string;             // 'SAM.gov' | 'USAspending.gov' | ...
  readonly version: string;                 // semver for the source integration

  // Lifecycle
  initialize(): Promise<void>;              // load secrets, verify auth, warm caches
  shutdown(): Promise<void>;                // graceful close (release rate-limiter, flush logs)

  // Configuration
  loadConfig(workspaceId: string): Promise<TConfig>;
  validateConfig(config: TConfig): ConfigValidationResult;

  // Sync operations
  syncDelta(workspaceId: string, options: SyncOptions): Promise<SyncResult>;
  syncBackfill(workspaceId: string, options: BackfillOptions): Promise<SyncResult>;
  syncOnDemand(workspaceId: string, recordId: string): Promise<TEntity | null>;

  // Mapping
  mapRecord(record: TRecord, context: MappingContext): Promise<TEntity[]>;

  // Health
  reportHealth(workspaceId: string): Promise<SourceHealthSnapshot>;
}
```

## Standard lifecycle

Every source's scheduled job follows this sequence:

```typescript
async function runScheduledSync(client: SourceClient, options: ScheduleOptions): Promise<void> {
  const logger = createLogger({ source: client.name, jobId: generateJobId() });
  const errors: JobError[] = [];

  try {
    await client.initialize();
    logger.info('client_initialized');

    const workspaces = await iterateApprovedWorkspaces(client.name);
    logger.info('workspaces_loaded', { count: workspaces.length });

    for (const workspaceId of workspaces) {
      const workspaceLogger = logger.child({ workspace: workspaceId });
      try {
        const config = await client.loadConfig(workspaceId);
        const validationResult = client.validateConfig(config);
        if (!validationResult.valid) {
          workspaceLogger.warn('config_invalid', validationResult.errors);
          continue;
        }

        const result = await client.syncDelta(workspaceId, options.syncOptions);
        await writeSourceHealth(workspaceId, client.name, {
          lastSyncAt: Date.now(),
          lastError: null,
          recordsFetched: result.recordsFetched,
          recordsUpserted: result.recordsUpserted
        });
        workspaceLogger.info('sync_succeeded', result);
      } catch (error) {
        const categorized = categorizeError(error);
        await writeSourceHealth(workspaceId, client.name, {
          lastSyncAt: null,            // sync did not complete
          lastError: {
            occurredAt: Date.now(),
            category: categorized.category,
            message: categorized.message,
            retriable: categorized.retriable
          }
        });
        workspaceLogger.error('sync_failed', categorized);
        errors.push({ workspaceId, ...categorized });
      }
    }
  } finally {
    await client.shutdown();
    logger.info('job_completed', { workspacesProcessed: workspaces.length, errorCount: errors.length });
  }
}
```

This orchestration pattern is in the framework. Every job file is ~10-20 lines that calls into this pattern with source-specific options.

## Sync options

```typescript
interface SyncOptions {
  since?: number;            // timestamp; default = workspace.lastSync
  until?: number;            // timestamp; default = now
  limit?: number;            // max records to fetch in this sync; default = unlimited
  dryRun?: boolean;          // log what would happen but don't write
  forceRefresh?: boolean;    // ignore hash-based change detection; refresh all
}

interface SyncResult {
  recordsFetched: number;
  recordsUpserted: number;
  recordsSkipped: number;       // hash matched; no write
  recordsErrored: number;
  errors: Array<{ recordId: string; error: JobError }>;
  durationMs: number;
  apiCallsCount: number;
  apiCallsBudget: number;
  apiCallsRemaining: number;
}
```

## Mapping context

```typescript
interface MappingContext {
  workspaceId: string;
  existingEntities: {
    organizations: OrganizationLookup;     // pre-loaded for matching efficiency
    awards: AwardLookup;
    opportunities: OpportunityLookup;
    persons: PersonLookup;
  };
  config: any;                              // source's loaded config
  now: number;
  logger: Logger;
}
```

The framework pre-loads existing entity lookups before invoking `mapRecord`. This avoids per-record RTDB reads during mapping and makes resolution operations fast.

---

# PART FOUR — RATE LIMITER DESIGN

Each source has a published or observed rate limit. The framework provides a per-source token bucket with persistence across function invocations.

## Token bucket model

A token bucket has:
- **Capacity** — maximum tokens at any time (burst limit).
- **Refill rate** — tokens added per second.
- **Current tokens** — current available count.

Each API call consumes one token. If the bucket is empty, the call must wait or fail.

Per-source configuration:
```typescript
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  samgov: { capacity: 10, refillPerSecond: 0.278, dailyBudget: 1000 },          // 10/sec burst, 1000/hr
  usaspending: { capacity: 5, refillPerSecond: 0.278, dailyBudget: 1000 },      // 1000/hr
  dod_news: { capacity: 1, refillPerSecond: 0.5 },                              // polite scrape, 1 req per 2 sec
  gao_protest: { capacity: 1, refillPerSecond: 0.5 },                           // polite scrape
  sec_edgar: { capacity: 10, refillPerSecond: 10 },                             // 10/sec strict
  congress_gov: { capacity: 5, refillPerSecond: 1.389, dailyBudget: 5000 }      // 5000/hr
};
```

## Persistence model

Cloud Functions instances are ephemeral; in-process state vanishes between invocations. The framework persists rate limiter state to RTDB:

```
_systemState/rateLimiters/{source}/
  ├── tokens: number              (current tokens)
  ├── lastRefillAt: timestamp     (last update)
  └── dailyConsumed: number       (today's API call count; reset at UTC midnight)
```

Each function invocation:
1. Reads current state.
2. Computes refill since `lastRefillAt`.
3. Updates `tokens` and `lastRefillAt`.
4. Attempts to consume tokens for the operation.
5. If insufficient tokens, waits (with timeout) or fails-fast based on operation policy.

## Concurrency

Multiple Cloud Function instances may run concurrently (parallel workspace syncs). The rate limiter uses RTDB transactions to atomically decrement the token count, preventing over-consumption.

```typescript
async function consumeTokens(source: string, count: number): Promise<TokenConsumeResult> {
  return rtdb.ref(`_systemState/rateLimiters/${source}`).transaction((current) => {
    if (current === null) {
      return { tokens: RATE_LIMITS[source].capacity - count, lastRefillAt: Date.now(), dailyConsumed: count };
    }
    const refillTokens = computeRefillSince(current.lastRefillAt, source);
    const tokens = Math.min(current.tokens + refillTokens, RATE_LIMITS[source].capacity);
    if (tokens < count) {
      return; // abort transaction; signal "rate limited"
    }
    return {
      tokens: tokens - count,
      lastRefillAt: Date.now(),
      dailyConsumed: current.dailyConsumed + count
    };
  });
}
```

## 429 response handling

When a source returns 429:
1. Inspect `Retry-After` header. If present, wait that long (with safety margin).
2. If absent, exponential backoff: 5s, 15s, 60s, 300s.
3. Refresh token bucket state from RTDB after waiting.
4. Reset the local-job retry counter.

## Burst handling

For sources with bursty limits (SAM.gov: 10/sec but 1000/hour), the framework allows bursts up to capacity, then enforces refill rate. A workspace job that needs 100 requests rapidly will:
- First 10 happen immediately (consume burst capacity).
- Next 90 happen at 0.278/sec (the refill rate) — total time ~5.4 minutes.

If the job's total budget would exceed the daily limit, fail-fast and queue for next cycle.

## Daily budget enforcement

Daily budgets (e.g., SAM.gov 1000/hour but per-day caps at 1000) prevent a single workspace from monopolizing the application-wide key allocation. Per OQ-4: single application key for Phase 8.5, with per-tier sharding at 15+ workspaces.

When daily consumed > `dailyBudget * 0.9`, framework emits warning to Source Health view: "API budget approaching limit — sync may queue for tomorrow."

---

# PART FIVE — RETRY UTILITY

Retry logic separates from rate limiting. Rate limiting decides whether to send; retry decides what to do when sending fails.

## Retry state machine

```
[attempt 1] ── network error ─→ [wait backoff(1)] ─→ [attempt 2]
                                                          │
                                ┌──── 429 ─────→ [wait Retry-After] ─→ [attempt 2]
                                │
[attempt 2] ─── 5xx ─→ [wait backoff(2)] ─→ [attempt 3]
                                                  │
                                ┌── 4xx (not 429) → [error: don't retry; alert]
                                │
[attempt 3] ── success ───────────────────────→ [return result]
                                                  │
                                ┌── exhausted ──→ [error: permanent fail; dead-letter]
```

## Backoff parameters

```typescript
interface RetryConfig {
  maxAttempts: number;           // total attempts including first
  backoffMs: number[];            // backoff delays per retry
  retriableStatusCodes: number[]; // HTTP status codes to retry
  retriableErrorTypes: string[];  // network error categories to retry
  perAttemptTimeoutMs: number;    // each attempt's own timeout
  totalDeadlineMs: number;        // wall-clock deadline; never retry past this
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 4,
  backoffMs: [1000, 5000, 30000],   // 1s, 5s, 30s between attempts
  retriableStatusCodes: [408, 429, 500, 502, 503, 504],
  retriableErrorTypes: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'],
  perAttemptTimeoutMs: 30000,
  totalDeadlineMs: 120000
};

// Source-specific overrides
const RETRY_CONFIGS: Record<string, Partial<RetryConfig>> = {
  sec_edgar: {
    maxAttempts: 6,
    backoffMs: [30000, 60000, 120000, 300000, 600000],   // SEC EDGAR ban-risk; long backoffs
  },
  dod_news: {
    maxAttempts: 3,
    backoffMs: [2000, 10000],                              // scrape — short retries acceptable
  }
};
```

## Idempotency

Retries must be safe. The framework enforces idempotency by:
- All HTTP fetches are GETs or stateless POSTs (no side effects on the server).
- All RTDB writes are upserts (idempotent by entity ID and content hash).
- Retry happens only on the fetch step, not on the write step. If a fetch succeeds and writing fails, the entire record processing fails (retry on the next sync cycle picks it up).

## Dead-letter queue

When retries are exhausted:
```
workspaces/{wsId}/sources/{system}/deadLetterQueue/{recordId} = {
  recordId,
  failedAt: timestamp,
  attempts: number,
  error: { category, message, statusCode? },
  rawPayload: any              (the source data that couldn't be processed)
}
```

Operator sees dead-letter queue size in Source Health view. Operator action: review (drill into individual failures, attempt manual remediation, or dismiss as data quality issue).

---

# PART SIX — SECRETS MANAGEMENT

API keys and other sensitive credentials must not appear in source code, must not be committed to git, must not be readable from the client.

## Storage options

Three viable storage mechanisms:

**Option A: Firebase Functions config** (`firebase functions:config:set`)
- Pros: Native to Firebase. Free. Trivial to set.
- Cons: Deprecated for 2nd-gen functions in favor of Secret Manager. Visible to anyone with Firebase Console access. No rotation history.
- Use: Phase 8.5.2 initial deployment for low-sensitivity keys (free API keys with no real risk).

**Option B: Google Secret Manager**
- Pros: First-class Google Cloud secret store. Rotation history. IAM-controlled access. Versioned secrets.
- Cons: Slight cost (~$0.06/secret/month). One additional service.
- Use: Production deployment for any key Corsair would not want disclosed.

**Option C: Environment variables via `.env`**
- Pros: Familiar pattern.
- Cons: Mixing local dev secrets and production secrets is error-prone. Not auditable.
- Use: Local development only.

## Recommendation

**For Phase 8.5.2 first deploy:** Functions config for all keys. Simple, free, works.

**For production hardening (Phase 9+):** Migrate to Secret Manager. The framework's `secrets.ts` module abstracts the access, so the migration is internal.

## Typed secret accessor

```typescript
// secrets.ts
interface Secrets {
  samgov: { apiKey: string };
  congressgov: { apiKey: string };
  secEdgar: { userAgent: string };
  // sources that don't need keys (usaspending, dod_news, gao_protest) are absent
}

let cachedSecrets: Secrets | null = null;

export async function getSecrets(): Promise<Secrets> {
  if (cachedSecrets) return cachedSecrets;

  cachedSecrets = {
    samgov: { apiKey: process.env.SAMGOV_API_KEY || functions.config().samgov?.api_key },
    congressgov: { apiKey: process.env.CONGRESSGOV_API_KEY || functions.config().congressgov?.api_key },
    secEdgar: { userAgent: process.env.SEC_USER_AGENT || functions.config().sec_edgar?.user_agent }
  };

  validateSecrets(cachedSecrets);
  return cachedSecrets;
}

function validateSecrets(secrets: Secrets): void {
  // throw if required secrets are missing
  if (!secrets.samgov.apiKey) throw new ConfigError('SAM.gov API key missing');
  if (!secrets.congressgov.apiKey) throw new ConfigError('Congress.gov API key missing');
  if (!secrets.secEdgar.userAgent) throw new ConfigError('SEC EDGAR User-Agent missing');
}
```

## Key rotation procedure

1. Generate new key from source's registration portal.
2. Set new key via `firebase functions:config:set samgov.api_key="<new_key>"` (or via Secret Manager).
3. Deploy functions: `firebase deploy --only functions:samGov`.
4. Verify new key works via test sync on a single workspace.
5. Revoke old key at source portal.

Total rotation time: ~5 minutes. Operator-driven; not automated in Phase 8.5.

## Access control

Functions config is readable by anyone with Firebase project Owner or Editor IAM role. Secret Manager allows per-secret IAM grants. Production deployments should restrict who has access.

For Phase 8.5.2, the operator is the sole IAM principal with access to keys. Future expansion (additional operators on a team) requires explicit IAM grant.

---

# PART SEVEN — STRUCTURED LOGGING

All framework operations emit structured logs to Cloud Logging. The Source Health view, error alerts, and debugging all depend on consistent log shape.

## Log envelope

Every log entry has the standard envelope:
```typescript
interface LogEnvelope {
  // Timestamp
  timestamp: string;                // ISO 8601, set automatically by Cloud Logging

  // Severity
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

  // Context
  source: string;                   // 'samgov' | 'usaspending' | ...
  workspace?: string;
  jobId?: string;
  attempt?: number;

  // Message
  message: string;                  // human-readable summary
  event: string;                    // machine-parseable event code

  // Payload
  payload?: Record<string, any>;    // event-specific structured data

  // Error context (only on severity ERROR+)
  errorCategory?: ErrorCategory;
  errorCode?: string;
  errorMessage?: string;
  stackTrace?: string;
}
```

## Standard event codes

The framework defines a catalog of standard event codes that all sources use:

| Event code | Severity | Emitted by |
|---|---|---|
| `client_initialized` | INFO | SourceClient.initialize() |
| `client_shutdown` | INFO | SourceClient.shutdown() |
| `workspaces_loaded` | INFO | workspaceIterator |
| `config_loaded` | INFO | loadConfig() success |
| `config_invalid` | WARNING | validateConfig() failure |
| `sync_started` | INFO | syncDelta() entry |
| `sync_succeeded` | INFO | syncDelta() success |
| `sync_failed` | ERROR | syncDelta() failure |
| `rate_limit_hit` | WARNING | rate limiter denied |
| `rate_limit_recovered` | INFO | tokens replenished |
| `retry_attempt` | INFO | retry utility |
| `retry_exhausted` | ERROR | retry utility |
| `record_upserted` | DEBUG | per-record write |
| `record_skipped_unchanged` | DEBUG | hash matched |
| `record_errored` | WARNING | per-record processing failure |
| `dead_letter_queued` | WARNING | retry exhausted |
| `reconciliation_match` | INFO | reconciler matched |
| `reconciliation_review` | INFO | reconciler queued for review |
| `organization_resolved` | DEBUG | org resolver matched |
| `organization_created` | INFO | org resolver auto-created |
| `secondary_index_written` | DEBUG | batch index write |

## Per-job log structure

A typical job invocation produces:

```
[INFO]  job_started      { jobId: 'samGovHourly-2026-05-15T13:00:00Z' }
[INFO]  client_initialized
[INFO]  workspaces_loaded { count: 5 }
  ... for each workspace ...
  [INFO]  sync_started      { workspace: 'ws_abc' }
  [INFO]  config_loaded     { workspace: 'ws_abc', filterCount: 3 }
  [DEBUG] record_upserted   { workspace: 'ws_abc', recordId: 'notice_xyz' } × 25
  [INFO]  sync_succeeded    { workspace: 'ws_abc', recordsUpserted: 25, durationMs: 4500 }
[INFO]  job_completed     { workspacesProcessed: 5, errorCount: 0, totalDurationMs: 18000 }
```

## Aggregation queries for Source Health

The Source Health view consumes log queries via Cloud Logging's structured query language. Example queries:

```
-- Most recent sync per workspace per source
SELECT workspace, source, MAX(timestamp) AS lastSync
FROM logs
WHERE event = 'sync_succeeded'
GROUP BY workspace, source

-- Error rate in last 24 hours per source
SELECT source, COUNT(*) FILTER (WHERE severity = 'ERROR') AS errors,
                       COUNT(*) AS total
FROM logs
WHERE timestamp > now() - INTERVAL 24 HOUR
GROUP BY source
```

For Phase 8.5.2, the Source Health view reads pre-aggregated state from RTDB (`workspaces/{wsId}/sources/{system}/lastSync` and `lastError`) which the framework writes after each job. Cloud Logging is for debugging and audit; RTDB is for the UI.

## Retention

Cloud Logging default retention is 30 days. For longer-term audit, export to Cloud Storage with a sink. Phase 8.5.2 ships with default retention; longer retention is a Phase 9+ consideration.

---

# PART EIGHT — ERROR CATEGORIZATION

The framework distinguishes error types so retry, alert, and operator-action logic is consistent across sources.

## Error categories

```typescript
type ErrorCategory =
  | 'transient'              // retry; expected to succeed eventually
  | 'rate_limited'           // wait per Retry-After then retry
  | 'permanent'              // do not retry; alert operator
  | 'auth_failed'            // do not retry; alert operator urgently
  | 'config_invalid'         // do not retry; alert operator with config remediation
  | 'schema_mismatch'        // do not retry; possibly source format change
  | 'quota_exhausted'        // wait until quota refill; long deferred retry
  | 'partial_success'        // commit what succeeded; alert on failed items
  | 'doctrine_violation';    // hard stop; operator must intervene
```

## Categorization rules

```typescript
function categorizeError(error: any): CategorizedError {
  // HTTP status code categorization
  if (error.statusCode === 429) return { category: 'rate_limited', retriable: true };
  if (error.statusCode === 401 || error.statusCode === 403) {
    return { category: 'auth_failed', retriable: false, requiresOperator: true };
  }
  if (error.statusCode >= 500) return { category: 'transient', retriable: true };
  if (error.statusCode >= 400 && error.statusCode < 500) {
    return { category: 'permanent', retriable: false };
  }

  // Network errors
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) {
    return { category: 'transient', retriable: true };
  }

  // Schema errors
  if (error instanceof SchemaValidationError) {
    return { category: 'schema_mismatch', retriable: false, requiresOperator: true };
  }

  // Doctrine violations
  if (error instanceof DoctrineViolationError) {
    return { category: 'doctrine_violation', retriable: false, requiresOperator: true, urgent: true };
  }

  // Default
  return { category: 'permanent', retriable: false };
}
```

## Operator-facing surfacing

Each category surfaces differently in the Source Health view:
- **transient** — invisible (silently retried).
- **rate_limited** — visible if persistent for > 1 hour ("API throttling — sync slowed").
- **permanent** — visible with error detail ("Source returned 404 for record xyz").
- **auth_failed** — RED status ("API key invalid; sync stopped").
- **config_invalid** — AMBER status with remediation hint ("Watchlist config missing required NAICS field").
- **schema_mismatch** — RED status ("Source data format changed; integration needs update").
- **quota_exhausted** — AMBER status with recovery time ("Daily quota reached; will resume tomorrow").
- **partial_success** — GREEN status with sub-state ("Sync complete with N partial failures; review queue available").
- **doctrine_violation** — RED status, urgent alert, sync halted ("Doctrine §VI violation detected: action required").

---

# PART NINE — RTDB WRITE PATTERNS

Multi-source writes touch many paths. The framework provides consistent write helpers.

## Multi-path update batching

Firebase RTDB supports atomic multi-path updates via `update({ path1: value1, path2: value2 })`. The framework batches related writes:

```typescript
async function batchUpsertEntities(
  workspaceId: string,
  entities: Array<{ path: string, value: any, secondaryIndexes?: Record<string, any> }>
): Promise<BatchResult> {
  const update: Record<string, any> = {};
  for (const entity of entities) {
    update[`workspaces/${workspaceId}/${entity.path}`] = entity.value;
    if (entity.secondaryIndexes) {
      for (const [indexPath, indexValue] of Object.entries(entity.secondaryIndexes)) {
        update[`workspaces/${workspaceId}/${indexPath}`] = indexValue;
      }
    }
  }
  return rtdb.ref().update(update);
}
```

Practical batch size: 500 paths per update. Larger batches risk transaction size limits.

## Workspace-scoped locks

For long-running operations (initial backfill, migration), the framework acquires a workspace-source lock:

```
workspaces/{wsId}/sources/{system}/locks/{operation} = {
  acquiredAt: timestamp,
  acquiredBy: <functionInstanceId>,
  expiresAt: timestamp,                  // 5 min lease typically
  operation: 'sync' | 'backfill' | 'migration'
}
```

Lock acquisition is via RTDB transaction (atomic check-and-set). Lock expiration prevents permanent locks if a function crashes. Stale locks are reclaimable after `expiresAt`.

## Provenance attachment helper

```typescript
function attachProvenance<T>(
  entity: T,
  source: SourceProvenance
): T & { source: SourceProvenance; updatedAt: number } {
  return {
    ...entity,
    source: {
      ...source,
      fetchedAt: source.fetchedAt || Date.now(),
      refreshedAt: Date.now()
    },
    updatedAt: Date.now()
  };
}
```

Every entity write goes through this helper. The framework refuses to write entities without provenance.

## Secondary index writes

Per the per-source specs (Award has `awardsByPopEnd`, etc.), secondary indexes are duplicative-but-fast paths. The framework computes index entries from a canonical record:

```typescript
function computeSecondaryIndexes(award: Award): Record<string, any> {
  return {
    [`awardsByPopEnd/${epochDayOf(award.popEnd)}/${award.id}`]: { id: award.id, primeOrgId: award.primeOrgId, popEnd: award.popEnd },
    [`awardsByPrime/${award.primeOrgId}/${award.id}`]: { id: award.id, popEnd: award.popEnd },
    [`awardsByCustomer/${award.customerOrgId}/${award.id}`]: { id: award.id, popEnd: award.popEnd },
    [`awardsByNaics/${award.naics}/${award.id}`]: { id: award.id, popEnd: award.popEnd },
    [`awardsByLifecycle/${award.lifecycleState}/${award.id}`]: { id: award.id }
  };
}
```

Each entity type has its own `computeSecondaryIndexes` function in its respective `framework/types/{entity}Indexes.ts` module.

## Hash-based change detection

Every entity computes a content hash of stable fields:

```typescript
function computeContentHash(entity: any, fields: string[]): string {
  const stable = pickFields(entity, fields);
  return sha256(JSON.stringify(stable, Object.keys(stable).sort()));
}
```

Per-entity-type field lists (defined per AIQ-6 confirmed in Award spec):
- Award: `[obligated, popEnd, lastModifiedAt, modifications.length, description.slice(0,500)]`
- Opportunity: `[title, naicsCodes, samgovResponseDeadline, descriptionText.slice(0,500), amendmentNumber]`
- Signal: `[type, occurredAt, attrs (deterministically serialized)]`

Before writing, the framework compares `existingHash` vs. `newHash`. If equal, skip write. If different, write and update hash.

## Idempotent upsert pattern

```typescript
async function upsertEntity<T>(workspaceId: string, entityType: string, entityId: string, newValue: T): Promise<UpsertResult> {
  const path = `workspaces/${workspaceId}/${entityType}/${entityId}`;
  const existing = await rtdb.ref(path).once('value').then(s => s.val());

  if (existing) {
    // Check for operator overrides — preserve operator-edited fields
    const merged = mergePreservingOperatorOverrides(existing, newValue);
    if (computeContentHash(merged) === computeContentHash(existing)) {
      return { written: false, reason: 'unchanged' };
    }
    await rtdb.ref(path).set(attachProvenance(merged, source));
    return { written: true, action: 'updated' };
  } else {
    await rtdb.ref(path).set(attachProvenance(newValue, source));
    return { written: true, action: 'created' };
  }
}
```

The `mergePreservingOperatorOverrides` helper consults `entity.reconciliation.operatorOverrides[]` and copies operator-set values from `existing` to `merged`, preventing overwrite.

---

# PART TEN — DEPLOYMENT PIPELINE

The framework deploys to three environments: local dev, staging, production.

## Local development

```bash
# In functions/ directory
npm install
firebase emulators:start --only functions,database,auth
# Functions run locally against the Firebase Emulator Suite
# Use http://localhost:9000 for emulated RTDB
# Mock API responses from fixtures/ avoid hitting live external sources
```

Development uses `.env` with development keys. `.env` is gitignored.

## Staging

Separate Firebase project (`corsair-staging`). Functions deploy via:
```bash
firebase use staging
firebase deploy --only functions
```

Staging uses real external APIs but a separate workspace. Operator tests new function deployments here before promoting.

## Production

```bash
firebase use production
firebase deploy --only functions:samGov   # or specific function group
```

Production deploys are operator-initiated only. No CI/CD auto-deploy for Phase 8.5. The operator deploys after manual staging validation.

## Feature flags per function

```
_systemState/featureFlags/{flagName} = boolean
```

Each function checks its feature flag at start:
```typescript
async function samGovHourly() {
  if (!await isFeatureFlagEnabled('samgov.enabled')) {
    logger.info('feature_disabled', { source: 'samgov' });
    return;
  }
  // ... rest of job ...
}
```

This allows the operator to enable/disable specific source syncs without redeploying. Useful for incident response (e.g., SEC EDGAR returning bad data; operator disables `secEdgar.enabled` flag while problem is investigated).

## Rollback procedure

Cloud Functions supports versioned deployments. To roll back:
```bash
firebase functions:rollback samGovHourly
```

Or via Cloud Console for fine-grained version selection.

Functions config rollback (for key rotation rollback) requires re-setting via `firebase functions:config:set`.

## Monitoring and alerting

Phase 8.5.2 ships with:
- Source Health view in Brief surface (operator-visible).
- Cloud Logging structured logs (for debugging).

Phase 9+ additions:
- Email alerts on `auth_failed` and `doctrine_violation` errors.
- Slack integration for error notifications.
- SLO/SLI tracking on sync success rate.

For Phase 8.5.2, the operator monitors via daily check of the Source Health view.

---

# PART ELEVEN — ACCEPTANCE CRITERIA

Phase 8.5.2 framework is shippable when all of the following are demonstrably true:

1. **SourceClient interface is defined** and exported from `framework/SourceClient.ts`. All five source integrations (when implemented in 8.5.3-8.5.7) extend this interface.
2. **Rate limiter works correctly** — load tests confirm per-source limits are enforced; concurrent function instances do not over-consume.
3. **Retry utility works correctly** — load tests with simulated transient errors confirm successful retry; permanent errors fail-fast without retry.
4. **Secrets management works** — API keys load from Functions config; missing keys produce clear error messages, not silent failures.
5. **Structured logging works** — every standard event code produces a parseable log entry; Cloud Logging queries return expected results.
6. **Error categorization works** — 5xx errors categorized as transient, 4xx (not 429) as permanent, 429 as rate_limited, etc.
7. **RTDB write helpers work** — batch upsert, secondary index writes, hash-based change detection, idempotent upserts all function correctly.
8. **Workspace iterator works** — `iterateApprovedWorkspaces(sourceName)` returns only workspaces where migration 8.5.1 is complete and the source is enabled in config.
9. **Source Health writes work** — every sync attempt writes `lastSync` (on success) or `lastError` (on failure) to `workspaces/{wsId}/sources/{system}/`.
10. **Feature flags work** — `featureFlags/{flagName}` reads correctly; disabling a flag halts the corresponding function on next invocation.
11. **Local development with emulators works** — full dev environment runs without hitting live APIs.
12. **Deployment pipeline works** — staging and production deploys succeed via documented commands.
13. **A minimal SourceClient implementation** (no real source — a fixture-based mock) can be deployed and run successfully end-to-end against the framework, demonstrating the framework is complete enough for source integrations to plug in.

When all 13 criteria are met, Phase 8.5.2 is accepted and Phase 8.5.3 (SAM.gov), Phase 8.5.4 (USAspending + DoD News), and subsequent source integrations can begin.

---

# PART TWELVE — OPEN IMPLEMENTATION QUESTIONS

## FIQ-1 — TypeScript vs. JavaScript

**Recommendation:** TypeScript for `framework/` (high-leverage typing) and source clients. Acceptable to use JavaScript for `jobs/` (thin wrappers).

**Tradeoff:** TypeScript adds build step and type-check time. Build session may prefer JavaScript for velocity.

**Default:** TypeScript unless build session pushes back.

## FIQ-2 — Cloud Functions 1st gen vs. 2nd gen

**Recommendation:** 2nd gen. Better cold-start, better region availability, native `onSchedule` triggers, IAM integration.

**Caveat:** 2nd gen requires Cloud Run under the hood — slight cost difference, slight regional restriction.

**Default:** 2nd gen.

## FIQ-3 — Region selection

**Recommendation:** Functions in `us-central1` (lowest cost, most features). RTDB in `us-central1` for proximity. SEC EDGAR and Congress.gov APIs are US-based, no latency concern.

**Default:** `us-central1`.

## FIQ-4 — Node.js version

**Recommendation:** Node 20+. Required for some Firebase SDK features. Long-term support.

**Default:** Node 20.

## FIQ-5 — Test framework

**Recommendation:** Vitest for unit and integration tests. Faster than Jest, similar API.

**Tradeoff:** Jest is more conventional. Vitest pairs well with TypeScript.

**Default:** Vitest unless build session prefers Jest.

## FIQ-6 — Workspace iterator caching

**Recommendation:** Cache the list of approved workspaces for the duration of a job invocation (typically <5 min). Refresh on every invocation. Don't persist across invocations.

**Tradeoff:** Could cache for longer but workspace approval state changes faster than cache could safely persist.

**Default:** Per-invocation refresh.

## FIQ-7 — Lock lease duration

**Recommendation:** 5 minutes for sync operations, 30 minutes for backfill operations, 60 minutes for migrations.

**Tradeoff:** Shorter leases risk premature lock release on slow operations; longer leases delay recovery after function crash.

**Default:** As recommended.

## FIQ-8 — Daily quota reset timing

**Recommendation:** UTC midnight reset for all daily quotas. Source-specific resets (e.g., Pacific time for some sources) add complexity for minimal value.

**Default:** UTC midnight.

## FIQ-9 — Multi-region disaster recovery

**Recommendation:** Out of scope for Phase 8.5.2. Single-region (`us-central1`) deployment. DR considerations for Phase 9+.

**Default:** Single region.

## FIQ-10 — Function timeout settings

**Recommendation:**
- Hourly syncs: 540s (9 min — Cloud Functions max for HTTP, 60 min for non-HTTP triggers in 2nd gen).
- Backfill: 60 min (2nd gen schedule trigger max).
- HTTPS callable: 300s (5 min).

Per-source memory: 512MB default, 1GB for SEC EDGAR (10-K text parsing).

**Default:** As recommended.

---

# CLOSING NOTES

## Why this framework is the highest-leverage spec

The per-source specs (8.5.3 SAM.gov, 8.5.4 Award integration, 8.5.5-8.5.7 Signal sources) collectively describe what data to ingest and where it goes. The framework spec describes *how* to ingest reliably. Without the framework, each source would re-invent retry, rate-limiting, logging, secrets, and idempotency — five times over, with five different bug surfaces.

The framework is also where the operator's confidence in external sources is built. Doctrine §IV — "if the platform does not know something with confidence, it does not pretend to" — applies to the sync layer most acutely. Stale data must be visible as stale. Failed syncs must be visible as failed. Auth errors must alert. The framework's logging and error categorization make all of this possible.

## Cross-references to per-source specs

Each per-source spec assumes the framework exists. Specific framework features cited:
- **Award integration (8.5.4)** assumes: rate limiter for USAspending (1000/hr), DoD News scrape (1 req/2sec), secondary index writes for `awardsByPopEnd`, reconciliation logic helpers, organization resolver helpers, hash-based change detection.
- **SAM.gov integration (8.5.3)** assumes: rate limiter for SAM.gov (1000/hr, 10/sec burst), retry on 429 with Retry-After, secrets accessor for SAM.gov API key, operator-override-aware merge helper.
- **GAO/EDGAR/Congress.gov (8.5.5-8.5.7)** assume: framework's Signal entity write helpers, batch operations, error categorization for source-specific quirks.

## Implementation order

Build session implements Phase 8.5.2 in this order:
1. RTDB wrapper + path helpers (`framework/rtdb.ts`, `framework/provenance.ts`).
2. Logger (`framework/logger.ts`).
3. Error categorization (`framework/errors.ts`).
4. Retry utility (`framework/retry.ts`).
5. Rate limiter (`framework/rateLimit.ts`).
6. Secrets accessor (`framework/secrets.ts`).
7. SourceClient interface (`framework/SourceClient.ts`).
8. Workspace iterator (`framework/workspaceIterator.ts`).
9. Source Health writer (`framework/sourceHealth.ts`).
10. Batch write helper (`framework/batchWrite.ts`).
11. Hash helper (`framework/hashing.ts`).
12. End-to-end test with a mock SourceClient (acceptance criterion 13).
13. Deploy framework to staging.
14. Hand off to per-source implementation (8.5.3, 8.5.4, etc.).

Phase 8.5.2 estimated effort: 2-3 operator-weeks for a single developer; 1-1.5 weeks for a developer pair.

## Maintenance principle

This document is v1.0. As source integrations land, the framework will surface gaps (e.g., a source needs a feature the framework doesn't have). The framework spec gets revised; per-source specs reference the framework version they target.

Backward compatibility: framework changes should never break existing source integrations without operator-approved migration. Source integrations declare a framework version range; framework increments major version for breaking changes.

---

*End of framework spec v1.0. Awaiting parallel build session implementation.*
