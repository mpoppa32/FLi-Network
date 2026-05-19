// FACA source — record → entity mapper
//
// Schema mapping per tier2-previews-v1 T2-1:
//   Committee record    → Organization with type:'committee' + committeeAttrs
//   Member record       → Person + 'member_of' Edge (Person → committee Org)
//   Meeting record      → Signal with type:'committee_meeting'

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import type { Logger } from "../../framework/logger";
import type { Organization, Edge } from "../../framework/types/entities";
import type { Signal } from "../../framework/types/signals";
import { resolvePersonByName } from "../../framework/personResolver";
import type { FacaCommitteeRecord, FacaMemberRecord, FacaMeetingRecord } from "./client";

function parseDateMs(s: string | undefined | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function normalizeName(name: string): string {
  return String(name).toLowerCase().replace(/[,.]/g, "").replace(/\s+/g, " ").trim();
}

/** Compute a stable ID prefix for FACA entities. */
function committeeId(facaId: string | number): string {
  return "org_faca_" + String(facaId).replace(/[^A-Za-z0-9]/g, "_").slice(0, 40);
}
function personId(facaMemberId: string | number, fullName: string): string {
  const safe = String(facaMemberId || normalizeName(fullName)).replace(/[^A-Za-z0-9]/g, "_").slice(0, 40);
  return "pers_faca_" + safe;
}
function meetingSignalId(facaMeetingId: string | number, committeeId: string | number): string {
  return "sig_faca_meet_" + String(committeeId).replace(/[^A-Za-z0-9]/g, "_") + "_" + String(facaMeetingId).replace(/[^A-Za-z0-9]/g, "_").slice(0, 30);
}
function membershipEdgeId(committeeOrgId: string, personOrgId: string): string {
  return "edge_faca_" + committeeOrgId.slice(0, 24) + "__" + personOrgId.slice(0, 24);
}

/**
 * Map a FACA Committee record to a Corsair Organization (type: committee).
 * Upserts to RTDB; preserves operator-input fields.
 */
export async function upsertCommittee(
  workspaceId: string,
  record: FacaCommitteeRecord,
  log?: Logger
): Promise<{ orgId: string; action: "created" | "updated" | "unchanged" }> {
  const facaId = String(record.committeeId ?? record.id ?? "");
  if (!facaId) throw new Error("FACA committee record has no id");
  const orgId = committeeId(facaId);
  const name = (record.name as string) || "Unnamed FACA Committee";
  const acronym = (record.acronym as string) || "";

  const committeeAttrs = {
    charter: (record.charterUrl as string) || (record.charter as string) || undefined,
    meetingFreq: (record.meetingFrequency as string) || undefined,
    publicReports: true,
  };

  const hash = hashFields(
    {
      name,
      acronym,
      agencyName: (record.agencyName as string) || "",
      charter: committeeAttrs.charter || "",
      status: (record.status as string) || "",
    } as Record<string, unknown>,
    ["name", "acronym", "agencyName", "charter", "status"]
  );

  const now = Date.now();
  const url = (record.committeeUrl as string) || null;
  const provenance = externalProvenance("faca", facaId, url, hash, now);

  const path = wsPath(workspaceId, "nodes", orgId);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    const org: Organization = {
      id: orgId,
      type: "committee",
      name,
      alternateNames: acronym ? [acronym] : undefined,
      autoCreated: true,
      created: new Date().toISOString(),
      committeeAttrs,
      notes: (record.description as string) || undefined,
      source: provenance,
    };
    await db.ref(path).set(org);
    log?.debug("faca_committee_created", { orgId, name });
    return { orgId, action: "created" };
  }
  const existing = snap.val() as Organization;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(now);
    return { orgId, action: "unchanged" };
  }
  // Update — preserve operator-input fields
  const merged: Organization = {
    ...existing,
    type: "committee",
    name,
    alternateNames: existing.alternateNames || (acronym ? [acronym] : undefined),
    committeeAttrs: { ...existing.committeeAttrs, ...committeeAttrs },
    source: provenance,
  };
  await db.ref(path).set(merged);
  log?.debug("faca_committee_updated", { orgId, name });
  return { orgId, action: "updated" };
}

/**
 * Map a FACA Member record to a Corsair Person + member_of Edge.
 * Upserts both. Person UEI/state fields not populated by FACA — left empty.
 */
export async function upsertMember(
  workspaceId: string,
  committeeOrgId: string,
  record: FacaMemberRecord,
  log?: Logger
): Promise<{ personId: string; edgeId: string; action: "created" | "updated" | "unchanged" }> {
  const fullName = (record.fullName as string)
    || [(record.firstName as string) || "", (record.lastName as string) || ""].filter(Boolean).join(" ").trim()
    || "Unnamed Member";
  const facaMemberId = String(record.memberId ?? record.id ?? normalizeName(fullName));
  const preferredId = personId(facaMemberId, fullName);

  const hash = hashFields(
    {
      fullName,
      title: (record.title as string) || "",
      affiliation: (record.affiliation as string) || "",
      start: parseDateMs((record.startDate as string) || ""),
      end: parseDateMs((record.endDate as string) || ""),
    } as Record<string, unknown>,
    ["fullName", "title", "affiliation", "start", "end"]
  );

  const now = Date.now();
  const provenance = externalProvenance("faca", facaMemberId, null, hash, now);

  // v1.2: route Person upsert through framework/personResolver for
  // cross-source dedupe. A FACA member who also appears in senate_lda
  // (revolving-door lobbyist) / advisory_boards (board member) /
  // plum_book (acting official) collapses to one Person node carrying
  // all outbound Edges across sources.
  const r = await resolvePersonByName(workspaceId, fullName, {
    autoCreate: true,
    preferredId,
    role: (record.title as string) || undefined,
    org: (record.affiliation as string) || undefined,
    provenance,
  });
  const pId = r.personId;
  const eId = membershipEdgeId(committeeOrgId, pId);
  const personAction: "created" | "updated" | "unchanged" = r.created
    ? "created"
    : "unchanged";

  // Upsert Edge (member_of)
  const edgePath = wsPath(workspaceId, "edges", eId);
  const edge: Edge = {
    id: eId,
    source: pId,
    target: committeeOrgId,
    label: "member_of",
    dir: "to",
    start: parseDateMs((record.startDate as string) || "") || undefined,
    end: parseDateMs((record.endDate as string) || "") || undefined,
    attrs: {
      title: (record.title as string) || undefined,
      appointmentType: (record.appointmentType as string) || undefined,
      affiliation: (record.affiliation as string) || undefined,
      sourceSystem: "faca",
    },
  };
  await db.ref(edgePath).set(edge);

  log?.debug("faca_member_upsert", { personId: pId, edgeId: eId, action: personAction });
  return { personId: pId, edgeId: eId, action: personAction };
}

/**
 * Map a FACA Meeting record to a Signal of type committee_meeting.
 * Upserts; signals are content-hash idempotent.
 */
export async function upsertMeetingSignal(
  workspaceId: string,
  committeeOrgId: string,
  facaCommitteeId: string | number,
  record: FacaMeetingRecord,
  log?: Logger
): Promise<{ signalId: string; action: "created" | "updated" | "unchanged" }> {
  const facaMeetingId = String(record.meetingId ?? record.id ?? "");
  if (!facaMeetingId) throw new Error("FACA meeting record has no id");
  const sigId = meetingSignalId(facaMeetingId, facaCommitteeId);
  const meetingDate = parseDateMs((record.meetingDate as string) || "") || Date.now();
  const title = (record.title as string) || "Committee Meeting";
  const location = (record.location as string) || "";
  const agendaUrl = (record.agendaUrl as string) || null;
  const minutesUrl = (record.minutesUrl as string) || null;
  const openToPublic = record.openToPublic !== false;

  const hash = hashFields(
    {
      title,
      meetingDate,
      location,
      agendaUrl: agendaUrl || "",
      minutesUrl: minutesUrl || "",
      openToPublic: !!openToPublic,
    } as Record<string, unknown>,
    ["title", "meetingDate", "location", "agendaUrl", "minutesUrl", "openToPublic"]
  );

  const now = Date.now();
  const provenance = externalProvenance(
    "faca",
    facaMeetingId,
    minutesUrl || agendaUrl || null,
    hash,
    now
  );

  const path = wsPath(workspaceId, "signals", sigId);
  const snap = await db.ref(path).once("value");

  const signal: Signal = {
    id: sigId,
    type: "committee_meeting",
    subjectIds: [committeeOrgId],
    occurredAt: meetingDate,
    attrs: {
      title,
      location,
      agendaUrl: agendaUrl || undefined,
      minutesUrl: minutesUrl || undefined,
      openToPublic,
      status: (record.status as string) || undefined,
    },
    source: provenance,
  };

  if (!snap.exists()) {
    await db.ref(path).set(signal);
    return { signalId: sigId, action: "created" };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(now);
    return { signalId: sigId, action: "unchanged" };
  }
  await db.ref(path).set(signal);
  return { signalId: sigId, action: "updated" };
}
