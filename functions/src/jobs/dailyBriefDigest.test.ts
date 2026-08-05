// Corsair — tests for the daily brief digest composer (Mission 3).
//
// The headline unit here is the MASTER SHEET CHANGES privilege gate. A
// regression there leaks internal-classified fact edits into an email that
// leaves the building, so every assertion below is written from the fail-safe
// direction: anything we cannot positively resolve as "customer-safe" must be
// WITHHELD from a non-Owner/Admin subscriber.
//
// No network, no emulator, no secrets: gmailSend (and through it firebase-admin
// + googleapis) is mocked away, the database is an in-memory tree, and the
// clock is frozen so the cadence windows are deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../capture/gmailSend", () => ({ sendViaGmail: vi.fn(async () => true) }));

import {
  composeBrief,
  sortOpenCommitments,
  selectHighPriorityActions,
  type BriefSubscription,
} from "./dailyBriefDigest";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const HOUR = 3600000;
const DAY = 86400000;

// ── in-memory database double ───────────────────────────────────────────────
let tree: Record<string, any> = {};

function resolve(path: string): any {
  let cur: any = tree;
  for (const p of path.split("/").filter(Boolean)) {
    if (cur === null || cur === undefined || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return cur === undefined ? null : cur;
}

function makeRef(path: string): any {
  return {
    child: (sub: string) => makeRef(`${path}/${sub}`),
    once: async () => {
      const val = resolve(path);
      return { val: () => val, exists: () => val !== null && val !== undefined };
    },
  };
}

const fakeDb: any = { ref: (path: string) => makeRef(path) };

const WS = "ws-1";

/** Only the fields a test cares about; every inc* flag defaults on. */
function sub(overrides: Partial<BriefSubscription> = {}): BriefSubscription {
  return { email: "mike@example.com", frequency: "daily", uid: "u-mike", ...overrides };
}

async function compose(s: BriefSubscription): Promise<string> {
  const { text } = await composeBrief(WS, "Atlas", s, fakeDb);
  return text;
}

/**
 * The lines of one `=== SECTION ===` block, header excluded. Stops at the next
 * section header OR at the `---` footer rule — the last section in the email is
 * followed by the footer, not by another header.
 */
function section(text: string, name: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`=== ${name}`));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("===") || lines[i].startsWith("---")) break;
    if (lines[i].trim()) out.push(lines[i]);
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  tree = { workspaces: { [WS]: { members: {}, facts: {} } } };
});

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
// sortOpenCommitments — shared by the digest AND the operatorData endpoint
// ═══════════════════════════════════════════════════════════════════════════
describe("sortOpenCommitments", () => {
  it("drops everything that is not status=open", () => {
    const out = sortOpenCommitments([
      { status: "open", task: "a" },
      { status: "done", task: "b" },
      { status: "cancelled", task: "c" },
      { task: "no status" },
      null,
      undefined,
    ]);
    expect(out.map((c) => c.task)).toEqual(["a"]);
  });

  it("orders dated soonest-first, overdue at the very top", () => {
    const out = sortOpenCommitments([
      { status: "open", task: "next week", deadline: "2026-08-12" },
      { status: "open", task: "overdue", deadline: "2026-07-01" },
      { status: "open", task: "tomorrow", deadline: "2026-08-06" },
    ]);
    expect(out.map((c) => c.task)).toEqual(["overdue", "tomorrow", "next week"]);
  });

  it("puts every dated commitment ahead of every undated one", () => {
    const out = sortOpenCommitments([
      { status: "open", task: "undated", created: "2026-08-04" },
      { status: "open", task: "dated far out", deadline: "2027-01-01" },
    ]);
    expect(out.map((c) => c.task)).toEqual(["dated far out", "undated"]);
  });

  it("orders undated commitments newest-created first", () => {
    const out = sortOpenCommitments([
      { status: "open", task: "old", created: "2026-01-01" },
      { status: "open", task: "new", created: "2026-08-04" },
      { status: "open", task: "middle", created: "2026-05-01" },
    ]);
    expect(out.map((c) => c.task)).toEqual(["new", "middle", "old"]);
  });

  it("treats an unparseable deadline as undated rather than throwing or sorting NaN-first", () => {
    const out = sortOpenCommitments([
      { status: "open", task: "garbage date", deadline: "not-a-date", created: "2026-08-04" },
      { status: "open", task: "real date", deadline: "2026-12-01" },
    ]);
    expect(out.map((c) => c.task)).toEqual(["real date", "garbage date"]);
  });

  it("returns [] for an empty input", () => {
    expect(sortOpenCommitments([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MASTER SHEET CHANGES — the fact-visibility privilege gate (security)
// ═══════════════════════════════════════════════════════════════════════════
describe("composeBrief — fact-visibility privilege gate", () => {
  /** Two recent edits: f-safe is customer-safe, f-int is internal. */
  function seedChanges() {
    tree.workspaces[WS].factChanges = {
      a: { id: "f-safe", label: "contract_value", from: "1", to: "2", at: NOW - HOUR },
      b: { id: "f-int", label: "internal_margin", from: "9", to: "11", at: NOW - 2 * HOUR },
    };
    tree.workspaces[WS].facts = {
      "f-safe": { visibility: "customer-safe" },
      "f-int": { visibility: "internal" },
    };
  }

  it("shows Owner every edit, internal included, with nothing withheld", async () => {
    seedChanges();
    tree.workspaces[WS].members["u-mike"] = { role: "Owner" };
    const lines = section(await compose(sub()), "MASTER SHEET CHANGES");
    expect(lines.join("\n")).toContain("internal margin: 9 → 11");
    expect(lines.join("\n")).toContain("contract value: 1 → 2");
    expect(lines.join("\n")).not.toContain("hidden");
  });

  it("shows Admin every edit too (role check is case-insensitive)", async () => {
    seedChanges();
    tree.workspaces[WS].members["u-mike"] = { role: "admin" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).toContain("internal margin: 9 → 11");
  });

  it("WITHHOLDS internal edits from an Analyst and reports the count", async () => {
    seedChanges();
    tree.workspaces[WS].members["u-mike"] = { role: "Analyst" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).toContain("contract value: 1 → 2");
    expect(body).not.toContain("internal margin");
    expect(body).not.toContain("11");
    expect(body).toContain("1 internal edit hidden");
  });

  it("WITHHOLDS from a subscriber with NO member record at all — default deny", async () => {
    seedChanges();
    // no members entry for u-mike
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).not.toContain("internal margin");
    expect(body).toContain("1 internal edit hidden");
  });

  it("WITHHOLDS from an unrecognized role — only owner/admin are privileged", async () => {
    seedChanges();
    tree.workspaces[WS].members["u-mike"] = { role: "SuperAdmin" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).not.toContain("internal margin");
    expect(body).toContain("1 internal edit hidden");
  });

  it("WITHHOLDS an edit whose fact no longer exists — unresolvable means deny", async () => {
    tree.workspaces[WS].factChanges = {
      a: { id: "f-gone", label: "orphaned_fact", from: "1", to: "2", at: NOW - HOUR },
    };
    tree.workspaces[WS].facts = {}; // fact deleted since the change was recorded
    tree.workspaces[WS].members["u-mike"] = { role: "Analyst" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).not.toContain("orphaned fact");
    expect(body).toContain("1 internal edit hidden");
  });

  it("WITHHOLDS an edit whose visibility field is missing or null", async () => {
    tree.workspaces[WS].factChanges = {
      a: { id: "f-novis", label: "no_visibility", to: "x", at: NOW - HOUR },
      b: { id: "f-null", label: "null_visibility", to: "y", at: NOW - HOUR },
    };
    tree.workspaces[WS].facts = { "f-novis": { value: 1 }, "f-null": { visibility: null } };
    tree.workspaces[WS].members["u-mike"] = { role: "Analyst" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).not.toContain("no visibility");
    expect(body).not.toContain("null visibility");
    expect(body).toContain("2 internal edits hidden");
  });

  it("WITHHOLDS a change record with no fact id at all", async () => {
    tree.workspaces[WS].factChanges = {
      a: { label: "idless_change", to: "z", at: NOW - HOUR },
    };
    tree.workspaces[WS].members["u-mike"] = { role: "Analyst" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).not.toContain("idless change");
    expect(body).toContain("1 internal edit hidden");
  });

  it("reads the fact's CURRENT visibility, so a reclassification to internal wins", async () => {
    tree.workspaces[WS].factChanges = {
      // The change record itself claims customer-safe; the live fact says otherwise.
      a: { id: "f-x", label: "reclassified", to: "v", at: NOW - HOUR, visibility: "customer-safe" },
    };
    tree.workspaces[WS].facts = { "f-x": { visibility: "internal" } };
    tree.workspaces[WS].members["u-mike"] = { role: "Analyst" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).not.toContain("reclassified");
    expect(body).toContain("1 internal edit hidden");
  });

  it("emits the section with only the withheld count when EVERYTHING is internal", async () => {
    tree.workspaces[WS].factChanges = {
      a: { id: "f-int", label: "internal_margin", to: "11", at: NOW - HOUR },
    };
    tree.workspaces[WS].facts = { "f-int": { visibility: "internal" } };
    tree.workspaces[WS].members["u-mike"] = { role: "Analyst" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).toBe("1 internal edit hidden — view in Corsair");
  });

  it("windows to the cadence: an edit older than 26h is out of a daily digest", async () => {
    tree.workspaces[WS].factChanges = {
      a: { id: "f-safe", label: "stale_edit", to: "2", at: NOW - 30 * HOUR },
    };
    tree.workspaces[WS].facts = { "f-safe": { visibility: "customer-safe" } };
    tree.workspaces[WS].members["u-mike"] = { role: "Owner" };
    expect(await compose(sub())).not.toContain("MASTER SHEET CHANGES");
  });

  it("a weekly subscriber gets the 8-day window instead", async () => {
    tree.workspaces[WS].factChanges = {
      a: { id: "f-safe", label: "week_old_edit", to: "2", at: NOW - 5 * DAY },
    };
    tree.workspaces[WS].facts = { "f-safe": { visibility: "customer-safe" } };
    tree.workspaces[WS].members["u-mike"] = { role: "Owner" };
    const text = await compose(sub({ frequency: "weekly" }));
    expect(text).toContain("MASTER SHEET CHANGES (last 7d)");
    expect(text).toContain("week old edit");
  });

  it("omits the section entirely when incFactChanges is false, even for an Owner", async () => {
    seedChanges();
    tree.workspaces[WS].members["u-mike"] = { role: "Owner" };
    expect(await compose(sub({ incFactChanges: false }))).not.toContain("MASTER SHEET CHANGES");
  });

  it("strips angle brackets out of externally-sourced labels and values", async () => {
    tree.workspaces[WS].factChanges = {
      a: { id: "f-safe", label: "co<script>", from: "<b>1</b>", to: "2", at: NOW - HOUR },
    };
    tree.workspaces[WS].facts = { "f-safe": { visibility: "customer-safe" } };
    tree.workspaces[WS].members["u-mike"] = { role: "Owner" };
    const body = section(await compose(sub()), "MASTER SHEET CHANGES").join("\n");
    expect(body).not.toContain("<");
    expect(body).not.toContain(">");
    expect(body).toContain("coscript: b1/b → 2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Commitment sections
// ═══════════════════════════════════════════════════════════════════════════
describe("composeBrief — DUE THIS WEEK", () => {
  it("includes overdue and inside-7-days, excludes further out, undated, and closed", async () => {
    tree.workspaces[WS].commitments = {
      a: { status: "open", task: "overdue", deadline: "2026-08-01" },
      b: { status: "open", task: "in 3 days", deadline: "2026-08-08" },
      c: { status: "open", task: "far out", deadline: "2026-09-30" },
      d: { status: "open", task: "undated" },
      e: { status: "done", task: "closed but due soon", deadline: "2026-08-06" },
    };
    const lines = section(await compose(sub()), "DUE THIS WEEK");
    const body = lines.join("\n");
    expect(body).toContain("overdue — 4d overdue");
    expect(body).toContain("in 3 days — in 3d");
    expect(body).not.toContain("far out");
    expect(body).not.toContain("undated");
    expect(body).not.toContain("closed but due soon");
  });

  it("caps the list at 10 — the visibility ceiling OPEN COMMITMENTS exists to lift", async () => {
    const commitments: Record<string, any> = {};
    for (let i = 0; i < 14; i++) {
      commitments[`c${i}`] = { status: "open", task: `task ${i}`, deadline: "2026-08-06" };
    }
    tree.workspaces[WS].commitments = commitments;
    expect(section(await compose(sub()), "DUE THIS WEEK")).toHaveLength(10);
  });

  it("omits the section when nothing is due", async () => {
    tree.workspaces[WS].commitments = { a: { status: "open", task: "undated" } };
    expect(await compose(sub())).not.toContain("DUE THIS WEEK");
  });
});

describe("composeBrief — OPEN COMMITMENTS", () => {
  function seedMany(n: number) {
    const commitments: Record<string, any> = {};
    for (let i = 0; i < n; i++) {
      commitments[`c${i}`] = { status: "open", task: `task ${i}`, created: `2026-0${(i % 8) + 1}-01` };
    }
    commitments["closed"] = { status: "done", task: "not counted" };
    tree.workspaces[WS].commitments = commitments;
  }

  it("reports the FULL open count, not the truncated list length", async () => {
    seedMany(65);
    const lines = section(await compose(sub()), "OPEN COMMITMENTS");
    expect(lines[0]).toBe("65 open total");
    expect(lines.filter((l) => l.startsWith("•"))).toHaveLength(8);
    expect(lines[lines.length - 1]).toBe("…and 57 more — open Corsair to see all");
  });

  it("includes undated commitments — the whole point of the section", async () => {
    tree.workspaces[WS].commitments = {
      a: { status: "open", task: "no deadline here", owner: "Tom Baron" },
    };
    const body = section(await compose(sub()), "OPEN COMMITMENTS").join("\n");
    expect(body).toContain("• no deadline here [Tom Baron] (no deadline)");
  });

  it("renders a deadline and owner when present", async () => {
    tree.workspaces[WS].commitments = {
      a: { status: "open", task: "Send the ROM", owner: "Bill Allen", deadline: "2026-08-10" },
    };
    const body = section(await compose(sub()), "OPEN COMMITMENTS").join("\n");
    expect(body).toContain("• Send the ROM [Bill Allen] (due 2026-08-10)");
  });

  it("drops the '…and N more' tail when the list fits", async () => {
    seedMany(3);
    const lines = section(await compose(sub()), "OPEN COMMITMENTS");
    expect(lines[0]).toBe("3 open total");
    expect(lines.some((l) => l.includes("more"))).toBe(false);
  });

  it("omits the section when incCommitments is false", async () => {
    seedMany(5);
    expect(await compose(sub({ incCommitments: false }))).not.toContain("OPEN COMMITMENTS");
  });

  it("omits the section when there is nothing open", async () => {
    tree.workspaces[WS].commitments = { a: { status: "done", task: "x" } };
    expect(await compose(sub())).not.toContain("OPEN COMMITMENTS");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// selectHighPriorityActions — HIGH PRIORITY ACTIONS ordering (Mission 4 #1)
//
// REPLACES the previous behavior, which was `highActions.slice(0, 8)` over
// meetings in Firebase key order. That was arbitrary on every axis: not the
// most urgent, not the most recent, and *stable* — so the same eight items
// could sit in the brief indefinitely while genuinely urgent ones never
// surfaced. There is no test here that pinned the old order, because none
// existed; this block is the first contract this section has ever had.
//
// THE CONTRACT: drop done → sort by deadline ascending (overdue at the top,
// dated before undated) → tiebreak by source-meeting recency, newest first
// → cap 8.
//
// DELIBERATELY STATELESS. No rotation, no "already shown" memory. An urgent
// item that keeps reappearing is pressure BY DESIGN, not staleness — hiding
// it on alternate days to manufacture variety would defeat the accountability
// loop. Anti-squat lives at the right cadence in the WEEKLY digest's
// staleness sentinel (flags a list unchanged week-over-week, names the
// longest-standing items for date/close/demote). Daily = pressure, weekly =
// staleness audit; two layers, no state. Rotation would also have made this
// read-only job start writing — and CT-1b (LOG 2026-08-05) is the standing
// lesson on casually-added write paths.
// ═══════════════════════════════════════════════════════════════════════════
describe("selectHighPriorityActions", () => {
  /** Meetings keyed so that KEY ORDER contradicts the contract order — if the
   *  old first-8 slice ever comes back, these tests go red rather than pass
   *  by coincidence. */
  const meetings = [
    {
      meta: { title: "old meeting", date: "2026-07-01" },
      intel: {
        actionItems: [
          { task: "no deadline, old mtg", priority: "high" },
          { task: "due next month", priority: "high", deadline: "2026-09-01" },
        ],
      },
    },
    {
      meta: { title: "recent meeting", date: "2026-08-04" },
      intel: {
        actionItems: [
          { task: "overdue", priority: "high", deadline: "2026-07-20" },
          { task: "no deadline, recent mtg", priority: "high" },
          { task: "low priority", priority: "low", deadline: "2026-07-01" },
          { task: "done and urgent", priority: "high", deadline: "2026-07-02", done: true },
        ],
      },
    },
  ];

  it("puts the most overdue item first, not whatever came first in key order", () => {
    const out = selectHighPriorityActions(meetings, NOW);
    expect(out[0].task).toBe("overdue");
  });

  it("drops completed items even when they are high priority and overdue", () => {
    const out = selectHighPriorityActions(meetings, NOW);
    expect(out.map((a) => a.task)).not.toContain("done and urgent");
  });

  it("drops anything that is not priority=high", () => {
    const out = selectHighPriorityActions(meetings, NOW);
    expect(out.map((a) => a.task)).not.toContain("low priority");
  });

  it("orders dated ascending and puts every dated item ahead of every undated one", () => {
    const out = selectHighPriorityActions(meetings, NOW);
    expect(out.map((a) => a.task)).toEqual([
      "overdue",
      "due next month",
      "no deadline, recent mtg",
      "no deadline, old mtg",
    ]);
  });

  it("tiebreaks equal deadlines by source-meeting recency, newest first", () => {
    const out = selectHighPriorityActions(
      [
        {
          meta: { title: "older", date: "2026-07-01" },
          intel: { actionItems: [{ task: "from older mtg", priority: "high", deadline: "2026-08-10" }] },
        },
        {
          meta: { title: "newer", date: "2026-08-04" },
          intel: { actionItems: [{ task: "from newer mtg", priority: "high", deadline: "2026-08-10" }] },
        },
      ],
      NOW,
    );
    expect(out.map((a) => a.task)).toEqual(["from newer mtg", "from older mtg"]);
  });

  it("falls back to ts when a meeting has no meta.date", () => {
    const out = selectHighPriorityActions(
      [
        { ts: "2026-07-01", intel: { actionItems: [{ task: "older", priority: "high" }] } },
        { ts: "2026-08-04", intel: { actionItems: [{ task: "newer", priority: "high" }] } },
      ],
      NOW,
    );
    expect(out.map((a) => a.task)).toEqual(["newer", "older"]);
  });

  it("caps at 8 and keeps the 8 MOST urgent — the cap must not truncate arbitrarily", () => {
    const many = [
      {
        meta: { title: "m", date: "2026-08-04" },
        intel: {
          // Deliberately supplied latest-deadline-first.
          actionItems: Array.from({ length: 12 }, (_, i) => ({
            task: `t${i}`,
            priority: "high",
            deadline: `2026-09-${String(12 - i).padStart(2, "0")}`,
          })),
        },
      },
    ];
    const out = selectHighPriorityActions(many, NOW);
    expect(out).toHaveLength(8);
    expect(out[0].task).toBe("t11"); // 2026-09-01, the soonest
    expect(out.map((a) => a.task)).not.toContain("t0"); // 2026-09-12, the furthest
  });

  it("survives malformed input without throwing", () => {
    expect(() => selectHighPriorityActions([null, undefined, {}, { intel: {} }] as any, NOW)).not.toThrow();
    expect(selectHighPriorityActions([null, undefined, {}] as any, NOW)).toEqual([]);
  });

  it("computes overdueDays only for items actually past due", () => {
    const out = selectHighPriorityActions(meetings, NOW);
    const overdue = out.find((a) => a.task === "overdue");
    const future = out.find((a) => a.task === "due next month");
    expect(overdue.overdueDays).toBe(16); // 2026-07-20 → 2026-08-05
    expect(future.overdueDays).toBe(0);
  });

  it("is stateless: the same input yields the same output on repeated calls", () => {
    const a = selectHighPriorityActions(meetings, NOW).map((x) => x.task);
    const b = selectHighPriorityActions(meetings, NOW).map((x) => x.task);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HIGH PRIORITY ACTIONS — as rendered in the email
// ═══════════════════════════════════════════════════════════════════════════
describe("composeBrief — HIGH PRIORITY ACTIONS section", () => {
  beforeEach(() => {
    tree.workspaces[WS].meetings = {
      // Key order deliberately contradicts contract order.
      zzz: {
        meta: { title: "old", date: "2026-07-01" },
        intel: { actionItems: [{ task: "later item", priority: "high", deadline: "2026-09-01" }] },
      },
      aaa: {
        meta: { title: "recent", date: "2026-08-04" },
        intel: {
          actionItems: [
            { task: "overdue item", priority: "high", owner: "Mike", deadline: "2026-08-02" },
            { task: "finished item", priority: "high", deadline: "2026-07-01", done: true },
          ],
        },
      },
    };
  });

  it("renders the most urgent item first regardless of meeting key order", async () => {
    const rows = section(await compose(sub()), "HIGH PRIORITY ACTIONS");
    expect(rows[0]).toContain("overdue item");
  });

  it("appends an overdue marker to the Due string (polish, not contract)", async () => {
    const rows = section(await compose(sub()), "HIGH PRIORITY ACTIONS");
    expect(rows[0]).toContain("(Due: 2026-08-02 — 3d overdue)");
  });

  it("does not mark a future deadline as overdue", async () => {
    const rows = section(await compose(sub()), "HIGH PRIORITY ACTIONS");
    const later = rows.find((r) => r.includes("later item"));
    expect(later).toContain("(Due: 2026-09-01)");
    expect(later).not.toContain("overdue");
  });

  it("keeps completed items out of the email entirely", async () => {
    const rows = section(await compose(sub()), "HIGH PRIORITY ACTIONS");
    expect(rows.join("\n")).not.toContain("finished item");
  });

  it("still honours incActions=false", async () => {
    const rows = section(await compose(sub({ incActions: false } as any)), "HIGH PRIORITY ACTIONS");
    expect(rows).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Envelope
// ═══════════════════════════════════════════════════════════════════════════
describe("composeBrief — envelope", () => {
  it("composes a dated subject and an HTML body from the same lines, on an empty workspace", async () => {
    const { subject, text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    expect(subject).toBe("Corsair Brief — Atlas — 2026-08-05");
    expect(text).toContain("CORSAIR DAILY BRIEF — Atlas");
    expect(html).toContain("CORSAIR DAILY BRIEF — Atlas");
    expect(html.startsWith("<div")).toBe(true);
  });

  it("renders each === SECTION === line as an h3 in the HTML", async () => {
    tree.workspaces[WS].commitments = { a: { status: "open", task: "x" } };
    const { html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    expect(html).toContain(">OPEN COMMITMENTS</h3>");
  });
});
