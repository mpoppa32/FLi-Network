// Corsair — scheduled job: reflect the Atlas master sheet onto the Truth Hub
// facts store every 6 hours (offset :30 to stagger from atlasMasterSync, which
// refreshes the same Google grant at :00).
//
// ONE-WAY (sheet -> Corsair). Sticky operator classification — the sync never
// changes internal/customer-safe on an existing fact. See factsSync/mapper.ts
// for the full rules. Health mirrors the Source-Health shape at
// sources/facts_sheet_sync so a silent failure is operator-visible in-app
// (P13.374 lesson: log-only failures are invisible for days).

import { onSchedule } from "firebase-functions/v2/scheduler";
import { createLogger, generateJobId } from "../framework/logger";
import { syncSheetToFacts } from "../factsSync/mapper";
import { ATLAS_MASTER_CONFIG as CFG } from "../sources/atlasMaster/config";
import { db } from "../framework/rtdb";

export const factsSheetSync = onSchedule(
  {
    schedule: "30 */6 * * *", // every 6 hours at :30 (atlasMasterSync runs at :00)
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    retryCount: 1,
    secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
  },
  async (event) => {
    const jobId = generateJobId("factsSheetSync");
    const log = createLogger({ source: "facts_sheet_sync", jobId });
    log.info("job_started", { scheduleTime: event.scheduleTime });
    const healthRef = db.ref(`workspaces/${CFG.workspaceId}/sources/facts_sheet_sync`);
    try {
      const report = await syncSheetToFacts(CFG.syncUid, { dryRun: false });
      log.info("job_completed", {
        catalogRows: report.catalogRows,
        pipelineRows: report.pipelineRows,
        created: report.created,
        updated: report.updated,
        reconfirmed: report.reconfirmed,
      });
      await healthRef.update({
        lastSync: Date.now(),
        lastError: null,
        lastReport: {
          catalogRows: report.catalogRows,
          pipelineRows: report.pipelineRows,
          seriesRows: report.seriesRows,
          orderRows: report.orderRows,
          shipmentRows: report.shipmentRows,
          created: report.created,
          updated: report.updated,
          reconfirmed: report.reconfirmed,
          changes: report.changes.slice(0, 10),
        },
      });
    } catch (err) {
      const e = err as Error;
      log.error("job_threw", { message: e.message ?? String(err) });
      const category = /grant|auth|token|consent|unauthenticated/i.test(e.message ?? "")
        ? "auth_failed"
        : "sync_failed";
      await healthRef
        .update({ lastError: { category, message: e.message ?? String(err), at: Date.now() } })
        .catch(() => {
          /* health write is best-effort — never mask the original failure */
        });
      throw err;
    }
  }
);
