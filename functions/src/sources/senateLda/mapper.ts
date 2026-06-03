// Senate LDA — filing → Signal mapper
//
// Each LD-2 filing becomes one lobbying_disclosure Signal. The client
// (paying company) is the subject; the registrant (lobby firm) and named
// government entities are related. Lobbyist names are surfaced in attrs
// but not resolved as Persons in v1.0 — that pass needs the workspace's
// existing person dedupe and is deferred to v1.1.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath, stripUndefinedDeep } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import { resolvePersonByName } from "../../framework/personResolver";
import type { LdaFiling, LdaLobbyingActivity, LdaLobbyistEntry } from "./client";
import { ldaFilingPublicUrl } from "./client";

interface LdaEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  dir: "to" | "from" | "both";
  attrs?: Record<string, unknown>;
}

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

/** v1.1: lobbyist entry now carries the LDA id (for Person dedupe) +
 *  derived title fields. */
interface LobbyistEntry {
  /** LDA API lobbyist.id when present — preferred Person dedupe key. */
  lobbyistId: number | null;
  /** Display name "{first} [middle] {last}". */
  name: string;
  /** First name (for Person.name dedupe fallback). */
  firstName: string;
  /** Last name (for Person.name dedupe fallback). */
  lastName: string;
  /** Full text of LDA "covered_position" — empty when no revolving-door. */
  coveredPosition: string;
}

function summarizeActivities(activities: LdaLobbyingActivity[]): {
  issueCodes: string[];
  issueCodeDisplays: string[];
  issuesDescription: string[];
  governmentEntityNames: string[];
  lobbyistsCount: number;
  revolvingDoorCount: number;
  topLobbyists: LobbyistEntry[];
} {
  const issueCodes = new Set<string>();
  const issueCodeDisplays = new Set<string>();
  const issuesDescription: string[] = [];
  const govEntityNames = new Set<string>();
  const lobbyistSet = new Set<string>();
  let revolvingDoorCount = 0;
  const lobbyistEntries: LobbyistEntry[] = [];

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
        // Dedupe within this filing — same lobbyist may appear under
        // multiple lobbying activities; we want one entry per person
        const dedupeKey = lo.lobbyist?.id
          ? `id:${lo.lobbyist.id}`
          : `name:${name.toLowerCase()}`;
        if (lobbyistSet.has(dedupeKey)) continue;
        lobbyistSet.add(dedupeKey);
        const covered = (lo.covered_position || "").toString().trim();
        if (covered) revolvingDoorCount++;
        lobbyistEntries.push({
          lobbyistId: lo.lobbyist?.id ?? null,
          name,
          firstName: (lo.lobbyist?.first_name || "").toString().trim(),
          lastName: (lo.lobbyist?.last_name || "").toString().trim(),
          coveredPosition: covered,
        });
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

/** v1.2: covered_position pattern catalog. The LDA `covered_position`
 *  field is free-text but follows recognizable conventions. We match a
 *  curated list of defense-relevant federal employer institutions and
 *  resolve each as a government Org. False negatives fall through
 *  (no Edge); false positives are rare given the LDA's structured
 *  format. */
interface CoveredPositionPattern {
  /** Substring or regex to match against covered_position. */
  match: RegExp;
  /** Canonical Org name to resolve. */
  canonicalName: string;
}

const COVERED_POSITION_PATTERNS: CoveredPositionPattern[] = [
  // Congressional committees — defense
  { match: /\bSenate Armed Services\b/i, canonicalName: "Senate Armed Services Committee" },
  { match: /\bHouse Armed Services\b/i, canonicalName: "House Armed Services Committee" },
  { match: /\bSenate (?:Select Committee on )?Intelligence\b/i, canonicalName: "Senate Select Committee on Intelligence" },
  { match: /\bHouse (?:Permanent Select Committee on )?Intelligence\b/i, canonicalName: "House Permanent Select Committee on Intelligence" },
  { match: /\bSenate Foreign Relations\b/i, canonicalName: "Senate Foreign Relations Committee" },
  { match: /\bHouse Foreign Affairs\b/i, canonicalName: "House Foreign Affairs Committee" },
  { match: /\bSenate Appropriations\b/i, canonicalName: "Senate Appropriations Committee" },
  { match: /\bHouse Appropriations\b/i, canonicalName: "House Appropriations Committee" },
  { match: /\bSenate Homeland Security and Governmental Affairs\b/i, canonicalName: "Senate Homeland Security and Governmental Affairs Committee" },
  { match: /\bHouse Homeland Security\b/i, canonicalName: "House Homeland Security Committee" },
  { match: /\bSenate Commerce(?:, Science, and Transportation)?\b/i, canonicalName: "Senate Commerce, Science, and Transportation Committee" },
  { match: /\bHouse (?:Energy and )?Commerce\b/i, canonicalName: "House Energy and Commerce Committee" },
  // Department of Defense
  { match: /\b(?:Office of the )?Secretary of Defense\b/i, canonicalName: "Office of the Secretary of Defense" },
  { match: /\bUnder Secretary of Defense for Acquisition and Sustainment\b/i, canonicalName: "Under Secretary of Defense for Acquisition and Sustainment" },
  { match: /\bUnder Secretary of Defense for Research and Engineering\b/i, canonicalName: "Under Secretary of Defense for Research and Engineering" },
  { match: /\bUnder Secretary of Defense for Policy\b/i, canonicalName: "Under Secretary of Defense for Policy" },
  { match: /\bUnder Secretary of Defense for Personnel and Readiness\b/i, canonicalName: "Under Secretary of Defense for Personnel and Readiness" },
  { match: /\bUnder Secretary of Defense for Intelligence(?: and Security)?\b/i, canonicalName: "Under Secretary of Defense for Intelligence and Security" },
  { match: /\bUnder Secretary of Defense.*Comptroller\b/i, canonicalName: "Under Secretary of Defense (Comptroller)" },
  { match: /\bJoint Chiefs of Staff\b/i, canonicalName: "Joint Chiefs of Staff" },
  { match: /\bDepartment of Defense\b/i, canonicalName: "Department of Defense" },
  // Service branches
  { match: /\bDepartment of the Army\b/i, canonicalName: "Department of the Army" },
  { match: /\bDepartment of the Navy\b/i, canonicalName: "Department of the Navy" },
  { match: /\bDepartment of the Air Force\b/i, canonicalName: "Department of the Air Force" },
  { match: /\bU(?:nited )?S(?:tates)?\.?\s+Marine Corps\b/i, canonicalName: "United States Marine Corps" },
  { match: /\bU(?:nited )?S(?:tates)?\.?\s+Space Force\b/i, canonicalName: "United States Space Force" },
  // Defense agencies
  { match: /\bDefense Advanced Research Projects Agency|DARPA\b/i, canonicalName: "Defense Advanced Research Projects Agency" },
  { match: /\bMissile Defense Agency|\bMDA\b/i, canonicalName: "Missile Defense Agency" },
  { match: /\bDefense Innovation Unit|\bDIU\b/i, canonicalName: "Defense Innovation Unit" },
  { match: /\bDefense Logistics Agency|\bDLA\b/i, canonicalName: "Defense Logistics Agency" },
  // Executive branch — adjacent
  { match: /\bNational Security Council|\bNSC\b/i, canonicalName: "National Security Council" },
  { match: /\bOffice of Management and Budget|\bOMB\b/i, canonicalName: "Office of Management and Budget" },
  { match: /\bWhite House\b/i, canonicalName: "Executive Office of the President" },
  // Other defense-adjacent
  { match: /\bDepartment of State\b/i, canonicalName: "Department of State" },
  { match: /\bDepartment of Homeland Security\b/i, canonicalName: "Department of Homeland Security" },
  { match: /\bDepartment of Energy\b/i, canonicalName: "Department of Energy" },
  { match: /\bDepartment of Veterans Affairs\b/i, canonicalName: "Department of Veterans Affairs" },
  { match: /\bCentral Intelligence Agency|\bCIA\b/i, canonicalName: "Central Intelligence Agency" },
  { match: /\bNational Security Agency|\bNSA\b/i, canonicalName: "National Security Agency" },
  { match: /\bDefense Intelligence Agency|\bDIA\b/i, canonicalName: "Defense Intelligence Agency" },
  { match: /\bOffice of the Director of National Intelligence|\bODNI\b/i, canonicalName: "Office of the Director of National Intelligence" },
];

/** v1.2: parse a covered_position string and return canonical Org names
 *  for each pattern that matches. Order preserved by first-match. */
function parseCoveredPosition(coveredPosition: string): string[] {
  if (!coveredPosition) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of COVERED_POSITION_PATTERNS) {
    if (p.match.test(coveredPosition) && !seen.has(p.canonicalName)) {
      seen.add(p.canonicalName);
      out.push(p.canonicalName);
    }
  }
  return out;
}

function formerlyAtEdgeId(personId: string, orgId: string): string {
  return "edge_lda_formerly_" + personId.slice(0, 24) + "__" + orgId.slice(0, 24);
}

/** v1.1: deterministic Person id for an LDA lobbyist. Prefer LDA id when
 *  present (stable across filings), otherwise fall back to normalized
 *  display name. */
function ldaLobbyistPersonId(entry: LobbyistEntry): string {
  if (entry.lobbyistId != null && Number.isFinite(entry.lobbyistId)) {
    return "pers_lda_" + String(entry.lobbyistId);
  }
  const norm = entry.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return "pers_lda_n_" + (norm || String(Date.now()));
}

/** v1.1: deterministic Edge id for a lobbyist-at-firm relationship. */
function lobbyistEdgeId(personId: string, registrantOrgId: string): string {
  return "edge_lda_lobbyist_" + personId.slice(0, 24) + "__" + registrantOrgId.slice(0, 24);
}

export interface LdaUpsertMetrics {
  clientOrgResolved: boolean;
  registrantOrgResolved: boolean;
  governmentEntitiesResolved: number;
  /** v1.1: number of lobbyist Persons created (revolving-door entries —
   *  lobbyists with non-empty covered_position). */
  revolvingDoorPersonsCreated: number;
  /** v1.1: number of lobbyist Persons matched to an existing node. */
  revolvingDoorPersonsMatched: number;
  /** v1.1: number of lobbyist→registrant Edges upserted. */
  revolvingDoorEdgesUpserted: number;
  /** v1.2: number of lobbyist→former-employer Orgs resolved across all
   *  parsed covered_positions on this filing. */
  formerEmployerOrgsResolved: number;
  /** v1.2: number of formerly_at Edges upserted on this filing. */
  formerlyAtEdgesUpserted: number;
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
    revolvingDoorPersonsCreated: 0,
    revolvingDoorPersonsMatched: 0,
    revolvingDoorEdgesUpserted: 0,
    formerEmployerOrgsResolved: 0,
    formerlyAtEdgesUpserted: 0,
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
  let registrantOrgId: string | null = null;
  if (registrantName) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, registrantName, null, {
        autoCreate: true,
        type: "company",
      });
      registrantOrgId = orgId;
      if (!relatedIds.includes(orgId)) relatedIds.push(orgId);
      metrics.registrantOrgResolved = true;
    } catch (e) {
      log?.debug("senate_lda_registrant_resolve_failed", {
        registrantName,
        message: (e as Error).message,
      });
    }
  }

  // v1.1: upsert Person + lobbyist_at Edge for each revolving-door
  // lobbyist (covered_position is the BD intel cue — former Hill / agency
  // staff now lobbying for the same client). Non-revolving-door lobbyists
  // stay in attrs.topLobbyists only; we don't churn Person records for
  // every named lobbyist on every filing.
  // v1.2: additionally parse covered_position for former-employer
  // committees/agencies and upsert formerly_at Edges to each.
  if (registrantOrgId) {
    for (const lobbyist of activitiesSummary.topLobbyists) {
      if (!lobbyist.coveredPosition) continue;
      try {
        const r = await upsertLdaLobbyistPerson(
          workspaceId,
          lobbyist,
          registrantOrgId,
          registrantName,
          filing.filing_uuid,
          log
        );
        if (r.personAction === "created") metrics.revolvingDoorPersonsCreated++;
        else if (r.personAction === "matched") metrics.revolvingDoorPersonsMatched++;
        if (r.edgeUpserted) metrics.revolvingDoorEdgesUpserted++;

        // v1.2: walk covered_position for known committee/agency markers,
        // resolve each as a government Org, upsert formerly_at Edge.
        const formerEmployers = parseCoveredPosition(lobbyist.coveredPosition);
        for (const employerName of formerEmployers) {
          try {
            const employerRes = await resolveRecipientOrg(workspaceId, employerName, null, {
              autoCreate: true,
              type: "government",
            });
            metrics.formerEmployerOrgsResolved++;
            const er = await upsertFormerlyAtEdge(
              workspaceId,
              r.personId,
              employerRes.orgId,
              lobbyist.coveredPosition,
              filing.filing_uuid,
              log
            );
            if (er.edgeUpserted) metrics.formerlyAtEdgesUpserted++;
          } catch (e) {
            log?.debug("senate_lda_former_employer_resolve_failed", {
              employer: employerName,
              message: (e as Error).message,
            });
          }
        }
      } catch (e) {
        log?.debug("senate_lda_lobbyist_resolve_failed", {
          name: lobbyist.name,
          message: (e as Error).message,
        });
      }
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
    await db.ref(path).set(stripUndefinedDeep(signal));
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
      await db.ref(path).set(stripUndefinedDeep(signal));
      action = "updated";
    }
  }

  metrics.durationMs = Date.now() - startedAt;
  return { signalId: id, action, metrics };
}

/**
 * v1.1: upsert a Person record for a revolving-door lobbyist + an Edge
 * from that Person to the registrant (lobby firm) Org. Idempotent: re-
 * ingestion of the same filing or later filings re-upsert the Edge and
 * may update the Person's coveredPositionLastSeen.
 *
 * Person id is the LDA lobbyist.id when present (stable across filings),
 * otherwise derived from the normalized display name (so a lobbyist who
 * shows up without an id still gets a node, just less reliably deduped).
 *
 * Edge `attrs.coveredPosition` carries the LDA covered_position string
 * verbatim — that's the revolving-door narrative the operator wants to
 * search ("former Senate Armed Services Committee staff"). Edge
 * `attrs.lastSeenOnFiling` carries the most recent filing UUID we saw
 * this lobbyist on, useful for "still active?" queries.
 */
async function upsertLdaLobbyistPerson(
  workspaceId: string,
  lobbyist: LobbyistEntry,
  registrantOrgId: string,
  registrantName: string,
  filingUuid: string,
  log?: Logger
): Promise<{
  personId: string;
  personAction: "created" | "matched" | "updated";
  edgeUpserted: boolean;
}> {
  // v1.3: Person upsert via framework/personResolver for cross-source
  // dedupe. The resolver matches existing Persons (from advisory_boards
  // members, faca members, etc.) before auto-creating. Operator_manual
  // Persons are auto-respected — resolver returns existing id and the
  // node is untouched.
  const now = Date.now();
  const provenance = externalProvenance(
    "senate_lda",
    lobbyist.lobbyistId != null ? String(lobbyist.lobbyistId) : `name:${lobbyist.name}`,
    null,
    null,
    now
  );
  const r = await resolvePersonByName(workspaceId, lobbyist.name, {
    autoCreate: true,
    preferredId: ldaLobbyistPersonId(lobbyist),
    role: "Registered lobbyist",
    org: registrantName,
    provenance,
  });
  const pId = r.personId;
  const personAction: "created" | "matched" | "updated" = r.created
    ? "created"
    : "matched";
  if (r.created) {
    log?.debug("senate_lda_lobbyist_person_created", {
      personId: pId,
      name: lobbyist.name,
    });
  } else {
    log?.debug("senate_lda_lobbyist_person_matched", {
      personId: pId,
      name: lobbyist.name,
      matchedVia: r.matchedVia,
    });
  }

  // Upsert the lobbyist_at Edge
  const eId = lobbyistEdgeId(pId, registrantOrgId);
  const edgePath = wsPath(workspaceId, "edges", eId);
  const edgeSnap = await db.ref(edgePath).once("value");
  const edgeAttrs: Record<string, unknown> = {
    coveredPosition: lobbyist.coveredPosition,
    lobbyistLdaId: lobbyist.lobbyistId,
    lastSeenOnFiling: filingUuid,
    lastSeenAt: now,
  };
  const edge: LdaEdge = {
    id: eId,
    source: pId,
    target: registrantOrgId,
    label: "lobbyist_at",
    dir: "to",
    attrs: edgeAttrs,
  };
  let edgeUpserted = false;
  if (!edgeSnap.exists()) {
    await db.ref(edgePath).set(stripUndefinedDeep(edge));
    edgeUpserted = true;
  } else {
    // Preserve operator-input fields; just bump lastSeenAt + lastSeenOnFiling
    const existing = edgeSnap.val() as LdaEdge;
    const mergedAttrs = { ...(existing.attrs || {}), ...edgeAttrs };
    await db.ref(edgePath).set(stripUndefinedDeep({ ...existing, attrs: mergedAttrs }));
    edgeUpserted = true;
  }

  return { personId: pId, personAction, edgeUpserted };
}

/**
 * v1.2: upsert a formerly_at Edge from a Person to a government Org
 * (committee or agency parsed from the LDA covered_position string).
 * Idempotent: re-ingestion bumps lastSeenAt + lastSeenOnFiling without
 * disturbing existing operator-input edge attrs.
 *
 * The Edge captures "this Person was institutionally affiliated with
 * this body before becoming a registered lobbyist" — the revolving-door
 * arrow that BD operators care about. Storing this as a first-class Edge
 * makes "who used to staff HASC" queries instant.
 */
async function upsertFormerlyAtEdge(
  workspaceId: string,
  personId: string,
  orgId: string,
  coveredPositionRaw: string,
  filingUuid: string,
  log?: Logger
): Promise<{ edgeUpserted: boolean }> {
  const eId = formerlyAtEdgeId(personId, orgId);
  const edgePath = wsPath(workspaceId, "edges", eId);
  const now = Date.now();
  const edgeAttrs: Record<string, unknown> = {
    coveredPositionRaw: coveredPositionRaw.slice(0, 400),
    lastSeenOnFiling: filingUuid,
    lastSeenAt: now,
  };
  const edge: LdaEdge = {
    id: eId,
    source: personId,
    target: orgId,
    label: "formerly_at",
    dir: "to",
    attrs: edgeAttrs,
  };
  const snap = await db.ref(edgePath).once("value");
  if (!snap.exists()) {
    await db.ref(edgePath).set(stripUndefinedDeep(edge));
    log?.debug("senate_lda_formerly_at_edge_created", {
      personId,
      orgId,
    });
    return { edgeUpserted: true };
  }
  const existing = snap.val() as LdaEdge;
  const mergedAttrs = { ...(existing.attrs || {}), ...edgeAttrs };
  await db.ref(edgePath).set({ ...existing, attrs: mergedAttrs });
  return { edgeUpserted: true };
}
