// Plum Book / FVRA — vacancy → Signal mapper (v1.0)
//
// Each parsed vacancy entry becomes one vacancy_alert Signal scoped to
// (workspace, agency, position, reportGuid). Agency auto-resolved as a
// government Org (subjectIds). Acting official name stored in attrs;
// Person resolution deferred to v1.1.

import { createHash } from "crypto";

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { ParsedVacancy } from "./vacancyParser";

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
  let agencyOrgResolved = false;

  // Resolve the agency as a government Org so Brief scoring + the
  // entity graph treat this vacancy as touching a customer agency
  if (vacancy.agency) {
    try {
      const { orgId } = await resolveRecipientOrg(ctx.workspaceId, vacancy.agency, null, {
        autoCreate: true,
        type: "government",
      });
      subjectIds.push(orgId);
      agencyOrgResolved = true;
    } catch (e) {
      log?.debug("plum_book_agency_resolve_failed", {
        agency: vacancy.agency,
        message: (e as Error).message,
      });
    }
  }

  const attrs: Record<string, unknown> = {
    position: vacancy.position,
    agency: vacancy.agency,
    actingOfficial: vacancy.actingOfficial,
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
    relatedIds: [],
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
    durationMs: Date.now() - startedAt,
  };
}
