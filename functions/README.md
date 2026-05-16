# Corsair Cloud Functions

Server-side functions powering Corsair's external data integrations. Phase 8.5 onward.

## Current scope (Phase 8.5.1)

Three HTTPS callable functions for the workspace migration that prepares existing operator data for Phase 8.5 external source integration:

| Function | Purpose |
|---|---|
| `triggerInventory` | Read-only pre-migration audit; writes inventory report. |
| `triggerMigration` | Applies the five-step migration after operator approval. |
| `triggerRollback` | Rolls back migration (per-step or full). |

The migration adds source provenance to existing entities, initializes the new `awards/` collection, and creates per-source configuration paths under `workspaces/{wsId}/sources/`. No existing entity fields are deleted, renamed, or merged. Full safety contract: see `corsair-osint-migration-v1.md` at the repo root.

## Prerequisites for deploy

1. **Firebase project on Blaze plan.** Cloud Functions 2nd gen requires pay-as-you-go billing. Estimated cost at current Corsair scale (1-3 workspaces, occasional migration runs): under $1/month.

2. **Firebase CLI installed and authenticated**:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

3. **Node.js 20+** for local development.

## Local setup

```bash
cd functions/
npm install
npm run build
```

## Deploy

From the repo root (`C:/Users/mpopp/FLi-Network`):

```bash
firebase deploy --only functions
```

Deploy time: 2-4 minutes on first deploy (Cloud Run cold provisioning). Subsequent deploys are faster (~1 minute).

## Test the deploy

After `firebase deploy --only functions` succeeds, verify the three functions are registered:

```bash
firebase functions:list
```

You should see `triggerInventory`, `triggerMigration`, and `triggerRollback` listed.

## Operator workflow

Once deployed, the operator-driven workflow runs from the Corsair client:

1. **Inventory** — Operator opens Settings → Phase 8.5 → "Inventory workspace for migration." Client calls `triggerInventory({ workspaceId })`. Function reads workspace state, writes inventory report to `workspaces/{wsId}/migrations/8.5.1/inventory`. Operator reviews entity counts, anomalies, and estimated duration.

2. **Approve** — If inventory looks good, operator clicks "Approve migration." Client writes `workspaces/{wsId}/migrations/8.5.1/operatorApprovedAt = <timestamp>`. This is the safety gate; migration won't run without it.

3. **Apply** — Operator clicks "Apply migration." Client calls `triggerMigration({ workspaceId })`. Function:
   - Verifies operator approval timestamp exists
   - Acquires migration lock (per-workspace, 60-min lease)
   - Refreshes inventory
   - Checks anomaly threshold (5% default; pass `forceProceed: true` to override)
   - Runs Step 1 (source provenance), Step 2/3 (client-side markers), Step 4 (collections)
   - Runs validation (V-1 through V-6)
   - On pass: writes `completedAt`. Workspace is 8.5.1-ready.
   - On fail: writes `validationErrors`; `completedAt` remains null until remediated.
   - Releases lock.

4. **Rollback (if needed)** — If migration fails or operator decides to revert, client calls `triggerRollback({ workspaceId, steps?: [...] })`. Function rolls back in reverse order, returning workspace to pre-migration state.

## Migration spec

The full migration design lives in `corsair-osint-migration-v1.md` at the repo root. Read that first for:
- The five migration principles (idempotency, forward/backward compatibility, etc.)
- Detailed step-by-step behavior
- Validation rules (V-1 through V-6)
- Test scenarios (T-1 through T-7) the implementation must satisfy
- The 10-criterion acceptance contract

This code is the implementation of that spec.

## Doctrine

Per Corsair Doctrine §IX (Pass-Down): existing operator data is sacred. The migration never deletes fields, never merges entities, never renames existing types. All writes are either:
- Additive (adding `source` and `migration` fields to entities that lack them)
- New collection initialization (paths that don't yet exist)

Operator-input fields are never overwritten. Per OQ-5 (LOCKED): operator-pin-wins on conflicts.

## Repository layout

```
functions/
├── package.json                    Build / deploy / test config
├── tsconfig.json                   TypeScript config (target ES2020)
├── .gitignore                      lib/, node_modules/, .env, logs
├── src/
│   ├── index.ts                    Entry point — registers HTTPS functions
│   ├── framework/                  Shared infrastructure
│   │   ├── rtdb.ts                 Admin SDK wrapper + path helpers
│   │   ├── logger.ts               Structured Cloud Logging
│   │   ├── provenance.ts           Source provenance helper (E-4)
│   │   └── errors.ts               Error categorization
│   ├── migrations/                 Phase 8.5.1 migration code
│   │   ├── migrate851.ts           Orchestrator (apply / preview / rollback)
│   │   ├── inventory.ts            Pre-migration audit
│   │   ├── steps.ts                Steps 1-4 implementation
│   │   ├── validation.ts           Step 5 validation checks (V-1..V-6)
│   │   └── rollback.ts             Per-step rollback procedures
│   └── http/                       HTTPS callable triggers (operator-facing)
│       ├── triggerInventory.ts
│       ├── triggerMigration.ts
│       └── triggerRollback.ts
└── lib/                            Compiled JS output (gitignored)
```

## Logs

Cloud Logging captures all function activity. View via:

```bash
firebase functions:log
```

Filter by function:
```bash
firebase functions:log --only triggerMigration
```

## Rollback safety

Per migration spec Part Three Step 4 rollback safety: if subsequent Phase 8.5 sub-phases (8.5.2+) have written data to `workspaces/{wsId}/awards/` or `workspaces/{wsId}/sources/{system}/raw/`, rollback would lose that data. The framework refuses unsafe rollback unless `forceUnsafe: true` is passed explicitly.

Doctrine alignment: data loss requires explicit operator authorization, not silent execution.

## Future Phase 8.5 sub-phases

This functions/ directory is the home for all Phase 8.5 server-side code. Subsequent sub-phases will add:

- **8.5.2 Framework:** `src/framework/rateLimit.ts`, `retry.ts`, `secrets.ts`, `workspaceIterator.ts`, `sourceHealth.ts`
- **8.5.3 SAM.gov:** `src/sources/samGov/` + scheduled job
- **8.5.4 USAspending + DoD News + Award entity:** `src/sources/usaSpending/`, `src/sources/dodNewsContracts/`, Award reconciliation logic
- **8.5.5 GAO Protest:** `src/sources/gaoProtest/`
- **8.5.6 SEC EDGAR:** `src/sources/secEdgar/`
- **8.5.7 Congress.gov:** `src/sources/congressGov/`
- **8.5.8 Brief synthesis:** `src/jobs/briefSynthesisNightly.ts`

Sub-phase sequencing per architecture sketch: `corsair-osint-architecture-v1.md` Part Five.

## Where the design lives

| Document | Topic |
|---|---|
| `corsair-osint-INDEX.md` | Entry point — all 21 design docs indexed |
| `corsair-osint-architecture-v1.md` | Phase 8.5 architecture sketch + operator sign-offs |
| `corsair-osint-migration-v1.md` | The migration spec this code implements |
| `corsair-osint-decision-log-v1.md` | ~150 decisions consolidated |
| `corsair-osint-risk-register-v1.md` | Anticipated risks + mitigations |
| `corsair-osint-observability-ops-v1.md` | Production runbook |
| `corsair-osint-testing-strategy-v1.md` | Test plan + acceptance verification |
