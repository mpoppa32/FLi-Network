// Senate LDA — SourceClient implementation (Phase 8.6.9 v1.0)
//
// Walks the lda.senate.gov REST API for filings matching defense issue
// codes, ingests each as a lobbying_disclosure Signal. Cadence: weekly.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, type SenateLdaConfig } from "./config";
import { listFilings, ldaPostedAfter, type LdaFiling } from "./client";
import { upsertLdaSignal } from "./mapper";

export const SOURCE_NAME = "senate_lda";
export const SOURCE_VERSION = "1.0.0";

export interface SenateLdaSyncOptions {
  itemCap?: number;
  dryRun?: boolean;
  /** Per-run override of maxPagesPerSync. */
  maxPagesPerSync?: number;
}

export interface SenateLdaSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  pagesWalked: number;
  filingsConsidered: number;
  filingsMatched: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  clientsResolvedTotal: number;
  registrantsResolvedTotal: number;
  governmentEntitiesResolvedTotal: number;
  /** v1.1: revolving-door Person + Edge totals across all upserts. */
  revolvingDoorPersonsCreatedTotal: number;
  revolvingDoorPersonsMatchedTotal: number;
  revolvingDoorEdgesUpsertedTotal: number;
  /** v1.2: former-employer Org resolutions + formerly_at Edges. */
  formerEmployerOrgsResolvedTotal: number;
  formerlyAtEdgesUpsertedTotal: number;
  perIssueCode: Record<string, number>;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

function dedupeByUuid(filings: LdaFiling[]): LdaFiling[] {
  const seen = new Set<string>();
  const out: LdaFiling[] = [];
  for (const f of filings) {
    if (!f || !f.filing_uuid) continue;
    if (seen.has(f.filing_uuid)) continue;
    seen.add(f.filing_uuid);
    out.push(f);
  }
  return out;
}

export async function syncWorkspace(
  workspaceId: string,
  options: SenateLdaSyncOptions = {},
  log?: Logger
): Promise<SenateLdaSyncResult> {
  const startedAt = Date.now();
  log?.info("senate_lda_sync_started", { workspaceId, options });

  const result: SenateLdaSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    pagesWalked: 0,
    filingsConsidered: 0,
    filingsMatched: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    clientsResolvedTotal: 0,
    registrantsResolvedTotal: 0,
    governmentEntitiesResolvedTotal: 0,
    revolvingDoorPersonsCreatedTotal: 0,
    revolvingDoorPersonsMatchedTotal: 0,
    revolvingDoorEdgesUpsertedTotal: 0,
    formerEmployerOrgsResolvedTotal: 0,
    formerlyAtEdgesUpsertedTotal: 0,
    perIssueCode: {},
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: SenateLdaConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const cutoff = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
    const postedAfter = ldaPostedAfter(new Date(cutoff));
    const maxPages = options.maxPagesPerSync ?? config.maxPagesPerSync ?? 24;
    const itemCap = options.itemCap ?? config.maxFilingsPerSync ?? 200;
    const filingTypeSet = new Set(config.filingTypes);

    // For each defense issue code, walk pages until we hit maxPages or
    // exhaust results. Filings can appear under multiple issue codes; the
    // mapper hashes by filing_uuid so re-ingestion is a no-op.
    const collected: LdaFiling[] = [];
    let pagesRemaining = maxPages;

    for (const code of config.issueCodes) {
      result.perIssueCode[code] = 0;
      let page = 1;
      let hasNext = true;
      while (hasNext && pagesRemaining > 0 && collected.length < itemCap) {
        let resp;
        try {
          resp = await listFilings(
            {
              generalIssueCode: code,
              postedAfter,
              page,
              pageSize: 25,
              ordering: "-dt_posted",
            },
            log
          );
          result.apiCallsCount++;
          result.pagesWalked++;
          pagesRemaining--;
        } catch (err) {
          const e = err as Error;
          log?.warn("senate_lda_page_fetch_failed", {
            code,
            page,
            message: e.message,
          });
          result.errors.push({ ref: `page:${code}:${page}`, message: e.message });
          break;
        }

        for (const f of resp.results) {
          if (!filingTypeSet.has(f.filing_type)) continue;
          collected.push(f);
          result.perIssueCode[code]++;
        }

        hasNext = !!resp.next;
        page++;
        if (collected.length >= itemCap) break;
      }
    }

    const deduped = dedupeByUuid(collected).slice(0, itemCap);
    result.filingsConsidered = collected.length;
    result.filingsMatched = deduped.length;

    if (!options.dryRun) {
      for (const filing of deduped) {
        try {
          const r = await upsertLdaSignal(workspaceId, filing, log);
          if (r.action === "created") result.signalsCreated++;
          else if (r.action === "updated") result.signalsUpdated++;
          else result.signalsUnchanged++;
          if (r.metrics.clientOrgResolved) result.clientsResolvedTotal++;
          if (r.metrics.registrantOrgResolved) result.registrantsResolvedTotal++;
          result.governmentEntitiesResolvedTotal += r.metrics.governmentEntitiesResolved;
          result.revolvingDoorPersonsCreatedTotal += r.metrics.revolvingDoorPersonsCreated;
          result.revolvingDoorPersonsMatchedTotal += r.metrics.revolvingDoorPersonsMatched;
          result.revolvingDoorEdgesUpsertedTotal += r.metrics.revolvingDoorEdgesUpserted;
          result.formerEmployerOrgsResolvedTotal += r.metrics.formerEmployerOrgsResolved;
          result.formerlyAtEdgesUpsertedTotal += r.metrics.formerlyAtEdgesUpserted;
        } catch (err) {
          result.errors.push({
            ref: filing.filing_uuid,
            message: (err as Error).message,
          });
        }
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted: result.signalsCreated + result.signalsUpdated,
        recordsSkipped: result.signalsUnchanged,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("senate_lda_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      pagesWalked: result.pagesWalked,
      filingsMatched: result.filingsMatched,
      signalsCreated: result.signalsCreated,
      clientsResolvedTotal: result.clientsResolvedTotal,
      registrantsResolvedTotal: result.registrantsResolvedTotal,
      errors: result.errors.length,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ ref: "_sync_root", message: e.message ?? String(err) });
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
