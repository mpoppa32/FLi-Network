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
  countRecentAutoArchived,
  isOpenActionItem,
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
// loop.
//
// CORRECTED 2026-08-11 (Rule 14): this comment previously claimed "anti-squat
// lives at the right cadence in the WEEKLY digest's staleness sentinel." THERE
// IS NO WEEKLY DIGEST — verified against index.ts (only `dailyBriefDigest` +
// `triggerBriefDigestTest`); the five `*Weekly.ts` jobs are OSINT connectors.
// So there is no second layer and nothing audits staleness at any cadence.
// Rotation would also have made this read-only job start writing — and CT-1b
// (LOG 2026-08-05) is the standing lesson on casually-added write paths.
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
// ARCHIVED N STALE — the Rule 11 report line for commitmentsAutoArchive
//
// The job silently moves stale opens out of the brief. This line is the only
// thing that tells the operator it happened, so the tests below care most
// about it NOT lying: it must never claim the job acted when it didn't.
// ═══════════════════════════════════════════════════════════════════════════
// The predicate shared with operatorData (Mission 4 #3). It exists because the
// digest and the endpoint disagreed about what "open" means; these tests pin
// the definition in the one place both import from.
describe("isOpenActionItem", () => {
  it("treats a done item as closed", () => {
    expect(isOpenActionItem({ task: "x", done: true })).toBe(false);
  });

  it("treats done:false and a missing done field as open", () => {
    expect(isOpenActionItem({ task: "x", done: false })).toBe(true);
    expect(isOpenActionItem({ task: "x" })).toBe(true);
  });

  it("is not fooled by falsy-but-present values", () => {
    expect(isOpenActionItem({ task: "x", done: 0 })).toBe(true);
    expect(isOpenActionItem({ task: "x", done: "" })).toBe(true);
    // Any truthy marker closes it — matches the front end's `!a.done`.
    expect(isOpenActionItem({ task: "x", done: "yes" })).toBe(false);
  });

  it("rejects anything that is not a usable object", () => {
    expect(isOpenActionItem(null)).toBe(false);
    expect(isOpenActionItem(undefined)).toBe(false);
    expect(isOpenActionItem("a string")).toBe(false);
    expect(isOpenActionItem(42)).toBe(false);
  });

  // ── archived items (2026-08-11). Before this date neither `done` nor
  // `archivedAt` existed on ANY record, so this predicate excluded nothing.
  // Without the archivedAt clause the sweep would archive an item and the
  // digest would keep nagging about it — the same deny-list leak P13.400 had
  // to patch at three separate sites on the commitment side. ──
  it("excludes an archived item", () => {
    expect(isOpenActionItem({ task: "x", archivedAt: "2026-08-12T00:00:00.000Z" })).toBe(false);
  });

  it("still counts an item whose archivedAt is absent, empty or null", () => {
    expect(isOpenActionItem({ task: "x" })).toBe(true);
    expect(isOpenActionItem({ task: "x", archivedAt: "" })).toBe(true);
    expect(isOpenActionItem({ task: "x", archivedAt: "   " })).toBe(true);
    expect(isOpenActionItem({ task: "x", archivedAt: null })).toBe(true);
  });

  it("keeps an archived item out of HIGH PRIORITY ACTIONS", () => {
    // The reason the predicate is shared rather than inlined: this is the
    // digest path, and operatorData gets the same answer for free.
    const meetings = [{
      meta: { date: "2026-08-01", title: "M" },
      intel: {
        actionItems: [
          { task: "live", priority: "high", deadline: "2026-08-20" },
          { task: "swept", priority: "high", deadline: "2026-04-28", archivedAt: "2026-08-12T00:00:00.000Z" },
        ],
      },
    }];
    const picked = selectHighPriorityActions(meetings, NOW).map((a: any) => a.task);
    expect(picked).toContain("live");
    expect(picked).not.toContain("swept");
  });
});

describe("countRecentAutoArchived", () => {
  const auto = (hoursAgo: number) => ({
    status: "archived",
    archiveNote: "auto-archived: created 60d ago, no deadline",
    archivedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  });

  it("counts records the job archived inside the window", () => {
    expect(countRecentAutoArchived([auto(1), auto(20)], NOW)).toBe(2);
  });

  it("ignores archives older than the window", () => {
    expect(countRecentAutoArchived([auto(25), auto(200)], NOW)).toBe(0);
  });

  it("does NOT count a MANUAL archive — the line claims the job acted", () => {
    expect(countRecentAutoArchived([
      { status: "archived", archiveNote: "Manual exception, Mike-approved 2026-08-06", archivedAt: new Date(NOW).toISOString() },
    ], NOW)).toBe(0);
  });

  it("ignores open and completed records entirely", () => {
    expect(countRecentAutoArchived([{ status: "open" }, { status: "completed" }], NOW)).toBe(0);
  });

  it("skips an archived record with no or unparseable archivedAt rather than assuming it is recent", () => {
    expect(countRecentAutoArchived([
      { status: "archived", archiveNote: "auto-archived: x" },
      { status: "archived", archiveNote: "auto-archived: x", archivedAt: "nonsense" },
    ], NOW)).toBe(0);
  });

  it("survives malformed input", () => {
    expect(() => countRecentAutoArchived([null, undefined, "x", 7] as any, NOW)).not.toThrow();
    expect(countRecentAutoArchived([null, undefined] as any, NOW)).toBe(0);
  });
});

describe("composeBrief — ARCHIVED N STALE line", () => {
  it("is absent when the job archived nothing (today's live-data case)", async () => {
    tree.workspaces[WS].commitments = { a: { status: "open", task: "x" } };
    expect(await compose(sub())).not.toContain("ARCHIVED");
  });

  it("appears with the exact count when the job archived records overnight", async () => {
    tree.workspaces[WS].commitments = {
      a: { status: "open", task: "x" },
      b: { status: "archived", archiveNote: "auto-archived: created 60d ago, no deadline", archivedAt: new Date(NOW - HOUR).toISOString() },
      c: { status: "archived", archiveNote: "auto-archived: created 90d ago, overdue 40d", archivedAt: new Date(NOW - 2 * HOUR).toISOString() },
    };
    expect(await compose(sub())).toContain("ARCHIVED 2 STALE (>30d, unscheduled)");
  });

  it("does not report a manual archive as job activity", async () => {
    tree.workspaces[WS].commitments = {
      b: { status: "archived", archiveNote: "Manual exception, Mike-approved", archivedAt: new Date(NOW).toISOString() },
    };
    expect(await compose(sub())).not.toContain("ARCHIVED");
  });

  it("keeps archived records out of the OPEN COMMITMENTS block", async () => {
    tree.workspaces[WS].commitments = {
      a: { status: "open", task: "still open" },
      b: { status: "archived", task: "archived away", archiveNote: "auto-archived: created 60d ago, no deadline", archivedAt: new Date(NOW - HOUR).toISOString() },
    };
    const rows = section(await compose(sub()), "OPEN COMMITMENTS");
    expect(rows.join("\n")).toContain("still open");
    expect(rows.join("\n")).not.toContain("archived away");
    expect(rows.join("\n")).toContain("1 open total");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE PARSER CONTRACT — the highest-risk surface in the email redesign.
//
// Three scheduled LLM routines read this email and look for sections BY NAME:
// the morning brief (trig_01JXRoMxHWfxPX3bPasd7aWC), meeting prep
// (trig_01FeoWtBS73hyUpzz2ErwbDU) and Friday Focus (trig_01VUcsXG8ajqFmay8jmfejjK).
// A renamed or reordered section degrades all three, and the failure looks
// exactly like a quiet day — which is why it must fail HERE instead.
//
// FROZEN: the ten section keys, their spelling, and their order.
// NOT FROZEN: item-level text within a section.
// (Byte-identity of the whole plaintext was an earlier, stricter proxy for
// this; it is not the requirement. The golden snapshot below still pins the
// whole plaintext for commit 1, where nothing in it may move at all.)
// ═══════════════════════════════════════════════════════════════════════════

/** Populates every section the digest can emit, so the golden covers all ten. */
function fullFixture() {
  const ws = tree.workspaces[WS];
  ws.members = { "u-mike": { role: "owner" } };
  ws.opportunities = {
    o1: { id: "o1", name: "PA Army RFP", stage: "proposal", agency: "US Army" },
    o2: { id: "o2", name: "Navy Propulsion IDIQ", stage: "qualify", agency: "USN" },
  };
  ws.meetings = {
    m1: {
      meta: { title: "Atlas sync", date: "2026-08-04" },
      intel: {
        actionItems: [
          { task: "Send the ROM", owner: "Mike", priority: "high", deadline: "2026-08-02" },
          { task: "Chase the NDA", owner: "Bryce", priority: "high" },
        ],
        risks: [{ risk: "Single-source motor supply", severity: "high" }],
      },
    },
  };
  ws.commitments = {
    c1: { status: "open", task: "Return the redline", owner: "Mike", deadline: "2026-08-07", created: "2026-07-01T00:00:00Z" },
    c2: { status: "open", task: "Undated follow-up", owner: "Bryce", created: "2026-07-02T00:00:00Z" },
    c3: {
      status: "archived",
      task: "Stale thing",
      archiveNote: "auto-archived: created 60d ago, no deadline",
      archivedAt: new Date(NOW - 2 * HOUR).toISOString(),
    },
  };
  ws.calibration = {
    k1: { outcome: "won", oppName: "Sensor BAA", value: "250k", closedAt: new Date(NOW - 3 * DAY).toISOString() },
    k2: { outcome: "lost", oppName: "Legacy Rotor", closedAt: new Date(NOW - 10 * DAY).toISOString() },
  };
  ws.factChanges = {
    f1: { id: "fact-1", field: "Unit price", from: "100", to: "120", at: NOW - 3 * HOUR },
  };
  ws.facts = { "fact-1": { visibility: "customer-safe", label: "Unit price" } };
  ws.slackFeed = {
    s1: { channel: "atlas-eng", user: "avery", text: "Motor KV test done", atMs: NOW - 4 * HOUR },
  };
  ws.derivedViews = {
    dailyBrief: {
      latest: {
        totalItems: 5,
        generatedAt: NOW - 6 * HOUR,
        counts: { signals: 6, awards: 0 },
        itemsByCategory: {
          pursuit: [{
            title: "Army posts propulsion sources-sought",
            subtitle: "The service intends to survey industry on high-efficiency electric propulsion for Group 3 systems and it",
            source: "SAM.gov",
            category: "pursuit",
            relevance: { total: 9.1 },
          }],
          context: [{
            title: "Hearing scheduled on NDS implementation",
            subtitle: "Committee will review the National Defense Strategy and it",
            source: "Congress.gov",
            category: "context",
            confidence: 0.7,
            relevance: { total: 2.2 },
          }],
        },
      },
    },
  };
}

describe("composeBrief — machine-readable section keys", () => {
  /** The ten keys, in emission order. Renaming or reordering any one of them
   *  silently degrades three live routines — so this test is the tripwire. */
  const KEYS_IN_ORDER = [
    "=== OVERNIGHT INTELLIGENCE ===",
    "=== MASTER SHEET CHANGES (last 24h) ===",
    "=== ATLAS SLACK (last 24h) ===",
    "=== PIPELINE ===",
    "=== HIGH PRIORITY ACTIONS ===",
    "=== HIGH RISKS ===",
    "=== CLOSED DEALS (last 30d) ===",
    "=== DUE THIS WEEK ===",
    "=== OPEN COMMITMENTS ===",
  ];

  it("emits all ten machine-readable keys, spelled exactly, in order", async () => {
    fullFixture();
    const text = await compose(sub());
    // Every key present, exactly as spelled.
    for (const key of KEYS_IN_ORDER) expect(text).toContain(key);
    // The tenth key is a line, not a === header.
    expect(text).toMatch(/^ARCHIVED \d+ STALE \(>30d, unscheduled\)$/m);
    // And in this order — a reordering breaks a consumer reading top-down.
    const positions = KEYS_IN_ORDER.map((k) => text.indexOf(k));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("uses the weekly parenthetical on a weekly subscription", async () => {
    // KNOWN AND ACCEPTED: two keys carry a cadence-dependent parenthetical.
    // Safe because the consumers are LLM sessions reading for a named section,
    // not regexes matching a whole line. Pinned so a change is deliberate.
    fullFixture();
    const text = await compose(sub({ frequency: "weekly" }));
    expect(text).toContain("=== MASTER SHEET CHANGES (last 7d) ===");
    expect(text).toContain("=== ATLAS SLACK (last 7d) ===");
  });
});

// The A1 hedge, enforced. The two MIME parts must cover the SAME sections in
// the SAME order, because the consumers are LLM sessions and nobody can
// guarantee which part the harness puts in the model's context (truncation,
// part preference). If a future edit pushes a plaintext block without its
// htmlSections sibling, a model reading the HTML silently loses a section —
// and that looks exactly like a quiet day. One refactor away, so: a test.
describe("composeBrief — HTML/plaintext section parity", () => {
  /** Machine-readable key → the HTML display label that must accompany it. */
  const KEY_TO_LABEL: Array<[RegExp, string]> = [
    [/^=== OVERNIGHT INTELLIGENCE ===$/m, "Overnight intelligence"],
    [/^=== MASTER SHEET CHANGES \(/m, "Master sheet changes"],
    [/^=== ATLAS SLACK \(/m, "Atlas Slack"],
    [/^=== PIPELINE ===$/m, "Pipeline"],
    [/^=== HIGH PRIORITY ACTIONS ===$/m, "Needs you today"],
    [/^=== HIGH RISKS ===$/m, "High risks"],
    [/^=== CLOSED DEALS \(last 30d\) ===$/m, "Closed deals (last 30d)"],
    [/^=== DUE THIS WEEK ===$/m, "Due this week"],
    [/^=== OPEN COMMITMENTS ===$/m, "Open commitments"],
  ];

  it("every plaintext section has an HTML sibling, in the same relative order", async () => {
    fullFixture();
    const { text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    const present = KEY_TO_LABEL.filter(([key]) => key.test(text));
    expect(present.length).toBe(KEY_TO_LABEL.length); // fixture covers all nine
    const htmlPositions = present.map(([, label]) => {
      const i = html.indexOf(label);
      expect(i, `HTML is missing the section for ${label}`).toBeGreaterThan(-1);
      return i;
    });
    expect(htmlPositions).toEqual([...htmlPositions].sort((a, b) => a - b));
  });

  it("holds when only some sections are present", async () => {
    // Parity is about the sections that EXIST, not a fixed list.
    tree.workspaces[WS].commitments = { a: { status: "open", task: "solo" } };
    const { text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    for (const [key, label] of KEY_TO_LABEL) {
      if (key.test(text)) expect(html).toContain(label);
    }
  });

  it("THE ONE EXCEPTION: empty signals adds an HTML section with no plaintext twin, and appends it", async () => {
    // Deliberate: the plaintext omits an empty OVERNIGHT INTELLIGENCE block
    // entirely, but the HTML must still say so out loud (absence must never
    // read as calm). It is APPENDED, so it can never displace the actions.
    tree.workspaces[WS].commitments = { a: { status: "open", task: "x" } };
    tree.workspaces[WS].meetings = {
      m: { meta: { title: "t" }, intel: { actionItems: [{ task: "act now", priority: "high" }] } },
    };
    const { text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    expect(text).not.toContain("=== OVERNIGHT INTELLIGENCE ===");
    expect(html).toContain("No signals cleared the bar.");
    // and it must sit BELOW the actions, not above them
    expect(html.indexOf("Needs you today")).toBeLessThan(html.indexOf("Overnight intelligence"));
  });
});

describe("composeBrief — plaintext golden", () => {
  it("plaintext matches the captured golden", async () => {
    // Captured from the pre-decouple generator, then RE-CAPTURED for P13.402
    // (commit 2), which intentionally lengthens OVERNIGHT INTELLIGENCE
    // subtitles. Its job from here is to catch UNINTENDED drift: any plaintext
    // change must arrive as a deliberate re-capture whose diff was read, never
    // as a surprise. Diffed by CI, not by eyes.
    fullFixture();
    const text = await compose(sub());
    await expect(text).toMatchFileSnapshot("./__snapshots__/brief-plaintext.golden.txt");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P13.402 — the plaintext subtitle is a HAYSTACK, not a display string.
// Meeting prep asks "does OVERNIGHT INTELLIGENCE mention today's counterparty?"
// The old `.slice(0, 90)` made anything past character 90 invisible to it, so
// this is a data-visibility contract, not formatting. Written to fail against
// the old code: the marker sits deliberately past character 90.
// ═══════════════════════════════════════════════════════════════════════════
describe("composeBrief — OVERNIGHT INTELLIGENCE subtitle is not truncated at 90", () => {
  /** 96 chars of filler, so COUNTERPARTY_MARKER starts past character 90. */
  const FILLER = "Solicitation amendment issued covering propulsion subsystems and integration support scope. ";
  const MARKER = "Kestrel Dynamics";

  it("keeps a counterparty name that sits past character 90", async () => {
    fullFixture();
    const ws = tree.workspaces[WS];
    ws.derivedViews.dailyBrief.latest.itemsByCategory.pursuit = [{
      title: "Army propulsion recompete",
      subtitle: `${FILLER}${MARKER} named as incumbent.`,
      source: "SAM.gov",
      category: "pursuit",
      relevance: { total: 99 },
    }];
    const text = await compose(sub());
    expect(FILLER.length).toBeGreaterThan(90);       // the test is only meaningful if it is
    expect(text).toContain(MARKER);                  // RED against `.slice(0, 90)`
  });

  it("still caps a pathological subtitle, on a word boundary", async () => {
    fullFixture();
    const ws = tree.workspaces[WS];
    ws.derivedViews.dailyBrief.latest.itemsByCategory.pursuit = [{
      title: "Bulk scrape",
      subtitle: "alpha ".repeat(400),               // 2,400 chars
      source: "SAM.gov",
      category: "pursuit",
      relevance: { total: 99 },
    }];
    const text = await compose(sub());
    const line = text.split("\n").find((l) => l.includes("Bulk scrape")) || "";
    expect(line.length).toBeLessThan(600);           // capped, not unbounded
    expect(line).toContain("…");                     // and marked as trimmed
    expect(line).not.toMatch(/alph…|alp…/);          // never severed mid-word
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Envelope
// ═══════════════════════════════════════════════════════════════════════════
describe("composeBrief — envelope", () => {
  it("composes a dated subject, a plaintext part, and a table-based HTML part", async () => {
    const { subject, text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    expect(subject).toBe("Corsair Brief — Atlas — 2026-08-05");
    expect(text).toContain("CORSAIR DAILY BRIEF — Atlas");
    // P13.401: the HTML is no longer made of the plaintext lines. It is a
    // table layout with a serif masthead on a light surface.
    expect(html.startsWith("<table")).toBe(true);
    expect(html).toContain("Atlas Brief");
    expect(html).toContain("Georgia");
  });

  it("HTML display labels differ from the machine-readable plaintext keys", async () => {
    // The whole point of the decouple: the keys stay frozen for the three LLM
    // routines while the HTML says something a human wants to read.
    fullFixture();
    const { text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    expect(text).toContain("=== HIGH PRIORITY ACTIONS ===");
    expect(html).toContain("Needs you today");
    expect(html).not.toContain("=== HIGH PRIORITY ACTIONS ===");
  });

  it("carries no [CONTEXT]/[PURSUIT] prefixes and no mid-word truncation in the HTML", async () => {
    // Acceptance 2, scoped to the HTML part (relay 004 ruling).
    //
    // UPDATED for P13.402 (commit 2). In commit 1 this test pinned the
    // plaintext defects as DELIBERATELY still present — `expect(text).not
    // .toContain("Group 3 systems")` asserted that the 90-char slice ate the
    // rest of the subtitle. Commit 2 removes that slice, so that assertion is
    // now inverted: the words must SURVIVE in both parts. The truncation was
    // never a display choice in the plaintext — meeting prep reads it as a
    // haystack, so a name past character 90 was invisible to a live routine.
    fullFixture();
    const { text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    // The [TAG] prefix REMAINS in plaintext, deliberately and unlike the HTML:
    // the tag is the item's category and it varies across five values, so it
    // is real per-item metadata for the three LLM consumers reading this part.
    // Dropping it from the HTML was a visual call; dropping it here would
    // delete classification from the machine-readable layer. Not in scope.
    expect(text).toContain("[PURSUIT]");
    expect(html).not.toContain("[PURSUIT]");
    expect(html).not.toContain("[CONTEXT]");
    // Both parts now carry the whole subtitle — the HTML trimmed on a word
    // boundary at 150, the plaintext at its 400-char safety cap.
    expect(text).toContain("Group 3 systems");
    expect(html).toContain("Group 3 systems");
  });

  it("shows at most 3 signals in HTML with an explicit 'N more' line", async () => {
    fullFixture();
    const ws = tree.workspaces[WS];
    ws.derivedViews.dailyBrief.latest.itemsByCategory.capability = [
      { title: "Cap A", subtitle: "s", source: "X", category: "capability", relevance: { total: 8 } },
      { title: "Cap B", subtitle: "s", source: "X", category: "capability", relevance: { total: 7 } },
      { title: "Cap C", subtitle: "s", source: "X", category: "capability", relevance: { total: 6 } },
    ];
    const { text, html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    // Plaintext keeps ALL items — meeting prep reads this as a haystack.
    expect(text).toContain("Cap C");
    expect(html).toContain("2 more signals · view in Corsair");
  });

  it("never omits the signals section silently — absence must not read as calm", async () => {
    const { html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    expect(html).toContain("Overnight intelligence");
    expect(html).toContain("No signals cleared the bar.");
  });

  it("marks an overdue commitment in red with a left rule", async () => {
    fullFixture();
    const { html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    expect(html).toContain("#d03b3b");
    expect(html).toContain("3d overdue");
  });

  it("uses no flexbox, grid, web fonts, or background images", async () => {
    fullFixture();
    const { html } = await composeBrief(WS, "Atlas", sub(), fakeDb);
    for (const banned of ["display:flex", "display:grid", "@import", "background-image", "<style"]) {
      expect(html).not.toContain(banned);
    }
  });
});
