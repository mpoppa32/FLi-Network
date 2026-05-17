// DSCA FMS — parsed notification → Signal mapper
//
// Per tier2-previews-v1 T2-2:
//   Notification → Signal type='fms_notification'
//   Linked entities:
//     - Foreign country → Organization (type='foreign_government', new)
//     - Prime contractor → Organization (existing pattern)
//
// Hash-based idempotency: same notification key (transmittal number +
// country + dollar) yields same Signal id; re-runs skip writes.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { ParsedFmsNotification } from "./parser";

function signalId(notification: ParsedFmsNotification): string {
  const tx = (notification.transmittalNumber || "no_tx").replace(/[^A-Za-z0-9]/g, "_");
  const country = (notification.country || "no_country").replace(/[^A-Za-z0-9]/g, "_").slice(0, 20);
  const dateBucket = notification.notificationDate
    ? Math.floor(notification.notificationDate / 86400000)
    : 0;
  return `sg_fms_${tx}_${country}_${dateBucket}`;
}

export interface FmsMapResult {
  action: "created" | "updated" | "unchanged" | "skipped_below_confidence";
  signalId: string | null;
  flags: string[];
}

export async function upsertFmsSignal(
  workspaceId: string,
  notification: ParsedFmsNotification,
  log?: Logger,
  options: { confidenceFloor?: number; countryFilter?: string[]; primeFilter?: string[] } = {}
): Promise<FmsMapResult> {
  const floor = options.confidenceFloor ?? 0.55;
  if (notification.confidence < floor) {
    return { action: "skipped_below_confidence", signalId: null, flags: ["below_floor"] };
  }

  // Apply optional country / prime filters
  if (options.countryFilter && options.countryFilter.length > 0) {
    const ok = options.countryFilter.some((c) =>
      notification.country.toLowerCase().indexOf(c.toLowerCase()) >= 0
    );
    if (!ok) return { action: "skipped_below_confidence", signalId: null, flags: ["country_filter"] };
  }
  if (options.primeFilter && options.primeFilter.length > 0 && notification.primeContractor) {
    const ok = options.primeFilter.some((p) =>
      (notification.primeContractor || "").toLowerCase().indexOf(p.toLowerCase()) >= 0
    );
    if (!ok) return { action: "skipped_below_confidence", signalId: null, flags: ["prime_filter"] };
  }

  // Resolve foreign country Organization (new entity type)
  const { orgId: countryOrgId } = await resolveRecipientOrg(
    workspaceId,
    notification.country,
    null,
    { autoCreate: true, type: "foreign_government" }
  );

  // Resolve prime contractor Org if known
  let primeOrgId: string | undefined;
  if (notification.primeContractor) {
    try {
      const { orgId } = await resolveRecipientOrg(
        workspaceId,
        notification.primeContractor,
        null,
        { autoCreate: true, type: "company" }
      );
      primeOrgId = orgId;
    } catch (e) {
      // continue without prime resolution
    }
  }

  const id = signalId(notification);
  const occurredAt = notification.notificationDate || Date.now();
  const hash = hashFields(
    {
      transmittalNumber: notification.transmittalNumber || "",
      country: notification.country,
      dollarValue: notification.dollarValue,
      platform: notification.platform.slice(0, 100),
    } as Record<string, unknown>,
    ["transmittalNumber", "country", "dollarValue", "platform"]
  );

  const provenance = externalProvenance(
    "dsca_fms",
    notification.transmittalNumber || notification.country,
    notification.detailUrl || "https://www.dsca.mil/press-media/major-arms-sales",
    hash,
    Date.now()
  );

  const subjectIds = [countryOrgId];
  if (primeOrgId) subjectIds.push(primeOrgId);

  const signal: Signal = {
    id,
    type: "fms_notification",
    subjectIds,
    relatedIds: [],
    occurredAt,
    attrs: {
      transmittalNumber: notification.transmittalNumber,
      country: notification.country,
      platform: notification.platform,
      dollarValue: notification.dollarValue,
      primeContractor: notification.primeContractor,
      isMde: notification.isMde,
      url: notification.detailUrl,
      flags: notification.flags,
      confidence: notification.confidence,
    },
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("dsca_fms_signal_created", {
      id,
      country: notification.country,
      transmittal: notification.transmittalNumber,
    });
    return { action: "created", signalId: id, flags: notification.flags };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", signalId: id, flags: notification.flags };
  }
  await db.ref(path).set(signal);
  return { action: "updated", signalId: id, flags: notification.flags };
}
