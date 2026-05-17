// USAspending v1.1 — FFATA subaward sync
//
// Per award-integration-v1 Part Two §2.4 and Part Four (SubawardRef substructure):
// For each prime Award, fetch FFATA-reported subawards via /subawards/, resolve
// sub-recipient names to Organization entities (auto-creating where needed),
// and append SubawardRef[] to the Award.
//
// FFATA subaward data lags primary award data by 30-180 days. We run this
// less frequently (weekly) than the primary nightly sync.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Award, SubawardRef } from "../../framework/types/awards";
import { fetchAwardSubawards, type UsaSpendingSubaward } from "./client";
import { resolveRecipientOrg } from "./orgResolver";

function parseDateMs(s: string | undefined | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Map one raw subaward record to a SubawardRef.
 * Resolves the sub-recipient name to an Organization, creating if needed.
 */
async function mapSubaward(
  workspaceId: string,
  generatedUniqueAwardId: string,
  raw: UsaSpendingSubaward
): Promise<{ ref: SubawardRef; orgCreated: boolean }> {
  const subRecipientName =
    raw.sub_recipient_name || raw.recipient_name || "Unknown Subrecipient";
  const subUei = raw.recipient_uei || raw.sub_recipient_unique_id || null;
  const { orgId: subOrgId, created } = await resolveRecipientOrg(
    workspaceId,
    subRecipientName,
    subUei,
    { autoCreate: true, type: "company" }
  );

  const amount = Number(raw.subaward_amount ?? raw.amount ?? 0);
  const subawardActionDate = parseDateMs(raw.sub_action_date ?? raw.subaward_action_date);
  const subawardNumber = String(raw.subaward_number ?? raw.internal_id ?? "");
  const description = String(raw.subaward_description ?? raw.description ?? "").slice(0, 1000);
  const naics = raw.naics_code ?? raw.naics ?? undefined;

  const now = Date.now();
  const hashSubset = { subawardNumber, amount, subawardActionDate, subUei: subUei ?? "" };
  const hash = hashFields(hashSubset as unknown as Record<string, unknown>, [
    "subawardNumber",
    "amount",
    "subawardActionDate",
    "subUei",
  ]);

  const ref: SubawardRef = {
    subawardNumber,
    subRecipientName,
    subOrgId,
    amount,
    reportedAt: now,
    subawardActionDate,
    naics,
    description,
    source: externalProvenance(
      "usaspending",
      `${generatedUniqueAwardId}::sub::${subawardNumber}`,
      `https://www.usaspending.gov/award/${generatedUniqueAwardId}`,
      hash,
      now
    ),
  };
  return { ref, orgCreated: created };
}

/**
 * Sync subawards for one prime Award.
 * Idempotent: same subaward records produce same SubawardRef.
 */
export async function syncAwardSubawards(
  workspaceId: string,
  award: Award,
  log?: Logger
): Promise<{
  awardId: string;
  subawardsFetched: number;
  subawardsWritten: number;
  orgsCreated: number;
  changed: boolean;
}> {
  const raws = await fetchAwardSubawards(award.generated_unique_id, 5, log);
  let orgsCreated = 0;
  const refs: SubawardRef[] = [];
  for (const raw of raws) {
    try {
      const { ref, orgCreated } = await mapSubaward(workspaceId, award.generated_unique_id, raw);
      if (orgCreated) orgsCreated++;
      refs.push(ref);
    } catch (err) {
      log?.warn("usaspending_subaward_failed", {
        awardId: award.id,
        subawardNumber: raw.subaward_number,
        message: (err as Error).message,
      });
    }
  }

  // Sort largest amount first for stable serialization
  refs.sort((a, b) => b.amount - a.amount);

  const existing = award.subawards ?? [];
  const existingKeys = new Set(existing.map((s) => `${s.subawardNumber}::${s.amount}`));
  const newKeys = new Set(refs.map((s) => `${s.subawardNumber}::${s.amount}`));
  const changed =
    existing.length !== refs.length || [...newKeys].some((k) => !existingKeys.has(k));

  const now = Date.now();
  if (!changed && award.subawardsLastSyncAt) {
    await db.ref(wsPath(workspaceId, "awards", award.id, "subawardsLastSyncAt")).set(now);
    return {
      awardId: award.id,
      subawardsFetched: refs.length,
      subawardsWritten: 0,
      orgsCreated,
      changed: false,
    };
  }

  const updates: Record<string, unknown> = {
    [`${wsPath(workspaceId, "awards", award.id, "subawards")}`]: refs,
    [`${wsPath(workspaceId, "awards", award.id, "subawardsLastSyncAt")}`]: now,
  };
  await db.ref().update(updates);

  log?.info("usaspending_subawards_synced", {
    workspaceId,
    awardId: award.id,
    subCount: refs.length,
    orgsCreated,
  });

  return {
    awardId: award.id,
    subawardsFetched: refs.length,
    subawardsWritten: refs.length,
    orgsCreated,
    changed: true,
  };
}

/**
 * Sync subawards for all active+expiring Awards in a workspace.
 * Bounded by maxAwards to keep within rate-limit budget.
 */
export async function syncWorkspaceSubawards(
  workspaceId: string,
  options: { maxAwards?: number; onlyLifecycleStates?: string[] } = {},
  log?: Logger
): Promise<{
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  awardsProcessed: number;
  subawardsTotal: number;
  orgsCreated: number;
  errors: Array<{ awardId: string; message: string }>;
}> {
  const startedAt = Date.now();
  const maxAwards = options.maxAwards ?? 200;
  const states = new Set(options.onlyLifecycleStates ?? ["active", "expiring"]);

  log?.info("usaspending_workspace_subawards_started", { workspaceId, maxAwards });

  const snap = await db.ref(wsPath(workspaceId, "awards")).once("value");
  const awards = (snap.val() as Record<string, Award> | null) ?? {};
  const candidates = Object.values(awards)
    .filter((a) => a && states.has(a.lifecycleState))
    // Process oldest-synced first so stale data refreshes preferentially
    .sort((a, b) => (a.subawardsLastSyncAt ?? 0) - (b.subawardsLastSyncAt ?? 0))
    .slice(0, maxAwards);

  let subTotal = 0;
  let orgsTotal = 0;
  const errors: Array<{ awardId: string; message: string }> = [];
  let processed = 0;
  for (const award of candidates) {
    try {
      const result = await syncAwardSubawards(workspaceId, award, log);
      subTotal += result.subawardsWritten;
      orgsTotal += result.orgsCreated;
      processed++;
    } catch (err) {
      const e = err as Error;
      errors.push({ awardId: award.id, message: e.message ?? String(err) });
      log?.warn("usaspending_subaward_award_failed", {
        awardId: award.id,
        message: e.message,
      });
    }
  }

  const completedAt = Date.now();
  log?.info("usaspending_workspace_subawards_completed", {
    workspaceId,
    awardsProcessed: processed,
    subTotal,
    orgsTotal,
    errors: errors.length,
    durationMs: completedAt - startedAt,
  });

  return {
    workspaceId,
    startedAt,
    completedAt,
    awardsProcessed: processed,
    subawardsTotal: subTotal,
    orgsCreated: orgsTotal,
    errors,
  };
}
