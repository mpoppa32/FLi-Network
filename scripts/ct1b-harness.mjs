// Corsair — CT-1b persist behavioral harness (P13.397).
//
// WHY THIS EXISTS. CT-1b failed live acceptance on 2026-08-05: on a wedged
// socket the raw SDK set() hangs forever, never rejects, so its .catch could
// never fire — the code could not report its own failure, and the guard-skip
// path was silent too, making "guard false" and "socket wedged" look identical.
// `node --check` would not have caught any of that: the old code parsed fine.
//
// So this drives the ACTUAL shipped _ct1bPersist source, extracted verbatim
// from FLiIntel.html by marker (not line number, which rots), against stubs
// that can simulate the wedge. No browser, no Firebase, no network.
//
//   node scripts/ct1b-harness.mjs
//
// NOT wired into CI: the workflow's test step runs `npm test` inside
// functions/, and the front end has no test infrastructure. Run it by hand
// after touching the recorder. Takes ~9s (it waits out the hang timeout).
//
// Proven non-vacuous 2026-08-05: run against the pre-fix implementation, 14 of
// 17 checks fail — including the hang detector with an EMPTY warning list,
// which is precisely the "nothing printed to console" symptom that was
// observed in the browser.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "FLiIntel.html"), "utf8");

// Extract by marker so this does not rot when line numbers shift.
const START = "var _ct1bBusy = false;";
const END = "function recordPipelineEvent(";
const s = html.indexOf(START);
const e = html.indexOf(END, s);
if (s === -1 || e === -1) {
  console.error("FAILED to locate _ct1bPersist in FLiIntel.html — markers moved. Fix this script, do not delete it.");
  process.exit(2);
}
const src = html.slice(s, e);
if (!/function _ct1bPersist/.test(src)) {
  console.error("Extracted region does not contain _ct1bPersist — refusing to run a vacuous check.");
  process.exit(2);
}

let warns = [];
let restCalls = [];
let sdkMode = "resolve"; // resolve | hang | throw
let restMode = "ok";     // ok | http500 | reject

const realLog = console.log;
globalThis.console = { ...console, warn: (...a) => warns.push(a.join(" ")) };
globalThis.currentWsId = "ws-1";
globalThis.db = {};
globalThis.ref = (_db, p) => ({ path: p });
globalThis.set = () => {
  if (sdkMode === "throw") throw new Error("sdk boom");
  if (sdkMode === "hang") return new Promise(() => {}); // never settles — the real bug
  return Promise.resolve();
};
globalThis.window = { currentUser: { getIdToken: async () => "tok-123" } };
globalThis.fetch = async (url, opts) => {
  restCalls.push({ url, opts });
  if (restMode === "reject") throw new Error("network down");
  return { ok: restMode === "ok", status: restMode === "ok" ? 200 : 500 };
};

const { persist, timeout } = new Function(
  "return (function(){ " + src + "; return { persist:_ct1bPersist, timeout:CT1B_TIMEOUT_MS }; })()"
)();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reset = () => { warns = []; restCalls = []; sdkMode = "resolve"; restMode = "ok"; };
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; realLog(`  PASS  ${name}`); }
  else { fail++; realLog(`  FAIL  ${name} ${extra}`); }
};

realLog("CT-1b behavioral harness — drives the shipped FLiIntel.html source\n");

// 1. Happy path — REST is the durable write.
reset();
persist({ kind: "selftest", ts: "2026-08-05T12:00:00Z" });
await sleep(50);
check("REST PUT fires on the happy path", restCalls.length === 1);
check("REST targets the pipelineHealth path", (restCalls[0]?.url || "").includes("/workspaces/ws-1/pipelineHealth/ph-"));
check("REST uses PUT with the id token", restCalls[0]?.opts?.method === "PUT" && (restCalls[0]?.url || "").includes("auth=tok-123"));
check("REST body carries the event", JSON.parse(restCalls[0]?.opts?.body || "{}").kind === "selftest");
check("happy path logs nothing", warns.length === 0, JSON.stringify(warns));

// 2. THE BUG ITSELF — SDK hangs forever, REST must still persist.
reset();
sdkMode = "hang";
persist({ kind: "selftest" });
await sleep(50);
check("REST still persists while the SDK hangs", restCalls.length === 1);
check("no premature hang warning before the timeout", !warns.some((w) => w.includes("has not settled")));

// 3. The hang is only ever detectable by clock.
reset();
sdkMode = "hang";
persist({ kind: "selftest" });
await sleep(timeout + 400);
check("hang detector warns after CT1B_TIMEOUT_MS", warns.some((w) => w.includes("has not settled")), JSON.stringify(warns));
check("hang warning names the wedge cause", warns.some((w) => w.includes("P13.354")));

// 4. Guard-skip must be loud (Rule 11) — the silence is what made this undiagnosable.
reset();
globalThis.currentWsId = null;
persist({ kind: "selftest" });
await sleep(50);
check("guard skip logs instead of failing silently", warns.some((w) => w.includes("SKIPPED")));
check("guard skip names the missing dependency", warns.some((w) => w.includes("currentWsId")));
check("guard skip performs no write", restCalls.length === 0);
globalThis.currentWsId = "ws-1";

// 5. Re-entry latch — nothing in the persist path may recurse into the recorder.
reset();
let reentered = false;
const origSet = globalThis.set;
globalThis.set = () => { if (!reentered) { reentered = true; persist({ kind: "recursive" }); } return Promise.resolve(); };
persist({ kind: "outer" });
await sleep(50);
check("re-entry is blocked and logged", warns.some((w) => w.includes("re-entry blocked")), JSON.stringify(warns));
globalThis.set = origSet;

// 6. REST failures surface, never swallowed.
reset();
restMode = "http500";
persist({ kind: "selftest" });
await sleep(50);
check("HTTP 500 from REST is logged", warns.some((w) => w.includes("HTTP 500")), JSON.stringify(warns));

reset();
restMode = "reject";
persist({ kind: "selftest" });
await sleep(50);
check("network rejection is logged", warns.some((w) => w.includes("REST persist failed")), JSON.stringify(warns));

// 7. A throwing SDK must not take the durable path down with it.
reset();
sdkMode = "throw";
persist({ kind: "selftest" });
await sleep(50);
check("SDK throw does not block the durable REST write", restCalls.length === 1);
check("SDK throw is logged", warns.some((w) => w.includes("SDK set() threw")));

realLog(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
