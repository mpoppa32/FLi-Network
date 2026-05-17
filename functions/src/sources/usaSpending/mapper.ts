// USAspending source — record → Award entity mapper
//
// Per award-integration-v1 Part Four: map a USAspending search result to a
// Corsair Award entity. V1 scope: search-endpoint fields only. Modifications
// and subawards are populated by separate detail-endpoint follow-up sync.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import type { Award, AwardLifecycleState, AwardType, AwardCategory, LifecycleTransition } from "../../framework/types/awards";
import type { UsaSpendingSearchResult } from "./client";
import { resolveRecipientOrg, resolveAgencyOrg } from "./orgResolver";
import { db, wsPath } from "../../framework/rtdb";

const AWARD_TYPE_TO_CATEGORY: Record<string, AwardCategory> = {
  A: "contract",
  B: "contract",
  C: "contract",
  D: "contract",
  IDV_A: "idv",
  IDV_B: "idv",
  IDV_C: "idv",
  IDV_D: "idv",
  IDV_E: "idv",
};

const EXPIRING_HORIZON_MS = 18 * 30 * 24 * 60 * 60 * 1000; // ~18 months

function parseDateMs(s: string | undefined | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function deriveLifecycleState(popEnd: number, isProvisional: boolean): AwardLifecycleState {
  if (isProvisional) return "provisional";
  const now = Date.now();
  if (popEnd <= 0) return "unknown";
  if (popEnd < now) return "expired";
  if (popEnd - now < EXPIRING_HORIZON_MS) return "expiring";
  return "active";
}

function deriveAwardType(record: UsaSpendingSearchResult): AwardType {
  const code = record.award_type;
  if (!code) return "D"; // best guess: definitive contract
  if (code === "A" || code === "B" || code === "C" || code === "D") return code as AwardType;
  if (code.startsWith("IDV_")) return code as AwardType;
  return "D";
}

/**
 * Map one USAspending search result to a Corsair Award.
 * Resolves prime + customer Organizations (creating them if needed).
 */
export async function mapSearchResultToAward(
  workspaceId: string,
  record: UsaSpendingSearchResult
): Promise<Award> {
  const generatedId = record.generated_internal_id || `usa_${record.internal_id}`;
  const piid = record["Award ID"] || generatedId;
  const id = "aw_" + generatedId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);

  const recipientName = record["Recipient Name"] || "Unknown Recipient";
  const recipientUei = record["Recipient UEI"] || null;
  const { orgId: primeOrgId } = await resolveRecipientOrg(workspaceId, recipientName, recipientUei);

  const toptierName = record["Awarding Agency"] || "Unknown Agency";
  const subtierName = record["Awarding Sub Agency"] || toptierName;
  const { orgId: customerToptierOrgId } = await resolveAgencyOrg(workspaceId, toptierName);
  const { orgId: customerOrgId } = await resolveAgencyOrg(workspaceId, subtierName);

  const popStart = parseDateMs(record["Period of Performance Start Date"]);
  const popEnd = parseDateMs(record["Period of Performance Current End Date"]);
  const awardedAt = popStart || Date.now();
  const lastModifiedAt = parseDateMs(record["Last Modified Date"]) || awardedAt;
  const obligated = Number(record["Award Amount"] || 0);

  const awardType = deriveAwardType(record);
  const awardCategory: AwardCategory = AWARD_TYPE_TO_CATEGORY[awardType] ?? "contract";

  const lifecycleState = deriveLifecycleState(popEnd, false);
  const transitions: LifecycleTransition[] = [
    {
      fromState: "unknown",
      toState: lifecycleState,
      transitionedAt: Date.now(),
      reason: "initial sync from USAspending",
      triggeredBy: "usaspending_sync",
    },
  ];

  const place = record["Place of Performance"] ?? {};
  const placeOfPerf = {
    country: place.country_code || "USA",
    state: place.state_code,
    city: place.city_name,
  };

  const description = (record.Description || "").slice(0, 2000);

  const hashSubset = {
    obligated,
    popEnd,
    lastModifiedAt,
    description: description.slice(0, 500),
  };
  const hash = hashFields(hashSubset as unknown as Record<string, unknown>, [
    "obligated",
    "popEnd",
    "lastModifiedAt",
    "description",
  ]);

  const now = Date.now();
  const provenance = externalProvenance(
    "usaspending",
    generatedId,
    `https://www.usaspending.gov/award/${generatedId}`,
    hash,
    now
  );

  const award: Award = {
    id,
    type: "award",
    generated_unique_id: generatedId,
    piid,
    lifecycleState,
    lifecycleTransitions: transitions,
    awardType,
    awardCategory,
    primeOrgId,
    primeRecipientHash: recipientUei || piid,
    primeUei: recipientUei || undefined,
    customerOrgId,
    customerToptierOrgId,
    obligated,
    baseAndAllOptionsValue: obligated,
    totalOutlays: typeof record["Total Outlays"] === "number" ? record["Total Outlays"] : undefined,
    currency: "USD",
    naics: record.NAICS || "",
    psc: record.PSC || "",
    setAside: record["Type of Set Aside"] || undefined,
    awardedAt,
    popStart,
    popEnd,
    lastModifiedAt,
    placeOfPerf,
    description,
    modifications: [],
    subawards: [],
    source: provenance,
    reconciliation: {
      firstSeenAt: now,
      firstSeenSource: "usaspending",
      confirmedAt: now,
      confirmedSource: "usaspending",
      matchConfidence: 1.0,
      sources: [
        {
          system: "usaspending",
          externalId: generatedId,
          observedAt: now,
          confidence: 1.0,
        },
      ],
      authoritativeSource: "usaspending",
    },
  };

  return award;
}

/**
 * Write Award to RTDB. Idempotent: hash-equality skip; otherwise upsert.
 * Operator-input fields (operatorNotes, operatorTags, workspaceAdversaryFor)
 * are preserved on update.
 */
export async function upsertAward(
  workspaceId: string,
  award: Award
): Promise<{ action: "created" | "updated" | "unchanged"; awardId: string }> {
  const path = wsPath(workspaceId, "awards", award.id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(award);
    await writeSecondaryIndexes(workspaceId, award);
    return { action: "created", awardId: award.id };
  }

  const existing = snap.val() as Award;
  const existingHash = existing.source?.hash;
  const newHash = award.source.hash;
  if (existingHash && existingHash === newHash) {
    // No content change — just bump refreshedAt
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", awardId: award.id };
  }

  // Merge: preserve operator-input + lifecycle history
  const merged: Award = {
    ...award,
    operatorNotes: existing.operatorNotes,
    operatorTags: existing.operatorTags,
    workspaceAdversaryFor: existing.workspaceAdversaryFor,
    lifecycleTransitions: [
      ...(existing.lifecycleTransitions || []),
      ...(existing.lifecycleState !== award.lifecycleState
        ? [
            {
              fromState: existing.lifecycleState,
              toState: award.lifecycleState,
              transitionedAt: Date.now(),
              reason: "USAspending sync update",
              triggeredBy: "usaspending_sync" as const,
            },
          ]
        : []),
    ],
    reconciliation: {
      ...award.reconciliation,
      firstSeenAt: existing.reconciliation?.firstSeenAt ?? award.reconciliation.firstSeenAt,
      firstSeenSource: existing.reconciliation?.firstSeenSource ?? award.reconciliation.firstSeenSource,
    },
  };

  await db.ref(path).set(merged);
  await writeSecondaryIndexes(workspaceId, merged);
  return { action: "updated", awardId: award.id };
}

/**
 * Write secondary indexes per Award integration spec Part Four.
 * Each index entry is a small {id, ...} record at a path keyed for fast query.
 */
async function writeSecondaryIndexes(workspaceId: string, award: Award): Promise<void> {
  const popEndDay = Math.floor(award.popEnd / 86400000);
  const indexUpdates: Record<string, unknown> = {
    [`${wsPath(workspaceId, "awardsByPopEnd", String(popEndDay), award.id)}`]: {
      id: award.id,
      primeOrgId: award.primeOrgId,
      popEnd: award.popEnd,
    },
    [`${wsPath(workspaceId, "awardsByPrime", award.primeOrgId, award.id)}`]: {
      id: award.id,
      popEnd: award.popEnd,
    },
    [`${wsPath(workspaceId, "awardsByCustomer", award.customerOrgId, award.id)}`]: {
      id: award.id,
      popEnd: award.popEnd,
    },
    [`${wsPath(workspaceId, "awardsByNaics", award.naics || "_none", award.id)}`]: {
      id: award.id,
      popEnd: award.popEnd,
    },
    [`${wsPath(workspaceId, "awardsByLifecycle", award.lifecycleState, award.id)}`]: {
      id: award.id,
    },
  };
  await db.ref().update(indexUpdates);
}
