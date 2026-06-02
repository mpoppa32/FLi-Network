// uas-patterns PIE Supply-Chain Intelligence — payload → Signal mapper
//
// Two signal types emitted per scrape:
//
//   supply_chain_status     — one per manufacturer that resolves to an
//                             existing workspace Org node. autoCreate:false
//                             so we don't proliferate 50 random vendor
//                             nodes; the curator's universe spans the
//                             whole drone-defense market while a
//                             workspace tracks a subset. attrs carries
//                             status, funding, programs, key_risk,
//                             acquisition_probability, ndaa_status.
//                             subjectIds = [orgId].
//
//   supply_chain_scenario   — one per forecast (no Org dependency).
//                             subjectIds = []; relatedIds via scan over
//                             scenario.disrupted[] + description against
//                             the workspace's existing Org name index.
//                             attrs has probability + description +
//                             disrupted + lead_override + recovery +
//                             mitigation.
//
// Vendor resolution: tries `name`, then `id` (often a slug-cased
// shortform like "skydio" / "brinc"). The DDG plugin's alias map covers
// the three name divergences shared between the two sources; we import
// rather than duplicate so the alias surface stays single-source.
//
// Hash strategy: per-manufacturer hash over last_audited + status +
// signal + funding + acquisition_probability + ndaa_status (the fields
// the curator updates between audits). Per-scenario hash over
// probability + description slice + mitigation slice. Hash-stable
// reruns produce 'unchanged' until the curator publishes a refresh.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath, stripUndefinedDeep } from "../../framework/rtdb";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { PieManufacturer, PieScenario } from "./client";

/** Names that don't normalize cleanly to an Atlas Org node. Mirrors the
 *  DDG plugin's alias map plus a few PIE-only entries; verified against
 *  Atlas workspace 1777435779676. */
const VENDOR_ALIASES: Record<string, string[]> = {
  Neros: ["Neros Technologies"],
  "Auterion Government Solutions": ["Auterion"],
  "Napatree Technology": ["Napatree"],
  "BRINC Drones": ["BRINC"],
};

function manufacturerSignalId(m: PieManufacturer): string {
  const seed = m.id || m.name || "unknown";
  const safe = seed
    .replace(/[^A-Za-z0-9]/g, "_")
    .slice(0, 60)
    .replace(/_+$/, "");
  return "sig_uap_pie_mfr_" + safe;
}

function scenarioSignalId(s: PieScenario): string {
  const seed = s.id || s.name || "unknown";
  const safe = seed
    .replace(/[^A-Za-z0-9]/g, "_")
    .slice(0, 60)
    .replace(/_+$/, "");
  return "sig_uap_pie_scn_" + safe;
}

function manufacturerHash(m: PieManufacturer): string {
  const payload = {
    name: m.name || "",
    status: m.status || "",
    signal: m.signal || "",
    funding: m.funding || "",
    last_round: m.last_round || "",
    acquisition_probability: m.acquisition_probability ?? 0,
    ndaa_status: m.ndaa_status || "",
    last_audited: m.last_audited || "",
    key_risk_head: (m.key_risk || "").slice(0, 200),
  };
  return hashFields(
    payload as unknown as Record<string, unknown>,
    Object.keys(payload)
  );
}

function scenarioHash(s: PieScenario): string {
  const payload = {
    name: s.name,
    probability: s.probability,
    description_head: (s.description || "").slice(0, 300),
    mitigation_head: (s.mitigation || "").slice(0, 300),
    recovery: s.recovery || "",
    lead_override: s.lead_override ?? 0,
    disrupted: (s.disrupted || []).join("|"),
  };
  return hashFields(
    payload as unknown as Record<string, unknown>,
    Object.keys(payload)
  );
}

export interface UasPatternsPieUpsertResult {
  manufacturerSignalsCreated: number;
  manufacturerSignalsUpdated: number;
  manufacturerSignalsUnchanged: number;
  manufacturersSkippedNoOrg: number;
  scenarioSignalsCreated: number;
  scenarioSignalsUpdated: number;
  scenarioSignalsUnchanged: number;
}

/** Try to resolve a manufacturer to a workspace Org. Falls back through
 *  display name, alias map, and `id` (lowercased — sometimes the curator
 *  uses a slug that matches a node alternateName). */
async function tryResolveManufacturerOrg(
  workspaceId: string,
  m: PieManufacturer
): Promise<string | null> {
  const candidates: Array<{ name: string; alts?: string[] }> = [];
  if (m.name) candidates.push({ name: m.name, alts: VENDOR_ALIASES[m.name] });
  if (m.id && m.id !== m.name) candidates.push({ name: m.id });
  for (const c of candidates) {
    try {
      const r = await resolveRecipientOrg(workspaceId, c.name, null, {
        autoCreate: false,
        emitFuzzyCandidates: false,
        alternateNames: c.alts,
      });
      if (r.orgId) return r.orgId;
    } catch {
      // fall through to next candidate
    }
  }
  return null;
}

export async function upsertManufacturerSignals(
  workspaceId: string,
  manufacturers: PieManufacturer[],
  pageUrl: string,
  fetchedAt: number,
  confidence: number,
  log?: Logger
): Promise<UasPatternsPieUpsertResult> {
  const result: UasPatternsPieUpsertResult = {
    manufacturerSignalsCreated: 0,
    manufacturerSignalsUpdated: 0,
    manufacturerSignalsUnchanged: 0,
    manufacturersSkippedNoOrg: 0,
    scenarioSignalsCreated: 0,
    scenarioSignalsUpdated: 0,
    scenarioSignalsUnchanged: 0,
  };

  for (const m of manufacturers) {
    if (!m.name) continue;
    const orgId = await tryResolveManufacturerOrg(workspaceId, m);
    if (!orgId) {
      result.manufacturersSkippedNoOrg++;
      log?.debug("uas_patterns_pie_mfr_not_in_workspace", {
        name: m.name,
        id: m.id,
      });
      continue;
    }

    const id = manufacturerSignalId(m);
    const hash = manufacturerHash(m);
    const provenance = externalProvenance(
      "uas_patterns_pie",
      m.id || m.name,
      pageUrl,
      hash,
      fetchedAt
    );

    const signal: Signal = {
      id,
      type: "supply_chain_status",
      subjectIds: [orgId],
      occurredAt: fetchedAt,
      attrs: {
        manufacturerId: m.id,
        manufacturerName: m.name,
        country: m.country,
        hq: m.hq,
        tags: m.tags,
        status: m.status,
        statusLabel: m.status_label,
        funding: m.funding,
        lastRound: m.last_round,
        revenue: m.revenue,
        programs: m.programs,
        platformsInForge: m.platforms_in_forge,
        keyRisk: m.key_risk,
        dependencyNote: m.dependency_note,
        acquisitionProbability: m.acquisition_probability,
        acquirers: m.acquirers,
        ndaaStatus: m.ndaa_status,
        signalDirection: m.signal,
        lastAudited: m.last_audited,
        title: `${m.name} — ${m.status_label || m.status || "supply-chain status"}`,
        confidence,
        sourceUrl: pageUrl,
      },
      source: provenance,
    };

    const path = wsPath(workspaceId, "signals", id);
    const snap = await db.ref(path).once("value");
    if (!snap.exists()) {
      await db.ref(path).set(stripUndefinedDeep(signal));
      result.manufacturerSignalsCreated++;
      log?.debug("uas_patterns_pie_mfr_signal_created", {
        id,
        name: m.name,
      });
      continue;
    }
    const existing = snap.val() as Signal;
    if (existing.source?.hash === hash) {
      await db.ref(`${path}/source/refreshedAt`).set(fetchedAt);
      result.manufacturerSignalsUnchanged++;
      continue;
    }
    await db.ref(path).set(stripUndefinedDeep(signal));
    result.manufacturerSignalsUpdated++;
    log?.debug("uas_patterns_pie_mfr_signal_updated", {
      id,
      name: m.name,
    });
  }

  return result;
}

export async function upsertScenarioSignals(
  workspaceId: string,
  scenarios: PieScenario[],
  pageUrl: string,
  fetchedAt: number,
  confidence: number,
  log?: Logger,
  workspaceOrgIdsByName?: Map<string, string>
): Promise<{ created: number; updated: number; unchanged: number }> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const s of scenarios) {
    if (!s.name) continue;
    const id = scenarioSignalId(s);
    const hash = scenarioHash(s);

    // Build relatedIds via mention scan across scenario.disrupted[] +
    // description against the workspace's existing Org names. Bounded at
    // 6 to avoid relatedIds bloat on broadly-impacting scenarios.
    const relatedIds: string[] = [];
    if (workspaceOrgIdsByName && workspaceOrgIdsByName.size > 0) {
      const seen = new Set<string>();
      const haystack = (
        (s.description || "") +
        " " +
        (s.disrupted || []).join(" ") +
        " " +
        (s.mitigation || "")
      ).toLowerCase();
      for (const [orgName, orgId] of workspaceOrgIdsByName) {
        if (relatedIds.length >= 6) break;
        if (!orgName || orgName.length < 4) continue;
        if (haystack.indexOf(orgName.toLowerCase()) >= 0 && !seen.has(orgId)) {
          seen.add(orgId);
          relatedIds.push(orgId);
        }
      }
    }

    const provenance = externalProvenance(
      "uas_patterns_pie",
      s.id || s.name,
      pageUrl,
      hash,
      fetchedAt
    );

    const signal: Signal = {
      id,
      type: "supply_chain_scenario",
      subjectIds: [],
      relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
      occurredAt: fetchedAt,
      attrs: {
        scenarioId: s.id,
        title: s.name,
        probability: s.probability,
        description: s.description,
        disrupted: s.disrupted,
        leadOverrideWeeks: s.lead_override,
        recovery: s.recovery,
        mitigation: s.mitigation,
        confidence,
        sourceUrl: pageUrl,
      },
      source: provenance,
    };

    const path = wsPath(workspaceId, "signals", id);
    const snap = await db.ref(path).once("value");
    if (!snap.exists()) {
      await db.ref(path).set(stripUndefinedDeep(signal));
      created++;
      continue;
    }
    const existing = snap.val() as Signal;
    if (existing.source?.hash === hash) {
      await db.ref(`${path}/source/refreshedAt`).set(fetchedAt);
      unchanged++;
      continue;
    }
    await db.ref(path).set(stripUndefinedDeep(signal));
    updated++;
  }

  return { created, updated, unchanged };
}

/** Build a workspace-Orgs name → id map for the scenario mention scan.
 *  Loads /workspaces/{ws}/nodes once. Filtered to company/government
 *  type so we don't mention-match against person nodes. */
export async function loadWorkspaceOrgNameMap(
  workspaceId: string
): Promise<Map<string, string>> {
  const snap = await db.ref(wsPath(workspaceId, "nodes")).once("value");
  const nodes = (snap.val() as Record<
    string,
    { id?: string; name?: string; type?: string; alternateNames?: string[] }
  > | null) ?? {};
  const map = new Map<string, string>();
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || !node.name) continue;
    if (node.type && node.type !== "company" && node.type !== "government") {
      continue;
    }
    map.set(node.name, id);
    if (node.alternateNames) {
      for (const alt of node.alternateNames) {
        if (alt && alt.trim().length > 3) map.set(alt, id);
      }
    }
  }
  return map;
}
