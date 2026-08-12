import { describe, it, expect } from "vitest";
import {
  parseIsoDate,
  isStaleActionItem,
  actionItemArchiveNote,
  ACTION_ITEM_OVERDUE_DAYS,
} from "./actionItemArchive";

const NOW = Date.UTC(2026, 7, 12); // 2026-08-12
const DAY = 86400000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════
// THE REGRESSION THIS WHOLE MODULE EXISTS FOR.
//
// Date.parse() does not reject free text, it invents dates. The first pass of
// the 2026-08-11 audit used it and reported "Phase 1" as 9,352 days overdue —
// sorted to the top of the list, because fabricated dates are the most
// extreme. 282 of 359 Atlas deadlines are free transcript text, so this is the
// common case, not an edge. If parseIsoDate ever starts accepting these, a
// sweep archives an operator's live work on a date V8 made up.
// ═══════════════════════════════════════════════════════════════════════════
describe("parseIsoDate — Date.parse must never adjudicate this field", () => {
  it("Date.parse really does fabricate a date for 'Phase 1' (the hazard, pinned)", () => {
    // Documents WHY the strict parser exists. If this ever stops being true the
    // comment in actionItemArchive.ts is stale, and we should know.
    //
    // Measured, not assumed — the first write-up of this finding claimed V8
    // resolved "Phase 1" to year 0001. It does not: it reads the "1" as a YEAR
    // and defaults the rest, giving 2001-01-01. The 9,352-day figure was right
    // and the explanation was wrong, which is its own small lesson about
    // asserting a mechanism you have not executed.
    const fabricated = Date.parse("Phase 1");
    expect(Number.isFinite(fabricated)).toBe(true);
    expect(new Date(fabricated).getUTCFullYear()).toBe(2001);
    // …which is how ~9,350 days overdue happened:
    expect(Math.floor((NOW - fabricated) / DAY)).toBeGreaterThan(9000);
  });

  it("fabricates for the whole 'Phase N' family, each a different wrong date", () => {
    // Not one quirky string — a systematic misread of a common label shape.
    expect(new Date(Date.parse("Phase 2")).toISOString().slice(0, 10)).toBe("2001-02-01");
    expect(new Date(Date.parse("Phase 1-2")).toISOString().slice(0, 10)).toBe("2001-01-02");
    expect(new Date(Date.parse("Friday April 25")).toISOString().slice(0, 10)).toBe("2001-04-25");
  });

  it("returns null for 'Phase 1' rather than a fabricated 2001 date", () => {
    expect(parseIsoDate("Phase 1")).toBeNull();
  });

  it("returns null for every free-text deadline shape seen in live data", () => {
    const real = [
      "Phase 1", "Phase 1-2", "Phase 2", "Phase 2 / concurrent with first shipments",
      "Ongoing", "TBD", "TBD post-seed", "Near-term", "Near-term, before raise launch",
      "Before agreements are signed", "Upon contract signing", "Pre-seed close",
      "First 30 days", "First weeks on contract", "Immediate — Day 1 priority",
      "Friday April 25", "April 27, 2026", "Ongoing from April 27, 2026",
      "Immediately / by June 7", "Pending Tom's strategic direction",
      "Before April 27, 2026 execution", "Post-seed round", "Pre-first shipment",
    ];
    for (const v of real) {
      expect(parseIsoDate(v), `${v} must not parse`).toBeNull();
    }
  });

  it("returns null for empty, missing and non-string values", () => {
    for (const v of ["", "   ", null, undefined, 0, 42, {}, [], true]) {
      expect(parseIsoDate(v as unknown)).toBeNull();
    }
  });

  it("accepts a plain ISO date at UTC midnight", () => {
    expect(parseIsoDate("2026-04-28")).toBe(Date.UTC(2026, 3, 28));
  });

  it("accepts an ISO date carrying a time or a human annotation, reading only the date", () => {
    // Four such records exist in Atlas, e.g. "2026-05-01 (same day, in car)".
    expect(parseIsoDate("2026-05-01 (same day, in car)")).toBe(Date.UTC(2026, 4, 1));
    expect(parseIsoDate("2026-06-04 (tomorrow per Rick)")).toBe(Date.UTC(2026, 5, 4));
    expect(parseIsoDate("2026-04-28T09:30:00Z")).toBe(Date.UTC(2026, 3, 28));
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(parseIsoDate("2026-02-31")).toBeNull();   // Date.UTC would give Mar 3
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-00-10")).toBeNull();
  });

  it("rejects a date that merely CONTAINS an ISO date", () => {
    expect(parseIsoDate("Tonight (2026-04-20)")).toBeNull();
    expect(parseIsoDate("due by 2026-04-20")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("isStaleActionItem — fail-safe policy", () => {
  it("sweeps an item more than 21 days overdue", () => {
    const d = isStaleActionItem({ deadline: daysAgo(22), task: "t" }, NOW);
    expect(d.stale).toBe(true);
    expect(d.overdueDays).toBe(22);
    expect(d.reason).toBe("overdue_past_threshold");
  });

  it("spares an item exactly at the threshold — the rule is strictly greater", () => {
    const d = isStaleActionItem({ deadline: daysAgo(ACTION_ITEM_OVERDUE_DAYS) }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("within_threshold");
  });

  it("spares an item one day inside the threshold, and sweeps one day outside", () => {
    expect(isStaleActionItem({ deadline: daysAgo(21) }, NOW).stale).toBe(false);
    expect(isStaleActionItem({ deadline: daysAgo(22) }, NOW).stale).toBe(true);
  });

  it("spares a future deadline", () => {
    const future = new Date(NOW + 10 * DAY).toISOString().slice(0, 10);
    const d = isStaleActionItem({ deadline: future }, NOW);
    expect(d.stale).toBe(false);
    expect(d.overdueDays).toBe(-10);
  });

  it("NEVER sweeps a free-text deadline, however old the meeting", () => {
    for (const v of ["Phase 1", "Ongoing", "TBD", "Upon contract signing"]) {
      const d = isStaleActionItem({ deadline: v }, NOW);
      expect(d.stale, `${v} must be spared`).toBe(false);
      expect(d.reason).toBe("undated_or_free_text");
    }
  });

  it("spares an undated item — unlike the commitment rule, where undated is the target", () => {
    expect(isStaleActionItem({ task: "no deadline at all" }, NOW).stale).toBe(false);
    expect(isStaleActionItem({ deadline: "" }, NOW).reason).toBe("undated_or_free_text");
  });

  it("spares a non-object", () => {
    for (const v of [null, undefined, "x", 7]) {
      expect(isStaleActionItem(v as unknown, NOW).stale).toBe(false);
    }
  });

  // ── idempotence: a second run must archive zero and throw nothing ──
  it("never re-sweeps an item already marked done", () => {
    const d = isStaleActionItem({ deadline: daysAgo(100), done: true }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("done");
  });

  it("never re-sweeps an item already archived", () => {
    const d = isStaleActionItem(
      { deadline: daysAgo(100), archivedAt: "2026-08-12T00:00:00.000Z" }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("already_archived");
  });

  it("is idempotent end to end: sweep, apply, re-run, zero selected", () => {
    const items = [
      { deadline: daysAgo(105), task: "a" },
      { deadline: daysAgo(60), task: "b" },
      { deadline: daysAgo(3), task: "c" },
      { deadline: "Phase 1", task: "d" },
    ];
    const firstPass = items.filter((i) => isStaleActionItem(i, NOW).stale);
    expect(firstPass).toHaveLength(2);

    const applied = items.map((i) =>
      isStaleActionItem(i, NOW).stale
        ? { ...i, archivedAt: "2026-08-12T00:00:00.000Z", archivedNote: "n", done: false }
        : i);
    const secondPass = applied.filter((i) => isStaleActionItem(i, NOW).stale);
    expect(secondPass).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("actionItemArchiveNote", () => {
  it("states the rule, the days overdue, the date, the authority and the reversal", () => {
    const note = actionItemArchiveNote(
      { stale: true, overdueDays: 105, reason: "overdue_past_threshold" }, "2026-08-12");
    expect(note).toContain("21-day overdue rule");
    expect(note).toContain("105d overdue");
    expect(note).toContain("2026-08-12");
    expect(note).toContain("Mike's authorization, 2026-08-11");
    expect(note).toContain("Reversible: clear archivedAt");
  });

  it("says time-based, NOT that the work was abandoned", () => {
    // Load-bearing wording. With no completion field before 2026-08-11, a swept
    // item may simply have been finished with nowhere to record it — the note
    // must not assert a judgement the data cannot support.
    const note = actionItemArchiveNote(
      { stale: true, overdueDays: 42, reason: "overdue_past_threshold" }, "2026-08-12");
    expect(note).toContain("not a finding");
    expect(note).toContain("abandoned");
    expect(note).toMatch(/Time-based, not a finding that the work was abandoned/);
  });
});
