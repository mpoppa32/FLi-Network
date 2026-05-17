// SAM.gov source — SAM opportunity → Corsair Opportunity mapper
//
// V1 scope: create new Opportunities from SAM notices. Reconciliation with
// operator-created Opportunities (via solicitation number match) is V1.1.
// Amendment versioning is V1.1. Q&A log extraction is V1.1.

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import { hashFields } from "../../framework/hashing";
import { resolveAgencyOrg } from "../usaSpending/orgResolver";
import type { Opportunity, OpportunityStage, SamgovLifecycle, SamgovNoticeType } from "../../framework/types/entities";
import type { SamOpportunity } from "./client";

/** SAM notice type code → human-readable + Corsair stage hint */
const NOTICE_TYPE_MAP: Record<string, { name: string; defaultStage: OpportunityStage; lifecycle: SamgovLifecycle }> = {
  p: { name: "Presolicitation", defaultStage: "tracking", lifecycle: "tracked" },
  r: { name: "Sources Sought", defaultStage: "awareness", lifecycle: "tracked" },
  s: { name: "Special Notice", defaultStage: "awareness", lifecycle: "tracked" },
  k: { name: "Combined Synopsis/Solicitation", defaultStage: "rfp", lifecycle: "tracked" },
  o: { name: "Solicitation", defaultStage: "rfp", lifecycle: "tracked" },
  u: { name: "Justification", defaultStage: "tracking", lifecycle: "tracked" },
  a: { name: "Award Notice", defaultStage: "award", lifecycle: "awarded" },
  m: { name: "Modification/Amendment", defaultStage: "rfp", lifecycle: "tracked" },
  i: { name: "Intent to Bundle", defaultStage: "awareness", lifecycle: "tracked" },
  f: { name: "Foreign Standard", defaultStage: "awareness", lifecycle: "tracked" },
};

function parseDateMs(s: string | undefined | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function deriveLifecycle(notice: SamOpportunity): SamgovLifecycle {
  const t = (notice.type || "").toLowerCase();
  if (t === "award" || t === "a") return "awarded";
  if (notice.active === "No") return "archived";
  const deadline = parseDateMs(notice.responseDeadLine);
  if (deadline && deadline < Date.now()) return "response_window_closed";
  return "tracked";
}

/** Parse the agency hierarchy from fullParentPathName (dot-separated). */
export function parseAgencyHierarchy(fullParentPathName?: string): string[] {
  if (!fullParentPathName) return [];
  return fullParentPathName.split(".").map((s) => s.trim()).filter(Boolean);
}

/**
 * Map a SAM notice to a Corsair Opportunity. Resolves agency hierarchy
 * Organizations (auto-creating government entries as needed).
 */
export async function mapNoticeToOpportunity(
  workspaceId: string,
  notice: SamOpportunity
): Promise<Opportunity> {
  const id = "opp_sam_" + notice.noticeId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50);
  const hierarchy = parseAgencyHierarchy(notice.fullParentPathName);

  // Resolve the deepest subtier to the customer Organization
  let customerOrgId: string | undefined;
  if (hierarchy.length > 0) {
    const deepest = hierarchy[hierarchy.length - 1];
    const { orgId } = await resolveAgencyOrg(workspaceId, deepest);
    customerOrgId = orgId;
  }

  const noticeTypeCode = ((notice.type || "").toLowerCase().slice(0, 1)) as SamgovNoticeType;
  const noticeMeta = NOTICE_TYPE_MAP[noticeTypeCode] ?? { name: notice.type ?? "Unknown", defaultStage: "awareness" as OpportunityStage, lifecycle: "tracked" as SamgovLifecycle };

  const placeOfPerf = notice.placeOfPerformance ?? {};
  const placeNormalized = {
    country: placeOfPerf.country?.code || "USA",
    state: placeOfPerf.state?.code,
    city: placeOfPerf.city?.name,
    zip: placeOfPerf.zip,
  };

  const now = Date.now();
  const hashSubset = {
    noticeId: notice.noticeId,
    title: notice.title,
    responseDeadLine: notice.responseDeadLine ?? "",
    type: notice.type ?? "",
    active: notice.active ?? "",
  };
  const hash = hashFields(hashSubset as unknown as Record<string, unknown>, [
    "noticeId",
    "title",
    "responseDeadLine",
    "type",
    "active",
  ]);

  const opp: Opportunity = {
    id,
    name: notice.title || "Untitled Opportunity",
    agency: hierarchy[0] || notice.fullParentPathName || "",
    vehicle: "",
    value: "",
    stage: noticeMeta.defaultStage,
    stageEnteredAt: parseDateMs(notice.postedDate) || now,
    notes: "",
    solicitationNumber: notice.solicitationNumber,
    meetings: [],
    posture: { adversaries: [] },
    updatedAt: new Date().toISOString(),
    // Phase 8.5 SAM.gov extensions:
    samgovNoticeId: notice.noticeId,
    samgovUiLink: notice.uiLink,
    samgovNoticeType: noticeTypeCode,
    samgovBaseType: notice.baseType || noticeMeta.name,
    samgovPostedDate: parseDateMs(notice.postedDate) || undefined,
    samgovArchiveDate: parseDateMs(notice.archiveDate) || undefined,
    samgovResponseDeadline: parseDateMs(notice.responseDeadLine) || undefined,
    samgovLifecycle: deriveLifecycle(notice),
    customerOrgId,
    agencyHierarchy: hierarchy,
    naicsCodes: notice.naicsCodes ?? (notice.naicsCode ? [notice.naicsCode] : []),
    pscCodes: notice.classificationCode ? [notice.classificationCode] : [],
    setAsideCode: notice.typeOfSetAside,
    setAsideDescription: notice.typeOfSetAsideDescription,
    placeOfPerf: placeNormalized,
    descriptionText: "", // fetched separately via /noticedesc endpoint (v1.1)
    samgovPocs: (notice.pointOfContact || []).map((p) => ({
      type: p.type || "primary",
      title: p.title || "",
      fullName: p.fullName || "",
      email: p.email || "",
      phone: p.phone || undefined,
    })),
    attachments: (notice.resourceLinks || []).map((url) => ({
      resourceUrl: url,
      observedAt: now,
    })),
    relatedNotices: (notice.relatedNotices || []).map((r) => ({
      noticeId: r.noticeId,
      type: r.type,
      direction: "sibling" as const,
    })),
    amendmentNumber: 0,
    isLatestVersion: true,
    source: externalProvenance("sam_gov", notice.noticeId, notice.uiLink || null, hash, now),
    reconciliation: {
      samgovMatchedAt: now,
      matchConfidence: 1.0,
      matchMethod: "piid",
      operatorOverrides: [],
    },
  };

  return opp;
}

/** Idempotent upsert respecting operator overrides. */
export async function upsertOpportunity(
  workspaceId: string,
  opp: Opportunity
): Promise<{ action: "created" | "updated" | "unchanged"; oppId: string }> {
  const path = wsPath(workspaceId, "opportunities", opp.id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(opp);
    return { action: "created", oppId: opp.id };
  }
  const existing = snap.val() as Opportunity;
  if (existing.source?.hash && opp.source?.hash && existing.source.hash === opp.source.hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", oppId: opp.id };
  }
  // Operator override-preserving merge
  const overrides = new Set(existing.reconciliation?.operatorOverrides ?? []);
  const merged: Opportunity = { ...opp };
  // Always preserve operator-input core fields if operator has set them
  if (existing.notes !== undefined && existing.notes !== "" && !overrides.has("notes")) merged.notes = existing.notes;
  else if (overrides.has("notes")) merged.notes = existing.notes;
  if (overrides.has("name") && existing.name) merged.name = existing.name;
  if (overrides.has("agency") && existing.agency) merged.agency = existing.agency;
  if (overrides.has("value") && existing.value) merged.value = existing.value;
  if (overrides.has("stage") && existing.stage) {
    merged.stage = existing.stage;
    merged.stageEnteredAt = existing.stageEnteredAt;
  }
  if (existing.meetings && existing.meetings.length) merged.meetings = existing.meetings;
  if (existing.posture?.adversaries?.length) merged.posture = existing.posture;
  // Preserve reconciliation flags
  merged.reconciliation = {
    ...(existing.reconciliation ?? {}),
    ...merged.reconciliation,
    operatorOverrides: existing.reconciliation?.operatorOverrides ?? [],
  };

  await db.ref(path).set(merged);
  return { action: "updated", oppId: opp.id };
}
