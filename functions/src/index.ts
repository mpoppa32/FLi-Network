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

// Migration (Phase 8.5.1)
export { triggerInventory } from "./http/triggerInventory";
export { triggerMigration } from "./http/triggerMigration";
export { triggerRollback } from "./http/triggerRollback";

// USAspending (Phase 8.5.4 + v1.1)
export { triggerUsaSpendingSync } from "./http/triggerUsaSpendingSync";
export { usaSpendingNightly } from "./jobs/usaSpendingNightly";
export { triggerUsaSpendingSubawards } from "./http/triggerUsaSpendingSubawards";
export { usaSpendingSubawardsWeekly } from "./jobs/usaSpendingSubawardsWeekly";
export { triggerRecompeteWatchRefresh } from "./http/triggerRecompeteWatchRefresh";

// GAO Bid Protest (Phase 8.5.5)
export { triggerGaoProtestSync } from "./http/triggerGaoProtestSync";
export { gaoProtestDaily } from "./jobs/gaoProtestDaily";

// SEC EDGAR (Phase 8.5.6)
export { triggerSecEdgarSync } from "./http/triggerSecEdgarSync";
export { secEdgarFrequent } from "./jobs/secEdgarFrequent";

// SAM.gov (Phase 8.5.3) — requires SAMGOV_API_KEY env var
export { triggerSamGovSync } from "./http/triggerSamGovSync";
export { samGovHourly } from "./jobs/samGovHourly";

// Congress.gov (Phase 8.5.7) — requires CONGRESSGOV_API_KEY env var
export { triggerCongressGovSync } from "./http/triggerCongressGovSync";
export { congressGovDaily } from "./jobs/congressGovDaily";

// Brief Synthesis (Phase 8.5.8) — composes all sources into a daily Brief
export { triggerBriefSynthesis } from "./http/triggerBriefSynthesis";
export { briefSynthesisNightly } from "./jobs/briefSynthesisNightly";

// FACA Database (Phase 8.6.1 — first Tier 2 source)
export { triggerFacaDatabaseSync } from "./http/triggerFacaDatabaseSync";
export { facaDatabaseWeekly } from "./jobs/facaDatabaseWeekly";

// DoD News Contracts (Phase 8.5.4 v1.2 — multi-source reconciliation)
export { triggerDodNewsSync } from "./http/triggerDodNewsSync";
export { dodNewsDaily } from "./jobs/dodNewsDaily";

// Think Tanks (Phase 8.6.6 — bundled RSS aggregator)
export { triggerThinkTanksSync } from "./http/triggerThinkTanksSync";
export { thinkTanksDaily } from "./jobs/thinkTanksDaily";

// DSCA FMS Notifications (Phase 8.6.2 — Tier 2 web scrape)
export { triggerDscaFmsSync } from "./http/triggerDscaFmsSync";
export { dscaFmsWeekly } from "./jobs/dscaFmsWeekly";
