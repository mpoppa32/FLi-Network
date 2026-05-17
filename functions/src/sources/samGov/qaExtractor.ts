// SAM.gov v1.1 — Q&A log extractor
//
// Per spec Part Six §6.4: when a type 'm' amendment description contains a
// Q&A log, extract structured entries into `Opportunity.qAndA[]`. v1
// supports the most common format: numbered Q/A pairs.
//
// Example format the parser handles:
//   "Q1: Will small businesses be eligible?
//    A1: Yes, this requirement is a 100% small business set-aside.
//    Q2: When will the technical library be available?
//    A2: The library will be posted by July 15, 2026."
//
// Confidence: per spec SIQ-4, entries below confidence floor are skipped.

import type { OpportunityQAEntry } from "../../framework/types/entities";

const QA_PATTERN = /\bQ\.?\s*(\d{1,3})\s*[:.\-]?\s*([\s\S]*?)\bA\.?\s*\1\s*[:.\-]?\s*([\s\S]*?)(?=(?:\bQ\.?\s*\d|\Z))/gi;

export const QA_CONFIDENCE_FLOOR = 0.5;

export interface QaExtractResult {
  entries: OpportunityQAEntry[];
  totalCandidates: number;
  flags: string[];
}

/**
 * Extract Q&A pairs from amendment description text. Each entry carries an
 * implicit confidence based on length + structure. Returns an empty array
 * if no recognizable Q&A pattern is present.
 */
export function extractQandA(
  text: string,
  issuedAt: number,
  sourceAmendmentId?: string
): QaExtractResult {
  const flags: string[] = [];
  const entries: OpportunityQAEntry[] = [];
  let totalCandidates = 0;
  if (!text || text.length < 20) {
    return { entries, totalCandidates: 0, flags: ["empty_or_short_text"] };
  }

  QA_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QA_PATTERN.exec(text)) !== null) {
    totalCandidates++;
    const num = Number(m[1]);
    const question = (m[2] || "").trim().slice(0, 2000);
    const answer = (m[3] || "").trim().slice(0, 4000);
    if (!question || !answer) continue;
    // Confidence heuristic: short Q or A are weak signals
    let confidence = 0.5;
    if (question.length > 20) confidence += 0.2;
    if (answer.length > 30) confidence += 0.2;
    if (/[.!?]$/.test(answer)) confidence += 0.1;
    if (confidence < QA_CONFIDENCE_FLOOR) {
      flags.push(`skip_low_confidence_${num}`);
      continue;
    }
    entries.push({
      questionNumber: num,
      question,
      answer,
      issuedAt,
      sourceAmendmentId,
    });
  }

  if (entries.length === 0 && totalCandidates === 0) {
    flags.push("no_q_a_pattern_found");
  }

  // Dedupe by questionNumber, keep latest
  const byNum = new Map<number, OpportunityQAEntry>();
  for (const e of entries) byNum.set(e.questionNumber, e);
  return {
    entries: Array.from(byNum.values()).sort((a, b) => a.questionNumber - b.questionNumber),
    totalCandidates,
    flags,
  };
}
