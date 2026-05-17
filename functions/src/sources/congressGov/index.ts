// Congress.gov source — orchestrator
//
// V1 scope: committee hearings only. Nominations and bill actions are V1.1.
// Iterates watchlisted committees; fetches recent meetings; maps each to a
// Signal entity.

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import {
  currentCongress,
  fetchCommitteeMeetingDetail,
  listCommitteeMeetings,
} from "./client";
import { mapHearingDetailToSignal, upsertSignal } from "./mapper";
import { loadConfig, validateConfig, type CongressGovConfig } from "./config";

export const SOURCE_NAME = "congress_gov";
export const SOURCE_VERSION = "0.1.0";

export interface CongressGovSyncOptions {
  sinceDays?: number;
  maxMeetingsPerChamber?: number;
  dryRun?: boolean;
}

export interface CongressGovSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  meetingsListed: number;
  meetingsDetailed: number;
  signalsCreated: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  errors: Array<{ recordId: string; message: string }>;
  durationMs: number;
  apiCallsCount: number;
}

function toIsoForApi(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function chamberOf(committeeCode: string): "house" | "senate" | null {
  if (committeeCode.startsWith("h")) return "house";
  if (committeeCode.startsWith("s")) return "senate";
  return null;
}

export async function syncWorkspace(
  workspaceId: string,
  options: CongressGovSyncOptions = {},
  log?: Logger
): Promise<CongressGovSyncResult> {
  const startedAt = Date.now();
  log?.info("congressgov_sync_started", { workspaceId, options });

  const result: CongressGovSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    meetingsListed: 0,
    meetingsDetailed: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    signalsUnchanged: 0,
    errors: [],
    durationMs: 0,
    apiCallsCount: 0,
  };

  try {
    const config: CongressGovConfig = await loadConfig(workspaceId, log);
    const v = validateConfig(config);
    if (!v.valid) throw new Error(`Invalid config: ${v.errors.join(", ")}`);
    if (config.disabled) {
      log?.info("congressgov_sync_skipped_disabled", { workspaceId });
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const sinceDays = options.sinceDays ?? Math.min(180, config.lookBackMonths * 30);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const until = new Date();
    const congress = currentCongress();
    const maxPerChamber = options.maxMeetingsPerChamber ?? 30;

    // List meetings per chamber (house + senate)
    const chambers = new Set<"house" | "senate">();
    for (const code of config.committees) {
      const ch = chamberOf(code);
      if (ch) chambers.add(ch);
    }
    if (chambers.size === 0) {
      chambers.add("house");
      chambers.add("senate");
    }

    // Set of watchlisted committee codes — we'll filter in-process since the
    // API endpoint lists all committee meetings for the chamber.
    const watchlistedCodes = new Set(config.committees.map((c) => c.toLowerCase()));

    for (const chamber of chambers) {
      try {
        const listing = await listCommitteeMeetings(
          congress,
          chamber,
          {
            fromDateTime: toIsoForApi(since),
            toDateTime: toIsoForApi(until),
            limit: 100,
          },
          log
        );
        result.apiCallsCount++;
        const meetings = listing.committeeMeetings ?? [];
        result.meetingsListed += meetings.length;

        let processed = 0;
        for (const meetingItem of meetings) {
          if (processed >= maxPerChamber) break;
          try {
            const detail = await fetchCommitteeMeetingDetail(
              congress,
              chamber,
              meetingItem.eventId,
              log
            );
            result.apiCallsCount++;
            const m = detail.committeeMeeting;
            // Filter to watchlisted committees if config has any
            if (config.committees.length > 0 && m.committees) {
              const matches = m.committees.some((c) =>
                watchlistedCodes.has(String(c.systemCode || "").toLowerCase())
              );
              if (!matches) continue;
            }
            result.meetingsDetailed++;

            const signal = await mapHearingDetailToSignal(workspaceId, congress, chamber, detail);
            if (!signal) continue;
            if (options.dryRun) {
              processed++;
              continue;
            }
            const r = await upsertSignal(workspaceId, signal);
            if (r.action === "created") result.signalsCreated++;
            else if (r.action === "updated") result.signalsUpdated++;
            else result.signalsUnchanged++;
            processed++;
          } catch (err) {
            const e = err as Error;
            result.errors.push({
              recordId: `event:${meetingItem.eventId}`,
              message: e.message ?? String(err),
            });
            log?.warn("congressgov_meeting_failed", {
              eventId: meetingItem.eventId,
              message: e.message,
            });
          }
        }
      } catch (err) {
        const e = err as Error;
        result.errors.push({
          recordId: `chamber:${chamber}`,
          message: e.message ?? String(err),
        });
        log?.warn("congressgov_chamber_failed", { chamber, message: e.message });
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

    log?.info("congressgov_sync_completed", {
      workspaceId,
      meetingsListed: result.meetingsListed,
      meetingsDetailed: result.meetingsDetailed,
      signalsCreated: result.signalsCreated,
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
