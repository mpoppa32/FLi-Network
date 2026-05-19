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

// Service-branch News (Phase 8.6.5 — Tier 2 bundled RSS aggregator)
export { triggerServiceNewsSync } from "./http/triggerServiceNewsSync";
export { serviceNewsDaily } from "./jobs/serviceNewsDaily";

// GAO Reports (Phase 8.6.14 — Tier 2 oversight findings via RSS)
export { triggerGaoReportsSync } from "./http/triggerGaoReportsSync";
export { gaoReportsDaily } from "./jobs/gaoReportsDaily";

// Advisory Boards — DSB / DBB / DIB (Phase 8.6.8 — Tier 2 advisory body
// reports via HTML index walk + PDF deep parse; reuses framework/pdfExtractor)
export { triggerAdvisoryBoardsSync } from "./http/triggerAdvisoryBoardsSync";
export { advisoryBoardsWeekly } from "./jobs/advisoryBoardsWeekly";

// Senate LDA — lobbying disclosure filings (Phase 8.6.9 — Tier 2 LD-1/LD-2
// from lda.senate.gov REST API; keyless v1.0)
export { triggerSenateLdaSync } from "./http/triggerSenateLdaSync";
export { senateLdaWeekly } from "./jobs/senateLdaWeekly";

// DoD Comptroller — budget materials PE catalog (Phase 8.6.3 — Tier 2
// R-2/P-1 PDF walk; PE-level Signals; reuses framework/pdfExtractor)
export { triggerDodComptrollerSync } from "./http/triggerDodComptrollerSync";
export { dodComptrollerMonthly } from "./jobs/dodComptrollerMonthly";

// Plum Book / Federal Vacancies (Phase 8.6.10 — GAO FVRA vacancy reports
// via PDF walk; emits vacancy_alert Signals; reuses framework/pdfExtractor)
export { triggerPlumBookSync } from "./http/triggerPlumBookSync";
export { plumBookMonthly } from "./jobs/plumBookMonthly";

// Industry Association rosters (Phase 8.6.11 — NDIA / AFA / AUSA corporate
// members via HTML scrape; Edge-only source, no Signals; populates the
// entity graph with cross-association membership data)
export { triggerIndustryAssocSync } from "./http/triggerIndustryAssocSync";
export { industryAssocQuarterly } from "./jobs/industryAssocQuarterly";
