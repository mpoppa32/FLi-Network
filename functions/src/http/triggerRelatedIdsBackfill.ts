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
//
// P13.270 — operator-callable wrapper around backfillRelatedIdsForWorkspace.
// A sibling onSchedule (relatedIdsBackfillMonthly) lets Cloud Scheduler
// fire the same logic without an end-user Firebase Auth token.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { backfillRelatedIdsForWorkspace } from "../jobs/backfillRelatedIdsCore";

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
    const maxRelated = Number(request.data?.maxRelated ?? 6);
    log.info("related_ids_backfill_request", {
      workspaceId,
      userId: request.auth.uid,
      maxRelated,
    });
    const result = await backfillRelatedIdsForWorkspace(
      workspaceId,
      { maxRelated },
      log
    );
    return { ok: true, ...result };
  }
);
