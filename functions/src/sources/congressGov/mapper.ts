// Congress.gov source — Hearing → Signal mapper (V1)

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import { hashFields } from "../../framework/hashing";
import { resolveRecipientOrg } from "../usaSpending/orgResolver";
import type { Signal } from "../../framework/types/signals";
import type { CommitteeMeetingDetail } from "./client";

/** Strip military rank / honorific prefixes for Person resolution. */
export function normalizeWitnessName(name: string): string {
  return String(name)
    .replace(/^(Hon\.?|Gen\.?|Adm\.?|Lt\.?\s*Gen\.?|Maj\.?\s*Gen\.?|Brig\.?\s*Gen\.?|VAdm\.?|RAdm\.?|Capt\.?|Col\.?|Lt\.?\s*Col\.?|Maj\.?|Cmdr\.?|Mr\.?|Ms\.?|Mrs\.?|Dr\.?)\s+/i, "")
    .replace(/\s*(Jr\.?|Sr\.?|II|III|IV|USAF\s*\(Ret\.\)|USA\s*\(Ret\.\)|USN\s*\(Ret\.\)|USMC\s*\(Ret\.\))\s*$/i, "")
    .trim();
}

export async function mapHearingDetailToSignal(
  workspaceId: string,
  congress: number,
  chamber: "house" | "senate" | "joint",
  detail: CommitteeMeetingDetail
): Promise<Signal | null> {
  const m = detail.committeeMeeting;
  if (!m) return null;

  const occurredAt = m.date ? Date.parse(m.date) : Date.now();
  const committees = m.committees || [];
  const witnesses = (m.witnesses || []) as Array<{ name: string; position?: string; organization?: string }>;

  // Resolve committee Organizations (one or more)
  const subjectIds: string[] = [];
  for (const c of committees) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, c.name, null, {
        autoCreate: true,
        type: "committee",
      });
      subjectIds.push(orgId);
    } catch (e) {
      // continue if resolve fails
    }
  }

  // Resolve witness Persons
  const witnessRefs: Array<{
    name: string;
    title: string;
    organization?: string;
    personId?: string;
  }> = [];
  const relatedIds: string[] = [];
  for (const w of witnesses) {
    const cleanName = normalizeWitnessName(w.name);
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, cleanName, null, {
        autoCreate: true,
        // Persons are stored as nodes with type=person in existing schema, but
        // we use 'company' or 'other' fallback for witness orgs since our
        // orgResolver doesn't distinguish persons yet. For V1 we record the
        // witness in signal attrs only; full Person-entity wiring is V1.1.
        type: "other",
      });
      relatedIds.push(orgId);
      witnessRefs.push({
        name: cleanName,
        title: w.position || "",
        organization: w.organization,
        personId: orgId,
      });
    } catch (e) {
      witnessRefs.push({
        name: cleanName,
        title: w.position || "",
        organization: w.organization,
      });
    }
  }

  const signalId = "sg_cg_h_" + congress + "_" + chamber + "_" + m.eventId;
  const hash = hashFields(
    {
      eventId: m.eventId,
      title: m.title || "",
      witnessCount: witnesses.length,
      date: m.date || "",
    } as unknown as Record<string, unknown>,
    ["eventId", "title", "witnessCount", "date"]
  );

  const signal: Signal = {
    id: signalId,
    type: "congressional_hearing",
    subjectIds,
    relatedIds,
    occurredAt: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
    attrs: {
      congress,
      chamber,
      committeeCode: committees[0]?.systemCode || "",
      committeeName: committees[0]?.name || "",
      title: m.title || "Committee Meeting",
      hearingNumber: String(m.eventId),
      witnesses: witnessRefs,
      transcriptUrl: m.videos?.[0]?.url || null,
      documentUrls: [],
      bills: (m.related?.bills || []).map((b) => `${b.congress}_${b.type}_${b.number}`),
      meetingStatus: m.meetingStatus,
      meetingType: m.type,
    },
    source: externalProvenance(
      "congress_gov",
      `committee-meeting/${congress}/${chamber}/${m.eventId}`,
      `https://www.congress.gov/event/${congress}/${chamber}/${m.eventId}`,
      hash,
      Date.now()
    ),
  };

  return signal;
}

export async function upsertSignal(
  workspaceId: string,
  signal: Signal
): Promise<{ action: "created" | "updated" | "unchanged"; signalId: string }> {
  const path = wsPath(workspaceId, "signals", signal.id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    return { action: "created", signalId: signal.id };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash && existing.source.hash === signal.source.hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return { action: "unchanged", signalId: signal.id };
  }
  await db.ref(path).set(signal);
  return { action: "updated", signalId: signal.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.1: Nominations
// ─────────────────────────────────────────────────────────────────────────────

import type { NominationDetail, BillListItem, BillActionsResponse } from "./client";

function buildNomineeName(n: { firstName?: string; middleName?: string; lastName?: string }): string {
  return [n.firstName, n.middleName, n.lastName].filter(Boolean).join(" ").trim();
}

/**
 * Decide if a nomination is defense-relevant based on operator's tracked
 * categories. Returns true if any category keyword appears in the
 * organization or position string.
 */
export function isDefenseRelevantNomination(
  detail: NominationDetail,
  trackedCategories: string[]
): boolean {
  if (!trackedCategories || trackedCategories.length === 0) return true;
  const nominees = detail.nomination.nominees || [];
  for (const n of nominees) {
    const haystack = `${n.organization || ""} ${n.position || ""}`.toLowerCase();
    for (const cat of trackedCategories) {
      if (haystack.indexOf(cat.toLowerCase()) >= 0) return true;
    }
  }
  return false;
}

export async function mapNominationToSignal(
  workspaceId: string,
  detail: NominationDetail
): Promise<Signal | null> {
  const n = detail.nomination;
  if (!n || !n.number) return null;

  const nominees = n.nominees || [];
  if (nominees.length === 0) return null;

  const primaryNominee = nominees[0];
  const nomineeName = buildNomineeName(primaryNominee);
  if (!nomineeName) return null;

  const receivedAt = n.receivedDate ? Date.parse(n.receivedDate) : Date.now();
  const confirmedAt = n.confirmDate ? Date.parse(n.confirmDate) : undefined;
  const targetOrgName = primaryNominee.organization || "Federal Government";

  // Resolve nominee Person + target Org
  const { orgId: targetOrgId } = await resolveRecipientOrg(workspaceId, targetOrgName, null, {
    autoCreate: true,
    type: "government",
  });
  const { orgId: nomineeOrgId } = await resolveRecipientOrg(workspaceId, nomineeName, null, {
    autoCreate: true,
    type: "other",
  });

  const signalId = "sg_cg_nom_" + n.congress + "_" + n.number;
  const hash = hashFields(
    {
      congress: n.congress,
      number: n.number,
      receivedAt,
      status: n.latestAction?.text || "",
      confirmedAt: confirmedAt || 0,
    } as Record<string, unknown>,
    ["congress", "number", "receivedAt", "status", "confirmedAt"]
  );

  const status: "pending" | "confirmed" | "returned" | "withdrawn" = confirmedAt
    ? "confirmed"
    : /returned/i.test(n.latestAction?.text || "")
    ? "returned"
    : /withdrawn/i.test(n.latestAction?.text || "")
    ? "withdrawn"
    : "pending";

  const signal: Signal = {
    id: signalId,
    type: "nomination",
    subjectIds: [nomineeOrgId, targetOrgId],
    relatedIds: [],
    occurredAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
    attrs: {
      congress: n.congress,
      nominationNumber: n.number,
      nomineeName,
      position: primaryNominee.position || "(unspecified)",
      targetOrgName,
      receivedAt,
      committeeName: n.committees?.[0]?.name,
      confirmedAt,
      status,
      isCivilian: n.isCivilian !== false,
      isPrivileged: !!n.isPrivileged,
      actionTimeline: n.latestAction
        ? [{ actionDate: Date.parse(n.latestAction.actionDate || "") || 0, text: n.latestAction.text || "" }]
        : [],
    },
    source: externalProvenance(
      "congress_gov",
      `nomination/${n.congress}/${n.number}`,
      `https://www.congress.gov/nomination/${n.congress}th-congress/${n.number}`,
      hash,
      Date.now()
    ),
  };
  return signal;
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.1: Bill action signals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a bill action to a Signal. We emit one Signal per *latest* action to
 * avoid Signal-explosion on bills with long action histories. The signal's
 * hash includes the actionDate so a new action causes a new Signal version.
 */
export async function mapBillToActionSignal(
  workspaceId: string,
  bill: BillListItem,
  actionsResponse: BillActionsResponse | null
): Promise<Signal | null> {
  const latestAction = actionsResponse?.actions?.[0] || bill.latestAction;
  if (!latestAction) return null;
  const occurredAt = Date.parse(latestAction.actionDate || "") || Date.now();

  // Resolve a committee Org if action mentions one
  let committeeOrgId: string | undefined;
  const committee = (actionsResponse?.actions?.[0] as any)?.committee;
  if (committee && committee.name) {
    try {
      const { orgId } = await resolveRecipientOrg(workspaceId, committee.name, null, {
        autoCreate: true,
        type: "committee",
      });
      committeeOrgId = orgId;
    } catch (e) {
      // ignore
    }
  }

  const signalId = "sg_cg_bill_" + bill.congress + "_" + bill.type + "_" + bill.number;
  const actionDateMs = Date.parse(latestAction.actionDate || "") || 0;
  const hash = hashFields(
    {
      congress: bill.congress,
      billType: bill.type,
      number: bill.number,
      actionDate: actionDateMs,
      actionText: (latestAction.text || "").slice(0, 200),
    } as Record<string, unknown>,
    ["congress", "billType", "number", "actionDate", "actionText"]
  );

  const billLabel = `${bill.type.toUpperCase()} ${bill.number} (${bill.congress}th)`;
  const signal: Signal = {
    id: signalId,
    type: "congressional_bill_action",
    subjectIds: committeeOrgId ? [committeeOrgId] : [],
    relatedIds: [],
    occurredAt: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
    attrs: {
      congress: bill.congress,
      billType: bill.type,
      billNumber: bill.number,
      billLabel,
      title: bill.title || "",
      actionDate: actionDateMs,
      actionText: latestAction.text || "",
      committeeName: committee?.name,
      committeeSystemCode: committee?.systemCode,
      url: `https://www.congress.gov/bill/${bill.congress}th-congress/${bill.type}-bill/${bill.number}`,
    },
    source: externalProvenance(
      "congress_gov",
      `bill/${bill.congress}/${bill.type}/${bill.number}`,
      `https://www.congress.gov/bill/${bill.congress}th-congress/${bill.type}-bill/${bill.number}`,
      hash,
      Date.now()
    ),
  };
  return signal;
}

/**
 * Filter bills by operator keyword list (substring on title).
 * Empty keyword list = no filter (returns all).
 */
export function bilMatchesKeywords(bill: BillListItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const title = (bill.title || "").toLowerCase();
  for (const k of keywords) {
    if (k && title.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}
