// Corsair — extractionEval: does the extraction actually match what was said?
//
// WHY THIS EXISTS.
// CLAUDE.md Rule 2 is NO FUDGE FACTORS and Rule 8 is TEST BEFORE "DONE", and
// until now neither had an instrument pointed at the thing this system is
// actually made of. Every meeting is turned into structured intel by a model,
// and nothing has ever checked whether that intel is FAITHFUL to the source.
// A model upgrade could have silently degraded every extraction in the corpus
// and the only symptom would be worse decisions six months later.
//
// The 2026-08-31 metrics run made the gap concrete from a second direction:
// 591 Atlas meetings produced 300 action items — half a commitment per meeting.
// Either extraction is dropping them or those meetings genuinely produced none,
// and NOTHING IN THE SYSTEM CAN TELL YOU WHICH.
//
// WHY THIS IS NOT A HAND-LABELLED GOLDEN SET.
// The classic design — 20-30 transcripts with expected outputs written by hand —
// has been "the cheapest quality win on the page" since 2026-08-06 and has never
// been started, because it needs hours of the one person whose time is the
// bottleneck. This grades REFERENCE-FREE instead: the grader reads the source
// notes and the extraction together and scores FIDELITY, which needs no labels,
// scales to all 591 records rather than 30, and measures the failure this system
// demonstrably has rather than a generic notion of quality.
//
// A hand-verified golden set still emerges — as a BYPRODUCT. Any extraction that
// scores clean and is confirmed once by a human becomes a regression case.
//
// THE FIVE CHECKS ARE NOT GENERIC. Each is a failure this corpus actually made:
//   1. fabricatedPeople     — "never promote a proper noun from a summary" is a
//                             standing rule because a name with no primary source
//                             has been written as live fact more than once.
//   2. fabricatedCompanies  — same rule, and a company name once entered the
//                             record from a single garbled mid-sentence phrase.
//   3. unsupportedDeadlines — a date the model supplied rather than heard is
//                             worse than no date: it enters the commitment
//                             tracker and drives a decision.
//   4. missedCommitments    — the coverage half. 591 meetings → 300 action items
//                             is either this or nothing, and nobody knows.
//   5. quoteFidelity        — a paraphrase presented as a quotation is the exact
//                             defect the source-fidelity lens exists to catch.
//
// THE GRADER IS A DIFFERENT MODEL FROM THE EXTRACTOR, DELIBERATELY.
// Extraction runs on Sonnet; grading runs on Opus. A model grading its own
// output shares its own blind spots — the 2026-08-30 adversarial run measured
// this directly: two lenses ran the same weak control, agreed with each other,
// and were both wrong, while the one lens forced to work differently caught it.
// LENS DIVERSITY, NOT VERIFIER COUNT, IS WHAT CATCHES ERROR.
//
// This module is PURE — no Firebase, no network, no secrets — so the scoring
// contract can be tested without invoking anything. All IO lives in
// `http/triggerExtractionEval.ts`. Same split as the archive selector, and for
// the same reason: a rule you cannot test in isolation is a rule you will not
// test at all.

/** The grader model. MUST be in anthropicProxy's ALLOWED_MODELS — imported
 *  there rather than re-listed, because a second copy of an allow-list is how
 *  the two drift apart and the "second copy is the bug." */
export const GRADER_MODEL = "claude-opus-4-7";

/** Hard bounds. Every one exists so a run cannot become an unbounded bill.
 *  "Hard caps, not hope" is itself a hope until it carries an integer. */
export const EVAL_LIMITS = {
  /** Meetings graded per invocation. */
  meetingsDefault: 10,
  meetingsCap: 40,
  /** Source notes handed to the grader. Truncation is DISCLOSED to the grader
   *  so it never scores a "missed" commitment that was simply cut off. */
  notesChars: 24000,
  /** Extraction JSON handed to the grader. */
  intelChars: 12000,
  /** Grader response budget. */
  maxTokens: 4000,
} as const;

/** Penalty per finding and the cap on each check's total damage. Fabrication is
 *  weighted worst because a false claim with a confident shape stops every later
 *  reader from checking — the same reason a false [V] outranks a fabrication
 *  under [U]. Caps exist so one catastrophic meeting cannot make the corpus
 *  average meaningless. */
export const PENALTIES = {
  fabricatedPeople: { each: 15, cap: 45 },
  fabricatedCompanies: { each: 10, cap: 30 },
  unsupportedDeadlines: { each: 10, cap: 30 },
  quoteFidelity: { each: 15, cap: 30 },
  missedCommitments: { each: 5, cap: 25 },
} as const;

export type CheckName = keyof typeof PENALTIES;
export const CHECK_NAMES = Object.keys(PENALTIES) as CheckName[];

export interface Finding {
  /** What the extraction asserted, or what the notes contained that was missed. */
  claim: string;
  /** Quoted from the source, or an explicit statement that the source is silent.
   *  A finding without this is an opinion and is discarded. */
  evidence: string;
}

export interface CheckResult {
  findings: Finding[];
}

export type Checks = Record<CheckName, CheckResult>;

export interface GraderVerdict {
  checks: Checks;
  /** The grader's own one-line read. Never used in scoring — scoring is
   *  arithmetic over findings, so the number cannot drift with the prose. */
  note: string;
}

export interface ScoredExtraction extends GraderVerdict {
  score: number;
  verdict: "PASS" | "WEAK" | "FAIL";
  counts: Record<CheckName, number>;
}

/**
 * Arithmetic over findings. Deliberately NOT asked of the model: a grader that
 * reports both the evidence and the grade can quietly reconcile the two, and
 * then the score stops being a function of the evidence. The model finds; the
 * code scores.
 */
export function scoreFromChecks(checks: Checks): { score: number; counts: Record<CheckName, number> } {
  const counts = {} as Record<CheckName, number>;
  let penalty = 0;
  for (const name of CHECK_NAMES) {
    // A finding with no evidence is not a finding. Same rule as everywhere else.
    const valid = (checks[name]?.findings ?? []).filter(
      (f) => f && typeof f.evidence === "string" && f.evidence.trim().length > 0
    );
    counts[name] = valid.length;
    const p = PENALTIES[name];
    penalty += Math.min(valid.length * p.each, p.cap);
  }
  return { score: Math.max(0, 100 - penalty), counts };
}

export function verdictFor(score: number): ScoredExtraction["verdict"] {
  if (score >= 85) return "PASS";
  if (score >= 60) return "WEAK";
  return "FAIL";
}

/**
 * Which meetings to grade next. Never-scored first, then oldest score first, so
 * a repeated run walks the corpus instead of re-grading the same head. Meetings
 * with no notes are skipped entirely — grading fidelity against an absent source
 * would score the grader's imagination, and would silently post a perfect 100.
 */
export function selectMeetingsToScore(
  meetings: Record<string, any>,
  alreadyScored: Record<string, { scoredAt?: string } | undefined>,
  limit: number
): string[] {
  const candidates = Object.keys(meetings).filter((id) => {
    const m = meetings[id] || {};
    if (m.archivedAt) return false;
    if (/^\s*AUDIT TEST\b/i.test(String(m?.meta?.title ?? ""))) return false;
    // `notes` is a TOP-LEVEL field on the meeting record, not `intel.notes`.
    // v1 of this file read `intel.notes` — a path I assumed rather than checked,
    // and it matched nothing in 591 records. Verified against the live schema
    // 2026-08-31: a hand-logged record is
    //   {ts, loggedByUid, id, meta, intel, loggedBy, notes, oppId}
    // while an auto-captured stub is {autoCapture, source, ts, approvedAt, id,
    // meta, intel} with intel = {summary} alone and NO notes at all. The stubs
    // are calendar/email captures that never had a transcript, so excluding them
    // is correct — there is genuinely no source to grade against.
    return String(m?.notes ?? "").trim().length > 200;
  });

  candidates.sort((a, b) => {
    const sa = alreadyScored[a]?.scoredAt ?? "";
    const sb = alreadyScored[b]?.scoredAt ?? "";
    if (!sa && sb) return -1;
    if (sa && !sb) return 1;
    return sa.localeCompare(sb);
  });

  return candidates.slice(0, Math.max(0, limit));
}

/** Truncation is stated in the payload, never hidden. A grader that cannot see
 *  the end of the notes must not be allowed to report a missed commitment it
 *  simply never read. */
export function clip(s: unknown, max: number): { text: string; truncated: boolean } {
  const t = String(s ?? "");
  return t.length <= max ? { text: t, truncated: false } : { text: t.slice(0, max), truncated: true };
}

export const GRADER_SYSTEM = `You are an adversarial grader for a defense business-development intelligence system. You are given the RAW SOURCE NOTES from a meeting and the STRUCTURED EXTRACTION a different model produced from them. Your job is to find every place the extraction says something the source does not support, or misses something the source clearly states.

YOUR STANCE IS SKEPTICAL. You are not assessing whether the extraction reads well. You are checking whether it is FAITHFUL. Plausibility is not evidence.

THE FIVE CHECKS:

1. fabricatedPeople — a person named in the extraction who does not appear in the source notes. Nicknames, partial names and obvious transcription variants of a person who IS present do not count; a wholly new individual does.

2. fabricatedCompanies — an organisation named in the extraction that does not appear in the source notes. Same tolerance for variants.

3. unsupportedDeadlines — an action-item deadline the source does not state or clearly imply. A date the extractor supplied rather than heard is worse than no date, because it enters a commitment tracker and drives a decision. "Next week" supporting a concrete date is fine; silence is not.

4. missedCommitments — a clear commitment, deliverable or owed action stated in the source that does not appear in the extraction's action items. Only obvious ones. Do NOT invent borderline cases to look thorough.

5. quoteFidelity — text presented in the extraction as a quotation that is not verbatim in the source.

RULES THAT DECIDE WHETHER YOUR OUTPUT IS USABLE:
- EVERY finding MUST carry evidence quoted from the source, or an explicit statement that the source is silent on it. A finding without evidence is discarded before it is scored, so an unevidenced finding is wasted work.
- If the source was truncated, you will be told so. NEVER report a missedCommitment when the notes were cut off — you cannot see what you were not given.
- Finding nothing is a valid and common result. An empty findings array is a real answer. Do not manufacture findings to appear rigorous; a false finding here corrupts the same quality record it exists to protect.
- Do not score. Do not total anything. Report findings only — the arithmetic is done outside you, deliberately, so your prose cannot drift the number.

Return ONLY a JSON object, no prose before or after, no markdown fence:
{"checks":{"fabricatedPeople":{"findings":[{"claim":"...","evidence":"..."}]},"fabricatedCompanies":{"findings":[]},"unsupportedDeadlines":{"findings":[]},"missedCommitments":{"findings":[]},"quoteFidelity":{"findings":[]}},"note":"one line"}`;

export function buildGraderUserMessage(args: {
  notes: string;
  notesTruncated: boolean;
  intelJson: string;
  intelTruncated: boolean;
  title: string;
}): string {
  return [
    `MEETING: ${args.title || "(untitled)"}`,
    "",
    args.notesTruncated
      ? "=== SOURCE NOTES (TRUNCATED — the end is missing. Do NOT report missedCommitments.) ==="
      : "=== SOURCE NOTES (complete) ===",
    args.notes,
    "",
    args.intelTruncated
      ? "=== STRUCTURED EXTRACTION (truncated) ==="
      : "=== STRUCTURED EXTRACTION ===",
    args.intelJson,
  ].join("\n");
}

/**
 * Parse the grader's reply. Throws LOUDLY rather than returning a default —
 * a malformed grader response that silently becomes "no findings" would post a
 * perfect score for an ungraded meeting, which is precisely the confident false
 * pass this whole module exists to prevent.
 */
export function parseGraderResponse(raw: string): GraderVerdict {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Grader returned an empty response.");

  // Tolerate a fenced block; refuse anything else. A regex-scavenged JSON blob
  // from arbitrary prose is a guess, and a guess here becomes a quality metric.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();

  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    throw new Error(`Grader response was not JSON: ${(e as Error).message}. First 200 chars: ${candidate.slice(0, 200)}`);
  }
  if (!parsed || typeof parsed !== "object" || !parsed.checks || typeof parsed.checks !== "object") {
    throw new Error("Grader response has no `checks` object.");
  }

  const checks = {} as Checks;
  for (const name of CHECK_NAMES) {
    const rawFindings = parsed.checks[name]?.findings;
    if (rawFindings !== undefined && !Array.isArray(rawFindings)) {
      throw new Error(`Grader check "${name}" has findings that are not an array.`);
    }
    checks[name] = {
      findings: (rawFindings ?? [])
        .filter((f: any) => f && typeof f === "object")
        .map((f: any) => ({ claim: String(f.claim ?? "").trim(), evidence: String(f.evidence ?? "").trim() })),
    };
  }
  return { checks, note: String(parsed.note ?? "").trim() };
}

/** Full pipeline over one grader reply: parse, score, classify. */
export function gradeFromResponse(raw: string): ScoredExtraction {
  const v = parseGraderResponse(raw);
  const { score, counts } = scoreFromChecks(v.checks);
  return { ...v, score, verdict: verdictFor(score), counts };
}

/** Corpus rollup. Reports the DISTRIBUTION, not just a mean — an average of 88
 *  made of mostly-100s and two catastrophic 20s is a different corpus from one
 *  where everything sits at 88, and only one of those has a fixable problem. */
export function rollup(scores: ScoredExtraction[]): {
  n: number;
  meanScore: number | null;
  medianScore: number | null;
  pass: number;
  weak: number;
  fail: number;
  totalsByCheck: Record<CheckName, number>;
  worstScore: number | null;
} {
  const n = scores.length;
  const totalsByCheck = {} as Record<CheckName, number>;
  for (const c of CHECK_NAMES) totalsByCheck[c] = 0;
  for (const s of scores) for (const c of CHECK_NAMES) totalsByCheck[c] += s.counts[c] ?? 0;

  if (n === 0) {
    return { n: 0, meanScore: null, medianScore: null, pass: 0, weak: 0, fail: 0, totalsByCheck, worstScore: null };
  }
  const sorted = scores.map((s) => s.score).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    n,
    meanScore: Math.round((sorted.reduce((a, b) => a + b, 0) / n) * 10) / 10,
    medianScore: sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    pass: scores.filter((s) => s.verdict === "PASS").length,
    weak: scores.filter((s) => s.verdict === "WEAK").length,
    fail: scores.filter((s) => s.verdict === "FAIL").length,
    totalsByCheck,
    worstScore: sorted[0],
  };
}
