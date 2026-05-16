# CORSAIR PHASE 8.5.1 — SCHEMA MIGRATION DESIGN

**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-15
**Doctrine version referenced:** 1.0
**Companion to:** [`corsair-osint-research-v1.md`](corsair-osint-research-v1.md), [`corsair-osint-architecture-v1.md`](corsair-osint-architecture-v1.md)
**Status:** Migration design — not for direct execution. Defines the safety contract Phase 8.5.1 implementation must honor. Operator review of the migration principles, ordering, and rollback procedure is recommended before any code is committed in the parallel build session.

---

## Document Purpose

Phase 8.5.1 is the first implementation step in Phase 8.5 (OSINT Integration). It extends Corsair's data schema in four ways (E-1 Award entity, E-2 Organization.type enum, E-3 Edge schema extension, E-4 source provenance attribute), all locked by operator sign-off in the architecture sketch.

Phase 8.5.1 is also the **highest-risk** step in 8.5 because it touches existing operator workspace data. Every other Phase 8.5 sub-phase only writes new records or adds attributes to records the migration itself has already prepared. The migration step is the only one that mutates fields on entities created by operator activity in prior phases.

This document specifies the safety contract Phase 8.5.1 implementation must honor:
- What exactly changes per workspace
- In what order changes happen
- What idempotency guarantees each step provides
- What rollback procedure undoes each step
- How operator visibility is maintained throughout
- What validation runs before the migration is considered complete

When the build session implements 8.5.1, this document is the acceptance criteria. A migration implementation that satisfies the rules below is accepted; one that does not is not.

---

# PART ONE — MIGRATION PRINCIPLES

Five binding principles. Every step is evaluated against them.

## P-1 — Existing data is sacred
The operator's accumulated entity graph — Persons, Organizations, Opportunities, Meetings, Signals, Edges, Posture-Layer observations — represents months or years of operator work. The migration adds attributes and creates new collections. It does not delete fields, merge entities, rename existing types, or restructure existing data.

The only writes are:
- Additive attribute writes (e.g., adding `source.system: 'operator_manual'` where no `source` exists).
- New top-level collection creation (e.g., `workspaces/{wsId}/awards/`, `workspaces/{wsId}/sources/`).
- Migration marker writes (`workspaces/{wsId}/migrations/8.5.1/`).

Doctrine §IV's confidence principle applies: the operator must finish migration more confident in her data, not less.

## P-2 — Idempotency
Every migration step must be safe to run repeatedly. Running the same step twice on the same workspace produces the same final state as running it once.

Concretely: each step checks for its own completion marker or the presence of its own writes before acting. If the writes are already there, the step is a no-op.

This matters because:
- Operator may need to re-run a partial migration after an error.
- Cloud Functions can retry on transient failures.
- A test workspace migration may be re-applied during validation.

## P-3 — Forward and backward client compatibility
The schema migration is server-side data work. The client deploy that *uses* the new schema is a separate step. During the gap between migration and client deploy, two compatibility conditions must hold:

- **Old client reads new data:** Migrated entities have new fields (`source`, `migration`) the old client doesn't know about. Old client ignores them and continues to work. (Verified: existing client code reads specific fields by name; unknown fields are passed through silently.)
- **New client reads pre-migrated data:** If a workspace hasn't been migrated yet but the new client is deployed, the new client must gracefully handle entities without `source` fields. (Implementation: client treats missing `source` as `source.system: 'operator_manual'` implicitly.)

This decoupling allows operator to deploy the new client first (low-risk) and migrate workspaces individually on his schedule (controlled rollout).

## P-4 — Per-workspace gating
Migration runs per-workspace, gated by explicit operator approval. A workspace is not migrated until the operator clicks "Approve 8.5.1 migration" in a Corsair settings page, which writes:

```
workspaces/{wsId}/migrations/8.5.1/operatorApprovedAt: <timestamp>
```

The Cloud Function that performs migration refuses to operate on any workspace where this field is null. This is the kill-switch: if the operator wants to halt migration mid-rollout, he simply does not approve further workspaces.

## P-5 — Observable and rollbackable
Every step emits structured logs. Every step has a documented rollback procedure that returns the workspace to its pre-step state. The migration marker tracks granular completion so partial rollback (e.g., undo only Step 4) is possible without re-running prior steps.

If anything goes wrong, the operator can read the log, identify the failing step, roll back to a known-good state, and proceed manually.

---

# PART TWO — PRE-MIGRATION INVENTORY

Before any migration step runs, an inventory script reads the workspace and reports its state. The operator reviews the inventory before approving migration.

## Inventory output shape

Written to `workspaces/{wsId}/migrations/8.5.1/inventory.json`:

```
{
  workspaceId: 'ws_abc123',
  inventoryAt: <timestamp>,
  entityCounts: {
    nodes: {
      total: N,
      byType: { person: N, company: N, government: N, other: N }
    },
    links: { total: N },
    opportunities: {
      total: N,
      byStage: { awareness: N, tracking: N, ..., lost: N }
    },
    meetings: { total: N },
    signals: { total: N, byType: { ... } },
    workspaceMembers: { total: N }
  },
  schemaState: {
    entitiesWithSource: N,
    entitiesWithoutSource: N,
    postureExtensionsPresent: { byPursuit: N, tells: N, adversaries: N, ... }
  },
  anomalies: [
    { type: 'orphan_edge', edgeId: '...', reason: 'source node missing' },
    { type: 'malformed_opp', oppId: '...', reason: 'invalid stage value' },
    ...
  ],
  estimatedDurationSec: <number>,
  estimatedWritesCount: <number>
}
```

## Anomaly handling

The inventory script flags anomalies but does not auto-correct them. Anomalies include:
- Orphan edges (source or target node ID no longer resolves).
- Opportunities with invalid stage values (not in OPP_STAGES).
- Entities with malformed type fields.
- Entities older than the workspace's earliest known creation date (clock-skew indicator).
- Duplicate entities (same name + type, suggesting a merge candidate).

The operator reviews anomalies. Three resolutions per anomaly:
- **Ignore:** Anomaly is acceptable; proceed with migration. Migration will not touch the anomalous entity.
- **Manual fix:** Operator edits the entity in Corsair before approving migration.
- **Auto-clean:** Operator explicitly authorizes the migration to delete or repair the anomaly. This is the only path where migration deletes data, and it is operator-explicit per anomaly.

## When inventory runs

The inventory script is triggered by an operator-facing button: "Inventory workspace for 8.5.1 migration." It runs in dry-run mode — reads only, no writes (except writing the inventory output and the inventory timestamp).

Operator may run inventory multiple times before approving migration; the latest output overwrites the previous.

---

# PART THREE — MIGRATION STEPS

Five steps, in this dependency order. Each step's section specifies: scope, operation, idempotency guarantee, observability, rollback.

## Step 1 — Add source provenance to existing entities

### Scope
All entities in the workspace that do not currently have a `source` field:
- `nodes/{nodeId}` — Persons, Organizations
- `links/{linkId}` — Edges
- `opportunities/{oppId}`
- `meetings/{meetingId}`
- `signals/{signalId}` (if Signal collection exists in this workspace; some workspaces may not have it)

### Operation
For each in-scope entity:
```
if (entity.source && entity.source.system) {
  // already migrated; skip
  return;
}
entity.source = {
  system: 'operator_manual',
  externalId: null,
  url: null,
  fetchedAt: entity.created || entity.createdAt || Date.now(),
  refreshedAt: entity.created || entity.createdAt || Date.now(),
  hash: null
};
entity.migration = { version: '8.5.1', step: 1, appliedAt: Date.now() };
```

Writes are batched 500 entities per RTDB multi-path update for performance.

### Idempotency guarantee
The `if (entity.source && entity.source.system)` short-circuit ensures re-runs are no-ops.

### Observability
After the step completes:
```
workspaces/{wsId}/migrations/8.5.1/steps/1 = {
  startedAt: <timestamp>,
  completedAt: <timestamp>,
  recordsProcessed: { nodes: N, links: N, opportunities: N, meetings: N, signals: N },
  recordsUpdated: { nodes: N, links: N, opportunities: N, meetings: N, signals: N },
  recordsSkipped: { nodes: N, links: N, ... },
  errors: []
}
```

### Rollback
For each entity that has `entity.migration.version === '8.5.1' && entity.migration.step === 1`:
- Delete the `source` field.
- Delete the `migration` field.

This restores the pre-Step-1 state exactly. The migration marker tracks which entities the migration itself wrote source data to (versus entities that already had source data from prior partial migrations).

---

## Step 2 — Organization.type enum extension

### Scope
This is a client-side schema change only. No data migration in RTDB is required. The new types (`program`, `committee`, `lobby_firm`, `university`, `ffrdc`, `trade_assoc`) are values the client recognizes; existing entities continue to use `company` / `government` / `person` / `other`.

### Operation
- Client code in `js/corsair/util.js` (or equivalent) expands its enum recognition.
- Where the client renders an Organization's type label, the new values get readable labels.
- No RTDB writes from migration.

### Idempotency guarantee
Client deploys are idempotent.

### Observability
Migration step writes a placeholder marker:
```
workspaces/{wsId}/migrations/8.5.1/steps/2 = {
  completedAt: <timestamp>,
  note: 'client-side enum extension; no data migration required',
  clientVersionRequired: '0.x.y'
}
```

### Rollback
Revert the client deploy.

---

## Step 3 — Edge schema extension

### Scope
Same as Step 2 — client-side schema extension only. Existing edges without `start`, `end`, or `attrs` fields continue to work; the new fields are optional.

### Operation
- Client code that creates new edges (e.g., the meeting-intel link-creation paths in FLiIntel.html line 18895 region) gets optional support for `start` / `end` / `attrs`.
- Existing edge-rendering code in `theater.js` and elsewhere gracefully handles the new fields.

### Idempotency guarantee
Client deploys are idempotent.

### Observability
```
workspaces/{wsId}/migrations/8.5.1/steps/3 = {
  completedAt: <timestamp>,
  note: 'client-side edge schema extension; no data migration required',
  clientVersionRequired: '0.x.y'
}
```

### Rollback
Revert the client deploy.

---

## Step 4 — Initialize new collections and source configurations

### Scope
Create the new top-level paths the rest of Phase 8.5 will write to.

### Operation

For each workspace:
```
workspaces/{wsId}/awards = {}
workspaces/{wsId}/sources/sam_gov/config = {
  naics: [],
  agencies: [],
  setAsides: [],
  noticeTypes: ['solicitation', 'combined_synopsis_solicitation', 'presol', 'sources_sought'],
  initializedAt: <timestamp>
}
workspaces/{wsId}/sources/sam_gov/lastSync = null
workspaces/{wsId}/sources/sam_gov/lastError = null
workspaces/{wsId}/sources/sam_gov/raw = {}

workspaces/{wsId}/sources/usaspending/config = {
  naics: [],
  agencies: [],
  competitorOrgs: [],
  lookBackMonths: 24,
  recompeteWatchHorizonMonths: 18,
  initializedAt: <timestamp>
}
workspaces/{wsId}/sources/usaspending/lastSync = null
workspaces/{wsId}/sources/usaspending/lastError = null
workspaces/{wsId}/sources/usaspending/raw = {}

workspaces/{wsId}/sources/dod_news/config = {
  initializedAt: <timestamp>
}
workspaces/{wsId}/sources/dod_news/lastSync = null
workspaces/{wsId}/sources/dod_news/lastError = null
workspaces/{wsId}/sources/dod_news/raw = {}

workspaces/{wsId}/sources/gao_protest/config = {
  trackedOrgs: [],
  lookBackMonths: 12,
  initializedAt: <timestamp>
}
workspaces/{wsId}/sources/gao_protest/lastSync = null
workspaces/{wsId}/sources/gao_protest/lastError = null
workspaces/{wsId}/sources/gao_protest/raw = {}

workspaces/{wsId}/sources/sec_edgar/config = {
  watchlistCiks: [],  // operator populates; default seed available
  filingTypes: ['8-K', '10-K', '10-Q', 'DEF 14A', '4'],
  initializedAt: <timestamp>
}
workspaces/{wsId}/sources/sec_edgar/lastSync = null
workspaces/{wsId}/sources/sec_edgar/lastError = null
workspaces/{wsId}/sources/sec_edgar/raw = {}

workspaces/{wsId}/sources/congress_gov/config = {
  committees: ['hsas00', 'hsap02', 'hlig00', 'ssas00', 'ssap02', 'slin00'],
  trackedNominationCategories: ['DoD', 'Defense', 'Air Force', 'Navy', 'Army', 'Space Force'],
  initializedAt: <timestamp>
}
workspaces/{wsId}/sources/congress_gov/lastSync = null
workspaces/{wsId}/sources/congress_gov/lastError = null
workspaces/{wsId}/sources/congress_gov/raw = {}
```

The default values are conservative (mostly empty lists). Operator configures each source's watchlist before activation in subsequent sub-phases.

### Idempotency guarantee
Each path check:
```
if (snapshot.exists()) {
  // already initialized; skip without modification
  return;
}
```
Re-running Step 4 on a workspace where some paths exist and others don't will fill in the missing paths without overwriting existing ones.

### Observability
```
workspaces/{wsId}/migrations/8.5.1/steps/4 = {
  startedAt: <timestamp>,
  completedAt: <timestamp>,
  pathsCreated: [...],
  pathsSkipped: [...],
  errors: []
}
```

### Rollback
For each path in `pathsCreated`:
- Delete the path (RTDB `remove`).

Critically, the `pathsCreated` list distinguishes paths created by *this* migration from paths that existed beforehand. Rolling back only removes what the migration added.

**Safety condition for rollback of Step 4:** Rollback of Step 4 is only safe if no subsequent Phase 8.5 sub-phase has written to these paths. Specifically:
- If `workspaces/{wsId}/awards` is empty, deletion is safe.
- If `workspaces/{wsId}/sources/{system}/raw` is empty, deletion is safe.

If those conditions don't hold, rollback of Step 4 requires operator confirmation and acknowledges data loss of the cached external data.

---

## Step 5 — Migration completion marker and validation

### Scope
After Steps 1-4 complete successfully, run the validation script (Part Five) and write the completion marker.

### Operation

Run validation. If validation passes:
```
workspaces/{wsId}/migrations/8.5.1 = {
  ...existing fields,
  inventoryAt: <timestamp from Step 0>,
  startedAt: <timestamp from Step 1 start>,
  completedAt: <timestamp>,
  validatedAt: <timestamp>,
  recordsUpdated: {
    nodes: <from step 1>,
    links: <from step 1>,
    opportunities: <from step 1>,
    meetings: <from step 1>,
    signals: <from step 1>,
    awardsInitialized: <from step 4>,
    sourcesInitialized: <from step 4 count>
  },
  errors: [],
  validationResult: 'pass',
  operatorApprovedAt: <existing>
}
```

If validation fails:
```
workspaces/{wsId}/migrations/8.5.1 = {
  ...existing fields,
  startedAt: ...,
  completedAt: null,  // NOT marked complete
  validatedAt: <timestamp>,
  validationResult: 'fail',
  validationErrors: [...]
}
```

Workspace is **not** considered 8.5.1-ready until `completedAt` is non-null and `validationResult === 'pass'`.

### Idempotency guarantee
Re-running Step 5 re-runs validation; if validation passes a second time, `completedAt` is updated to the latest run. If validation fails, `completedAt` is set to null even if previously set to a value (this protects against later data corruption).

### Observability
The migration marker is itself the observability output. Operator views it in the Source Health surface.

### Rollback
Set `completedAt` and `validatedAt` to null. This re-opens the workspace for re-running validation or earlier steps.

---

# PART FOUR — WORKSPACE MIGRATION ORDERING

Migrations roll out per-workspace, gated by operator approval. Default order:

## Order

1. **Operator's primary test workspace.** Operator designates this workspace explicitly. Migration runs end-to-end. Operator verifies behavior personally (creates a test Opportunity, observes that source provenance applies; creates a test Edge with start/end, observes it renders; opens an Award entity placeholder, observes the new entity type renders).
2. **Other operator non-production workspaces** (if any exist). Same procedure as above with reduced verification scope.
3. **Production workspace.** Migration runs only after operator confirms test workspaces are stable for at least 24 hours of normal use.

## Approval mechanism

A Corsair settings panel ("Schema Migrations") lists each workspace with:
- Migration status (`Not approved` / `Approved, pending` / `Inventoried, awaiting approval to apply` / `Applied` / `Validation failed`)
- Inventory output (if available)
- Approve button (writes `operatorApprovedAt`)
- Apply button (triggers Cloud Function to run migration; only enabled when `operatorApprovedAt` is set)
- Rollback button (triggers Cloud Function to run rollback; only enabled when migration has been applied)

The operator drives this UI. Migration does not run automatically.

## Pause behavior

If the operator wants to pause the rollout mid-sequence (e.g., something looks off in workspace 2 and he wants to stop before touching production), the pause is implicit: he simply does not approve additional workspaces. Migrations that have completed are stable; the system does not auto-progress.

---

# PART FIVE — OPERATOR VISIBILITY DURING MIGRATION

The operator must always know the workspace's migration state. Migration visibility lives in three places:

## A. The settings panel
Per the previous section. Provides explicit migration-status, approve/apply/rollback controls.

## B. Workspace-level banner
When a workspace has an inventory written but not yet applied, or applied but not yet validated, a top-of-workspace banner shows:
- *"Schema migration available for this workspace. Inventory complete. Review and approve in Settings."*
- *"Migration in progress. Approximately X of Y entities processed."*
- *"Migration complete. New entity types active. View summary."*
- *"Migration encountered errors. Click for details. Rollback available."*

Banners are dismissible after applied + validated. They reappear if rollback is initiated.

## C. Source Health surface
The Source Health view (added in Phase 8.5.2) reflects per-source initialization state. After Step 4 completes, sources show "Awaiting first sync" until their respective sub-phases activate.

## Doctrine alignment

§IV: "Hide uncertainty when unproductive; surface it when operational." Migration state is operational information — the operator must be able to act on it. Banners and the Source Health surface make state visible without flooding the workspace.

§IV: "The platform never knows better than her." Migration controls are explicit operator actions, never auto-executed.

---

# PART SIX — DATA INTEGRITY VALIDATION

The validation script runs at Step 5 and verifies the workspace's post-migration state is internally consistent. Validation gates the `completedAt` marker.

## Validation checks

### V-1 — Every entity has source provenance
For every entity in `nodes/`, `links/`, `opportunities/`, `meetings/`, `signals/`:
- Field `source.system` is present and is a non-empty string.
- Field `source.fetchedAt` is a timestamp.

Failure mode: entity missing `source.system`. Indicates Step 1 did not complete for this entity.

### V-2 — No orphan edges
For every link in `links/`:
- `source` resolves to an existing node in `nodes/`.
- `target` resolves to an existing node in `nodes/`.

Failure mode: link references a deleted or never-existed node. (May predate migration; flagged in inventory anomalies. Validation failure here is informational unless severity is high.)

### V-3 — Every opportunity has a valid stage
For every opportunity in `opportunities/`:
- `stage` is one of the OPP_STAGES keys (`awareness`, `tracking`, `engaged`, `rfp`, `proposal`, `negotiation`, `submitted`, `award`, `won`, `lost`).
- `stageEnteredAt` is a timestamp.

Failure mode: opportunity has invalid stage. Pre-existing data issue; validation flags but does not fail.

### V-4 — Posture extensions are well-formed
For every node with a `posture` field:
- `posture.tells` (if present) is an array.
- `posture.byPursuit` (if present) is an object keyed by pursuit IDs that resolve to opportunities.
- `posture.adversaries` (if present, on opportunity) is an array of organization IDs that resolve.

Failure mode: malformed posture. Pre-existing issue; flagged but not blocking.

### V-5 — New collections initialized
For each expected new path:
- `workspaces/{wsId}/awards` exists (may be empty).
- `workspaces/{wsId}/sources/sam_gov/config` exists.
- `workspaces/{wsId}/sources/usaspending/config` exists.
- `workspaces/{wsId}/sources/dod_news/config` exists.
- `workspaces/{wsId}/sources/gao_protest/config` exists.
- `workspaces/{wsId}/sources/sec_edgar/config` exists.
- `workspaces/{wsId}/sources/congress_gov/config` exists.

Failure mode: path missing. Indicates Step 4 did not complete.

### V-6 — Migration markers are well-formed
- `workspaces/{wsId}/migrations/8.5.1/steps/1.completedAt` is a timestamp.
- `workspaces/{wsId}/migrations/8.5.1/steps/4.completedAt` is a timestamp.

Failure mode: step marker missing. Indicates the step did not complete.

## Validation severity

- **Hard failures** (V-1, V-5, V-6): block `completedAt`. Migration must roll back or remediate before retry.
- **Soft failures** (V-2, V-3, V-4): flag in `validationErrors` but do not block `completedAt`. These are pre-existing data issues, not migration-induced.

## Validation result shape

```
{
  ranAt: <timestamp>,
  durationMs: <number>,
  hardFailures: [
    { check: 'V-1', entityType: 'nodes', entityId: '...', issue: 'missing source.system' },
    ...
  ],
  softFailures: [
    { check: 'V-2', linkId: '...', issue: 'target node missing' },
    ...
  ],
  result: 'pass' | 'fail',
  recommendation: '...'
}
```

If `hardFailures` is non-empty, `result` is `fail` and `recommendation` describes the remediation path.

---

# PART SEVEN — IDEMPOTENCY TEST PLAN

Before Phase 8.5.1 ships to operator's production workspace, the migration is tested on a dedicated test workspace under the following scenarios:

## T-1 — Fresh workspace, full migration
- Set up a workspace with the operator's typical entity types but no source fields.
- Run inventory, approve, apply.
- **Expected:** all steps complete; validation passes; entities have source provenance; new paths exist.

## T-2 — Re-run on migrated workspace
- Run migration twice end-to-end on the same workspace.
- **Expected:** second run is largely a no-op. `recordsUpdated` shows zero updates in the second run. `completedAt` updates to second-run timestamp.

## T-3 — Partial completion
- Manually delete the Step 4 completion marker.
- Re-run migration.
- **Expected:** Steps 1, 2, 3 are no-ops (already complete). Step 4 re-runs. Step 5 re-runs and passes validation.

## T-4 — Mid-flight failure
- Simulate Cloud Function timeout midway through Step 1 (kill at 50% of entities).
- **Expected:** entities processed have source provenance; entities not yet processed do not. Migration marker shows partial state with `completedAt` null. Re-running picks up where it left off.

## T-5 — Concurrent operator activity
- Have a simulated operator create new entities (Persons, Edges, Opportunities) in the workspace during Step 1.
- **Expected:** new entities are either picked up by Step 1 (if created before the read snapshot) or are created by the operator with the new schema in place (after client deploy). No entities end up missing source provenance.

## T-6 — Rollback
- Apply full migration.
- Roll back Step 5 (`completedAt` → null).
- Verify Steps 1-4 markers still present.
- Roll back Step 4 (delete new paths).
- Verify Steps 1-3 still effective.
- Roll back Steps 1-3 (delete source fields, revert client).
- **Expected:** workspace returns to pre-migration state. Operator can re-inventory and re-approve.

## T-7 — Validation failure path
- Inject a fake validation failure (e.g., manually remove a source.system from one node after Step 1).
- Run Step 5.
- **Expected:** validation reports hard failure on V-1. `completedAt` not set. Operator sees error banner with remediation guidance.

Each scenario has a documented pass criterion. Phase 8.5.1 implementation must demonstrate all seven before deployment to operator's production workspace.

---

# PART EIGHT — OPEN IMPLEMENTATION QUESTIONS

Decisions about migration implementation specifics that the operator should make before code is committed.

## OIQ-1 — Where does the migration trigger live?

**Proposal:** A new Cloud Function `functions/src/migrations/migrate851.js` invoked by an HTTPS callable trigger from the Corsair client. Client button writes the operator approval to RTDB; Cloud Function reads approval and runs migration. Function emits structured logs and updates the migration marker continuously.

**Alternative:** Run migration entirely client-side via the Admin SDK with operator-scoped credentials. Rejected because (a) the operator's web session would have to remain open for the duration of a potentially long-running migration, (b) Admin SDK credentials should not be exposed in client code.

**Recommendation:** Confirm Cloud Function with HTTPS callable trigger.

## OIQ-2 — Dry-run mode

**Proposal:** The "Inventory workspace" button is the dry-run mode. It reads the workspace, computes what migration *would* do, but writes only the inventory output. The "Apply migration" button is the live mode.

**Recommendation:** Confirm two-button pattern.

## OIQ-3 — Batched RTDB writes vs. individual writes

**Proposal:** Step 1 batches writes at 500 entities per multi-path update. Smaller batches risk slow performance on large workspaces; larger batches risk RTDB transaction size limits.

**Recommendation:** Confirm 500-per-batch. Implementation can tune based on observed workspace sizes.

## OIQ-4 — Client version compatibility check

**Proposal:** When the operator clicks "Apply migration," the migration function checks the workspace's last-seen client version (recorded in `workspaces/{wsId}/clientVersion`). If the client version is older than the version that handles the new schema, migration refuses to run and reports "Client deploy required first."

**Recommendation:** Confirm client-version gate. Forces correct rollout sequence (deploy client first, then migrate workspaces).

## OIQ-5 — Multi-workspace simultaneous migration

**Proposal:** Migration is per-workspace. If the operator approves migration for multiple workspaces simultaneously, each runs independently. The Cloud Function uses workspace-scoped locks (`workspaces/{wsId}/migrations/8.5.1/locked`) to prevent two function instances from working on the same workspace concurrently.

**Recommendation:** Confirm per-workspace locks.

## OIQ-6 — Inventory anomaly threshold

**Proposal:** If the inventory reports more than 5% of entities have anomalies, the "Approve" button is disabled with the message "Anomaly rate too high. Review inventory and clean data before approving." Operator can override by editing the anomaly threshold in Settings.

**Recommendation:** Confirm 5% threshold with override option.

## OIQ-7 — Source config seed data

**Proposal:** Step 4 initializes source configs with empty watchlists. The operator populates them per workspace as part of Phase 8.5.3+ activation. No default NAICS / agencies / competitors are seeded automatically (those are operator-specific).

**Alternative:** Seed with a "common defense BD" default (e.g., NAICS 541330, 541512, 541715; agencies USA, USN, USAF, USMC, USSF, DARPA; competitors LMT/NOC/RTX/GD/BA).

**Recommendation:** Confirm empty seeds. Operator-specific config is a separate, optional setup step.

---

# PART NINE — ACCEPTANCE CRITERIA

When Phase 8.5.1 ships, the implementation must satisfy all of the following. This list is the formal acceptance contract:

1. **Migration runs only with explicit operator approval per workspace.** No background or auto-triggered migration.
2. **All five migration steps are idempotent.** Re-running produces the same state.
3. **All five steps have documented rollback procedures that return the workspace to a known-good prior state.**
4. **Test scenarios T-1 through T-7 all pass on a non-production test workspace before production deploy.**
5. **Operator-facing UI provides:** inventory button, approve button, apply button, rollback button, migration-status display, error display, banner-based workspace-level state.
6. **Source Health surface is wired (even if no real sources are syncing yet) and reflects per-source initialization state.**
7. **Validation script runs at Step 5 and either passes (completedAt set) or fails with structured error output (completedAt remains null).**
8. **Migration marker at `workspaces/{wsId}/migrations/8.5.1/` is the canonical record of migration state.** Other components reading "is this workspace 8.5.1-ready" check this marker only.
9. **No existing entity fields are deleted or renamed during migration.** All changes are additive.
10. **Client version compatibility is gated:** operator cannot apply migration on a workspace running a pre-8.5.1 client.

When all ten criteria are met, Phase 8.5.1 is shippable. Subsequent sub-phases (8.5.2 onward) can begin in parallel once 8.5.1 is shipped on the operator's primary test workspace.

---

# CLOSING NOTES

## Why this document exists

Migrations are the most dangerous step in any data-platform change. Existing operator data is the institutional memory the platform claims to preserve. Corsair's pass-down doctrine (§IX) — "nothing the operator learns is lost when she leaves the chair" — applies first to the operator herself. A migration that loses or corrupts data violates the doctrine before any successor operator ever inherits the workspace.

This design is heavy on safety language because the operational expectation is that migrations are routine, undramatic, observable, and reversible. If the implementation feels heavyweight, that is the design intent. The platform's confidence principle (§IV) requires that the operator leave the migration more certain of her data, not less.

## Relationship to subsequent sub-phases

Phase 8.5.1 is the prerequisite for everything else in Phase 8.5. Phase 8.5.2 (Cloud Functions scaffolding) reads `workspaces/{wsId}/sources/*` paths that 8.5.1 creates. Phases 8.5.3 through 8.5.7 each depend on the entity model extensions 8.5.1 deploys. Phase 8.5.8 (Daily Brief integration) reads from all of them.

If 8.5.1 ships clean, the remaining sub-phases are additive — they only write new records, never mutate the operator's existing data. The risk profile after 8.5.1 drops substantially.

## Maintenance principle

This document is v1.0. As implementation surfaces real constraints (RTDB transaction size limits, Cloud Function timeout boundaries, batching edge cases observed at real workspace volumes), the document gets revised to v1.1, v1.2, etc. The acceptance criteria in Part Nine may be amended *only* by operator-approved revision; implementation does not unilaterally relax them.

---

*End of migration design v1.0. Awaiting operator review of migration principles, ordering, and rollback procedure before parallel build session begins 8.5.1 implementation.*
