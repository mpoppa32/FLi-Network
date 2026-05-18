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
  | "house_lobbying"
  | "plum_book"
  | "industry_assoc"
  | "conference"
  | "forum"
  | "gao_reports"
  | "dpc_oversight";

export interface SourceProvenance {
  system: SourceSystem;
  externalId: string | null;
  url: string | null;
  fetchedAt: number;
  refreshedAt: number;
  hash: string | null;
}
