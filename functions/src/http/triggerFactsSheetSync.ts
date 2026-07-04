// Corsair — HTTPS callable: run the master-sheet -> Truth Hub facts sync on
// the CALLER's Google grant. SAFETY: defaults to dryRun=true — calling with no
// args only PREVIEWS the mapping (rows read, creates/updates it WOULD make);
// pass {dryRun:false} explicitly to write. The 6-hour cron
// (jobs/factsSheetSync) calls the same mapper with dryRun:false on
// config.syncUid.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createLogger } from "../framework/logger";
import { syncSheetToFacts } from "../factsSync/mapper";

export const triggerFactsSheetSync = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
  },
  async (request) => {
    const log = createLogger({ source: "http_triggerFactsSheetSync" });
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const uid = request.auth.uid;
    // Default to a safe preview. Only an explicit {dryRun:false} writes.
    const dryRun = (request.data as { dryRun?: boolean } | undefined)?.dryRun !== false;
    log.info("facts_sheet_sync_request", { uid, dryRun });
    try {
      const report = await syncSheetToFacts(uid, { dryRun });
      log.info("facts_sheet_sync_ok", {
        uid, dryRun,
        catalogRows: report.catalogRows,
        pipelineRows: report.pipelineRows,
        created: report.created,
        updated: report.updated,
        reconfirmed: report.reconfirmed,
      });
      return { ok: true, ...report };
    } catch (err) {
      const e = err as Error;
      log.error("facts_sheet_sync_failed", { uid, message: e.message });
      throw new HttpsError("internal", `Facts sheet sync failed: ${e.message}`);
    }
  }
);
