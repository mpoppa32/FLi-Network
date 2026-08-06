// Corsair — tests for the nightly stale-commitment auto-archive (Mission 4 #5).
//
// THE RULE UNDER TEST (Mike, 2026-08-06, authoritative):
//   status==='open' && created >30d ago && (no deadline || overdue >7d)
//
// Acceptance is by SYNTHETIC FIXTURES by design, not by preference: measured
// on live Atlas 2026-08-06, ZERO commitments qualify (47 open, all dated, none
// overdue), so a live-data assertion would pass while testing nothing. Every
// boundary below is therefore constructed.
//
// Written from the fail-safe direction throughout: this job MUTATES operator
// data, so the interesting assertions are about what it must REFUSE to touch.
// Archiving a live commitment removes real work from the operator's view; the
// cost of sparing a stale one is merely that it stays in the brief.

import { describe, it, expect, vi, beforeEach } from "vitest";

const refMock = vi.fn();
const updateMock = vi.fn(async () => undefined);
vi.mock("../framework/rtdb", () => ({
  db: {
    ref: (path?: string) => refMock(path),
  },
  wsPath: (ws: string, ...parts: string[]) => ["workspaces", ws, ...parts].join("/"),
}));

import {
  isStale,
  archiveNoteFor,
  archiveStaleCommitments,
  STALE_AGE_DAYS,
  OVERDUE_GRACE_DAYS,
} from "./commitmentsAutoArchive";

const NOW = Date.parse("2026-08-06T12:00:00Z");
const DAY = 86400000;
/** ISO timestamp for "n days before NOW". */
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
/** YYYY-MM-DD deadline n days before NOW (negative = future). */
const deadlineDaysAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

describe("isStale — the policy", () => {
  it("archives an old commitment with no deadline at all", () => {
    const d = isStale({ status: "open", created: daysAgo(45) }, NOW);
    expect(d.stale).toBe(true);
    expect(d.reason).toBe("old_and_undated");
    expect(d.overdueDays).toBeNull();
  });

  it("archives an old commitment overdue by more than the grace period", () => {
    const d = isStale({ status: "open", created: daysAgo(45), deadline: deadlineDaysAgo(10) }, NOW);
    expect(d.stale).toBe(true);
    expect(d.reason).toBe("old_and_overdue");
    expect(d.overdueDays).toBe(10);
  });

  it("SPARES an old commitment overdue by exactly the grace period (boundary is >, not >=)", () => {
    const d = isStale({ status: "open", created: daysAgo(45), deadline: deadlineDaysAgo(OVERDUE_GRACE_DAYS) }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("within_grace");
  });

  it("SPARES the precedent shape — 43d old but only 1 day overdue", () => {
    // The two records hand-archived on 2026-08-06 looked exactly like this.
    // They were a Mike-approved one-off; this rule must NOT reproduce them.
    const d = isStale({ status: "open", created: daysAgo(43), deadline: deadlineDaysAgo(1) }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("within_grace");
  });

  it("SPARES an undated commitment younger than the age threshold", () => {
    const d = isStale({ status: "open", created: daysAgo(10) }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("younger_than_30d");
  });

  it("SPARES a commitment at exactly the age threshold (boundary is >, not >=)", () => {
    const d = isStale({ status: "open", created: daysAgo(STALE_AGE_DAYS) }, NOW);
    expect(d.stale).toBe(false);
  });

  it("SPARES an old commitment whose deadline is still in the future", () => {
    const d = isStale({ status: "open", created: daysAgo(60), deadline: deadlineDaysAgo(-5) }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("within_grace");
  });

  it.each([["completed"], ["archived"], ["fulfilled"], ["broken"], ["closed"]])(
    "never touches status=%s, however old",
    (status) => {
      expect(isStale({ status, created: daysAgo(500) }, NOW).stale).toBe(false);
    },
  );

  it("never touches a record with no status at all", () => {
    expect(isStale({ created: daysAgo(500) }, NOW).stale).toBe(false);
  });

  // ── fail-safe: anything unresolvable is LEFT OPEN ────────────────────────
  it("SPARES a record whose created date is unparseable — unknown age is not stale", () => {
    const d = isStale({ status: "open", created: "not a date" }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("created_unparseable");
  });

  it("SPARES a record with no created field", () => {
    expect(isStale({ status: "open" }, NOW).stale).toBe(false);
  });

  it("SPARES a record whose deadline is unparseable — that is NOT the same as undated", () => {
    const d = isStale({ status: "open", created: daysAgo(90), deadline: "whenever" }, NOW);
    expect(d.stale).toBe(false);
    expect(d.reason).toBe("deadline_unparseable");
  });

  it("treats an empty-string deadline as undated", () => {
    expect(isStale({ status: "open", created: daysAgo(90), deadline: "   " }, NOW).stale).toBe(true);
  });

  it.each([[null], [undefined], ["a string"], [42]])("survives malformed input %s", (bad) => {
    expect(() => isStale(bad, NOW)).not.toThrow();
    expect(isStale(bad, NOW).stale).toBe(false);
  });
});

describe("archiveNoteFor", () => {
  it("states age and overdue days for a dated record", () => {
    expect(archiveNoteFor({ stale: true, ageDays: 45, overdueDays: 10, reason: "x" }))
      .toBe("auto-archived: created 45d ago, overdue 10d");
  });

  it("says 'no deadline' rather than 'overdue null' for an undated record", () => {
    expect(archiveNoteFor({ stale: true, ageDays: 45, overdueDays: null, reason: "x" }))
      .toBe("auto-archived: created 45d ago, no deadline");
  });
});

describe("archiveStaleCommitments — the write", () => {
  let tree: Record<string, any>;

  beforeEach(() => {
    updateMock.mockClear();
    refMock.mockReset();
    refMock.mockImplementation((path?: string) => {
      if (path === undefined) return { update: updateMock };
      return { once: async () => ({ val: () => tree }) };
    });
  });

  it("archives only the qualifying records and reports real counts", async () => {
    tree = {
      stale1: { status: "open", created: daysAgo(60), task: "old undated" },
      stale2: { status: "open", created: daysAgo(60), deadline: deadlineDaysAgo(20), task: "old overdue" },
      fresh: { status: "open", created: daysAgo(2), task: "new" },
      grace: { status: "open", created: daysAgo(60), deadline: deadlineDaysAgo(3), task: "in grace" },
      done: { status: "completed", created: daysAgo(900), task: "finished" },
    };
    const out = await archiveStaleCommitments("ws-1", NOW);
    expect(out.scanned).toBe(5);
    expect(out.archived).toBe(2);
    expect(out.ids.sort()).toEqual(["stale1", "stale2"]);
  });

  it("writes ONLY status, archivedAt and archiveNote — never deletes, never touches other fields", async () => {
    tree = { s: { status: "open", created: daysAgo(60), task: "keep me", owner: "mike", priority: "high" } };
    await archiveStaleCommitments("ws-1", NOW);
    const updates = updateMock.mock.calls[0][0];
    expect(Object.keys(updates).sort()).toEqual([
      "workspaces/ws-1/commitments/s/archiveNote",
      "workspaces/ws-1/commitments/s/archivedAt",
      "workspaces/ws-1/commitments/s/status",
    ]);
    expect(updates["workspaces/ws-1/commitments/s/status"]).toBe("archived");
    expect(updates["workspaces/ws-1/commitments/s/archivedAt"]).toBe(new Date(NOW).toISOString());
    expect(updates["workspaces/ws-1/commitments/s/archiveNote"]).toBe("auto-archived: created 60d ago, no deadline");
    // No null values anywhere — a null in a multi-path update is a DELETE.
    expect(Object.values(updates).some((v) => v === null)).toBe(false);
  });

  it("does not write at all when nothing qualifies — the live-data case today", async () => {
    tree = {
      a: { status: "open", created: daysAgo(60), deadline: deadlineDaysAgo(-5) },
      b: { status: "open", created: daysAgo(3) },
    };
    const out = await archiveStaleCommitments("ws-1", NOW);
    expect(out.archived).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("handles an empty or missing commitments node", async () => {
    tree = null as any;
    const out = await archiveStaleCommitments("ws-1", NOW);
    expect(out).toEqual({ scanned: 0, archived: 0, ids: [] });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("scopes every path to the workspace it was given — no hardcoded ids", async () => {
    tree = { s: { status: "open", created: daysAgo(60) } };
    await archiveStaleCommitments("ws-OTHER", NOW);
    const updates = updateMock.mock.calls[0][0];
    expect(Object.keys(updates).every((k) => k.startsWith("workspaces/ws-OTHER/commitments/"))).toBe(true);
  });

  it("is idempotent — a second run archives nothing new", async () => {
    tree = { s: { status: "open", created: daysAgo(60) } };
    await archiveStaleCommitments("ws-1", NOW);
    tree = { s: { status: "archived", created: daysAgo(60), archivedAt: new Date(NOW).toISOString() } };
    updateMock.mockClear();
    const out = await archiveStaleCommitments("ws-1", NOW);
    expect(out.archived).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
