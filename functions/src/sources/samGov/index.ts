// SAM.gov source — orchestrator
//
// v1.1 (2026-05-17): handles type 'm' amendment notices by applying to
// parent Opp in place (amendment versioning); reconciles incoming notices
// against operator-created Opps by solicitation number; extracts Q&A from
// amendment descriptions; emits deadline-change Signals.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { formatDateForApi, searchAllPages } from "./client";
import { mapNoticeToOpportunity, upsertOpportunity } from "./mapper";
import { loadConfig, validateConfig, type SamGovConfig } from "./config";
import { handleAmendment } from "./amendment";
import { findReconciliationMatch, applyReconciliation } from "./reconcile";

export const SOURCE_NAME = "sam_gov";
export const SOURCE_VERSION = "1.1.0";

export { handleAmendment } from "./amendment";
export { extractQandA } from "./qaExtractor";
export { findReconciliationMatch, applyReconciliation } from "./reconcile";

export interface SamGovSyncOptions {
  sinceDays?: number;
  maxRecords?: number;
  dryRun?: boolean;
  /** Skip amendment-handling step. Default false. */
  skipAmendments?: boolean;
  /** Skip operator-Opp reconciliation step. Default false. */
  skipReconciliation?: boolean;
}

export interface SamGovSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  recordsFetched: number;
  oppsCreated: number;
  oppsUpdated: number;
  oppsUnchanged: number;
  /** v1.1: amendment notices that were applied to a parent Opp */
  amendmentsApplied: number;
  /** v1.1: amendment notices with no parent in workspace (informational) */
  amendmentsOrphaned: number;
  /** v1.1: incoming notices reconciled with operator-created Opps */
  reconciledWithOperator: number;
  /** v1.1: deadline-change Signals emitted */
  deadlineChangeSignals: number;
  /** v1.1: total Q&A entries extracted across all amendments */
  qaExtractedTotal: number;
  errors: Array<{ recordId: string; message: string }>;
  durationMs: number;
  apiCallsCount: number;
}

export async function syncWorkspace(
  workspaceId: string,
  options: SamGovSyncOptions = {},
  log?: Logger
): Promise<SamGovSyncResult> {
  const startedAt = Date.now();
  log?.info("samgov_sync_started", { workspaceId, options });

  const result: SamGovSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    recordsFetched: 0,
    oppsCreated: 0,
    oppsUpdated: 0,
    oppsUnchanged: 0,
    amendmentsApplied: 0,
    amendmentsOrphaned: 0,
    reconciledWithOperator: 0,
    deadlineChangeSignals: 0,
    qaExtractedTotal: 0,
    errors: [],
    durationMs: 0,
    apiCallsCount: 0,
  };

  try {
    const config: SamGovConfig = await loadConfig(workspaceId, log);
    const v = validateConfig(config);
    if (!v.valid) throw new Error(`Invalid config: ${v.errors.join(", ")}`);
    if (config.disabled) {
      log?.info("samgov_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const sinceDays = options.sinceDays ?? Math.min(60, (config.lookBackMonths ?? 1) * 30);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const until = new Date();

    const params: any = {
      postedFrom: formatDateForApi(since),
      postedTo: formatDateForApi(until),
      limit: 100,
      active: "Yes" as const,
    };
    if (config.naics.length > 0) params.ncode = config.naics.join(",");
    if (config.noticeTypes.length > 0) params.ptype = config.noticeTypes.join(",");
    if (config.agencies.length > 0) params.deptname = config.agencies[0]; // SAM accepts single deptname

    const maxRecords = options.maxRecords ?? 300;
    const records = await searchAllPages(params, maxRecords, log);
    result.recordsFetched = records.length;
    result.apiCallsCount = Math.max(1, Math.ceil(records.length / 100));

    for (const notice of records) {
      try {
        const noticeType = (notice.type || "").toLowerCase().slice(0, 1);

        // v1.1: Type 'm' amendment handling
        if (noticeType === "m" && !options.skipAmendments && !options.dryRun) {
          const amendmentResult = await handleAmendment(workspaceId, notice, log);
          if (amendmentResult.action === "amendment_applied") {
            result.amendmentsApplied++;
            if (amendmentResult.deadlineChanged) result.deadlineChangeSignals++;
            if (amendmentResult.qAndAExtracted) result.qaExtractedTotal += amendmentResult.qAndAExtracted;
            continue;
          }
          if (amendmentResult.action === "amendment_no_parent") {
            result.amendmentsOrphaned++;
            // Fall through and create as a standalone Opp so the amendment
            // doesn't drop on the floor — operator can manually link it
          } else if (amendmentResult.action === "amendment_already_recorded") {
            result.oppsUnchanged++;
            continue;
          }
        }

        const opp = await mapNoticeToOpportunity(workspaceId, notice);
        if (options.dryRun) continue;

        // v1.1: Operator-Opp reconciliation by solicitation number
        if (!options.skipReconciliation) {
          const match = await findReconciliationMatch(workspaceId, notice, log);
          if (match) {
            await applyReconciliation(workspaceId, match, opp, log);
            result.reconciledWithOperator++;
            continue;
          }
        }

        const r = await upsertOpportunity(workspaceId, opp);
        if (r.action === "created") result.oppsCreated++;
        else if (r.action === "updated") result.oppsUpdated++;
        else result.oppsUnchanged++;
      } catch (err) {
        const e = err as Error;
        result.errors.push({ recordId: notice.noticeId, message: e.message ?? String(err) });
        log?.warn("samgov_notice_failed", { noticeId: notice.noticeId, message: e.message });
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted: result.oppsCreated + result.oppsUpdated,
        recordsSkipped: result.oppsUnchanged,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("samgov_sync_completed", {
      workspaceId,
      created: result.oppsCreated,
      updated: result.oppsUpdated,
      unchanged: result.oppsUnchanged,
      amendmentsApplied: result.amendmentsApplied,
      amendmentsOrphaned: result.amendmentsOrphaned,
      reconciledWithOperator: result.reconciledWithOperator,
      deadlineChangeSignals: result.deadlineChangeSignals,
      qaExtractedTotal: result.qaExtractedTotal,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ recordId: "_sync_root", message: e.message ?? String(err) });
    await recordSyncError(
      workspaceId,
      SOURCE_NAME,
      {
        occurredAt: Date.now(),
        category: categorized.category,
        message: categorized.message,
        retriable: categorized.retriable,
      },
      log
    );
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
