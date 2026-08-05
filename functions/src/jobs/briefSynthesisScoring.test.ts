// Corsair — tests for Brief Synthesis relevance scoring (Mission 3).
//
// This is the ranking function for the whole intelligence layer: it orders the
// digest's OVERNIGHT INTELLIGENCE block AND operatorData's signals[]. A silent
// change to a weight or a threshold re-orders the operator's entire morning
// without raising a single error, which is exactly the class of regression
// "it compiles and deploys" cannot catch.
//
// Pure math, no I/O. `nowMs` is an explicit parameter on all three scorers, so
// every recency assertion is deterministic without touching the clock.

import { describe, it, expect } from "vitest";
import {
  SCORING_WEIGHTS,
  scoreSignal,
  scoreAward,
  scoreOpportunity,
  categoryFromRelevance,
  type BriefScoringContext,
  type RelevanceComponents,
} from "./briefSynthesisScoring";
import type { Signal } from "../framework/types/signals";
import type { Award } from "../framework/types/awards";
import type { Opportunity } from "../framework/types/entities";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const HOUR = 3600000;

function ctx(overrides: Partial<BriefScoringContext> = {}): BriefScoringContext {
  return {
    trackedOppIds: new Set(),
    trackedAwardIds: new Set(),
    pursuitOrgIds: new Set(),
    activeAdversaryOrgIds: new Set(),
    archivedAdversaryOrgIds: new Set(),
    customerOrgIds: new Set(),
    customerHistoryOrgIds: new Set(),
    watchlistNaics: new Set(),
    watchlistPsc: new Set(),
    opportunities: new Map(),
    awards: new Map(),
    awardByPiid: new Map(),
    ...overrides,
  };
}

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "sig-1",
    type: "material_event",
    subjectIds: [],
    occurredAt: NOW - HOUR,
    attrs: {},
    source: {} as Signal["source"],
    ...overrides,
  };
}

function award(overrides: Partial<Award> = {}): Award {
  return {
    id: "awd-1",
    primeOrgId: "",
    customerOrgId: "",
    customerToptierOrgId: "",
    naics: "",
    obligated: 0,
    lifecycleState: "active",
    awardedAt: NOW - HOUR,
    lastModifiedAt: NOW - HOUR,
    ...overrides,
  } as unknown as Award;
}

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    customerOrgId: "",
    naicsCodes: [],
    samgovPostedDate: NOW - HOUR,
    ...overrides,
  } as unknown as Opportunity;
}

/** Recompute the doctrine formula independently of the implementation. */
function weightedTotal(r: RelevanceComponents): number {
  return (
    r.pursuit * SCORING_WEIGHTS.pursuit +
    r.adversary * SCORING_WEIGHTS.adversary +
    r.customer * SCORING_WEIGHTS.customer +
    r.capability * SCORING_WEIGHTS.capability +
    r.recency * SCORING_WEIGHTS.recency +
    r.magnitude * SCORING_WEIGHTS.magnitude
  );
}

// ═══════════════════════════════════════════════════════════════════════════
describe("SCORING_WEIGHTS", () => {
  it("matches the doctrine formula pursuit*4 + adversary*3 + customer*2.5 + capability*1.5 + recency*1 + magnitude*1", () => {
    expect(SCORING_WEIGHTS).toEqual({
      pursuit: 4.0,
      adversary: 3.0,
      customer: 2.5,
      capability: 1.5,
      recency: 1.0,
      magnitude: 1.0,
    });
  });

  it("keeps pursuit strictly the heaviest component", () => {
    const others = [
      SCORING_WEIGHTS.adversary,
      SCORING_WEIGHTS.customer,
      SCORING_WEIGHTS.capability,
      SCORING_WEIGHTS.recency,
      SCORING_WEIGHTS.magnitude,
    ];
    expect(Math.max(...others)).toBeLessThan(SCORING_WEIGHTS.pursuit);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("scoreSignal — pursuit", () => {
  it("scores a direct touch on a tracked opportunity at 1.0", () => {
    const r = scoreSignal(signal({ subjectIds: ["opp-7"] }), ctx({ trackedOppIds: new Set(["opp-7"]) }), NOW);
    expect(r.pursuit).toBe(1.0);
    expect(r.whySurfaced).toContain("Direct touch on tracked entity opp-7");
  });

  it("scores a direct touch on a tracked award at 1.0", () => {
    const r = scoreSignal(signal({ subjectIds: ["awd-3"] }), ctx({ trackedAwardIds: new Set(["awd-3"]) }), NOW);
    expect(r.pursuit).toBe(1.0);
  });

  it("scores a pursuit-linked org at 0.6, not 1.0", () => {
    const r = scoreSignal(signal({ subjectIds: ["org-9"] }), ctx({ pursuitOrgIds: new Set(["org-9"]) }), NOW);
    expect(r.pursuit).toBe(0.6);
  });

  it("takes the direct touch when a signal is both direct and org-linked", () => {
    const r = scoreSignal(
      signal({ subjectIds: ["opp-7"], relatedIds: ["org-9"] }),
      ctx({ trackedOppIds: new Set(["opp-7"]), pursuitOrgIds: new Set(["org-9"]) }),
      NOW
    );
    expect(r.pursuit).toBe(1.0);
  });

  it("searches relatedIds as well as subjectIds", () => {
    const r = scoreSignal(signal({ subjectIds: [], relatedIds: ["org-9"] }), ctx({ pursuitOrgIds: new Set(["org-9"]) }), NOW);
    expect(r.pursuit).toBe(0.6);
  });

  it("scores an untouched signal at 0", () => {
    expect(scoreSignal(signal({ subjectIds: ["nobody"] }), ctx(), NOW).pursuit).toBe(0);
  });
});

describe("scoreSignal — adversary and customer", () => {
  it("scores an active adversary at 1.0 and an archived one at 0.3", () => {
    expect(scoreSignal(signal({ subjectIds: ["a1"] }), ctx({ activeAdversaryOrgIds: new Set(["a1"]) }), NOW).adversary).toBe(1.0);
    expect(scoreSignal(signal({ subjectIds: ["a1"] }), ctx({ archivedAdversaryOrgIds: new Set(["a1"]) }), NOW).adversary).toBe(0.3);
  });

  it("prefers active over archived when an org is both", () => {
    const r = scoreSignal(
      signal({ subjectIds: ["a1"] }),
      ctx({ activeAdversaryOrgIds: new Set(["a1"]), archivedAdversaryOrgIds: new Set(["a1"]) }),
      NOW
    );
    expect(r.adversary).toBe(1.0);
  });

  it("scores an active customer at 1.0 and a historical one at 0.5", () => {
    expect(scoreSignal(signal({ subjectIds: ["c1"] }), ctx({ customerOrgIds: new Set(["c1"]) }), NOW).customer).toBe(1.0);
    expect(scoreSignal(signal({ subjectIds: ["c1"] }), ctx({ customerHistoryOrgIds: new Set(["c1"]) }), NOW).customer).toBe(0.5);
  });
});

describe("scoreSignal — capability (NAICS adjacency)", () => {
  const watch = ctx({ watchlistNaics: new Set(["336411"]) });

  it("scores an exact NAICS match at 1.0", () => {
    expect(scoreSignal(signal({ attrs: { naics: "336411" } }), watch, NOW).capability).toBe(1.0);
  });

  it("scores a same-4-digit-group NAICS as adjacent, 0.6", () => {
    expect(scoreSignal(signal({ attrs: { naics: "336412" } }), watch, NOW).capability).toBe(0.6);
  });

  it("scores a same-2-digit-sector NAICS as broader, 0.3", () => {
    expect(scoreSignal(signal({ attrs: { naics: "339999" } }), watch, NOW).capability).toBe(0.3);
  });

  it("scores an unrelated NAICS at 0", () => {
    expect(scoreSignal(signal({ attrs: { naics: "541511" } }), watch, NOW).capability).toBe(0);
  });

  it("accepts the naicsCode attr spelling as well as naics", () => {
    expect(scoreSignal(signal({ attrs: { naicsCode: "336411" } }), watch, NOW).capability).toBe(1.0);
  });

  it("scores 0 when the signal carries no NAICS at all", () => {
    expect(scoreSignal(signal({ attrs: {} }), watch, NOW).capability).toBe(0);
  });
});

describe("scoreSignal — recency decay", () => {
  const cases: Array<[string, number, number]> = [
    ["fresh (0h)", 0, 1.0],
    ["6h old", 6, 1.0],
    ["12h old", 12, 0.8],
    ["24h old", 24, 0.5],
    ["48h old", 48, 0.25],
    ["72h old", 72, 0.1],
  ];

  it.each(cases)("decays %s to %d", (_label, hoursOld, expected) => {
    const r = scoreSignal(signal({ occurredAt: NOW - hoursOld * HOUR }), ctx(), NOW);
    expect(r.recency).toBe(expected);
  });

  it("treats a future timestamp as maximally recent rather than going negative", () => {
    expect(scoreSignal(signal({ occurredAt: NOW + 5 * HOUR }), ctx(), NOW).recency).toBe(1.0);
  });

  it("explains the freshness in whySurfaced", () => {
    expect(scoreSignal(signal({ occurredAt: NOW - HOUR }), ctx(), NOW).whySurfaced).toContain("Less than 12 hours old");
    expect(scoreSignal(signal({ occurredAt: NOW - 20 * HOUR }), ctx(), NOW).whySurfaced).toContain("Posted within last day");
  });
});

describe("scoreSignal — magnitude", () => {
  it("scores 8-K item 1.01 (material definitive contract) at 0.8", () => {
    const r = scoreSignal(signal({ type: "material_event", attrs: { items: ["1.01"] } }), ctx(), NOW);
    expect(r.magnitude).toBe(0.8);
    expect(r.whySurfaced).toContain("8-K item 1.01 (material definitive contract)");
  });

  it("scores 8-K item 5.02 (executive transition) at 0.8", () => {
    expect(scoreSignal(signal({ type: "material_event", attrs: { items: ["5.02"] } }), ctx(), NOW).magnitude).toBe(0.8);
  });

  it("scores any other 8-K at 0.5", () => {
    expect(scoreSignal(signal({ type: "material_event", attrs: { items: ["9.01"] } }), ctx(), NOW).magnitude).toBe(0.5);
  });

  it("falls back to 0.3 for an unrecognized signal type instead of throwing", () => {
    const r = scoreSignal(signal({ type: "totally_new_type" as Signal["type"] }), ctx(), NOW);
    expect(r.magnitude).toBe(0.3);
    expect(r.whySurfaced).toContain("totally new type signal");
  });
});

describe("scoreSignal — total and determinism", () => {
  it("computes total as the weighted sum of its components", () => {
    const r = scoreSignal(
      signal({ subjectIds: ["opp-7", "a1", "c1"], attrs: { naics: "336411", items: ["1.01"] }, occurredAt: NOW - HOUR }),
      ctx({
        trackedOppIds: new Set(["opp-7"]),
        activeAdversaryOrgIds: new Set(["a1"]),
        customerOrgIds: new Set(["c1"]),
        watchlistNaics: new Set(["336411"]),
      }),
      NOW
    );
    expect(r).toMatchObject({ pursuit: 1, adversary: 1, customer: 1, capability: 1, recency: 1, magnitude: 0.8 });
    expect(r.total).toBeCloseTo(weightedTotal(r), 10);
    expect(r.total).toBeCloseTo(4 + 3 + 2.5 + 1.5 + 1 + 0.8, 10);
  });

  it("scores an untouched, stale, unremarkable signal near the floor", () => {
    const r = scoreSignal(signal({ occurredAt: NOW - 200 * HOUR, attrs: { items: [] } }), ctx(), NOW);
    expect(r.total).toBeCloseTo(0.1 + 0.5, 10);
  });

  it("is a pure function — identical inputs give an identical result", () => {
    const s = signal({ subjectIds: ["opp-7"], attrs: { items: ["1.01"] } });
    const c = ctx({ trackedOppIds: new Set(["opp-7"]) });
    expect(scoreSignal(s, c, NOW)).toEqual(scoreSignal(s, c, NOW));
  });

  it("always attaches at least one whySurfaced reason", () => {
    expect(scoreSignal(signal(), ctx(), NOW).whySurfaced.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("scoreAward", () => {
  it("scores a tracked award as a direct pursuit touch", () => {
    const r = scoreAward(award({ id: "awd-1" }), ctx({ trackedAwardIds: new Set(["awd-1"]) }), NOW);
    expect(r.pursuit).toBe(1.0);
    expect(r.whySurfaced).toContain("Award is itself a tracked entity in your workspace");
  });

  it("scores an untracked award whose parties touch a pursuit at 0.6", () => {
    const r = scoreAward(award({ primeOrgId: "org-9" }), ctx({ pursuitOrgIds: new Set(["org-9"]) }), NOW);
    expect(r.pursuit).toBe(0.6);
  });

  it("scores an award won by an active adversary at 1.0, archived at 0.3", () => {
    expect(scoreAward(award({ primeOrgId: "a1" }), ctx({ activeAdversaryOrgIds: new Set(["a1"]) }), NOW).adversary).toBe(1.0);
    expect(scoreAward(award({ primeOrgId: "a1" }), ctx({ archivedAdversaryOrgIds: new Set(["a1"]) }), NOW).adversary).toBe(0.3);
  });

  it("credits a toptier customer match when the direct customer misses", () => {
    const r = scoreAward(award({ customerOrgId: "sub", customerToptierOrgId: "top" }), ctx({ customerOrgIds: new Set(["top"]) }), NOW);
    expect(r.customer).toBe(1.0);
    expect(r.whySurfaced).toContain("Toptier agency in your active watchlist");
  });

  it.each([
    [60_000_000, 1.0],
    [50_000_000, 1.0],
    [20_000_000, 0.7],
    [ 5_000_000, 0.4],
    [   100_000, 0.2],
  ])("scores $%d obligated at magnitude %d", (obligated, expected) => {
    expect(scoreAward(award({ obligated }), ctx(), NOW).magnitude).toBe(expected);
  });

  it("adds an expiring bonus of 0.1 to magnitude", () => {
    const base = scoreAward(award({ obligated: 5_000_000 }), ctx(), NOW).magnitude;
    const exp = scoreAward(award({ obligated: 5_000_000, lifecycleState: "expiring" }), ctx(), NOW);
    expect(exp.magnitude).toBeCloseTo(base + 0.1, 10);
    expect(exp.whySurfaced).toContain("Expiring — recompete candidate");
  });

  it("adds a terminated bonus of 0.2 to magnitude", () => {
    const t = scoreAward(award({ obligated: 5_000_000, lifecycleState: "terminated" }), ctx(), NOW);
    expect(t.magnitude).toBeCloseTo(0.6, 10);
    expect(t.whySurfaced).toContain("Terminated — competitive opening");
  });

  it("caps the lifecycle bonus at magnitude 1.0", () => {
    expect(scoreAward(award({ obligated: 90_000_000, lifecycleState: "terminated" }), ctx(), NOW).magnitude).toBe(1.0);
  });

  it("computes total as the weighted sum, bonus included", () => {
    const r = scoreAward(award({ obligated: 5_000_000, lifecycleState: "expiring" }), ctx(), NOW);
    expect(r.total).toBeCloseTo(weightedTotal(r), 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("scoreOpportunity", () => {
  it("scores a tracked opportunity as a direct pursuit touch", () => {
    const r = scoreOpportunity(opportunity({ id: "opp-1" }), ctx({ trackedOppIds: new Set(["opp-1"]) }), NOW);
    expect(r.pursuit).toBe(1.0);
  });

  it("never assigns an adversary score — sources do not ship one on an Opp", () => {
    expect(scoreOpportunity(opportunity(), ctx({ activeAdversaryOrgIds: new Set(["anything"]) }), NOW).adversary).toBe(0);
  });

  it("takes the best NAICS match across the whole list", () => {
    const r = scoreOpportunity(
      opportunity({ naicsCodes: ["541511", "336412", "336411"] }),
      ctx({ watchlistNaics: new Set(["336411"]) }),
      NOW
    );
    expect(r.capability).toBe(1.0);
  });

  it("defaults magnitude to 0.4 when no numeric ceiling is present", () => {
    const r = scoreOpportunity(opportunity(), ctx(), NOW);
    expect(r.magnitude).toBe(0.4);
    expect(r.whySurfaced).toContain("Opportunity posted to SAM.gov");
  });

  it("adds a 0.2 solicitation bonus, capped at 1.0", () => {
    expect(scoreOpportunity(opportunity({ samgovBaseType: "Solicitation" }), ctx(), NOW).magnitude).toBeCloseTo(0.6, 10);
    expect(
      scoreOpportunity(opportunity({ estimatedValueNumeric: 80_000_000, samgovBaseType: "Combined Synopsis/Solicitation" }), ctx(), NOW).magnitude
    ).toBe(1.0);
  });

  it("computes total as the weighted sum", () => {
    const r = scoreOpportunity(opportunity({ estimatedValueNumeric: 20_000_000 }), ctx(), NOW);
    expect(r.total).toBeCloseTo(weightedTotal(r), 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("categoryFromRelevance", () => {
  const base: RelevanceComponents = {
    pursuit: 0, adversary: 0, customer: 0, capability: 0,
    recency: 0, magnitude: 0, total: 0, whySurfaced: [],
  };

  it.each([
    ["pursuit", { pursuit: 0.6 }],
    ["adversary", { adversary: 0.6 }],
    ["customer", { customer: 0.6 }],
    ["capability", { capability: 0.6 }],
  ] as const)("assigns %s at the 0.6 threshold", (expected, patch) => {
    expect(categoryFromRelevance({ ...base, ...patch })).toBe(expected);
  });

  it("falls through to context just below the threshold", () => {
    expect(categoryFromRelevance({ ...base, pursuit: 0.59, adversary: 0.59, customer: 0.59, capability: 0.59 })).toBe("context");
  });

  it("resolves ties in doctrine order: pursuit > adversary > customer > capability", () => {
    expect(categoryFromRelevance({ ...base, pursuit: 1, adversary: 1, customer: 1, capability: 1 })).toBe("pursuit");
    expect(categoryFromRelevance({ ...base, adversary: 1, customer: 1, capability: 1 })).toBe("adversary");
    expect(categoryFromRelevance({ ...base, customer: 1, capability: 1 })).toBe("customer");
  });

  it("assigns context to an all-zero item", () => {
    expect(categoryFromRelevance(base)).toBe("context");
  });
});
