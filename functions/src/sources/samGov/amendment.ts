// SAM.gov v1.1 — amendment handling
//
// Per spec Part Three §3.4 + Part Four (Type M): when a type 'm' notice
// arrives that references a parent notice via relatedNotices, update the
// parent Opportunity in place rather than creating a new one:
//   - Increment amendmentNumber
//   - Append to relatedNotices[] with direction='amended_by'
//   - Update samgovResponseDeadline if changed; emit deadline-change Signal
//   - Append new attachments
//   - Extract Q&A from description; merge into qAndA[]
//   - Update samgovNoticeId to the latest amendment (so links go to current)
//   - Append deadlineHistory record on deadline change

import { db, wsPath } from "../../framework/rtdb";
import { externalProvenance } from "../../framework/provenance";
import { hashFields } from "../../framework/hashing";
import type { Logger } from "../../framework/logger";
import type { Opportunity, OpportunityRelatedNotice } from "../../framework/types/entities";
import type { Signal } from "../../framework/types/signals";
import type { SamOpportunity } from "./client";
import { extractQandA } from "./qaExtractor";

function parseDateMs(s: string | undefined | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export interface AmendmentHandleResult {
  action: "amendment_applied" | "amendment_no_parent" | "amendment_already_recorded" | "skipped_not_amendment";
  parentOppId?: string;
  amendmentNumber?: number;
  deadlineChanged?: boolean;
  qAndAExtracted?: number;
  signalsEmitted?: number;
  flags: string[];
}

function findParentNoticeId(notice: SamOpportunity): string | null {
  const related = notice.relatedNotices || [];
  for (const r of related) {
    // Most common: SAM puts the parent first or marks it via type
    if (r.noticeId && r.noticeId !== notice.noticeId) return r.noticeId;
  }
  return null;
}

/**
 * Locate the existing Opportunity for a parent notice in this workspace.
 * Returns null if no match.
 */
async function findOppByNoticeId(
  workspaceId: string,
  noticeId: string
): Promise<Opportunity | null> {
  // First try the canonical SAM ID pattern
  const canonicalId = "opp_sam_" + noticeId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50);
  const directSnap = await db.ref(wsPath(workspaceId, "opportunities", canonicalId)).once("value");
  if (directSnap.exists()) return directSnap.val() as Opportunity;
  // Fallback: scan opportunities for matching samgovNoticeId
  const allSnap = await db.ref(wsPath(workspaceId, "opportunities")).once("value");
  const all = (allSnap.val() as Record<string, Opportunity> | null) ?? {};
  for (const opp of Object.values(all)) {
    if (opp && opp.samgovNoticeId === noticeId) return opp;
  }
  return null;
}

/**
 * Process a type 'm' amendment notice. Returns result describing what changed.
 */
export async function handleAmendment(
  workspaceId: string,
  amendmentNotice: SamOpportunity,
  log?: Logger
): Promise<AmendmentHandleResult> {
  const type = (amendmentNotice.type || "").toLowerCase().slice(0, 1);
  if (type !== "m") return { action: "skipped_not_amendment", flags: ["not_type_m"] };

  const parentNoticeId = findParentNoticeId(amendmentNotice);
  if (!parentNoticeId) {
    log?.warn("samgov_amendment_no_parent", { amendmentNoticeId: amendmentNotice.noticeId });
    return { action: "amendment_no_parent", flags: ["no_parent_in_related_notices"] };
  }

  const parentOpp = await findOppByNoticeId(workspaceId, parentNoticeId);
  if (!parentOpp) {
    log?.warn("samgov_amendment_parent_not_in_workspace", {
      parentNoticeId,
      amendmentNoticeId: amendmentNotice.noticeId,
    });
    return { action: "amendment_no_parent", parentOppId: undefined, flags: ["parent_opp_not_found"] };
  }

  // Check if this amendment was already applied
  const existingRelated: OpportunityRelatedNotice[] = parentOpp.relatedNotices || [];
  if (existingRelated.some((r) => r.noticeId === amendmentNotice.noticeId)) {
    return {
      action: "amendment_already_recorded",
      parentOppId: parentOpp.id,
      flags: ["already_recorded"],
    };
  }

  // Compute new fields
  const now = Date.now();
  const newAmendmentNumber = (parentOpp.amendmentNumber || 0) + 1;
  const newRelated = [
    ...existingRelated,
    {
      noticeId: amendmentNotice.noticeId,
      type: amendmentNotice.type || "m",
      direction: "amended_by" as const,
    },
  ];

  const oldDeadlineMs = parentOpp.samgovResponseDeadline || 0;
  const newDeadlineMs = parseDateMs(amendmentNotice.responseDeadLine) || oldDeadlineMs;
  const deadlineChanged = oldDeadlineMs > 0 && newDeadlineMs !== oldDeadlineMs;

  // Append new attachments (dedupe by URL)
  const existingAttachments = parentOpp.attachments || [];
  const existingUrls = new Set(existingAttachments.map((a) => a.resourceUrl));
  const newAttachments = (amendmentNotice.resourceLinks || [])
    .filter((url) => !existingUrls.has(url))
    .map((url) => ({ resourceUrl: url, observedAt: now }));
  const mergedAttachments = [...existingAttachments, ...newAttachments];

  // Extract Q&A from amendment description
  const description = (amendmentNotice.description as string) || "";
  const qaResult = extractQandA(description, now, amendmentNotice.noticeId);
  // Merge into existing qAndA (dedupe by questionNumber)
  const existingQA = parentOpp.qAndA || [];
  const qaByNum = new Map(existingQA.map((q) => [q.questionNumber, q]));
  for (const q of qaResult.entries) qaByNum.set(q.questionNumber, q);
  const mergedQA = Array.from(qaByNum.values()).sort((a, b) => a.questionNumber - b.questionNumber);

  // Deadline history
  const deadlineHistory = parentOpp.deadlineHistory || [];
  if (deadlineChanged && newDeadlineMs > 0) {
    deadlineHistory.push({ deadline: newDeadlineMs, recordedAt: now });
  }

  // Apply update
  const updates: Record<string, unknown> = {
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "amendmentNumber")}`]: newAmendmentNumber,
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "relatedNotices")}`]: newRelated,
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "attachments")}`]: mergedAttachments,
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "qAndA")}`]: mergedQA,
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "updatedAt")}`]: new Date(now).toISOString(),
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "samgovNoticeId")}`]: amendmentNotice.noticeId,
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "samgovUiLink")}`]: amendmentNotice.uiLink || parentOpp.samgovUiLink,
    [`${wsPath(workspaceId, "opportunities", parentOpp.id, "isLatestVersion")}`]: true,
  };
  if (deadlineChanged) {
    updates[`${wsPath(workspaceId, "opportunities", parentOpp.id, "samgovResponseDeadline")}`] = newDeadlineMs;
    updates[`${wsPath(workspaceId, "opportunities", parentOpp.id, "deadlineHistory")}`] = deadlineHistory;
  }
  await db.ref().update(updates);

  // Emit Signals
  let signalsEmitted = 0;
  // 1. opportunity_amendment Signal (always)
  const amendmentSignalId = `sig_amend_${amendmentNotice.noticeId.replace(/[^A-Za-z0-9]/g, "_").slice(0, 50)}`;
  const amendmentSig: Signal = {
    id: amendmentSignalId,
    type: "opportunity_amendment",
    subjectIds: [parentOpp.id],
    relatedIds: parentOpp.customerOrgId ? [parentOpp.customerOrgId] : [],
    occurredAt: parseDateMs(amendmentNotice.postedDate) || now,
    attrs: {
      parentNoticeId,
      amendmentNoticeId: amendmentNotice.noticeId,
      amendmentNumber: newAmendmentNumber,
      changes: [
        ...(deadlineChanged
          ? [{ field: "responseDeadline", before: oldDeadlineMs, after: newDeadlineMs }]
          : []),
        ...(newAttachments.length > 0
          ? [{ field: "attachments_added", before: existingAttachments.length, after: mergedAttachments.length }]
          : []),
        ...(qaResult.entries.length > 0
          ? [{ field: "qAndA_added", before: existingQA.length, after: mergedQA.length }]
          : []),
      ],
    },
    source: externalProvenance(
      "sam_gov",
      amendmentNotice.noticeId,
      amendmentNotice.uiLink || null,
      hashFields(
        { amendmentNoticeId: amendmentNotice.noticeId, amendmentNumber: newAmendmentNumber },
        ["amendmentNoticeId", "amendmentNumber"]
      ),
      now
    ),
  };
  await db.ref(wsPath(workspaceId, "signals", amendmentSignalId)).set(amendmentSig);
  signalsEmitted++;

  // 2. opportunity_deadline_extended / advanced Signal if deadline changed
  if (deadlineChanged) {
    const advanced = newDeadlineMs < oldDeadlineMs;
    const deadlineSignalId = `sig_deadline_${amendmentNotice.noticeId.replace(/[^A-Za-z0-9]/g, "_").slice(0, 40)}`;
    const deadlineSig: Signal = {
      id: deadlineSignalId,
      type: advanced ? "opportunity_deadline_advanced" : "opportunity_deadline_extended",
      subjectIds: [parentOpp.id],
      relatedIds: parentOpp.customerOrgId ? [parentOpp.customerOrgId] : [],
      occurredAt: parseDateMs(amendmentNotice.postedDate) || now,
      attrs: {
        parentNoticeId,
        amendmentNoticeId: amendmentNotice.noticeId,
        oldDeadline: oldDeadlineMs,
        newDeadline: newDeadlineMs,
        deltaDays: Math.round((newDeadlineMs - oldDeadlineMs) / 86400000),
      },
      source: externalProvenance(
        "sam_gov",
        amendmentNotice.noticeId,
        amendmentNotice.uiLink || null,
        hashFields({ d: newDeadlineMs, o: oldDeadlineMs }, ["d", "o"]),
        now
      ),
    };
    await db.ref(wsPath(workspaceId, "signals", deadlineSignalId)).set(deadlineSig);
    signalsEmitted++;
  }

  log?.info("samgov_amendment_applied", {
    parentOppId: parentOpp.id,
    amendmentNoticeId: amendmentNotice.noticeId,
    amendmentNumber: newAmendmentNumber,
    deadlineChanged,
    qaExtracted: qaResult.entries.length,
    signalsEmitted,
  });

  return {
    action: "amendment_applied",
    parentOppId: parentOpp.id,
    amendmentNumber: newAmendmentNumber,
    deadlineChanged,
    qAndAExtracted: qaResult.entries.length,
    signalsEmitted,
    flags: qaResult.flags,
  };
}
