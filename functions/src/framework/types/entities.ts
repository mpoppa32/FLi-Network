// Corsair entity types — Phase 8.5 extensions over the existing schema.
//
// The existing Person/Organization/Opportunity/Meeting model lives in
// FLiIntel.html's module scope. These TypeScript types describe the same
// shape for type-checking source-integration code that reads or writes
// entities via the Admin SDK.

import type { SourceProvenance } from "./provenance";

// ─── Organization ────────────────────────────────────────────────────────
//
// Per E-2 (LOCKED): `type` enum extended with program / committee /
// lobby_firm / university / ffrdc / trade_assoc subtypes. Existing types
// (company, government, other) remain.

export type OrganizationType =
  | "company"
  | "government"
  | "foreign_government"
  | "program"
  | "committee"
  | "lobby_firm"
  | "university"
  | "ffrdc"
  | "trade_assoc"
  | "other";

export interface ProgramAttrs {
  programElement?: string;
  acatLevel?: "ACAT I" | "ACAT II" | "ACAT III" | null;
  mdap?: boolean;
  fydpFunding?: Record<string, number>; // by FY string
}

export interface CommitteeAttrs {
  charter?: string;
  meetingFreq?: string;
  publicReports?: boolean;
  conferenceYear?: number;
}

export interface OrganizationLocation {
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  installation?: string;
  command?: string;
}

export interface Organization {
  id: string;
  type: OrganizationType;
  name: string;
  alternateNames?: string[];
  notes?: string;
  priority?: number;
  meetings?: string[];
  x?: number | null;
  y?: number | null;
  pinned?: boolean;
  color?: string | null;
  created?: string | number;
  // Phase 8.5 additions:
  uei?: string;
  duns?: string;
  parentOrgId?: string;
  programAttrs?: ProgramAttrs;
  committeeAttrs?: CommitteeAttrs;
  location?: OrganizationLocation;
  autoCreated?: boolean;
  // Posture extensions (apply across types)
  posture?: OrganizationPosture;
  source?: SourceProvenance;
  migration?: { version: string; step: number; appliedAt: number };
}

export interface OrganizationPosture {
  position?: string;
  path?: string;
  trajectory?: "rising" | "stable" | "transitioning" | "exiting";
  tells?: PostureTell[];
  influenceReads?: string;
  byPursuit?: Record<string, { position?: string; note?: string }>;
  lastUpdated?: number;
}

// ─── Person ──────────────────────────────────────────────────────────────

export interface PostureTell {
  observedAt: number;
  observedBy?: string; // user UID
  text: string;
  category?: string;
  passDownVisible?: boolean; // default true per pass-down spec D-5
}

export interface Person {
  id: string;
  type: "person";
  name: string;
  role?: string;
  org?: string;
  notes?: string;
  meetings?: string[];
  priority?: number;
  created?: string | number;
  // Phase 8.5 additions:
  history?: Array<{ org: string; role: string; start: number; end: number | null; source: string }>;
  bioguideId?: string;
  cik?: string;
  party?: string;
  state?: string;
  district?: string;
  posture?: OrganizationPosture;
  source?: SourceProvenance;
  migration?: { version: string; step: number; appliedAt: number };
}

// ─── Opportunity (existing entity, Phase 8.5 extended) ────────────────────

export type OpportunityStage =
  | "awareness"
  | "tracking"
  | "engaged"
  | "rfp"
  | "proposal"
  | "negotiation"
  | "submitted"
  | "award"
  | "won"
  | "lost";

export type SamgovLifecycle =
  | "tracked"
  | "response_window_closed"
  | "awarded"
  | "cancelled"
  | "archived";

export type SamgovNoticeType = "p" | "r" | "s" | "k" | "o" | "u" | "a" | "m" | "i" | "f" | "g";

export interface OpportunityAttachment {
  resourceUrl: string;
  filename?: string;
  size?: number;
  mimetype?: string;
  observedAt: number;
  category?: "section_l" | "section_m" | "scope" | "cdrls" | "justification" | "qa_log" | "other";
  removedAt?: number | null;
  versionedFrom?: string;
}

export interface OpportunityRelatedNotice {
  noticeId: string;
  type: string;
  direction: "parent" | "amended_by" | "amends" | "sibling";
}

export interface OpportunityReconciliation {
  operatorCreatedAt?: number;
  samgovMatchedAt?: number;
  matchConfidence?: number;
  matchMethod?: "piid" | "solnum" | "manual" | "fuzzy";
  operatorOverrides?: string[];
}

export interface OpportunityQAEntry {
  questionNumber: number;
  question: string;
  answer: string;
  issuedAt: number;
  sourceAmendmentId?: string;
}

export interface Opportunity {
  id: string;
  name: string;
  agency?: string;
  vehicle?: string;
  value?: string; // operator-set free-text
  stage: OpportunityStage;
  stageEnteredAt?: number;
  exitCriteriaChecks?: Record<string, Record<string, boolean>>;
  notes?: string;
  solicitationNumber?: string;
  meetings?: string[];
  posture?: { adversaries?: string[] };
  updatedAt?: string | number;
  // Phase 8.5 additions (SAM.gov):
  samgovNoticeId?: string;
  samgovUiLink?: string;
  samgovNoticeType?: SamgovNoticeType;
  samgovBaseType?: string;
  samgovPostedDate?: number;
  samgovArchiveDate?: number;
  samgovResponseDeadline?: number;
  samgovLifecycle?: SamgovLifecycle;
  // Normalized fields parallel to free-text equivalents:
  customerOrgId?: string;
  agencyHierarchy?: string[];
  agencyHierarchyCodes?: string[];
  naicsCodes?: string[];
  pscCodes?: string[];
  setAsideCode?: string;
  setAsideDescription?: string;
  placeOfPerf?: { country: string; state?: string; city?: string; zip?: string };
  estimatedValueNumeric?: number;
  estimatedValueCurrency?: "USD";
  descriptionText?: string;
  descriptionHtml?: string;
  samgovPocs?: Array<{ type: string; title: string; fullName: string; email: string; phone?: string }>;
  attachments?: OpportunityAttachment[];
  relatedNotices?: OpportunityRelatedNotice[];
  amendmentNumber?: number;
  isLatestVersion?: boolean;
  deadlineHistory?: Array<{ deadline: number; recordedAt: number }>;
  qAndA?: OpportunityQAEntry[];
  linkedAwardId?: string;
  outOfWatchlist?: boolean;
  reconciliation?: OpportunityReconciliation;
  source?: SourceProvenance;
  migration?: { version: string; step: number; appliedAt: number };
}

// ─── Meeting (existing) ───────────────────────────────────────────────────

export interface Meeting {
  id: string;
  meta?: { title: string; date: string; type?: string; attendees?: Array<{ name: string; role?: string }> };
  intel?: { keyPeople?: Array<{ name: string; org?: string }>; actionItems?: any[]; learningInsights?: any[] };
  oppId?: string;
  notes?: string;
  created?: string | number;
  source?: SourceProvenance;
  migration?: { version: string; step: number; appliedAt: number };
}

// ─── Edge (existing schema, Phase 8.5 extended per E-3) ───────────────────

export interface Edge {
  id: string;
  source: string; // node id (FK)
  target: string; // node id (FK)
  label?: string;
  dir?: "to" | "from" | "both";
  notes?: string;
  // E-3 extensions (optional, additive):
  start?: number;
  end?: number;
  attrs?: Record<string, unknown>;
}
