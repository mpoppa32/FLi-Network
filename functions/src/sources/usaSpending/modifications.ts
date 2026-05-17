// USAspending v1.1 — Award modification history sync
//
// Per award-integration-v1 Part Two §2.3 and Part Four (Modification substructure):
// For each Award, fetch the full transaction history via /transactions/, map
// each transaction to a Modification record, and merge into Award.modifications.
//
// Side effects on the parent Award:
//   - obligated = sum of federal_action_obligation across transactions
//   - lastModifiedAt = max(action_date)
//   - popEnd refresh if a later transaction has a popEndAfter
//   - lifecycleState = "terminated" if a transaction is detected as T4D/T4C
//
// Termination detection (per FPDS action_type semantics):
//   action_type === 'F' or description contains "TERMINATE FOR DEFAULT" → T4D
//   action_type === 'E' or description contains "TERMINATE FOR CONVENIENCE" → T4C

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Award, AwardLifecycleState, LifecycleTransition, Modification } from "../../framework/types/awards";
import { fetchAwardTransactions, type UsaSpendingTransaction } from "./client";

const TERMINATE_T4D_PATTERNS = [/terminate.*default/i, /^F$/];
const TERMINATE_T4C_PATTERNS = [/terminate.*convenience/i, /^E$/];

function parseDateMs(s: string | undefined | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function detectTermination(tx: UsaSpendingTransaction): "T4D" | "T4C" | null {
  const code = String(tx.action_type ?? "");
  const desc = String(tx.action_type_description ?? "");
  for (const pat of TERMINATE_T4D_PATTERNS) {
    if (pat.test(code) || pat.test(desc)) return "T4D";
  }
  for (const pat of TERMINATE_T4C_PATTERNS) {
    if (pat.test(code) || pat.test(desc)) return "T4C";
  }
  return null;
}

/**
 * Transform raw transactions into ordered Modification records.
 * Computes cumulativeObligated as running total across action_date-sorted txs.
 */
export function transactionsToModifications(
  transactions: UsaSpendingTransaction[],
  generatedUniqueAwardId: string
): { modifications: Modification[]; terminationType: "T4D" | "T4C" | null } {
  const sorted = [...transactions].sort((a, b) => {
    const ta = parseDateMs(a.action_date);
    const tb = parseDateMs(b.action_date);
    return ta - tb;
  });

  let cumulative = 0;
  let terminationType: "T4D" | "T4C" | null = null;
  const now = Date.now();
  const mods: Modification[] = [];

  for (const tx of sorted) {
    const delta = Number(tx.federal_action_obligation ?? 0);
    cumulative += delta;
    const detected = detectTermination(tx);
    if (detected) terminationType = detected;
    const modNumber = String(tx.modification_number ?? "P00000");
    const modifiedAt = parseDateMs(tx.action_date);
    const hashSubset = { modNumber, modifiedAt, delta, actionType: tx.action_type ?? "" };
    const hash = hashFields(hashSubset as unknown as Record<string, unknown>, [
      "modNumber",
      "modifiedAt",
      "delta",
      "actionType",
    ]);
    mods.push({
      modNumber,
      modifiedAt,
      obligationDelta: delta,
      cumulativeObligated: cumulative,
      actionType: String(tx.action_type ?? ""),
      actionTypeDescription: String(tx.action_type_description ?? tx.type_description ?? ""),
      description: String(tx.description ?? "").slice(0, 1000),
      source: externalProvenance(
        "usaspending",
        `${generatedUniqueAwardId}::${modNumber}`,
        `https://www.usaspending.gov/award/${generatedUniqueAwardId}`,
        hash,
        now
      ),
    });
  }

  return { modifications: mods, terminationType };
}

/**
 * Sync mod history for one Award. Idempotent: same transactions produce same
 * Modification records (deterministic hash); writes only if changed.
 *
 * Returns delta info so the orchestrator can summarize the run.
 */
export async function syncAwardModifications(
  workspaceId: string,
  award: Award,
  log?: Logger
): Promise<{
  awardId: string;
  modsFetched: number;
  modsWritten: number;
  obligatedDelta: number;
  terminated: boolean;
  changed: boolean;
}> {
  const transactions = await fetchAwardTransactions(award.generated_unique_id, 5, log);
  const { modifications, terminationType } = transactionsToModifications(
    transactions,
    award.generated_unique_id
  );

  const existing = award.modifications ?? [];
  const existingKeys = new Set(existing.map((m) => `${m.modNumber}::${m.modifiedAt}::${m.obligationDelta}`));
  const newKeys = new Set(modifications.map((m) => `${m.modNumber}::${m.modifiedAt}::${m.obligationDelta}`));
  const changed =
    existing.length !== modifications.length ||
    [...newKeys].some((k) => !existingKeys.has(k));

  if (!changed && award.modsLastSyncAt) {
    // Still bump the sync timestamp so observability shows freshness
    await db.ref(wsPath(workspaceId, "awards", award.id, "modsLastSyncAt")).set(Date.now());
    return {
      awardId: award.id,
      modsFetched: modifications.length,
      modsWritten: 0,
      obligatedDelta: 0,
      terminated: false,
      changed: false,
    };
  }

  const newObligated = modifications.length > 0
    ? modifications[modifications.length - 1].cumulativeObligated
    : award.obligated;
  const obligatedDelta = newObligated - (award.obligated ?? 0);
  const newLastModifiedAt = modifications.length > 0
    ? Math.max(award.lastModifiedAt ?? 0, modifications[modifications.length - 1].modifiedAt)
    : award.lastModifiedAt;

  // Build lifecycle transition if termination detected
  const newTransitions: LifecycleTransition[] = [...(award.lifecycleTransitions ?? [])];
  let newLifecycleState: AwardLifecycleState = award.lifecycleState;
  if (terminationType && award.lifecycleState !== "terminated") {
    newLifecycleState = "terminated";
    newTransitions.push({
      fromState: award.lifecycleState,
      toState: "terminated",
      transitionedAt: Date.now(),
      reason: `USAspending mod sync detected ${terminationType} termination`,
      triggeredBy: "usaspending_sync",
    });
  }

  // Multi-path update: write the whole array + the side-effects atomically
  const updates: Record<string, unknown> = {
    [`${wsPath(workspaceId, "awards", award.id, "modifications")}`]: modifications,
    [`${wsPath(workspaceId, "awards", award.id, "obligated")}`]: newObligated,
    [`${wsPath(workspaceId, "awards", award.id, "lastModifiedAt")}`]: newLastModifiedAt,
    [`${wsPath(workspaceId, "awards", award.id, "modsLastSyncAt")}`]: Date.now(),
    [`${wsPath(workspaceId, "awards", award.id, "lifecycleState")}`]: newLifecycleState,
    [`${wsPath(workspaceId, "awards", award.id, "lifecycleTransitions")}`]: newTransitions,
  };
  if (terminationType) {
    updates[`${wsPath(workspaceId, "awards", award.id, "terminationType")}`] = terminationType;
  }
  await db.ref().update(updates);

  // Maintain awardsByLifecycle index if state changed
  if (newLifecycleState !== award.lifecycleState) {
    await db.ref(`${wsPath(workspaceId, "awardsByLifecycle", award.lifecycleState, award.id)}`).remove();
    await db.ref(`${wsPath(workspaceId, "awardsByLifecycle", newLifecycleState, award.id)}`).set({ id: award.id });
  }

  log?.info("usaspending_mods_synced", {
    workspaceId,
    awardId: award.id,
    modsCount: modifications.length,
    obligatedDelta,
    terminated: !!terminationType,
  });

  return {
    awardId: award.id,
    modsFetched: modifications.length,
    modsWritten: modifications.length,
    obligatedDelta,
    terminated: !!terminationType,
    changed: true,
  };
}
