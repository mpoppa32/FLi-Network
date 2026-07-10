# Corsair Cloud Functions

Server-side functions powering Corsair's AI proxy, external OSINT data integrations, auto-capture, and email digests. TypeScript, **Node 20**, Firebase Functions **2nd gen** (package `corsair-functions`).

> **Scope note:** This README was rewritten 2026-07-08 to match what is actually deployed. The full OSINT suite (Phase 8.5 **and** 8.6) plus the AI proxy, Gmail/Calendar capture, and email digests are all implemented and exported from `src/index.ts` — the previous README describing "three migration functions as current scope" was badly out of date. `src/index.ts` is the authoritative list; the tables below summarize it.

---

## What's deployed

### AI proxy (the load-bearing one)

| Function | Purpose |
|---|---|
| `anthropicProxy` | Callable proxy for **all** Claude calls from the client. Holds the Anthropic key server-side (Secret Manager, `ANTHROPIC_API_KEY`), verifies workspace membership, enforces a per-workspace hourly quota (default 30/hr, hard ceiling 200), and forwards `/v1/messages`. Model allow-list: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` + legacy 3.x. 120s function timeout / 110s upstream abort. **If this key is unset or invalid, every AI feature in the app breaks.** |

### Migration (Phase 8.5.1)

| Function | Purpose |
|---|---|
| `triggerInventory` | Read-only pre-migration audit; writes inventory report. |
| `triggerMigration` | Applies the five-step migration after operator approval. |
| `triggerRollback` | Rolls back migration (per-step or full). |

The migration adds source provenance to existing entities, initializes the new `awards/` collection, and creates per-source config paths under `workspaces/{wsId}/sources/`. No existing entity fields are deleted, renamed, or merged. Safety contract: `corsair-osint-migration-v1.md` at the repo root.

### OSINT source syncs

Each source ships a manual `trigger*Sync` (operator/CLI callable) **and** a scheduled cron job. Tier 1 are the anchor sources (Phase 8.5); Tier 2 are the expansion sources (Phase 8.6).

**Tier 1 (Phase 8.5)**

| Source | Manual trigger | Scheduled job | Notes |
|---|---|---|---|
| SAM.gov | `triggerSamGovSync` | `samGovHourly` | Pipeline spine (opportunities + entity reg). Needs `SAMGOV_API_KEY`. |
| USAspending | `triggerUsaSpendingSync` | `usaSpendingNightly` | Awards. |
| USAspending subawards | `triggerUsaSpendingSubawards` | `usaSpendingSubawardsWeekly` | Subaward relationships. |
| Recompete watch | `triggerRecompeteWatchRefresh` | (on-demand) | Flagship "what's about to recompete" deliverable. |
| DoD News contracts | `triggerDodNewsSync` | `dodNewsDaily` | Multi-source reconciliation with USAspending. |
| GAO bid protest | `triggerGaoProtestSync` | `gaoProtestDaily` | Signals. |
| SEC EDGAR | `triggerSecEdgarSync` | `secEdgarFrequent` | Form 4 / proxy / periodic filings. |
| Congress.gov | `triggerCongressGovSync` | `congressGovDaily` | Legislation. Needs `CONGRESSGOV_API_KEY`. |
| Brief synthesis | `triggerBriefSynthesis` | `briefSynthesisNightly` | Composes all sources into the daily Brief. |

**Tier 2 (Phase 8.6)**

| Source | Manual trigger | Scheduled job |
|---|---|---|
| FACA advisory committees | `triggerFacaDatabaseSync` | `facaDatabaseWeekly` |
| DSCA Foreign Military Sales | `triggerDscaFmsSync` | `dscaFmsWeekly` |
| DoD Comptroller budget (R-2/P-1) | `triggerDodComptrollerSync` | `dodComptrollerMonthly` |
| State Department feeds | `triggerStateDepartmentSync` | `stateDepartmentDaily` |
| Service-branch news | `triggerServiceNewsSync` | `serviceNewsDaily` |
| Defense BD news (Breaking Defense / DefenseScoop / Defense News / FedScoop / NextGov) | `triggerDefenseScoopSync` | `defenseScoopDaily` |
| Think tanks | `triggerThinkTanksSync` | `thinkTanksDaily` |
| GAO reports (oversight) | `triggerGaoReportsSync` | `gaoReportsDaily` |
| DoD OIG (oversight) | `triggerDodOigSync` | `dodOigDaily` |
| NASA OIG (oversight) | `triggerNasaOigSync` | `nasaOigDaily` |
| DARPA news / R&D pipeline | `triggerDarpaNewsSync` | `darpaNewsDaily` |
| Advisory boards (DSB/DBB/DIB, PDF parse) | `triggerAdvisoryBoardsSync` | `advisoryBoardsWeekly` |
| Senate LDA lobbying disclosure | `triggerSenateLdaSync` | `senateLdaWeekly` |
| Plum Book / federal vacancies | `triggerPlumBookSync` | `plumBookMonthly` |
| Industry association rosters (NDIA/AFA/AUSA) | `triggerIndustryAssocSync` | `industryAssocQuarterly` |
| Drone Gauntlet leaderboard (Atlas market) | `triggerUasPatternsSync` | `uasPatternsDaily` |
| Drone PIE supply-chain intel | `triggerUasPatternsPieSync` | `uasPatternsPieDaily` |

### Atlas / Google Sheets sync

> These import the **gitignored** `atlasMaster` config (private Sheet IDs, customer names) — it's intentionally absent from this repo. Build/deploy from a checkout that has it.

| Function | Purpose |
|---|---|
| `triggerAtlasMasterRead` / `triggerAtlasMasterSync` / `atlasMasterSync` | Atlas master Sheet → opps (read proof / dry-run mapper / 6-hour auto-sync). |
| `triggerFactsSheetSync` / `factsSheetSync` | Truth Hub facts sync (Standard Motors pricing/COGM, BD pipeline) → `workspaces/{ws}/facts`. |
| `draftingFacts` | Customer-safe product facts for Tom's Atlas Relationship Console. |
| `slackIntakeHourly` / `triggerSlackIntake` | Slack channel intake feed (no-op until `SLACK_BOT_TOKEN` set). |

### Gmail + Calendar auto-capture (P2.14)

Requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

`captureOAuthStart`, `captureOAuthCallback`, `triggerGmailSync`, `triggerCalendarSync`, `captureHourly`, `backfillCaptureMatches`, `captureMatchBackfillYearly`.

### Email digests & reminders

Require `SENDGRID_API_KEY` + `BRIEF_FROM_EMAIL` (both gracefully no-op if unset).

`dailyBriefDigest` (11:00 UTC daily), `triggerBriefDigestTest` (fire one digest on demand), `meetingReminder` (per-meeting email reminders every 15 min).

### Maintenance / backfills

`listMyInvites` (scoped invite read), `triggerRelatedIdsBackfill` / `relatedIdsBackfillMonthly`, `backfillOrgMerge` / `orgMergeBackfillYearly` (dedupe org/person nodes), `triggerEnrichEntityDomains` / `enrichEntityDomainsYearly` (derive gov org domains from SAM.gov POC emails), `triggerEnrichCompanyDomainsByUei` / `enrichCompanyDomainsByUeiYearly` (derive company domains via SAM.gov entity API by UEI).

---

## Secrets & env vars

| Name | Mechanism | Used by | Required? |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Secret Manager (`firebase functions:secrets:set`) | `anthropicProxy` | **Yes — all AI features depend on it** |
| `SAMGOV_API_KEY` (or `SAM_GOV_API_KEY`) | env / functions config | SAM.gov sync | For SAM.gov |
| `CONGRESSGOV_API_KEY` (or `CONGRESS_GOV_API_KEY`) | env / functions config | Congress.gov sync | For Congress.gov |
| `SEC_EDGAR_USER_AGENT` | env (default set) | SEC EDGAR sync | Optional |
| `SENDGRID_API_KEY` + `BRIEF_FROM_EMAIL` | Secret Manager | digests / reminders | For email |
| `SLACK_BOT_TOKEN` | Secret Manager | Slack intake | For Slack |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | env / secrets | Gmail+Calendar capture | For auto-capture |

> **Hardening note:** per `framework/secrets.ts`, only the Anthropic key is Secret Manager-backed today; the OSINT source keys still read from plain env / functions config. Migrating the rest to Secret Manager is planned (Phase 9+).

---

## Prerequisites for deploy

1. **Firebase project on Blaze plan** (2nd-gen functions require pay-as-you-go). Cost at current scale (1–3 workspaces): low, but the OSINT crons + AI proxy now make this materially more than the old "<$1/mo" migration-only estimate — watch the scheduled-job invocation counts.
2. **Firebase CLI**: `npm install -g firebase-tools && firebase login`.
3. **Node.js 20** for local development.

## Local setup

```bash
cd functions/
npm install
npm run build
npm run test   # Vitest
```

## Deploy

From the repo root:

```bash
firebase deploy --only functions                 # all
firebase deploy --only functions:anthropicProxy  # single function
```

First deploy: 2–4 min (Cloud Run cold provisioning). Verify: `firebase functions:list`.

---

## Doctrine

Per Corsair Doctrine §IX (Pass-Down): existing operator data is sacred. Migrations and syncs never delete fields, never merge entities silently, never rename existing types. Writes are additive or new-collection initialization; operator-input fields are never overwritten (OQ-5 LOCKED: operator-pin-wins on conflicts). Unsafe rollback (that would drop source-ingested data) refuses unless `forceUnsafe: true` is passed explicitly.

## Repository layout

```
functions/
├── package.json / tsconfig.json / .gitignore
├── src/
│   ├── index.ts        Entry point — registers every deployed function (authoritative list)
│   ├── framework/      Shared middleware: rateLimit, retry, secrets, sourceHealth,
│   │                   provenance, workspaceIterator, personResolver, SourceClient,
│   │                   pdfExtractor, similarity, hashing, rtdb, logger, errors
│   ├── sources/        ~25 per-source client/mapper/config modules
│   ├── migrations/     Phase 8.5.1 migration engine (inventory, steps, validation, rollback)
│   ├── http/           Operator-facing callable triggers
│   └── jobs/           Scheduled cron jobs
└── lib/                Compiled JS output (gitignored)
```

## Logs

```bash
firebase functions:log
firebase functions:log --only anthropicProxy
```

## Where the design lives

The OSINT design body lives as `corsair-*.md` files at the repo root. See `corsair-docs-status.md` (repo root) for a built-vs-planned index of which specs have shipped. Key entries: `corsair-osint-architecture-v1.md` (architecture + sign-offs), `corsair-osint-migration-v1.md` (migration spec this code implements), `corsair-osint-testing-strategy-v1.md` (test plan). Some referenced companions (INDEX, decision-log, risk-register, observability-ops) are not in this public checkout.
