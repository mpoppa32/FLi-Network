// Corsair — tests for the operatorData endpoint (Mission 3).
//
// Covers the surface CI's post-deploy smoke depends on (bad token → 401) plus
// the auth/method/path guards and the conservative attribution rule that keeps
// one person's commitments off another person's dossier.
//
// No network, no emulator, no secrets: `framework/rtdb` is mocked before it can
// call admin.initializeApp(), and the shared token is injected via process.env
// (which is exactly where defineSecret().value() reads it at runtime).

import { describe, it, expect, beforeEach, vi } from "vitest";

// The real module calls admin.initializeApp() + admin.database() at import
// time, which throws without credentials. Mock it with an in-memory tree.
const h = vi.hoisted(() => ({ tree: {} as Record<string, any> }));

function resolve(path: string): any {
  const parts = path.split("/").filter(Boolean);
  let cur: any = h.tree;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return cur === undefined ? null : cur;
}

function makeRef(path: string): any {
  return {
    child: (sub: string) => makeRef(`${path}/${sub}`),
    get: async () => {
      const val = resolve(path);
      return { val: () => val, exists: () => val !== null && val !== undefined };
    },
    once: async () => {
      const val = resolve(path);
      return { val: () => val, exists: () => val !== null && val !== undefined };
    },
  };
}

vi.mock("../framework/rtdb", () => ({
  db: { ref: (path: string) => makeRef(path) },
}));

// Imported after the mock declaration; vi.mock is hoisted above these.
import {
  operatorData,
  tokenMatches,
  clean,
  nOf,
  matchNodes,
  ownedBy,
} from "./operatorData";

const TOKEN = "operator-token-for-tests-0123456789";

interface CallOpts {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

/** Drive the real onRequest handler with a minimal express-shaped req/res. */
async function call(opts: CallOpts = {}): Promise<{ code: number; body: any; headers: Record<string, string> }> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;

  const req: any = {
    method: opts.method ?? "GET",
    query: opts.query ?? {},
    get: (name: string) => headers[String(name).toLowerCase()],
  };

  const out = { code: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res: any = {
    status(c: number) { out.code = c; return res; },
    json(b: any) { out.body = b; return res; },
    set(k: string, v: string) { out.headers[k] = v; return res; },
  };

  await (operatorData as unknown as (rq: any, rs: any) => Promise<void>)(req, res);
  return out;
}

const WS = "ws-test-1";

beforeEach(() => {
  process.env.OPERATOR_API_TOKEN = TOKEN;
  h.tree = {
    workspaces: {
      [WS]: {
        info: { name: "Test Workspace" },
        commitments: {
          c1: { status: "open", task: "Send the ROM", owner: "Bill Allen", deadline: "2026-08-10" },
          c2: { status: "open", task: "Undated follow-up", owner: "Tom Baron", created: "2026-08-01" },
          c3: { status: "done", task: "Closed thing", owner: "Bill Allen" },
        },
        derivedViews: {
          dailyBrief: {
            latest: {
              itemsByCategory: {
                pursuit: [{ title: "Big <award>", subtitle: "  spaced   out ", source: "sam_gov", link: "u1", relevance: { total: 9.1, whySurfaced: ["a"] } }],
                context: [{ title: "Small item", source: "dod_news", relevance: { total: 2.0 } }],
              },
            },
          },
        },
        nodes: {
          n1: { id: "n1", name: "Bill Allen", type: "person", org: "Atlas", meetings: ["m1"] },
          n2: { id: "n2", name: "Bill Akman", type: "person", org: "Atlas", meetings: [] },
        },
        meetings: {
          m1: {
            meta: { title: "Atlas sync", date: "2026-08-01" },
            intel: {
              keyPeople: [{ name: "Bill Allen", stance: "champion" }],
              actionItems: [{ owner: "Bill Allen", task: "Draft the SOW" }],
            },
          },
        },
      },
    },
  };
});

// ── auth ────────────────────────────────────────────────────────────────────
describe("operatorData auth", () => {
  it("rejects a missing Authorization header with 401", async () => {
    const r = await call({ query: { ws: WS } });
    expect(r.code).toBe(401);
    expect(r.body).toEqual({ error: "Unauthorized." });
  });

  it("rejects a wrong bearer token with 401 — the contract CI's smoke test asserts", async () => {
    const r = await call({ query: { ws: WS }, headers: { authorization: "Bearer ci-smoke-invalid-token" } });
    expect(r.code).toBe(401);
  });

  it("rejects a malformed Authorization header (no Bearer scheme) with 401", async () => {
    const r = await call({ query: { ws: WS }, headers: { authorization: TOKEN } });
    expect(r.code).toBe(401);
  });

  it("accepts a valid bearer token", async () => {
    const r = await call({ query: { ws: WS }, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.code).toBe(200);
  });

  it("accepts the X-Operator-Token fallback (the *.cloudfunctions.net bearer-interception path)", async () => {
    const r = await call({ query: { ws: WS }, headers: { "x-operator-token": TOKEN } });
    expect(r.code).toBe(200);
  });

  it("returns 500, not 200, when the secret is unset — never serves data unauthenticated", async () => {
    delete process.env.OPERATOR_API_TOKEN;
    const r = await call({ query: { ws: WS }, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.code).toBe(500);
  });

  it("authenticates BEFORE method-gating, so an unauthenticated POST leaks no 405/401 distinction", async () => {
    const r = await call({ method: "POST", query: { ws: WS } });
    expect(r.code).toBe(401);
  });
});

describe("tokenMatches", () => {
  it("matches an identical token and rejects near-misses and empties", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN + "x", TOKEN)).toBe(false);
    expect(tokenMatches("", TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, "")).toBe(false);
  });

  it("does not throw on a length mismatch (hash-first keeps timingSafeEqual safe)", () => {
    expect(() => tokenMatches("short", TOKEN)).not.toThrow();
    expect(tokenMatches("short", TOKEN)).toBe(false);
  });
});

// ── method + path guards ────────────────────────────────────────────────────
describe("operatorData request guards", () => {
  const auth = { authorization: `Bearer ${TOKEN}` };

  it("rejects POST with 405 — the endpoint is read-only", async () => {
    const r = await call({ method: "POST", query: { ws: WS }, headers: auth });
    expect(r.code).toBe(405);
  });

  it("rejects PUT and DELETE with 405", async () => {
    expect((await call({ method: "PUT", query: { ws: WS }, headers: auth })).code).toBe(405);
    expect((await call({ method: "DELETE", query: { ws: WS }, headers: auth })).code).toBe(405);
  });

  it("allows HEAD alongside GET", async () => {
    expect((await call({ method: "HEAD", query: { ws: WS }, headers: auth })).code).toBe(200);
  });

  it("rejects a missing or path-traversing ws with 400", async () => {
    expect((await call({ query: {}, headers: auth })).code).toBe(400);
    expect((await call({ query: { ws: "../users" }, headers: auth })).code).toBe(400);
    expect((await call({ query: { ws: "a.b" }, headers: auth })).code).toBe(400);
  });

  it("returns 404 for a workspace that does not exist", async () => {
    const r = await call({ query: { ws: "no-such-ws" }, headers: auth });
    expect(r.code).toBe(404);
  });
});

// ── response shaping ────────────────────────────────────────────────────────
describe("operatorData response shaping", () => {
  const auth = { authorization: `Bearer ${TOKEN}` };

  it("returns open commitments only, sorted dated-first, with an accurate openCount", async () => {
    const r = await call({ query: { ws: WS }, headers: auth });
    expect(r.code).toBe(200);
    expect(r.body.commitments.openCount).toBe(2); // c3 is done
    expect(r.body.commitments.top.map((c: any) => c.task)).toEqual(["Send the ROM", "Undated follow-up"]);
    expect(r.body.commitments.top[0].priority).toBe("med"); // default when unset
  });

  it("ranks signals by relevance.total and scrubs angle brackets / whitespace", async () => {
    const r = await call({ query: { ws: WS }, headers: auth });
    expect(r.body.signals.map((s: any) => s.total)).toEqual([9.1, 2.0]);
    expect(r.body.signals[0].title).toBe("Big award");
    expect(r.body.signals[0].subtitle).toBe("spaced out");
  });

  it("honours the signals cap and never exceeds it", async () => {
    const r = await call({ query: { ws: WS, signals: "1" }, headers: auth });
    expect(r.body.signals).toHaveLength(1);
  });

  it("sets Cache-Control: no-store", async () => {
    const r = await call({ query: { ws: WS }, headers: auth });
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  it("returns no entities unless asked, and builds a dossier when asked", async () => {
    expect((await call({ query: { ws: WS }, headers: auth })).body.entities).toEqual([]);
    const r = await call({ query: { ws: WS, entities: "Bill Allen" }, headers: auth });
    const e = r.body.entities[0];
    expect(e.name).toBe("Bill Allen");
    expect(e.stance).toBe("champion");
    expect(e.lastMeeting).toEqual({ title: "Atlas sync", date: "2026-08-01" });
    expect(e.openActionItems).toContain("Draft the SOW");
    expect(e.openActionItems).toContain("Send the ROM (due 2026-08-10)");
  });

  it("does not cross-attribute between two people sharing a first name", async () => {
    const r = await call({ query: { ws: WS, entities: "Bill Akman" }, headers: auth });
    const e = r.body.entities[0];
    expect(e.name).toBe("Bill Akman");
    expect(e.openActionItems).toEqual([]);
  });
});

// ── pure helpers ────────────────────────────────────────────────────────────
describe("nOf", () => {
  it("clamps to the cap, floors fractions, and falls back on junk", () => {
    expect(nOf("5", 15, 100)).toBe(5);
    expect(nOf("500", 15, 100)).toBe(100);
    expect(nOf("7.9", 15, 100)).toBe(7);
    expect(nOf("0", 15, 100)).toBe(15);
    expect(nOf("-3", 15, 100)).toBe(15);
    expect(nOf("abc", 15, 100)).toBe(15);
    expect(nOf(undefined, 15, 100)).toBe(15);
    expect(nOf("Infinity", 15, 100)).toBe(15);
  });
});

describe("clean", () => {
  it("strips angle brackets, collapses whitespace, and survives null/undefined", () => {
    expect(clean("<script>hi</script>")).toBe("scripthi/script");
    expect(clean("  a\n\t b  ")).toBe("a b");
    expect(clean(null)).toBe("");
    expect(clean(undefined)).toBe("");
    expect(clean(42)).toBe("42");
  });
});

describe("matchNodes", () => {
  const nodes = [
    { id: "1", name: "Rick", org: "Mountain Horse" },
    { id: "2", name: "Rick Deckard", org: "Tyrell" },
    { id: "3", name: "Tom Baron", org: "Mountain Horse Aviation" },
  ];

  it("prefers an exact case-insensitive name over substring matches", () => {
    expect(matchNodes("rick", nodes).map((n) => n.id)).toEqual(["1"]);
  });

  it("falls back to substring over name and org", () => {
    expect(matchNodes("Mountain Horse", nodes).map((n) => n.id)).toEqual(["1", "3"]);
    expect(matchNodes("Deck", nodes).map((n) => n.id)).toEqual(["2"]);
  });

  it("returns nothing for an empty term or no match", () => {
    expect(matchNodes("   ", nodes)).toEqual([]);
    expect(matchNodes("Ikeuchi", nodes)).toEqual([]);
  });
});

describe("ownedBy — conservative attribution", () => {
  const allen = { name: "Bill Allen" };
  const akman = { name: "Bill Akman" };

  it("matches an exact name and an embedded name", () => {
    expect(ownedBy("Bill Allen", allen)).toBe(true);
    expect(ownedBy("bill allen", allen)).toBe(true);
    expect(ownedBy("Bill Allen <bill@atlas.com>", allen)).toBe(true);
  });

  it("matches a bare first name to its node", () => {
    expect(ownedBy("Bill", allen)).toBe(true);
    expect(ownedBy("Allen", allen)).toBe(true);
  });

  it("NEVER attributes a different full name that shares a first name", () => {
    expect(ownedBy("Bill Akman", allen)).toBe(false);
    expect(ownedBy("Bill Allen", akman)).toBe(false);
  });

  it("rejects empty owners, empty node names, and sub-3-char tokens", () => {
    expect(ownedBy("", allen)).toBe(false);
    expect(ownedBy(null, allen)).toBe(false);
    expect(ownedBy("Bill Allen", { name: "" })).toBe(false);
    expect(ownedBy("Al", allen)).toBe(false);
  });
});
