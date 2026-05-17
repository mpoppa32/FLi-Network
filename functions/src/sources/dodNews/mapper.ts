// DoD News — parsed announcement → provisional Award mapper
//
// Per award-integration-v1 Part Five (Reconciliation Logic):
//
// Match key is PIID. If a workspace Award with matching PIID already exists,
// the existing record is authoritative — we just append a DoD News
// observation to reconciliation.sources[] (Doctrine §IX provenance trail).
// If no match, we create a provisional Award with lifecycleState='provisional'
// and source.system='dod_news'.
//
// When USAspending sync subsequently finds the PIID, the upsertAward logic
// in usaSpending/mapper.ts will update the existing provisional Award:
// lifecycleState transitions provisional → active, source becomes
// usaspending, but reconciliation.firstSeenSource stays 'dod_news' so the
// operator's view of when Corsair first knew is preserved.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type {
  Award,
  AwardCategory,
  AwardLifecycleState,
  AwardType,
  LifecycleTransition,
} from "../../framework/types/awards";
import { resolveAgencyOrg, resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { ParsedAnnouncement } from "./parser";

const SERVICE_TO_AGENCY: Record<string, string> = {
  ARMY: "Department of the Army",
  NAVY: "Department of the Navy",
  "AIR FORCE": "Department of the Air Force",
  "SPACE FORCE": "Department of the Space Force",
  "MARINE CORPS": "United States Marine Corps",
  "DEFENSE LOGISTICS AGENCY": "Defense Logistics Agency",
  "MISSILE DEFENSE AGENCY": "Missile Defense Agency",
  "U.S. SPECIAL OPERATIONS COMMAND": "U.S. Special Operations Command",
  "U.S. TRANSPORTATION COMMAND": "U.S. Transportation Command",
  "DEFENSE INFORMATION SYSTEMS AGENCY": "Defense Information Systems Agency",
  "DEFENSE ADVANCED RESEARCH PROJECTS AGENCY": "Defense Advanced Research Projects Agency",
  "DEFENSE HEALTH AGENCY": "Defense Health Agency",
  "DEFENSE COUNTERINTELLIGENCE AND SECURITY AGENCY": "Defense Counterintelligence and Security Agency",
  "DEFENSE THREAT REDUCTION AGENCY": "Defense Threat Reduction Agency",
  "DEFENSE FINANCE AND ACCOUNTING SERVICE": "Defense Finance and Accounting Service",
  "WASHINGTON HEADQUARTERS SERVICES": "Washington Headquarters Services",
};

const DOD_TOPTIER_AGENCY = "Department of Defense";

function provisionalAwardId(piid: string, dateMs: number): string {
  const safe = piid.replace(/[^A-Za-z0-9]/g, "_").slice(0, 40) || "noPiid";
  const dayBucket = Math.floor(dateMs / 86400000);
  return `aw_dn_${safe}_${dayBucket}`;
}

export interface DodNewsMapResult {
  action: "created_provisional" | "appended_observation" | "skipped_below_confidence" | "skipped_existing_authoritative";
  awardId: string | null;
  flags: string[];
}

/**
 * Map one ParsedAnnouncement to a workspace Award. Idempotent: subsequent
 * runs on the same announcement only bump the observation timestamp.
 */
export async function reconcileAnnouncement(
  workspaceId: string,
  announcement: ParsedAnnouncement,
  log?: Logger,
  options: { confidenceFloor?: number } = {}
): Promise<DodNewsMapResult> {
  const floor = options.confidenceFloor ?? 0.6;
  if (announcement.confidence < floor) {
    return {
      action: "skipped_below_confidence",
      awardId: null,
      flags: ["confidence_below_floor", ...announcement.flags],
    };
  }
  if (!announcement.piid) {
    return { action: "skipped_below_confidence", awardId: null, flags: ["no_piid_extracted"] };
  }

  // Search for existing Award with matching PIID
  const allAwardsSnap = await db.ref(wsPath(workspaceId, "awards")).once("value");
  const allAwards = (allAwardsSnap.val() as Record<string, Award> | null) ?? {};
  const matched = Object.values(allAwards).find(
    (a) => a && a.piid && a.piid.toUpperCase() === announcement.piid.toUpperCase()
  );

  const now = Date.now();
  if (matched) {
    // Append observation to reconciliation.sources[]; do not overwrite
    const observations = matched.reconciliation?.sources ?? [];
    if (observations.some((o) => o.system === "dod_news" && o.externalId === announcement.piid)) {
      // Already recorded
      return { action: "skipped_existing_authoritative", awardId: matched.id, flags: ["already_observed"] };
    }
    const updatedSources = [
      ...observations,
      { system: "dod_news", externalId: announcement.piid, observedAt: now, confidence: announcement.confidence },
    ];
    // Bump firstSeenSource to dod_news if Award didn't have one or if dod_news is earlier
    const firstSeenAt = matched.reconciliation?.firstSeenAt
      ? Math.min(matched.reconciliation.firstSeenAt, announcement.publishedDate || now)
      : announcement.publishedDate || now;
    const firstSeenSource = matched.reconciliation?.firstSeenSource === "usaspending" && (announcement.publishedDate || now) < (matched.reconciliation.firstSeenAt || now)
      ? "dod_news"
      : matched.reconciliation?.firstSeenSource || "dod_news";

    const updates: Record<string, unknown> = {
      [`${wsPath(workspaceId, "awards", matched.id, "reconciliation", "sources")}`]: updatedSources,
      [`${wsPath(workspaceId, "awards", matched.id, "reconciliation", "firstSeenAt")}`]: firstSeenAt,
      [`${wsPath(workspaceId, "awards", matched.id, "reconciliation", "firstSeenSource")}`]: firstSeenSource,
      [`${wsPath(workspaceId, "awards", matched.id, "reconciliation", "dodNewsId")}`]: announcement.piid,
    };
    await db.ref().update(updates);
    log?.debug("dod_news_appended_observation", { awardId: matched.id, piid: announcement.piid });
    return { action: "appended_observation", awardId: matched.id, flags: announcement.flags };
  }

  // No match: create provisional Award
  const primeName = announcement.companyName || "Unknown Prime";
  const { orgId: primeOrgId } = await resolveRecipientOrg(workspaceId, primeName, null);
  const customerName = announcement.serviceOfRecord
    ? SERVICE_TO_AGENCY[announcement.serviceOfRecord] || announcement.serviceOfRecord
    : announcement.contractingAuthority || "Department of Defense";
  const { orgId: customerOrgId } = await resolveAgencyOrg(workspaceId, customerName);
  const { orgId: toptierOrgId } = await resolveAgencyOrg(workspaceId, DOD_TOPTIER_AGENCY);

  const awardedAt = announcement.publishedDate || now;
  const popEnd = announcement.estimatedCompletionDate || 0;
  const awardType: AwardType = announcement.isModification ? "D" : "D"; // best-guess; USAspending will refine
  const awardCategory: AwardCategory = "contract";
  const lifecycleState: AwardLifecycleState = "provisional";

  const transitions: LifecycleTransition[] = [
    {
      fromState: "unknown",
      toState: lifecycleState,
      transitionedAt: now,
      reason: `DoD News announcement (confidence ${announcement.confidence.toFixed(2)})`,
      triggeredBy: "dod_news_match",
    },
  ];

  const hash = hashFields(
    {
      piid: announcement.piid,
      dollar: announcement.dollarValue,
      description: announcement.description.slice(0, 200),
      publishedDate: announcement.publishedDate || 0,
    } as Record<string, unknown>,
    ["piid", "dollar", "description", "publishedDate"]
  );

  const provenance = externalProvenance(
    "dod_news",
    announcement.piid,
    "https://www.defense.gov/News/Contracts/",
    hash,
    now
  );

  const id = provisionalAwardId(announcement.piid, awardedAt);
  const award: Award = {
    id,
    type: "award",
    generated_unique_id: `DN_${announcement.piid}`,
    piid: announcement.piid,
    lifecycleState,
    lifecycleTransitions: transitions,
    awardType,
    awardCategory,
    primeOrgId,
    primeRecipientHash: announcement.piid,
    customerOrgId,
    customerToptierOrgId: toptierOrgId,
    obligated: announcement.dollarValue,
    baseAndAllOptionsValue: announcement.dollarValue,
    currency: "USD",
    naics: "",
    psc: "",
    awardedAt,
    popStart: awardedAt,
    popEnd,
    lastModifiedAt: awardedAt,
    placeOfPerf: {
      country: "USA",
      city: announcement.location?.split(",")[0]?.trim(),
      state: announcement.location?.split(",")[1]?.trim()?.slice(0, 2),
    },
    description: announcement.description.slice(0, 2000),
    modifications: [],
    subawards: [],
    source: provenance,
    reconciliation: {
      firstSeenAt: awardedAt,
      firstSeenSource: "dod_news",
      dodNewsId: announcement.piid,
      matchConfidence: announcement.confidence,
      sources: [
        {
          system: "dod_news",
          externalId: announcement.piid,
          observedAt: now,
          confidence: announcement.confidence,
        },
      ],
      authoritativeSource: "dod_news",
    },
  };

  await db.ref(wsPath(workspaceId, "awards", id)).set(award);
  // Light secondary indexes (mirror usaSpending/mapper minimal-write pattern)
  const popEndDay = popEnd > 0 ? Math.floor(popEnd / 86400000) : 0;
  const indexUpdates: Record<string, unknown> = {
    [`${wsPath(workspaceId, "awardsByPrime", primeOrgId, id)}`]: { id, popEnd },
    [`${wsPath(workspaceId, "awardsByCustomer", customerOrgId, id)}`]: { id, popEnd },
    [`${wsPath(workspaceId, "awardsByLifecycle", lifecycleState, id)}`]: { id },
  };
  if (popEnd > 0) {
    indexUpdates[`${wsPath(workspaceId, "awardsByPopEnd", String(popEndDay), id)}`] = { id, primeOrgId, popEnd };
  }
  await db.ref().update(indexUpdates);

  log?.info("dod_news_provisional_created", {
    workspaceId,
    awardId: id,
    piid: announcement.piid,
    dollar: announcement.dollarValue,
  });
  return { action: "created_provisional", awardId: id, flags: announcement.flags };
}
