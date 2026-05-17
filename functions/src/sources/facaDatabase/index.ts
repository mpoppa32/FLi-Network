// FACA source — SourceClient implementation
//
// Per tier2-previews-v1 T2-1: weekly sync of federal advisory committee
// membership + meetings. Phase 8.6.1 — first Tier 2 source.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import { loadConfig, validateConfig, saveResolvedIds, type FacaConfig } from "./config";
import {
  searchCommittees,
  getCommittee,
  getCommitteeMembers,
  getCommitteeMeetings,
  probeFacaApi,
} from "./client";
import { upsertCommittee, upsertMember, upsertMeetingSignal } from "./mapper";

export const SOURCE_NAME = "faca";
export const SOURCE_VERSION = "1.0.0";

export { probeFacaApi };

export interface FacaSyncOptions {
  /** Cap on total committees synced per run. Default: 50. */
  maxCommittees?: number;
  /** Skip member sync (faster; rebuilds meetings only). Default: false. */
  skipMembers?: boolean;
  /** Skip meeting sync (faster; refreshes membership only). Default: false. */
  skipMeetings?: boolean;
  /** Dry run: fetch and map, but don't write. Default: false. */
  dryRun?: boolean;
}

export interface FacaSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  committeesResolved: number;
  committeesUpserted: number;
  membersUpserted: number;
  meetingsUpserted: number;
  apiCallsCount: number;
  errors: Array<{ committeeRef: string; message: string }>;
}

/**
 * Sync all configured committees for one workspace.
 *
 * Steps:
 * 1. Load config; resolve any unresolved committee names to IDs via search
 * 2. For each ID, fetch detail + members + meetings
 * 3. Upsert committee Organization, member Persons + member_of Edges, meeting Signals
 * 4. Persist updated committeeIds + write source health
 */
export async function syncWorkspace(
  workspaceId: string,
  options: FacaSyncOptions = {},
  log?: Logger
): Promise<FacaSyncResult> {
  const startedAt = Date.now();
  log?.info("faca_sync_started", { workspaceId, options });

  const result: FacaSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    committeesResolved: 0,
    committeesUpserted: 0,
    membersUpserted: 0,
    meetingsUpserted: 0,
    apiCallsCount: 0,
    errors: [],
  };

  try {
    const config: FacaConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled) {
      log?.info("faca_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const apiBase = config.apiBase!;
    const maxCommittees = options.maxCommittees ?? 50;

    // Step 1: Resolve unresolved names
    const knownIds = new Set(config.committeeIds);
    const unresolvedNames = config.committeeNames.filter(
      (n) => !config.committeeIds.some((id) => id.toLowerCase().includes(n.toLowerCase().replace(/\s+/g, "_")))
    );
    // Simpler approach: re-resolve all names; dedupe IDs at end.
    const resolvedFromNames: Array<{ id: string; name: string }> = [];
    for (const name of config.committeeNames.slice(0, maxCommittees)) {
      try {
        const matches = await searchCommittees(name, apiBase, log);
        result.apiCallsCount++;
        if (matches.length === 0) continue;
        // Prefer exact-name match if available, else first result
        const exact = matches.find(
          (m) => ((m.name as string) || "").toLowerCase() === name.toLowerCase()
        );
        const picked = exact || matches[0];
        const id = String(picked.committeeId ?? picked.id ?? "");
        if (id) resolvedFromNames.push({ id, name });
      } catch (err) {
        result.errors.push({
          committeeRef: name,
          message: `name resolution failed: ${(err as Error).message}`,
        });
      }
    }

    // Combine pre-resolved + freshly-resolved IDs, dedupe
    const allIds = new Set<string>(config.committeeIds);
    for (const r of resolvedFromNames) allIds.add(r.id);
    const idsToSync = Array.from(allIds).slice(0, maxCommittees);
    result.committeesResolved = idsToSync.length;

    if (!options.dryRun) {
      await saveResolvedIds(workspaceId, idsToSync, log);
    }

    // Step 2: For each committee, fetch + upsert
    for (const facaId of idsToSync) {
      try {
        const detail = await getCommittee(facaId, apiBase, log);
        result.apiCallsCount++;
        if (!detail) {
          log?.warn("faca_committee_not_found", { facaId });
          continue;
        }
        // Some endpoints don't return id in detail — inject it
        if (!detail.committeeId && !detail.id) detail.committeeId = facaId;

        if (!options.dryRun) {
          const { orgId, action } = await upsertCommittee(workspaceId, detail, log);
          if (action !== "unchanged") result.committeesUpserted++;

          if (!options.skipMembers) {
            const members = await getCommitteeMembers(facaId, apiBase, log);
            result.apiCallsCount++;
            for (const m of members) {
              try {
                const memberResult = await upsertMember(workspaceId, orgId, m, log);
                if (memberResult.action !== "unchanged") result.membersUpserted++;
              } catch (err) {
                result.errors.push({
                  committeeRef: `${facaId}/member`,
                  message: (err as Error).message,
                });
              }
            }
          }

          if (!options.skipMeetings) {
            const meetings = await getCommitteeMeetings(facaId, apiBase, log);
            result.apiCallsCount++;
            const cutoff = Date.now() - config.meetingsLookbackDays * 24 * 60 * 60 * 1000;
            for (const meeting of meetings) {
              const meetingDate = Date.parse((meeting.meetingDate as string) || "");
              if (Number.isFinite(meetingDate) && meetingDate < cutoff) continue;
              try {
                const mr = await upsertMeetingSignal(workspaceId, orgId, facaId, meeting, log);
                if (mr.action !== "unchanged") result.meetingsUpserted++;
              } catch (err) {
                result.errors.push({
                  committeeRef: `${facaId}/meeting`,
                  message: (err as Error).message,
                });
              }
            }
          }
        }
      } catch (err) {
        const e = err as Error;
        result.errors.push({ committeeRef: facaId, message: e.message ?? String(err) });
        log?.warn("faca_committee_sync_failed", { facaId, message: e.message });
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted:
          result.committeesUpserted + result.membersUpserted + result.meetingsUpserted,
        recordsSkipped: 0,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("faca_sync_completed", {
      workspaceId,
      durationMs: result.durationMs,
      committeesUpserted: result.committeesUpserted,
      membersUpserted: result.membersUpserted,
      meetingsUpserted: result.meetingsUpserted,
      errors: result.errors.length,
    });
  } catch (err) {
    const e = err as Error;
    const categorized = categorizeError(err);
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    result.errors.push({ committeeRef: "_sync_root", message: e.message ?? String(err) });

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

    log?.error("faca_sync_failed", {
      workspaceId,
      category: categorized.category,
      message: categorized.message,
    });
    throw err;
  }

  return result;
}

export async function reportHealth(workspaceId: string) {
  return readSourceHealth(workspaceId, SOURCE_NAME);
}
