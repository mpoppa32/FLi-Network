// Senate LDA — filing → Signal mapper
//
// Each LD-2 filing becomes one lobbying_disclosure Signal. The client
// (paying company) is the subject; the registrant (lobby firm) and named
// government entities are related. Lobbyist names are surfaced in attrs
// but not resolved as Persons in v1.0 — that pass needs the workspace's
// existing person dedupe and is deferred to v1.1.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { LdaFiling, LdaLobbyingActivity, LdaLobbyistEntry } from "./client";
import { ldaFilingPublicUrl } from "./client";

function signalId(filingUuid: string): string {
  const safe = (filingUuid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  return "sig_lda_" + safe;
}

function parseIncome(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return Math.round(raw);
  const s = String(raw).replace(/[,$\s]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function lobbyistDisplayName(entry: LdaLobbyistEntry): string {
  const l = entry.lobbyist || {};
  const parts = [l.prefix_display, l.first_name, l.middle_name, l.last_name, l.suffix_display]
    .filter((s) => !!s && String(s).trim())
    .map((s) => String(s).trim());
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function summarizeActivities(activities: LdaLobbyingActivity[]): {
  issueCodes: string[];
  issueCodeDisplays: string[];
  issuesDescription: string[];
  governmentEntityNames: string[];
  lobbyistsCount: number;
  revolvingDoorCount: number;
  topLobbyists: Array<{ name: string; coveredPosition: string }>;
} {
  const issueCodes = new Set<string>();
  const issueCodeDisplays = new Set<string>();
  const issuesDescription: string[] = [];
  const govEntityNames = new Set<string>();
  const lobbyistSet = new Set<string>();
  let revolvingDoorCount = 0;
  const lobbyistEntries: Array<{ name: string; coveredPosition: string }> = [];

  for (const a of activities) {
    if (a.general_issue_code) issueCodes.add(a.general_issue_code);
    if (a.general_issue_code_display) issueCodeDisplays.add(a.general_issue_code_display);
    if (a.description) {
      const desc = a.description.trim();
      if (desc) issuesDescription.push(desc.slice(0, 600));
    }
    if (Array.isArray(a.government_entities)) {
      for (const g of a.government_entities) {
        if (g && g.name) govEntityNames.add(g.name.trim());
      }
    }
    if (Array.isArray(a.lobbyists)) {
      for (const lo of a.lobbyists) {
        const name = lobbyistDisplayName(lo);
        if (!name) continue;
        if (!lobbyistSet.has(name)) {
          lobbyistSet.add(name);
          const covered = (lo.covered_position || "").toString().trim();
          if (covered) revolvingDoorCount++;
          lobbyistEntries.push({ name, coveredPosition: covered });
        }
      }
    }
  }

  // Top lobbyists: revolving-door first, then alphabetic.
  lobbyistEntries.sort((a, b) => {
    if (!!a.coveredPosition !== !!b.coveredPosition) {
      return a.coveredPosition ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    issueCodes: Array.from(issueCodes),
    issueCodeDisplays: Array.from(issueCodeDisplays),
    issuesDescription: issuesDescription.slice(0, 8),
    governmentEntityNames: Array.from(govEntityNames).slice(0, 30),
    lobbyistsCount: lobbyistSet.size,
    revolvingDoorCount,
    topLobbyists: lobbyistEntries.slice(0, 8),
  };
}

export interface LdaUpsertMetrics {
  clientOrgResolved: boolean;
  registrantOrgResolved: boolean;
  governmentEntitiesResolved: number;
  durationMs: number;
}

export interface LdaUpsertResult {
  signalId: string;
  action: "created" | "updated" | "unchanged";
  metrics: LdaUpsertMetrics;
}

export async function upsertLdaSignal(
  workspaceId: string,
  filing: LdaFiling,
  log?: Logger
): Promise<LdaUpsertResult> {
  const startedAt = Date.now();
  const metrics: LdaUpsertMetrics = {
    clientOrgResolved: false,
    registrantOrgResolved: false,
    governmentEntitiesResolved: 0,
    durationMs: 0,
  };

  const id = signalId(filing.filing_uuid);
  const occurredAt = filing.dt_posted
    ? Date.parse(filing.dt_posted)
    : filing.filing_date
      ? Date.parse(filing.filing_date)
      : Date.now();

  const clientName = (filing.client?.name || "").trim();
  const registrantName = (filing.registrant?.name || "").trim();
  const income = parseIncome(filing.income);
  const expenses = parseIncome(filing.expenses);
  const reportedDollarAmount = income > 0 ? income : expenses;

  const activitiesSummary = summarizeActivities(filing.lobbying_activities ?? []);

  const subjectIds: string[] = [];
  const relatedIds: string[] = [];

  // Resolve client (the company paying for lobbying) → company Org, primary
  // subject. The Brief scorer keys off subjectIds against the adversary +
  // pursuit Org sets, so getting the client correctly here is what unlocks
  // "this adversary is lobbying on this issue right now" detection.
  if (clientName) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, clientName, null, {
        autoCreate: true,
        type: "company",
      });
      if (!subjectIds.includes(orgId)) subjectIds.push(orgId);
      metrics.clientOrgResolved = true;
    } catch (e) {
      log?.debug("senate_lda_client_resolve_failed", {
        clientName,
        message: (e as Error).message,
      });
    }
  }

  // Resolve registrant (lobby firm) → company Org, related context.
  if (registrantName) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, registrantName, null, {
        autoCreate: true,
        type: "company",
      });
      if (!relatedIds.includes(orgId)) relatedIds.push(orgId);
      metrics.registrantOrgResolved = true;
    } catch (e) {
      log?.debug("senate_lda_registrant_resolve_failed", {
        registrantName,
        message: (e as Error).message,
      });
    }
  }

  // Resolve up to 4 government entities → government Orgs. Cap to avoid
  // turning every filing's "House" + "Senate" + 8 agencies into Org churn;
  // the named primary contacts are the BD signal.
  for (const entityName of activitiesSummary.governmentEntityNames.slice(0, 4)) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, entityName, null, {
        autoCreate: true,
        type: "government",
      });
      if (!relatedIds.includes(orgId)) relatedIds.push(orgId);
      metrics.governmentEntitiesResolved++;
    } catch (e) {
      // continue
    }
  }

  const url = filing.url || ldaFilingPublicUrl(filing.filing_uuid);

  const attrs: Record<string, unknown> = {
    filingUuid: filing.filing_uuid,
    filingType: filing.filing_type,
    filingTypeDisplay: filing.filing_type_display,
    filingYear: filing.filing_year,
    filingPeriod: filing.filing_period,
    filingPeriodDisplay: filing.filing_period_display,
    filingDate: filing.filing_date,
    dtPosted: filing.dt_posted,
    clientName,
    clientDescription: filing.client?.general_description,
    clientCountry: filing.client?.country_name,
    registrantName,
    registrantDescription: filing.registrant?.description,
    income: income || null,
    expenses: expenses || null,
    reportedDollarAmount,
    issueCodes: activitiesSummary.issueCodes,
    issueCodeDisplays: activitiesSummary.issueCodeDisplays,
    issuesDescription: activitiesSummary.issuesDescription,
    governmentEntities: activitiesSummary.governmentEntityNames,
    lobbyistsCount: activitiesSummary.lobbyistsCount,
    revolvingDoorCount: activitiesSummary.revolvingDoorCount,
    topLobbyists: activitiesSummary.topLobbyists,
    url,
  };

  const hash = hashFields(
    {
      filingUuid: filing.filing_uuid,
      filingType: filing.filing_type,
      filingYear: filing.filing_year,
      clientName,
      registrantName,
      income,
      expenses,
      issueCodes: activitiesSummary.issueCodes.join(","),
      lobbyistsCount: activitiesSummary.lobbyistsCount,
      revolvingDoorCount: activitiesSummary.revolvingDoorCount,
      governmentEntities: activitiesSummary.governmentEntityNames.join("|"),
    } as Record<string, unknown>,
    [
      "filingUuid",
      "filingType",
      "filingYear",
      "clientName",
      "registrantName",
      "income",
      "expenses",
      "issueCodes",
      "lobbyistsCount",
      "revolvingDoorCount",
      "governmentEntities",
    ]
  );

  const provenance = externalProvenance(
    "senate_lda",
    filing.filing_uuid,
    url,
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "lobbying_disclosure",
    subjectIds,
    relatedIds,
    occurredAt,
    attrs,
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  let action: "created" | "updated" | "unchanged";
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("senate_lda_signal_created", {
      id,
      clientName,
      filingType: filing.filing_type,
    });
    action = "created";
  } else {
    const existing = snap.val() as Signal;
    if (existing.source?.hash === hash) {
      await db.ref(`${path}/source/refreshedAt`).set(Date.now());
      action = "unchanged";
    } else {
      await db.ref(path).set(signal);
      action = "updated";
    }
  }

  metrics.durationMs = Date.now() - startedAt;
  return { signalId: id, action, metrics };
}
