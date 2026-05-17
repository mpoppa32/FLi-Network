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
