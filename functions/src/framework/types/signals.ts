// Corsair Signal entity type variants
//
// Per architecture v1: Signal is a generic time-ordered event entity. Phase
// 8.5 introduces many specific Signal types from external sources. Each
// `type` value has its own `attrs` shape.

import type { SourceProvenance } from "./provenance";

export type SignalType =
  // Phase 8.5.3 SAM.gov
  | "opportunity_amendment"
  | "opportunity_deadline_extended"
  | "opportunity_deadline_advanced"
  | "regulatory_comment"
  // Phase 8.5.4 USAspending / DoD News
  | "award_modification"
  | "award_terminated"
  // Phase 8.5.5 GAO Protest
  | "protest"
  // Phase 8.5.6 SEC EDGAR
  | "material_event"
  | "periodic_report"
  | "insider_transaction"
  | "proxy_statement"
  // Phase 8.5.7 Congress.gov
  | "congressional_hearing"
  | "nomination"
  | "qfr"
  | "congressional_bill_action"
  // Phase 8.5+ broader categories
  | "policy_signal"
  | "oversight_finding"
  | "trade_press_article"
  | "analysis_publication"
  | "asset_movement"
  | "facility_activity"
  | "fms_notification"
  | "budget_change"
  | "congressional_mark"
  | "committee_meeting"
  | "committee_recommendation"
  | "lobbying_disclosure"
  | "vacancy_alert"
  | "service_news"
  | "public_statement"
  | "public_post"
  | "public_speaking"
  | "investor_communication"
  | "funding_event"
  | "advisory_body_report"
  // P13.273 / O-7 — uas-patterns DDG Tracker
  | "ddg_status_change"
  | "ddg_prediction"
  // P13.275 — uas-patterns PIE supply-chain intelligence (companion)
  | "supply_chain_status"
  | "supply_chain_scenario";

export interface Signal {
  id: string;
  type: SignalType;
  subjectIds: string[]; // primary entity IDs the signal is about
  relatedIds?: string[]; // secondary entity IDs (linked context)
  occurredAt: number; // timestamp the event happened
  attrs: Record<string, unknown>; // type-specific structured data
  source: SourceProvenance;
}

// ─── Type-specific attrs interfaces ──────────────────────────────────────

export interface ProtestAttrs {
  docketNumber: string;
  protestorName: string;
  protestorOrgId: string;
  awardeeName?: string;
  awardeeOrgId?: string;
  agency: string;
  agencyOrgId: string;
  solicitationNum?: string;
  status: "pending" | "decided" | "dismissed" | "withdrawn" | "settled";
  filedAt: number;
  decidedAt?: number;
  outcome?: "sustained" | "denied" | "dismissed_partial" | "dismissed_full" | "withdrawn" | "settled" | null;
  decisionUrl?: string;
  decisionPdfUrl?: string;
  decisionTextHash?: string;
  decisionTextStorage?: string;
  correctiveAction?: string;
  reconsiderationOf?: string;
}

export interface MaterialEventAttrs {
  cik: string;
  ticker?: string;
  accessionNumber: string;
  formType: "8-K";
  items: string[];
  itemDescriptions: string[];
  summary: string;
  documentUrl: string;
  filedAt: number;
}

export interface PeriodicReportAttrs {
  cik: string;
  ticker?: string;
  accessionNumber: string;
  formType: "10-K" | "10-Q";
  reportDate: number;
  documentUrl: string;
  extractedSections: {
    mdaSnippet?: string;
    riskFactorsSnippet?: string;
    defenseSegment?: string;
    backlogTotal?: number;
    backlogDefense?: number;
  };
  earningsCallTranscriptUrl?: string;
}

export interface InsiderTransactionAttrs {
  cik: string;
  insiderCik: string;
  insiderName: string;
  insiderTitle: string;
  transactionCode: string;
  transactionType: string;
  shares: number;
  pricePerShare?: number;
  totalValue?: number;
  sharesOwnedAfter?: number;
  documentUrl: string;
}

export interface CongressionalHearingAttrs {
  congress: number;
  chamber: "house" | "senate" | "joint";
  committeeCode: string;
  committeeName: string;
  title: string;
  hearingNumber: string;
  witnesses: Array<{
    name: string;
    title: string;
    organization?: string;
    personId?: string;
    bioguideId?: string;
    statementUrl?: string;
  }>;
  transcriptUrl?: string;
  documentUrls: string[];
  bills?: string[];
}

export interface NominationAttrs {
  congress: number;
  nominationNumber: number;
  nomineeName: string;
  position: string;
  targetOrgName: string;
  receivedAt: number;
  committeeName?: string;
  confirmedAt?: number;
  confirmationVote?: { yea: number; nay: number; present: number };
  status: "pending" | "confirmed" | "returned" | "withdrawn";
  isCivilian: boolean;
  isPrivileged: boolean;
  actionTimeline: Array<{ actionDate: number; text: string }>;
}

export interface OpportunityAmendmentAttrs {
  parentNoticeId: string;
  amendmentNoticeId: string;
  amendmentNumber: number;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
}
