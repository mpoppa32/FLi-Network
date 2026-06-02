// Corsair — core backfill logic for relatedIds on existing RSS-source
// signals (sig_tt_ / sig_sn_ / sig_ds_).
//
// Extracted from triggerRelatedIdsBackfill so a Cloud Scheduler wrapper
// can invoke it without going through the onCall auth wrapper. Operator
// UI keeps using the callable; cloud scheduler / cron uses the schedule
// wrapper that calls this directly.

import { Logger } from "../framework/logger";
import { db, wsPath } from "../framework/rtdb";
import { resolveRecipientOrg } from "../sources/usaSpending/orgResolver";
import { DEFAULT_DS_CONTRACTOR_PATTERNS } from "../sources/defenseScoop/config";
import type { Signal } from "../framework/types/signals";

export interface BackfillRelatedIdsResult {
  workspaceId: string;
  scanned: number;
  alreadyHasRelated: number;
  patched: number;
  resolveErrors: number;
  matchedByPattern: Record<string, number>;
  patchedBySource: Record<string, number>;
}

export interface BackfillRelatedIdsOptions {
  maxRelated?: number;
}

export async function backfillRelatedIdsForWorkspace(
  workspaceId: string,
  opts: BackfillRelatedIdsOptions = {},
  log?: Logger
): Promise<BackfillRelatedIdsResult> {
  const maxRelated = Math.max(1, Math.min(20, opts.maxRelated ?? 6));
  log?.info("related_ids_backfill_started", {
    workspaceId,
    patternCount: DEFAULT_DS_CONTRACTOR_PATTERNS.length,
    maxRelated,
  });

  const sigsSnap = await db.ref(wsPath(workspaceId, "signals")).once("value");
  const sigs = (sigsSnap.val() as Record<string, Signal> | null) ?? {};

  let scanned = 0;
  let alreadyHasRelated = 0;
  let patched = 0;
  let resolveErrors = 0;
  const matchedByPattern: Record<string, number> = {};
  const patchedBySource: Record<string, number> = {};
  const updates: Record<string, unknown> = {};

  for (const [id, sig] of Object.entries(sigs)) {
    if (!sig) continue;
    if (
      !id.startsWith("sig_tt_") &&
      !id.startsWith("sig_sn_") &&
      !id.startsWith("sig_ds_")
    ) {
      continue;
    }
    scanned++;
    if (sig.relatedIds && sig.relatedIds.length > 0) {
      alreadyHasRelated++;
      continue;
    }

    const attrs = (sig.attrs ?? {}) as Record<string, unknown>;
    const title = String(attrs.title || "");
    const summary = String(attrs.summary || "");
    const haystack = (title + " " + summary).toLowerCase();
    if (!haystack.trim()) continue;

    const rids: string[] = [];
    const seen = new Set<string>();
    for (const pattern of DEFAULT_DS_CONTRACTOR_PATTERNS) {
      if (rids.length >= maxRelated) break;
      if (!pattern || haystack.indexOf(pattern.toLowerCase()) < 0) continue;
      try {
        const r = await resolveRecipientOrg(workspaceId, pattern, null, {
          autoCreate: false,
          emitFuzzyCandidates: false,
        });
        if (r.orgId && !seen.has(r.orgId)) {
          seen.add(r.orgId);
          rids.push(r.orgId);
          matchedByPattern[pattern] = (matchedByPattern[pattern] || 0) + 1;
        }
      } catch {
        resolveErrors++;
      }
    }

    if (rids.length > 0) {
      updates[`${wsPath(workspaceId, "signals", id)}/relatedIds`] = rids;
      patched++;
      const prefix = id.split("_").slice(0, 2).join("_");
      patchedBySource[prefix] = (patchedBySource[prefix] || 0) + 1;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  log?.info("related_ids_backfill_completed", {
    workspaceId,
    scanned,
    alreadyHasRelated,
    patched,
    resolveErrors,
  });

  return {
    workspaceId,
    scanned,
    alreadyHasRelated,
    patched,
    resolveErrors,
    matchedByPattern,
    patchedBySource,
  };
}
