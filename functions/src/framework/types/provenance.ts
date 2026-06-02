// Source provenance per architecture v1 E-4 (LOCKED)
//
// Every entity created or updated from an external source carries this
// attribute. Operator-input entities use `system: 'operator_manual'` and are
// never overwritten by external feeds.

export type SourceSystem =
  | "operator_manual"
  | "sam_gov"
  | "usaspending"
  | "dod_news"
  | "gao_protest"
  | "sec_edgar"
  | "congress_gov"
  // Tier 2 sources (Phase 8.6+)
  | "faca"
  | "dsca_fms" // Phase 8.6.2 — FMS notifications
  | "dod_comptroller"
  | "inside_defense"
  | "service_news"
  | "think_tank"
  | "advisory_boards"
  | "senate_lda"
  | "plum_book"
  | "industry_assoc"
  | "conference"
  | "forum"
  | "gao_reports"
  | "dpc_oversight"
  | "state_department" // Phase 8.6.4 — State Dept RSS aggregator
  | "defense_scoop" // Phase 8.6.15 — Defense BD news aggregator
  | "dod_oig" // Phase 8.6.16 — DoD Office of Inspector General audit/eval/investigation reports
  | "darpa_news" // Phase 8.6.17 — DARPA news + program announcements (R&D pipeline leading-edge)
  | "nasa_oig" // Phase 8.6.18 — NASA Office of Inspector General (defense-adjacent contractor exposure)
  | "uas_patterns" // P13.273 / O-7 — uas-patterns.com DDG Tracker (drone-specific Cat 13)
  | "uas_patterns_pie"; // P13.275 — uas-patterns.com PIE supply-chain intelligence (companion to DDG)


export interface SourceProvenance {
  system: SourceSystem;
  externalId: string | null;
  url: string | null;
  fetchedAt: number;
  refreshedAt: number;
  hash: string | null;
}
