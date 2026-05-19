// Industry Association rosters — SourceClient implementation (Phase 8.6.11 v1.0)

import { Logger } from "../../framework/logger";
import {
  recordSyncSuccess,
  recordSyncError,
  readSourceHealth,
} from "../../framework/sourceHealth";
import { categorizeError } from "../../framework/errors";
import {
  loadConfig,
  validateConfig,
  ASSOCIATION_REGISTRY,
  type IndustryAssocConfig,
  type AssociationKey,
} from "./config";
import { fetchAssociationRoster, type MemberCandidate } from "./client";
import { resolveAssociationOrg, upsertMember } from "./mapper";

export const SOURCE_NAME = "industry_assoc";
export const SOURCE_VERSION = "1.0.0";

export interface IndustryAssocSyncOptions {
  dryRun?: boolean;
  associationsOverride?: AssociationKey[];
  maxMembersPerAssociationOverride?: number;
}

export interface IndustryAssocSyncResult {
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  associationsAttempted: number;
  associationOrgsResolvedTotal: number;
  membersDetected: number;
  membersResolved: number;
  membersCreatedTotal: number;
  edgesUpsertedTotal: number;
  perAssociation: Record<string, { detected: number; resolved: number; edges: number }>;
  errors: Array<{ ref: string; message: string }>;
  apiCallsCount: number;
  sourceVersion: string;
}

export async function syncWorkspace(
  workspaceId: string,
  options: IndustryAssocSyncOptions = {},
  log?: Logger
): Promise<IndustryAssocSyncResult> {
  const startedAt = Date.now();
  const syncId = "ia_" + Date.now().toString(36);
  log?.info("industry_assoc_sync_started", { workspaceId, options });

  const result: IndustryAssocSyncResult = {
    workspaceId,
    startedAt,
    completedAt: 0,
    durationMs: 0,
    associationsAttempted: 0,
    associationOrgsResolvedTotal: 0,
    membersDetected: 0,
    membersResolved: 0,
    membersCreatedTotal: 0,
    edgesUpsertedTotal: 0,
    perAssociation: {},
    errors: [],
    apiCallsCount: 0,
    sourceVersion: SOURCE_VERSION,
  };

  try {
    const config: IndustryAssocConfig = await loadConfig(workspaceId, log);
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }
    if (config.disabled || !config.enabled) {
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
      return result;
    }

    const associations = options.associationsOverride ?? config.associations;
    const maxMembers =
      options.maxMembersPerAssociationOverride ??
      config.maxMembersPerAssociation ??
      1500;

    for (const assocKey of associations) {
      result.associationsAttempted++;
      const spec = ASSOCIATION_REGISTRY[assocKey];
      result.perAssociation[assocKey] = { detected: 0, resolved: 0, edges: 0 };

      // Resolve association Org
      let assocOrgId: string | null = null;
      try {
        const r = await resolveAssociationOrg(
          workspaceId,
          spec.name,
          spec.acronym,
          log
        );
        assocOrgId = r.assocOrgId;
        result.associationOrgsResolvedTotal++;
      } catch (err) {
        result.errors.push({
          ref: `assoc_org:${assocKey}`,
          message: (err as Error).message,
        });
        continue;
      }

      // Fetch + parse roster
      let members: MemberCandidate[] = [];
      try {
        members = await fetchAssociationRoster(assocKey, config, log);
        result.apiCallsCount++;
        result.perAssociation[assocKey].detected = members.length;
        result.membersDetected += members.length;
      } catch (err) {
        result.errors.push({
          ref: `roster:${assocKey}`,
          message: (err as Error).message,
        });
        continue;
      }

      // Cap to maxMembers
      const toUpsert = members.slice(0, maxMembers);

      if (!options.dryRun) {
        for (const member of toUpsert) {
          try {
            const r = await upsertMember(
              workspaceId,
              member,
              assocOrgId,
              syncId,
              log
            );
            result.membersResolved++;
            result.perAssociation[assocKey].resolved++;
            if (r.memberCreated) result.membersCreatedTotal++;
            if (r.edgeUpserted) {
              result.edgesUpsertedTotal++;
              result.perAssociation[assocKey].edges++;
            }
          } catch (err) {
            result.errors.push({
              ref: `member:${assocKey}:${member.name}`,
              message: (err as Error).message,
            });
          }
        }
      }
    }

    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;

    await recordSyncSuccess(
      workspaceId,
      SOURCE_NAME,
      {
        recordsUpserted: result.edgesUpsertedTotal,
        recordsSkipped: 0,
        durationMs: result.durationMs,
        apiCalls: result.apiCallsCount,
      },
      log
    );

    log?.info("industry_assoc_sync_completed", {
      workspaceId,
      sourceVersion: SOURCE_VERSION,
      durationMs: result.durationMs,
      associationsAttempted: result.associationsAttempted,
      membersDetected: result.membersDetected,
      edgesUpsertedTotal: result.edgesUpsertedTotal,
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
