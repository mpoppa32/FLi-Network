// Corsair Cloud Functions — entry point
//
// Registers every deployed Cloud Function. Each function is exported here
// so `firebase deploy --only functions:<name>` resolves it.
//
// Current registrations (Phase 8.5.1 — migration):
//   - triggerInventory:  read-only pre-migration audit
//   - triggerMigration:  apply Phase 8.5.1 migration (requires approval)
//   - triggerRollback:   rollback migration (per-step or full)
//
// Future registrations (Phase 8.5.2+ source syncs) will be added here as
// the build session implements them.

export { triggerInventory } from "./http/triggerInventory";
export { triggerMigration } from "./http/triggerMigration";
export { triggerRollback } from "./http/triggerRollback";
export { triggerUsaSpendingSync } from "./http/triggerUsaSpendingSync";
export { usaSpendingNightly } from "./jobs/usaSpendingNightly";
