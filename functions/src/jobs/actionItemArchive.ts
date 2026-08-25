/**
 * ACTION-ITEM COMPLETION + ARCHIVE FIELDS — the schema that did not exist.
 *
 * Found 2026-08-11 by the staleness audit (corsair-staleness-inventory-v1.md):
 * all 359 action items in Atlas carried exactly `context, deadline, owner,
 * priority, task`. No `done`. No `status`. No `archivedAt`. Three consequences,
 * and the third is why this module exists before any sweep runs:
 *
 *   1. `isOpenActionItem`'s `!a.done` test could never be true-negative. It is
 *      correct code that excluded zero records — every action item in the
 *      workspace was permanently "open".
 *   2. The operator had no way to mark one finished. Not a UI gap on top of a
 *      working model: there was no field to write.
 *   3. So "43 items are 42-105 days overdue" did NOT mean 43 abandoned tasks.
 *      An unknown share are simply done, with nowhere to say so. Sweeping them
 *      as stale would have archived completed work and called it cleanup.
 *
 * This module adds the three fields as a POLICY, purely: `done` (boolean),
 * `archivedAt` (ISO string), `archivedNote` (string). Additive only — nothing
 * migrates, nothing is deleted, and an item that carries none of them behaves
 * exactly as it did before.
 *
 * DO NOT REPEAT (LOG 2026-08-11): before building a rule that selects on a
 * state, verify the schema can REPRESENT that state.
 */

export const ACTION_ITEM_OVERDUE_DAYS = 21;
const DAY_MS = 86400000;

/**
 * Strict ISO date reader. **This function deliberately never calls
 * `Date.parse`.**
 *
 * `Date.parse` does not reject free text, it INVENTS dates. Measured on Node
 * v24 (V8), not assumed: "Phase 1" -> 2001-01-01, "Phase 2" -> 2001-02-01,
 * "Phase 1-2" -> 2001-01-02, "Friday April 25" -> 2001-04-25. It seizes on any
 * number it can read as a year and defaults the rest — so a PHASE LABEL
 * becomes a date a quarter-century in the past, which is worse than NaN
 * because it is silently plausible. Run against this
 * field that is not a rare edge — 282 of 359 Atlas action-item deadlines are
 * free transcript text ("Ongoing", "TBD", "Upon contract signing") — and the
 * first pass of the audit duly reported "Phase 1" as 9,352 days overdue,
 * sorted to the very top of the list because fabricated dates are the most
 * extreme. Eleven of an apparent 54 matches were parser fabrications.
 *
 * So: match the shape, extract the digits, and build the timestamp from the
 * numbers. Anything that is not a real calendar date in `YYYY-MM-DD` form
 * returns null and is treated as UNDATED by every caller. A trailing time or
 * human annotation is tolerated ("2026-05-01 (same day, in car)" — four such
 * records exist) because only the leading ten characters are ever read.
 *
 * @returns epoch ms at UTC midnight, or null when the value is not a date.
 */
export function parseIsoDate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  // Rejects impossible calendar dates that Date.UTC silently rolls over
  // (2026-02-31 -> March 3). A date that is not the date it claims to be is
  // not a date we will archive an operator's work on.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/**
 * "A date is in there, and this rule will not guess what it MEANS."
 *
 * The counterpart to `parseIsoDate`'s refusal, and the reason it exists:
 * refusing to guess is correct, but a refusal nobody is told about is a silent
 * permanent exclusion — the exact failure class the last two weeks were spent
 * killing. `parseIsoDate` returning null has two very different causes and they
 * must not be reported as one:
 *
 *   - `"Ongoing"`, `"TBD"`, `"Upon contract signing"`, `""` — there is nothing
 *     to guess AT. The transcript never carried a date. **Not counted here.**
 *   - `"Before 2026-09-17"`, `"Week of 2026-08-03"`, `"~2026-07-27"`,
 *     `"During Camp Grayling event (2026-06-06 through ~2026-06-27)"` — a real
 *     date is present and its ROLE requires reading the prose around it: a
 *     bound, a week, an approximation, a range. **Counted here**, 19 of 359 on
 *     Atlas as of 2026-08-12, of which 8 look overdue.
 *
 * "Look overdue" is deliberately not asserted anywhere in this module, and this
 * function deliberately does not return a date. Deciding those 8 ARE overdue
 * would mean picking which embedded date is the deadline — the same guess the
 * sweep refuses. The split is: a loose scan may decide whether to SHOW an item
 * to Mike; only `parseIsoDate` may decide whether to ARCHIVE one. Surfacing is
 * reversible by reading; archiving writes.
 */
export function hasUnguessableDeadline(item: unknown): boolean {
  const a = item as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return false;
  const raw = String(a.deadline ?? "").trim();
  if (!raw) return false;
  if (parseIsoDate(raw) !== null) return false;
  // Date-SHAPED, not date-valid: "2026-13-45" lands here too, and should — a
  // deadline that looks like a date and is not one is precisely a thing to put
  // in front of a human rather than resolve in code.
  return /\d{4}-\d{2}-\d{2}/.test(raw);
}

/**
 * The one wording of the refusal disclosure, shared by every surface that states it.
 *
 * ONE DEFINITION, DELIBERATELY. The daily brief renders this line in both MIME
 * parts and the sweep manifest generator prints it in its console summary — three
 * places, and until now the digest built the sentence inline. Two near-identical
 * strings in two files is precisely the shape LOG 2026-08-12 caught on the sweep
 * selector ("if you find yourself writing the rule twice, the second copy is the
 * bug"): they do not drift loudly, they drift one word at a time until the brief
 * and the audit artifact describe the same number differently.
 *
 * Lives HERE rather than in `dailyBriefDigest.ts` for one mechanical reason: this
 * module imports nothing, so a plain `node` script can require the compiled
 * `lib/jobs/actionItemArchive.js` without dragging in `firebase-admin` and the
 * Gmail sender. The digest already imports from here; the edge is one-directional.
 *
 * `sep` exists because the HTML twin uses "·" where the plaintext uses an em dash.
 */
export function unguessableDeadlineNotice(n: number, sep = "—"): string {
  return n === 1
    ? `1 action item has a deadline this rule will not guess at ${sep} review in Corsair`
    : `${n} action items have deadlines this rule will not guess at ${sep} review in Corsair`;
}

export interface ActionItemStaleDecision {
  stale: boolean;
  /** Whole days past `deadline`; null when undated or unreadable. */
  overdueDays: number | null;
  /** Why it was spared — for logging and the manifest, never for control flow. */
  reason: string;
}

/**
 * The whole action-item sweep policy, as one pure function. No database, no
 * clock of its own — `now` is injected so tests are deterministic. Same shape
 * and same fail-safe direction as `commitmentsAutoArchive.isStale`.
 *
 * FAIL-SAFE: anything not positively established as stale is LEFT ALONE.
 * Sparing a stale item costs a stale row in the brief; archiving a live one
 * removes real work from the operator's view. Note in particular that an
 * UNDATED item is spared here — unlike the commitment rule, where "old and
 * never scheduled" is the primary target. Action-item deadlines are extracted
 * prose, so "undated" overwhelmingly means "the transcript said 'Ongoing'",
 * not "nobody scheduled it".
 */
export function isStaleActionItem(item: unknown, now: number): ActionItemStaleDecision {
  const a = item as Record<string, unknown> | null;
  if (!a || typeof a !== "object") {
    return { stale: false, overdueDays: null, reason: "not_an_object" };
  }
  // Idempotence, and the reason this module ships before the sweep: an item
  // already marked done or already archived is never swept again. A second run
  // archives zero and throws nothing.
  if (a.done === true) {
    return { stale: false, overdueDays: null, reason: "done" };
  }
  if (a.archivedAt !== undefined && a.archivedAt !== null && String(a.archivedAt).trim() !== "") {
    return { stale: false, overdueDays: null, reason: "already_archived" };
  }

  const deadlineMs = parseIsoDate(a.deadline);
  if (deadlineMs === null) {
    // Free text ("Phase 1", "Ongoing", "TBD") or missing. NEVER swept — see
    // parseIsoDate. This is 79% of the field and it is a capture problem in
    // the ingest, queued separately (LOG 2026-08-11).
    return { stale: false, overdueDays: null, reason: "undated_or_free_text" };
  }
  const overdueDays = Math.floor((now - deadlineMs) / DAY_MS);
  if (overdueDays > ACTION_ITEM_OVERDUE_DAYS) {
    return { stale: true, overdueDays, reason: "overdue_past_threshold" };
  }
  return { stale: false, overdueDays, reason: "within_threshold" };
}

/**
 * The note written onto every swept record.
 *
 * States the rule, the date, the authority, and how to reverse it — in the
 * record itself, so a future session reading the DATA rather than the docs
 * cannot mistake this for a judgement that the work was abandoned. It is not:
 * with no completion field before today, a swept item may simply have been
 * finished with nowhere to say so. The note says time-based, deliberately.
 *
 * `today` is injected rather than read from a clock, same as `now` above.
 */
export function actionItemArchiveNote(d: ActionItemStaleDecision, today: string): string {
  const overdue = d.overdueDays === null ? "no readable deadline" : `${d.overdueDays}d overdue`;
  return (
    `Archived ${today} by the ${ACTION_ITEM_OVERDUE_DAYS}-day overdue rule ` +
    `(${overdue}; Mike's authorization, 2026-08-11). Time-based, not a finding ` +
    `that the work was abandoned. Reversible: clear archivedAt.`
  );
}
