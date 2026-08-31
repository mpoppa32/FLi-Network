// Corsair Cloud Functions — entry point
//
// Registers every deployed Cloud Function. Each function is exported here
// so `firebase deploy --only functions:<name>` resolves it.
//
// DEPLOYMENT: a push to main touching functions/** deploys this codebase
// automatically via .github/workflows/firebase-deploy.yml. You do not need to
// run `firebase deploy` by hand. NOTE that a clean checkout of this PUBLIC repo
// does NOT compile — see the gitignored-atlasMaster note further down and
// scripts/atlas-bundle.sh.
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

// P13.124 (audit Finding 3.1) — Anthropic API proxy. Holds the API key as a
// Firebase secret (ANTHROPIC_API_KEY) and forwards /v1/messages on behalf
// of authenticated workspace members so the key never reaches the browser.
// One-time setup: `firebase functions:secrets:set ANTHROPIC_API_KEY` then
// `firebase deploy --only functions:anthropicProxy`.
export { anthropicProxy } from "./http/anthropicProxy";

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

// Atlas Master Sheet — living source-of-truth sync (sheet -> Corsair).
// NOTE: the atlasMaster source (./sources/atlasMaster, ./jobs/atlasMasterSync,
// ./http/triggerAtlasMaster*) is GITIGNORED — it carries internal operator
// config (private Sheet IDs, customer names) and is intentionally absent from
// this public repo. It exists on the operator's local checkout + in production;
// build/deploy from a checkout that has it.
// Phase 1: server-side read proof (reader through Corsair's own Google grant).
export { triggerAtlasMasterRead } from "./http/triggerAtlasMasterRead";
// Phase 2: mapper — reflect the Customers rollup onto opps (dryRun by default).
export { triggerAtlasMasterSync } from "./http/triggerAtlasMasterSync";
// Phase 3: 6-hour cron — auto-sync the sheet onto opps (writes; runs as syncUid).
export { atlasMasterSync } from "./jobs/atlasMasterSync";

// Truth Hub facts sync (P13.383-era) — master sheet -> workspaces/{ws}/facts.
// Standard Motors tab (price/COGM/capacity/availability per SKU) + Pipeline
// tab (BD stage per company). Sticky operator visibility classification; COGM
// forced internal; history on change; no deletes. The factsSync module itself
// is COMMITTED (public logic) but imports the gitignored atlasMaster config,
// so it shares the build-from-a-checkout-that-has-atlasMaster caveat above.
export { triggerFactsSheetSync } from "./http/triggerFactsSheetSync";
export { factsSheetSync } from "./jobs/factsSheetSync";
// Bridge to Tom's Atlas Relationship Console: customer-safe product facts for drafting.
export { draftingFacts } from "./http/draftingFacts";
// Operator layer: authenticated read-only graph access (commitments / signals /
// entity dossiers) for the headless Cowork brief + meeting-prep tasks.
export { operatorData } from "./http/operatorData";
// Corsair as an MCP server (spec 2026-07-28, stateless). Read-only; no write
// path exists. Shares OPERATOR_API_TOKEN with operatorData deliberately —
// one credential to rotate, one place it can leak from.
export { corsairMcp } from "./http/corsairMcp";
// Build C — Slack intake: pull Atlas channel messages into a surfaced feed (no-op until SLACK_BOT_TOKEN set).
export { slackIntakeHourly } from "./jobs/slackIntakeHourly";
export { triggerSlackIntake } from "./http/triggerSlackIntake";

// Think Tanks (Phase 8.6.6 — bundled RSS aggregator)
export { triggerThinkTanksSync } from "./http/triggerThinkTanksSync";
export { thinkTanksDaily } from "./jobs/thinkTanksDaily";

// State Department (Phase 8.6.4 — Tier 2 multi-feed RSS aggregator)
export { triggerStateDepartmentSync } from "./http/triggerStateDepartmentSync";
export { stateDepartmentDaily } from "./jobs/stateDepartmentDaily";

// Defense BD news (Phase 8.6.15 — Breaking Defense / DefenseScoop / Defense News / FedScoop / NextGov)
export { triggerDefenseScoopSync } from "./http/triggerDefenseScoopSync";
export { defenseScoopDaily } from "./jobs/defenseScoopDaily";

// DSCA FMS Notifications (Phase 8.6.2 — Tier 2 web scrape)
export { triggerDscaFmsSync } from "./http/triggerDscaFmsSync";
export { dscaFmsWeekly } from "./jobs/dscaFmsWeekly";

// Service-branch News (Phase 8.6.5 — Tier 2 bundled RSS aggregator)
export { triggerServiceNewsSync } from "./http/triggerServiceNewsSync";
export { serviceNewsDaily } from "./jobs/serviceNewsDaily";

// GAO Reports (Phase 8.6.14 — Tier 2 oversight findings via RSS)
export { triggerGaoReportsSync } from "./http/triggerGaoReportsSync";
export { gaoReportsDaily } from "./jobs/gaoReportsDaily";

// DoD OIG (Phase 8.6.16 — Tier 2 internal-audit oversight findings via RSS;
// sibling to gao_reports — same oversight_finding signal type with
// attrs.publisher="dod_oig" distinguishing internal DoD audits from
// external GAO audits)
export { triggerDodOigSync } from "./http/triggerDodOigSync";
export { dodOigDaily } from "./jobs/dodOigDaily";

// DARPA News (Phase 8.6.17 — Tier 2 R&D pipeline leading-edge; news +
// program announcements + awards + demonstrations from darpa.mil RSS;
// itemKind classification + body-text contractor + program resolution
// against 35-contractor + 35-program defaults; first plugin in the
// defense R&D coverage)
export { triggerDarpaNewsSync } from "./http/triggerDarpaNewsSync";
export { darpaNewsDaily } from "./jobs/darpaNewsDaily";

// NASA OIG (Phase 8.6.18 — Tier 2 defense-adjacent oversight; NASA
// Office of Inspector General audit/evaluation/investigation reports
// → oversight_finding Signals with attrs.publisher="nasa_oig";
// defense-relevance keyword filter default-on; opt-in source for
// operators who care about NASA contractor exposure (Boeing SLS,
// Lockheed Orion, SpaceX Crew/Cargo, etc.))
export { triggerNasaOigSync } from "./http/triggerNasaOigSync";
export { nasaOigDaily } from "./jobs/nasaOigDaily";

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

// ───────────────────────────────────────────────────────────────────────────
// P2.14 — Gmail + Calendar auto-capture (scaffold staged 2026-05-23).
// UNCOMMENT after setting these env vars on the deployed functions:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REDIRECT_URI=https://us-central1-fli-network.cloudfunctions.net/captureOAuthCallback
// Set via functions/.env (local) or `firebase functions:secrets:set` (prod).
// Full setup steps in docs/p2.14-gmail-calendar-plan.md Phase 1.
// ───────────────────────────────────────────────────────────────────────────
export { captureOAuthStart } from "./http/captureOAuthStart";
export { captureOAuthCallback } from "./http/captureOAuthCallback";
export { triggerGmailSync } from "./http/triggerGmailSync";
export { triggerCalendarSync } from "./http/triggerCalendarSync";
export { captureHourly } from "./jobs/captureHourly";
// P13.137 — one-shot backfill so existing pendingCapture entries get the
// matcher applied without waiting for them to age out and re-capture.
export { backfillCaptureMatches } from "./http/backfillCaptureMatches";
// P13.278 — onSchedule wrapper so cloud-scheduler-run-now can fire the
// matcher backfill headlessly. Yearly cron; primary purpose is the
// run-now path during matcher-tuning sessions.
export { captureMatchBackfillYearly } from "./jobs/captureMatchBackfillOnce";

// P13.154 — scoped invite read (replaces client-side full-tree /invites
// read that required .read: "auth != null" on the entire invites tree).
export { listMyInvites } from "./http/listMyInvites";

// Daily Brief Email Digest (closes 2026-05-25 SME-eval gap #2)
// Requires:
//   cd functions && npm install
//   firebase functions:secrets:set SENDGRID_API_KEY
//   firebase functions:secrets:set BRIEF_FROM_EMAIL
//   firebase deploy --only functions:dailyBriefDigest,functions:triggerBriefDigestTest
// Function gracefully no-ops if secrets are unset (logs "secrets_missing").
// Schedule: 11:00 UTC daily (~7am ET / 4am PT). Per-user TZ is a P14.x enhancement.
// triggerBriefDigestTest is a callable HTTP companion that fires one digest
// immediately to the caller (or to a `to` override) for SendGrid setup testing.
export { dailyBriefDigest } from "./jobs/dailyBriefDigest";
export { commitmentsAutoArchive } from "./jobs/commitmentsAutoArchive";
export { triggerBriefDigestTest } from "./http/triggerBriefDigestTest";

// P13.378 — per-meeting EMAIL reminders (every 15 min). Server-side complement
// to the in-app desktop notification, so a reminder lands even when Corsair is
// closed / the laptop is asleep. Opt out via
// brief_subscriptions/{uid}/meetingReminders:false.
export { meetingReminder } from "./jobs/meetingReminder";

// P13.270 — one-shot backfill of Signal.relatedIds across existing
// sig_tt_/sig_sn_/sig_ds_ records. Hash-stable signals predating the
// P13.266-269 wiring ships need this to pick up the new resolution
// path without re-fetching RSS. Match-to-existing-only (autoCreate:false).
//
// onCall callable for operator UI use; onSchedule monthly wrapper for
// cloud-scheduler-run-now and standing cron — both call the shared core
// in jobs/backfillRelatedIdsCore.ts.
export { triggerRelatedIdsBackfill } from "./http/triggerRelatedIdsBackfill";
export { relatedIdsBackfillMonthly } from "./jobs/relatedIdsBackfillMonthly";

// 2026-06-02 — one-shot operator-callable backfill that merges duplicate
// org/person nodes accumulated by the pre-v1.3 orgResolver / pre-v1.2
// personResolver race. Workspace 1777435779676 had 17 clusters at deploy
// time (4× "Senate Armed Services" etc). The in-flight dedupe fix in
// orgResolver/personResolver prevents future dups; this callable cleans
// up the existing ones. Idempotent; safe to re-run.
export { backfillOrgMerge } from "./http/triggerOrgMergeBackfill";
// onSchedule yearly wrapper — exists for cloud-scheduler-run-now during
// cleanup sessions (the onCall above can't be invoked from a CLI token).
// Same shared core in jobs/backfillOrgMergeCore.ts.
export { orgMergeBackfillYearly } from "./jobs/orgMergeBackfillOnce";

// uas-patterns DDG Tracker (P13.273 / O-7) — daily HTML scrape of the
// Defense Drone Gauntlet leaderboard + analyst predictions. Closes
// Category 13 (drone-specific / Atlas-target-market) coverage gap.
// Emits ddg_status_change Signals per tracked vendor and ddg_prediction
// Signals per analyst forecast. Subject-resolves only to existing Org
// nodes (no autoCreate); INFERRED confidence 0.75 per third-party
// curation policy.
export { triggerUasPatternsSync } from "./http/triggerUasPatternsSync";
export { uasPatternsDaily } from "./jobs/uasPatternsDaily";

// uas-patterns PIE supply-chain intelligence (P13.275) — companion to
// the DDG plugin. Daily HTML scrape of the same domain (rate-limit
// bucket shared) extracts MANUFACTURERS + SCENARIOS static slices.
// Emits supply_chain_status Signals per vendor present in workspace
// and supply_chain_scenario Signals per forecast (with relatedIds via
// mention scan against workspace Orgs). v1 ships only the static
// slices; the page's token-gated /api/data dynamic streams (FLAGS /
// PREDICTIONS / OUTCOMES / signals) are deferred to v1.1.
export { triggerUasPatternsPieSync } from "./http/triggerUasPatternsPieSync";
export { uasPatternsPieDaily } from "./jobs/uasPatternsPieDaily";

// Entity domain enrichment (P13.279) — derives node.domain on
// government-typed Organization nodes from aggregated SAM.gov POC email
// frequencies per opp.customerOrgId. Atlas at design time: 0/951 nodes
// had domain populated; 238 derivable from existing absorbed POC data.
// Lifts the email matcher's primary companyByDomain exact path from 0%
// to ~80% government coverage. Pure-graph derivation; no external API.
// Idempotent — never overwrites an existing explicit node.domain.
// See `corsair-entity-domain-enrichment.md` for design + probe results.
export { triggerEnrichEntityDomains } from "./http/triggerEnrichEntityDomains";
export { enrichEntityDomainsYearly } from "./jobs/enrichEntityDomainsYearly";

// Company domain enrichment (P13.280) — v2 companion to the above. Where
// v1 derived government org domains via POC email aggregation, v2 derives
// COMPANY node domains via SAM.gov entity-information API lookup by
// node.uei (472 of 652 Atlas companies have UEI populated at design time).
// Extracts coreData.entityInformation.entityURL → normalized domain.
// Confidence-tiered by Jaro-Winkler match between legalBusinessName and
// node.name. Time-bounded chunked processing (450s deadline per run);
// idempotent + safe to re-run since previously-written nodes are skipped.
export { triggerEnrichCompanyDomainsByUei } from "./http/triggerEnrichCompanyDomainsByUei";
export { enrichCompanyDomainsByUeiYearly } from "./jobs/enrichCompanyDomainsByUeiYearly";
