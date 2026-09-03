import { describe, it, expect } from "vitest";
import {
  scoreFromChecks,
  verdictFor,
  selectMeetingsToScore,
  parseGraderResponse,
  gradeFromResponse,
  rollup,
  clip,
  buildGraderUserMessage,
  CHECK_NAMES,
  PENALTIES,
  type Checks,
} from "./extractionEval";

const empty = (): Checks => {
  const c = {} as Checks;
  for (const n of CHECK_NAMES) c[n] = { findings: [] };
  return c;
};
const withFindings = (name: keyof typeof PENALTIES, n: number, evidence = "quoted from source"): Checks => {
  const c = empty();
  c[name] = { findings: Array.from({ length: n }, (_, i) => ({ claim: `claim ${i}`, evidence })) };
  return c;
};

describe("scoreFromChecks", () => {
  it("a clean extraction scores 100", () => {
    expect(scoreFromChecks(empty()).score).toBe(100);
  });

  it("penalises each check at its stated rate", () => {
    expect(scoreFromChecks(withFindings("fabricatedPeople", 1)).score).toBe(85);
    expect(scoreFromChecks(withFindings("fabricatedCompanies", 1)).score).toBe(90);
    expect(scoreFromChecks(withFindings("unsupportedDeadlines", 1)).score).toBe(90);
    expect(scoreFromChecks(withFindings("quoteFidelity", 1)).score).toBe(85);
    expect(scoreFromChecks(withFindings("missedCommitments", 1)).score).toBe(95);
  });

  it("caps a single check so one catastrophic meeting cannot dominate the corpus", () => {
    // 10 fabricated people would be -150 uncapped; the cap is -45.
    expect(scoreFromChecks(withFindings("fabricatedPeople", 10)).score).toBe(55);
  });

  it("never returns a negative score even when every check is maxed", () => {
    const c = empty();
    for (const n of CHECK_NAMES) c[n] = { findings: Array.from({ length: 20 }, () => ({ claim: "x", evidence: "y" })) };
    expect(scoreFromChecks(c).score).toBe(0);
  });

  it("DISCARDS findings with no evidence — an unevidenced finding is an opinion", () => {
    const c = empty();
    c.fabricatedPeople = {
      findings: [
        { claim: "real one", evidence: "the source says nothing about this person" },
        { claim: "unevidenced", evidence: "" },
        { claim: "whitespace only", evidence: "   " },
      ],
    };
    const r = scoreFromChecks(c);
    expect(r.counts.fabricatedPeople).toBe(1);
    expect(r.score).toBe(85);
  });

  it("tolerates a missing check object rather than throwing", () => {
    const partial = { fabricatedPeople: { findings: [] } } as unknown as Checks;
    expect(scoreFromChecks(partial).score).toBe(100);
  });
});

describe("verdictFor", () => {
  it("draws the boundaries where they are documented", () => {
    expect(verdictFor(100)).toBe("PASS");
    expect(verdictFor(85)).toBe("PASS");
    expect(verdictFor(84)).toBe("WEAK");
    expect(verdictFor(60)).toBe("WEAK");
    expect(verdictFor(59)).toBe("FAIL");
    expect(verdictFor(0)).toBe("FAIL");
  });
});

describe("selectMeetingsToScore", () => {
  const notes = "x".repeat(500);
  // Shapes mirror the LIVE schema, verified 2026-08-31:
  //   hand-logged  {ts, loggedByUid, id, meta, intel, loggedBy, notes, oppId}
  //   auto stub    {autoCapture, source, ts, approvedAt, id, meta, intel}
  //                with intel = {summary} only and NO notes at all
  const meetings = {
    never1: { meta: { title: "A" }, notes, intel: { summary: "s", actionItems: [] } },
    never2: { meta: { title: "B" }, notes, intel: { summary: "s" } },
    old: { meta: { title: "C" }, notes, intel: { summary: "s" } },
    recent: { meta: { title: "D" }, notes, intel: { summary: "s" } },
    demo: { meta: { title: "AUDIT TEST harness" }, notes, intel: { summary: "s" } },
    archived: { meta: { title: "E" }, notes, intel: { summary: "s" }, archivedAt: "2026-08-01" },
    thin: { meta: { title: "F" }, notes: "too short" },
    autoStub: { meta: { title: "Calendar event" }, autoCapture: true, approvedAt: "2026-07-06", intel: { summary: "s" } },
    // The bug this test now pins: notes nested under intel must NOT count.
    wrongPath: { meta: { title: "H" }, intel: { summary: "s", notes } },
  };
  const scored = { old: { scoredAt: "2026-01-01" }, recent: { scoredAt: "2026-08-30" } };

  it("prefers never-scored, then oldest-scored, so repeated runs walk the corpus", () => {
    const out = selectMeetingsToScore(meetings, scored, 4);
    expect(out.slice(0, 2).sort()).toEqual(["never1", "never2"]);
    expect(out[2]).toBe("old");
    expect(out[3]).toBe("recent");
  });

  it("excludes demo data, archived records, and anything without real notes", () => {
    const out = selectMeetingsToScore(meetings, scored, 99);
    expect(out).not.toContain("demo");
    expect(out).not.toContain("archived");
    expect(out).not.toContain("thin");
    expect(out).toHaveLength(4);
  });

  it("excludes auto-captured calendar stubs — they never had a transcript", () => {
    expect(selectMeetingsToScore(meetings, scored, 99)).not.toContain("autoStub");
  });

  it("reads notes from the TOP LEVEL, not intel.notes — the live schema, not the assumed one", () => {
    // Pins the bug that made the first real run grade 0 of 591 meetings.
    expect(selectMeetingsToScore(meetings, scored, 99)).not.toContain("wrongPath");
    expect(selectMeetingsToScore({ x: { meta: {}, notes: "y".repeat(300) } }, {}, 9)).toEqual(["x"]);
  });

  it("respects the limit and handles a zero or negative limit without throwing", () => {
    expect(selectMeetingsToScore(meetings, scored, 2)).toHaveLength(2);
    expect(selectMeetingsToScore(meetings, scored, 0)).toHaveLength(0);
    expect(selectMeetingsToScore(meetings, scored, -5)).toHaveLength(0);
  });
});

describe("parseGraderResponse", () => {
  const good = JSON.stringify({
    checks: {
      fabricatedPeople: { findings: [{ claim: "Adm. Nobody", evidence: "source is silent on this name" }] },
      fabricatedCompanies: { findings: [] },
      unsupportedDeadlines: { findings: [] },
      missedCommitments: { findings: [] },
      quoteFidelity: { findings: [] },
    },
    note: "one fabricated attendee",
  });

  it("parses a clean response", () => {
    const v = parseGraderResponse(good);
    expect(v.checks.fabricatedPeople.findings).toHaveLength(1);
    expect(v.note).toBe("one fabricated attendee");
  });

  it("tolerates a markdown fence", () => {
    expect(parseGraderResponse("```json\n" + good + "\n```").checks.fabricatedPeople.findings).toHaveLength(1);
  });

  it("fills in checks the grader omitted entirely", () => {
    const v = parseGraderResponse(JSON.stringify({ checks: { fabricatedPeople: { findings: [] } }, note: "" }));
    for (const n of CHECK_NAMES) expect(v.checks[n].findings).toEqual([]);
  });

  // These four are the point of the module: a malformed grader reply must NEVER
  // become a silent 100. Each of these would otherwise be a confident false pass.
  it("THROWS on an empty response rather than scoring it clean", () => {
    expect(() => parseGraderResponse("")).toThrow(/empty/i);
    expect(() => parseGraderResponse("   ")).toThrow(/empty/i);
  });

  it("THROWS on non-JSON prose rather than scavenging it", () => {
    expect(() => parseGraderResponse("I reviewed the meeting and found no issues.")).toThrow(/not JSON/i);
  });

  it("THROWS when the checks object is missing", () => {
    expect(() => parseGraderResponse(JSON.stringify({ note: "looks fine to me" }))).toThrow(/no `checks`/i);
  });

  it("THROWS when findings is the wrong shape", () => {
    expect(() =>
      parseGraderResponse(JSON.stringify({ checks: { fabricatedPeople: { findings: "two" } } }))
    ).toThrow(/not an array/i);
  });
});

describe("gradeFromResponse", () => {
  it("parses, scores and classifies in one pass", () => {
    const raw = JSON.stringify({
      checks: {
        fabricatedPeople: { findings: [{ claim: "X", evidence: "absent from source" }] },
        unsupportedDeadlines: { findings: [{ claim: "2026-09-01", evidence: "no date stated" }] },
      },
      note: "",
    });
    const g = gradeFromResponse(raw);
    expect(g.score).toBe(75);
    expect(g.verdict).toBe("WEAK");
    expect(g.counts.fabricatedPeople).toBe(1);
    expect(g.counts.missedCommitments).toBe(0);
  });
});

describe("rollup", () => {
  const mk = (score: number) => ({ score, verdict: verdictFor(score), counts: { fabricatedPeople: score < 60 ? 3 : 0, fabricatedCompanies: 0, unsupportedDeadlines: 0, quoteFidelity: 0, missedCommitments: 1 }, checks: empty(), note: "" });

  it("reports a distribution, not just a mean", () => {
    const r = rollup([mk(100), mk(100), mk(90), mk(20)]);
    expect(r.n).toBe(4);
    expect(r.meanScore).toBe(77.5);
    expect(r.medianScore).toBe(95);
    expect(r.worstScore).toBe(20);
    expect(r.pass).toBe(3);
    expect(r.fail).toBe(1);
    expect(r.totalsByCheck.missedCommitments).toBe(4);
    expect(r.totalsByCheck.fabricatedPeople).toBe(3);
  });

  it("returns nulls rather than NaN on an empty set", () => {
    const r = rollup([]);
    expect(r.n).toBe(0);
    expect(r.meanScore).toBeNull();
    expect(r.medianScore).toBeNull();
    expect(r.worstScore).toBeNull();
  });
});

describe("clip and the truncation disclosure", () => {
  it("reports truncation honestly", () => {
    expect(clip("short", 10)).toEqual({ text: "short", truncated: false });
    expect(clip("abcdefghijk", 5)).toEqual({ text: "abcde", truncated: true });
    expect(clip(undefined, 5)).toEqual({ text: "", truncated: false });
  });

  it("TELLS THE GRADER when notes were cut, so it cannot report a commitment it never saw", () => {
    const msg = buildGraderUserMessage({ notes: "n", notesTruncated: true, intelJson: "{}", intelTruncated: false, title: "T" });
    expect(msg).toMatch(/TRUNCATED/);
    expect(msg).toMatch(/Do NOT report missedCommitments/);
  });

  it("says 'complete' when nothing was cut", () => {
    const msg = buildGraderUserMessage({ notes: "n", notesTruncated: false, intelJson: "{}", intelTruncated: false, title: "T" });
    expect(msg).toMatch(/SOURCE NOTES \(complete\)/);
    expect(msg).not.toMatch(/TRUNCATED/);
  });
});
