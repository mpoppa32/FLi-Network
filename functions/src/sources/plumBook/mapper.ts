// Plum Book / FVRA — vacancy → Signal mapper
//
// Each parsed vacancy entry becomes one vacancy_alert Signal scoped to
// (workspace, agency, position, reportGuid). Agency auto-resolved as a
// government Org (subjectIds).
//
// v1.1: acting officials, when designated, are resolved as Persons via
// framework/personResolver and linked to the agency via an acting_at
// Edge. Cross-source dedupe collapses the same acting official with
// other Person nodes (faca members, senate_lda lobbyists, advisory_boards
// members).

import { createHash } from "crypto";

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import { resolvePersonByName } from "../../framework/personResolver";
import type { ParsedVacancy } from "./vacancyParser";

interface PlumBookEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  dir: "to" | "from" | "both";
  attrs?: Record<string, unknown>;
}

function signalId(reportGuid: string, agency: string, position: string): string {
  const basis = [reportGuid, agency, position].join("::");
  const hash = createHash("sha1").update(basis).digest("hex").slice(0, 24);
  return "sig_vacancy_" + hash;
}

export interface VacancyUpsertContext {
  workspaceId: string;
  reportGuid: string;
  reportUrl: string;
  reportDate: number | null;
}

export interface VacancyUpsertResult {
  signalId: string;
  action: "created" | "updated" | "unchanged";
  agencyOrgResolved: boolean;
  /** v1.1: whether an acting-official Person was resolved (created or
   *  matched). */
  actingOfficialPersonResolved: boolean;
  /** v1.1: whether the acting_at Edge was upserted. */
  actingAtEdgeUpserted: boolean;
  durationMs: number;
}

export async function upsertVacancySignal(
  ctx: VacancyUpsertContext,
  vacancy: ParsedVacancy,
  log?: Logger
): Promise<VacancyUpsertResult> {
  const startedAt = Date.now();
  const agency = vacancy.agency || "Unknown Agency";
  const id = signalId(ctx.reportGuid, agency, vacancy.position);
  const occurredAt =
    vacancy.vacantSinceMs ?? ctx.reportDate ?? Date.now();

  const subjectIds: string[] = [];
  const relatedIds: string[] = [];
  let agencyOrgResolved = false;
  let actingOfficialPersonResolved = false;
  let actingAtEdgeUpserted = false;
  let agencyOrgId: string | null = null;

  // Resolve the agency as a government Org so Brief scoring + the
  // entity graph treat this vacancy as touching a customer agency
  if (vacancy.agency) {
    try {
      const { orgId } = await resolveRecipientOrg(ctx.workspaceId, vacancy.agency, null, {
        autoCreate: true,
        type: "government",
      });
      agencyOrgId = orgId;
      subjectIds.push(orgId);
      agencyOrgResolved = true;
    } catch (e) {
      log?.debug("plum_book_agency_resolve_failed", {
        agency: vacancy.agency,
        message: (e as Error).message,
      });
    }
  }

  // v1.1: resolve the acting official (when designated) as a Person via
  // the cross-source personResolver. Upsert acting_at Edge to the
  // agency Org so the entity graph surfaces "who is currently acting at
  // this position" as a first-class relationship rather than a string
  // buried in attrs.
  let actingPersonId: string | null = null;
  if (vacancy.actingOfficial) {
    try {
      const personProvenance = externalProvenance(
        "plum_book",
        `acting:${vacancy.agency || "_unknown_"}:${vacancy.actingOfficial}`,
        null,
        null,
        Date.now()
      );
      const r = await resolvePersonByName(ctx.workspaceId, vacancy.actingOfficial, {
        autoCreate: true,
        role: vacancy.position
          ? `Acting ${vacancy.position}`
          : "Acting official",
        org: vacancy.agency || undefined,
        provenance: personProvenance,
      });
      actingPersonId = r.personId;
      actingOfficialPersonResolved = true;
      relatedIds.push(actingPersonId);
    } catch (e) {
      log?.debug("plum_book_acting_person_resolve_failed", {
        actingOfficial: vacancy.actingOfficial,
        message: (e as Error).message,
      });
    }
  }

  // v1.1: upsert acting_at Edge from acting Person to agency Org
  if (actingPersonId && agencyOrgId) {
    try {
      const eId =
        "edge_plum_acting_" +
        actingPersonId.slice(0, 24) +
        "__" +
        agencyOrgId.slice(0, 24);
      const edgePath = wsPath(ctx.workspaceId, "edges", eId);
      const edgeAttrs: Record<string, unknown> = {
        position: vacancy.position,
        daysVacant: vacancy.daysVacant,
        pastStatutoryLimit: vacancy.pastStatutoryLimit,
        vacantSince: vacancy.vacantSinceMs,
        lastSeenOnReport: ctx.reportGuid,
        lastSeenAt: Date.now(),
      };
      const edge: PlumBookEdge = {
        id: eId,
        source: actingPersonId,
        target: agencyOrgId,
        label: "acting_at",
        dir: "to",
        attrs: edgeAttrs,
      };
      const edgeSnap = await db.ref(edgePath).once("value");
      if (!edgeSnap.exists()) {
        await db.ref(edgePath).set(edge);
      } else {
        const existing = edgeSnap.val() as PlumBookEdge;
        const mergedAttrs = { ...(existing.attrs || {}), ...edgeAttrs };
        await db.ref(edgePath).set({ ...existing, attrs: mergedAttrs });
      }
      actingAtEdgeUpserted = true;
    } catch (e) {
      log?.debug("plum_book_acting_at_edge_failed", {
        message: (e as Error).message,
      });
    }
  }

  const attrs: Record<string, unknown> = {
    position: vacancy.position,
    agency: vacancy.agency,
    actingOfficial: vacancy.actingOfficial,
    actingOfficialPersonId: actingPersonId,
    daysVacant: vacancy.daysVacant,
    vacantSince: vacancy.vacantSinceMs,
    pastStatutoryLimit: vacancy.pastStatutoryLimit,
    reportUrl: ctx.reportUrl,
    reportDate: ctx.reportDate,
    extractedAt: Date.now(),
  };

  const hash = hashFields(
    {
      position: vacancy.position,
      agency,
      actingOfficial: vacancy.actingOfficial || "",
      daysVacant: vacancy.daysVacant ?? 0,
      pastStatutoryLimit: vacancy.pastStatutoryLimit ? 1 : 0,
      reportGuid: ctx.reportGuid,
    } as Record<string, unknown>,
    [
      "position",
      "agency",
      "actingOfficial",
      "daysVacant",
      "pastStatutoryLimit",
      "reportGuid",
    ]
  );

  const provenance = externalProvenance(
    "plum_book",
    `${ctx.reportGuid}:${agency}:${vacancy.position}`,
    ctx.reportUrl,
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "vacancy_alert",
    subjectIds,
    relatedIds,
    occurredAt,
    attrs,
    source: provenance,
  };

  const path = wsPath(ctx.workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  let action: "created" | "updated" | "unchanged";
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("plum_book_signal_created", {
      id,
      agency,
      position: vacancy.position.slice(0, 80),
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

  return {
    signalId: id,
    action,
    agencyOrgResolved,
    actingOfficialPersonResolved,
    actingAtEdgeUpserted,
    durationMs: Date.now() - startedAt,
  };
}
