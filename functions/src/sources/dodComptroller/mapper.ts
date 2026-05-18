// DoD Comptroller — PE entry → Signal mapper (v1.0)
//
// Each parsed program element becomes one budget_change Signal scoped to
// (workspace, service, PE, fiscalYear, bookType). v1.0 emits baselines —
// attrs.baseline:true — since we don't yet have prior-year data to diff
// against. v1.1 will populate attrs.deltaFromPriorYear and the Signal type
// keeps the same shape.

import { createHash } from "crypto";

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import { SERVICE_LABELS, type BudgetBookType, type ServiceSlug } from "./config";
import type { ParsedProgramElement } from "./budgetParser";

function signalId(workspaceId: string, service: string, pe: string, fy: string, bookType: string): string {
  // Deterministic per (service, PE, FY, bookType) so re-ingestion is idempotent
  const basis = [service, pe, fy, bookType].join(":");
  const hash = createHash("sha1").update(basis).digest("hex").slice(0, 24);
  return "sig_budget_" + hash;
}

/** Approximate publication date for a fiscal year — the President's
 *  Budget for FYYYYY typically drops in February/March of the prior
 *  calendar year. So PB FY2026 → March 2025. */
function approximatePublicationDate(fy: string): number {
  const n = parseInt(fy, 10);
  if (!Number.isFinite(n)) return Date.now();
  // FY starts Oct 1 of the prior calendar year, PB typically drops Mar of
  // the same calendar year as FY's Oct start — so PB FY2026 → March 2025.
  // Use March 15 as the centerpoint.
  return Date.UTC(n - 1, 2, 15);
}

export interface BudgetPeUpsertContext {
  workspaceId: string;
  service: ServiceSlug;
  fiscalYear: string;
  bookType: BudgetBookType;
  bookUrl: string;
  bookFilename: string;
}

export interface BudgetPeUpsertResult {
  signalId: string;
  action: "created" | "updated" | "unchanged";
  serviceOrgResolved: boolean;
  durationMs: number;
}

export async function upsertBudgetPeSignal(
  ctx: BudgetPeUpsertContext,
  pe: ParsedProgramElement,
  log?: Logger
): Promise<BudgetPeUpsertResult> {
  const startedAt = Date.now();
  const id = signalId(ctx.workspaceId, ctx.service, pe.pe, ctx.fiscalYear, ctx.bookType);
  const serviceLabel = SERVICE_LABELS[ctx.service];
  const occurredAt = approximatePublicationDate(ctx.fiscalYear);

  const subjectIds: string[] = [];
  let serviceOrgResolved = false;

  // Resolve the service as a government Org so the Brief scorer can match
  // tracked-customer agencies against this PE Signal.
  try {
    const { orgId } = await resolveRecipientOrg(ctx.workspaceId, serviceLabel, null, {
      autoCreate: true,
      type: "government",
    });
    subjectIds.push(orgId);
    serviceOrgResolved = true;
  } catch (e) {
    log?.debug("dod_comptroller_service_resolve_failed", {
      service: ctx.service,
      message: (e as Error).message,
    });
  }

  const attrs: Record<string, unknown> = {
    pe: pe.pe,
    title: pe.title,
    narrative: pe.narrative,
    exhibit: pe.exhibit,
    service: ctx.service,
    serviceLabel,
    bookType: ctx.bookType,
    fiscalYear: ctx.fiscalYear,
    bookUrl: ctx.bookUrl,
    bookFilename: ctx.bookFilename,
    baseline: true,
    deepParsingPending: true, // FY funding tables land in v1.1
    extractedAt: Date.now(),
  };

  const hash = hashFields(
    {
      pe: pe.pe,
      title: pe.title || "",
      service: ctx.service,
      fiscalYear: ctx.fiscalYear,
      bookType: ctx.bookType,
      bookUrl: ctx.bookUrl,
      narrativeHash: pe.narrative
        ? createHash("sha1").update(pe.narrative).digest("hex").slice(0, 16)
        : "",
    } as Record<string, unknown>,
    ["pe", "title", "service", "fiscalYear", "bookType", "bookUrl", "narrativeHash"]
  );

  const provenance = externalProvenance(
    "dod_comptroller",
    `${ctx.service}:${pe.pe}:${ctx.fiscalYear}:${ctx.bookType}`,
    ctx.bookUrl,
    hash,
    Date.now()
  );

  const signal: Signal = {
    id,
    type: "budget_change",
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
    log?.debug("dod_comptroller_signal_created", {
      id,
      pe: pe.pe,
      service: ctx.service,
      fy: ctx.fiscalYear,
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
    serviceOrgResolved,
    durationMs: Date.now() - startedAt,
  };
}
