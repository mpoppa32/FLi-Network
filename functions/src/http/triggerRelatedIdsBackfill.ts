// Corsair — HTTPS callable: one-shot backfill of relatedIds on
// existing RSS-source signals (sig_tt_ / sig_sn_ / sig_ds_).
//
// Why this exists: P13.266 wired think_tank + service_news mappers to
// resolve defense-contractor mentions into Signal.relatedIds. P13.267
// enriched the pattern list with drone-prime customers. P13.269 widened
// the pattern haystack to use the full description (incl. content:encoded
// body). But existing signals predating those ships have hash-stable
// records — subsequent syncs hit the "unchanged" branch and skip the
// resolution loop entirely. This callable forces a one-shot re-resolve
// against stored attrs.title + attrs.summary using the live pattern list
// and the workspace's existing Org nodes.
//
// Scope: match-to-existing-only — autoCreate disabled. Backfill never
// creates new Org nodes; if a pattern doesn't resolve to an existing
// node, the match is dropped. Keeps the backfill purely additive and
// idempotent.
//
// Idempotency: signals that already carry relatedIds are skipped. Re-runs
// only touch signals where relatedIds is missing or empty.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { db, wsPath } from "../framework/rtdb";
import { resolveRecipientOrg } from "../sources/usaSpending/orgResolver";
import { DEFAULT_DS_CONTRACTOR_PATTERNS } from "../sources/defenseScoop/config";
import type { Signal } from "../framework/types/signals";

export const triggerRelatedIdsBackfill = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerRelatedIdsBackfill" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const workspaceId = String(request.data?.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const maxRelated = Math.max(
      1,
      Math.min(20, Number(request.data?.maxRelated ?? 6))
    );

    log.info("related_ids_backfill_started", {
      workspaceId,
      userId: request.auth.uid,
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
      // Scope: RSS-source signals only. samGov / usaspending / sec_edgar /
      // gao_protest etc. have their own subject/related shape and are
      // not affected by the body-text contractor resolution path.
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
          // Pattern doesn't resolve to an existing Org (autoCreate:false
          // throws). Backfill is match-only — skip silently.
          resolveErrors++;
        }
      }

      if (rids.length > 0) {
        updates[
          `${wsPath(workspaceId, "signals", id)}/relatedIds`
        ] = rids;
        patched++;
        const prefix = id.split("_").slice(0, 2).join("_");
        patchedBySource[prefix] = (patchedBySource[prefix] || 0) + 1;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
    }

    log.info("related_ids_backfill_completed", {
      workspaceId,
      scanned,
      alreadyHasRelated,
      patched,
      resolveErrors,
    });

    return {
      ok: true,
      scanned,
      alreadyHasRelated,
      patched,
      patchedBySource,
      matchedByPattern,
    };
  }
);
