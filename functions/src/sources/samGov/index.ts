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
import { loadConfig, validateConfig, DEFAULT_ALLOWED_PSC_CODES, type SamGovConfig } from "./config";
import { handleAmendment } from "./amendment";
import { findReconciliationMatch, applyReconciliation } from "./reconcile";

export const SOURCE_NAME = "sam_gov";
export const SOURCE_VERSION = "1.3.0";

/**
 * v1.3 (P13.355) — relevance ALLOW-list (replaces the v1.2 PSC exclude-list).
 * The exclude-list kept everything it didn't explicitly block, so for Corsair's
 * narrow domain (electric motors, drones) it leaked ~1,000 irrelevant notices —
 * and notices with NO PSC code passed entirely. The allow-list inverts the test:
 * a notice is relevant only if its title/description matches a motor/drone
 * keyword OR one of its (comma-separated) PSC codes is allow-listed. Empty PSC
 * no longer auto-passes; it must earn ingest via a keyword.
 */
const RELEVANCE_KEYWORDS = /\bmotors?\b|\bdrones?\b|\bua[vs]\b|\bunmanned\b|\bbrushless\b|propuls|\bpropellers?\b|\bquadcopters?\b|\bsuas\b|\bloitering\b|\bfpv\b|counter[\s-]?u[ax]s/i;

function isRelevant(
  notice: { title?: string; description?: string; classificationCode?: string | null },
  allowSet: Set<string>
): boolean {
  const text = `${notice.title ?? ""} ${notice.description ?? ""}`;
  if (RELEVANCE_KEYWORDS.test(text)) return true;
  const codes = String(notice.classificationCode ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  for (const code of codes) {
    if (allowSet.has(code)) return true;
  }
  return false;
}

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
  /** v1.2: notices skipped by the PSC-category ingest filter */
  oppsExcludedByPsc: number;
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
    oppsExcludedByPsc: 0,
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

    // v1.3 (P13.355) — relevance ALLOW-list set. Workspace override via
    // config.allowPscCodes; absent → DEFAULT_ALLOWED_PSC_CODES;
    // pscFilterDisabled:true → no filtering (ingest everything).
    const relevanceDisabled = !!config.pscFilterDisabled;
    const allowSet: Set<string> = new Set(
      (Array.isArray(config.allowPscCodes) && config.allowPscCodes.length > 0
        ? config.allowPscCodes
        : DEFAULT_ALLOWED_PSC_CODES
      ).map((p) => String(p).trim().toUpperCase())
    );

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

        // v1.2 (P13.341) — reconciliation match is computed BEFORE mapping (it
        // only needs the notice) so the PSC filter can spare reconciled notices:
        // a notice that matches an operator-created Opp always flows through to
        // enrich it, whatever its PSC. Skipped in dryRun (match was previously
        // never computed in dryRun; keeps dryRun read-profile unchanged).
        const match = (!options.skipReconciliation && !options.dryRun)
          ? await findReconciliationMatch(workspaceId, notice, log)
          : null;

        // v1.3 (P13.355) — relevance ALLOW-list. Notices that do NOT reconcile
        // with an operator-created Opp must earn ingest by matching a motor/drone
        // keyword (title/description) or an allow-listed PSC code; everything else
        // is skipped before mapNoticeToOpportunity (mapping auto-creates agency
        // org nodes, and irrelevant notices must not keep seeding the org graph).
        // Amendments to existing parents were already applied above; orphaned
        // irrelevant amendments are filtered here instead of becoming Opps.
        if (!match && !relevanceDisabled && !isRelevant(notice, allowSet)) {
          result.oppsExcludedByPsc++;
          continue;
        }

        const opp = await mapNoticeToOpportunity(workspaceId, notice);
        if (options.dryRun) continue;

        // v1.1: Operator-Opp reconciliation by solicitation number
        if (match) {
          await applyReconciliation(workspaceId, match, opp, log);
          result.reconciledWithOperator++;
          continue;
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
      excludedByPsc: result.oppsExcludedByPsc,
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
