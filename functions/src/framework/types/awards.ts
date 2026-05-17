// Award entity — Phase 8.5.4 introduces this as a new top-level entity type
// per D-2 (LOCKED). Schema per award-integration-v1 Part Four.

import type { SourceProvenance } from "./provenance";

export type AwardLifecycleState =
  | "provisional"
  | "active"
  | "expiring"
  | "expired"
  | "recompeted"
  | "terminated"
  | "unknown";

export type AwardType =
  | "A" // BPA Call
  | "B" // Purchase Order
  | "C" // Delivery Order (task order under IDV)
  | "D" // Definitive Contract
  | "IDV_A"
  | "IDV_B"
  | "IDV_C"
  | "IDV_D"
  | "IDV_E"
  | "grant"
  | "cooperative_agreement";

export type AwardCategory = "contract" | "grant" | "cooperative_agreement" | "idv";

export interface LifecycleTransition {
  fromState: AwardLifecycleState;
  toState: AwardLifecycleState;
  transitionedAt: number;
  reason: string;
  triggeredBy: "system" | "usaspending_sync" | "dod_news_match" | "daily_check" | string; // operator:<userId>
}

export interface Modification {
  modNumber: string;
  modifiedAt: number;
  obligationDelta: number;
  cumulativeObligated: number;
  popEndAfter?: number;
  actionType: string;
  actionTypeDescription: string;
  description: string;
  source: SourceProvenance;
}

export interface SubawardRef {
  subawardNumber: string;
  subRecipientName: string;
  subOrgId?: string;
  amount: number;
  reportedAt: number;
  subawardActionDate: number;
  naics?: string;
  description: string;
  source: SourceProvenance;
}

export interface AwardPlaceOfPerf {
  country: string;
  state?: string;
  city?: string;
  zip?: string;
}

export interface AwardReconciliation {
  dodNewsId?: string;
  firstSeenAt: number;
  firstSeenSource: string;
  confirmedAt?: number;
  confirmedSource?: string;
  matchConfidence?: number;
  // Generalized for future multi-source per AIQ-9 (LOCKED):
  sources?: Array<{ system: string; externalId: string; observedAt: number; confidence: number }>;
  authoritativeSource?: string;
}

export interface Award {
  id: string;
  type: "award";
  generated_unique_id: string;
  piid: string;
  parentPiid?: string;
  parentAwardId?: string;
  lifecycleState: AwardLifecycleState;
  lifecycleTransitions: LifecycleTransition[];
  awardType: AwardType;
  awardCategory: AwardCategory;
  primeOrgId: string;
  primeRecipientHash: string;
  primeUei?: string;
  primeDuns?: string;
  primeParentOrgId?: string;
  customerOrgId: string;
  customerToptierOrgId: string;
  obligated: number;
  baseAndAllOptionsValue: number;
  totalOutlays?: number;
  currency: "USD";
  naics: string;
  psc: string;
  setAside?: string;
  setAsideDescription?: string;
  awardedAt: number;
  popStart: number;
  popEnd: number;
  lastModifiedAt: number;
  placeOfPerf: AwardPlaceOfPerf;
  description: string;
  modifications: Modification[];
  subawards: SubawardRef[];
  subawardsLastSyncAt?: number;
  attachments?: Array<{ url: string; name: string; fetchedAt: number }>;
  operatorNotes?: string;
  operatorTags?: string[];
  workspaceAdversaryFor?: string[];
  source: SourceProvenance;
  reconciliation: AwardReconciliation;
  recompeteWatchDismissed?: boolean;
  terminationType?: "T4D" | "T4C" | "Settlement" | "Closeout";
}

// Proposed Pursuit — pre-Opportunity record for recompete-watch candidates
// Per award-integration-v1 Part Seven.

export interface ProposedOpportunity {
  id: string;
  sourceAwardId: string;
  proposedAt: number;
  proposedStage: "awareness";
  customerOrgId: string;
  incumbentOrgId: string;
  naics: string;
  estimatedValue: number;
  popEndPredecessor: number;
  expectedSolicitationWindow: { start: number; end: number };
  notes: string;
  proposedAdversaries: string[];
  dismissed?: boolean;
  dismissedAt?: number;
  dismissReason?: string;
}
