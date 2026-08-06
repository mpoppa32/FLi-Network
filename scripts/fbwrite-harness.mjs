// Corsair — fbSet / fbRemove wedge harness (P13.398).
//
// WHY THIS EXISTS. Meeting PROCESS hung forever on 2026-08-06: "Analyzing"
// with no error, no console output, zero requests to anthropicProxy. Cause was
// fbSet awaiting its own fire-and-forget SDK promise after the REST path fell
// through on a 503. A hang never rejects, so nothing could report it, and
// saveMeeting — the first await in the process path — never returned.
//
// `node --check` passed the broken version. Only a harness that can SIMULATE
// THE WEDGE catches this, so this drives the shipped fbSet/fbRemove source,
// extracted from FLiIntel.html by marker, against stubs where the SDK promise
// never settles and REST returns 503 — the exact observed combination.
//
//   node scripts/fbwrite-harness.mjs
//
// NOT wired into CI (the workflow's test step is `npm test` inside functions/;
// the front end has no test infrastructure). Run by hand after touching the
// write layer. Takes ~35s — it waits out several 8s wedge timeouts.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "FLiIntel.html"), "utf8");

const START = "var FB_WEDGE_MS =";
const END = "// P13.139 — expose for POC promote";
const s = html.indexOf(START);
const e = html.indexOf(END, s);
if (s === -1 || e === -1) {
  console.error("FAILED to locate the write layer in FLiIntel.html — markers moved. Fix this script, do not delete it.");
  process.exit(2);
}
// fbRemove lives further down; pull it by its own markers.
const rs = html.indexOf("async function fbRemove(path){");
const re = html.indexOf("function wsPath(sub)", rs);
if (rs === -1 || re === -1) { console.error("FAILED to locate fbRemove."); process.exit(2); }
const src = html.slice(s, e) + "\n" + html.slice(rs, re);
for (const needed of ["async function fbSet", "async function fbRemove", "_fbTimeout", "_fbRestWrite"]) {
  if (!src.includes(needed)) { console.error(`Extracted region missing ${needed} — refusing a vacuous check.`); process.exit(2); }
}

let warns = [], errors = [], toasts = [], health = [], ss = [];
let restMode = "ok";   // ok | http503 | reject | hang
let sdkMode = "resolve"; // resolve | hang | reject

const realLog = console.log;
globalThis.console = { ...console, warn: (...a) => warns.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) };
globalThis.setSS = (s) => ss.push(s);
globalThis.toast = (m) => toasts.push(m);
globalThis.recordPipelineEvent = (kind, detail) => health.push({ kind, ...detail });
globalThis.db = {};
globalThis.ref = (_db, p) => ({ path: p });
const sdk = () => {
  if (sdkMode === "reject") return Promise.reject(new Error("sdk rejected"));
  if (sdkMode === "hang") return new Promise(() => {});   // the wedge
  return Promise.resolve();
};
globalThis.set = sdk;
globalThis.remove = sdk;
globalThis.window = { currentUser: { getIdToken: async () => "tok-123" } };
globalThis.fetch = async (url, opts) => {
  if (restMode === "reject") throw new Error("network down");
  if (restMode === "hang") { await new Promise((r) => setTimeout(r, 30000)); return { ok: true, status: 200 }; }
  if (restMode === "http503") return { ok: false, status: 503 };
  return { ok: true, status: 200 };
};

const { fbSet, fbRemove } = new Function(
  "return (function(){ " + src + "; return { fbSet:fbSet, fbRemove:fbRemove }; })()"
)();

const reset = () => { warns = []; errors = []; toasts = []; health = []; ss = []; restMode = "ok"; sdkMode = "resolve"; };
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; realLog(`  PASS  ${name}`); }
  else { fail++; realLog(`  FAIL  ${name} ${extra}`); }
};
const settles = async (p) => {
  let done = false;
  const r = await Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((res) => setTimeout(() => res("HUNG"), 20000))]);
  return r;
};

realLog("fbSet / fbRemove wedge harness — drives the shipped FLiIntel.html source\n");

// 1. Happy path.
reset();
check("fbSet resolves on the happy path", (await settles(fbSet("p/x", { a: 1 }))) === "resolved");
check("happy path reports live", ss.includes("live"));
check("happy path raises no health event", health.length === 0);

// 2. THE BUG: REST 503 + SDK hang. Old code hung forever here.
reset();
restMode = "http503"; sdkMode = "hang";
const r2 = await settles(fbSet("p/wedged", { a: 1 }));
check("REST 503 + wedged SDK REJECTS instead of hanging", r2 === "rejected", `(got ${r2})`);
check("failure sets sync state to error", ss.includes("error"));
check("failure raises a persist_error health event", health.some((h) => h.kind === "persist_error"));
check("failure toasts the operator", toasts.length === 1, JSON.stringify(toasts));
check("error names both paths", errors.some((e) => e.includes("REST") && e.includes("SDK")), JSON.stringify(errors));
check("error names the wedge", errors.some((e) => e.includes("P13.354")));

// 3. A 503 alone must not be treated as 'REST unavailable, silently use SDK'.
reset();
restMode = "http503"; sdkMode = "resolve";
check("503 with healthy SDK still completes", (await settles(fbSet("p/y", { a: 1 }))) === "resolved");
check("but the REST failure is logged, not swallowed", warns.some((w) => w.includes("REST path failed") && w.includes("503")), JSON.stringify(warns));

// 4. A hung getIdToken (network call) must not hang the write.
reset();
restMode = "ok"; sdkMode = "hang";
globalThis.window.currentUser.getIdToken = () => new Promise(() => {});
const r4 = await settles(fbSet("p/tok", { a: 1 }));
check("hung getIdToken does not hang fbSet", r4 === "rejected", `(got ${r4})`);
check("getIdToken timeout is named in the error", errors.some((e) => e.includes("getIdToken")), JSON.stringify(errors));
globalThis.window.currentUser.getIdToken = async () => "tok-123";

// 5. No signed-in user — must fail loudly, not hang.
reset();
sdkMode = "hang";
const savedUser = globalThis.window.currentUser;
globalThis.window.currentUser = null;
check("missing user does not hang", (await settles(fbSet("p/nouser", { a: 1 }))) === "rejected");
check("missing user is explained", errors.some((e) => e.includes("no signed-in user")), JSON.stringify(errors));
globalThis.window.currentUser = savedUser;

// 5b. [P13.399] The notification itself must not fail silently. This was a
// `catch(_){}` — the reason the 2026-08-06 wedge run could not answer whether
// the toast fired and went unseen or threw.
reset();
restMode = "http503"; sdkMode = "hang";
const goodToast = globalThis.toast;
globalThis.toast = () => { throw new Error("toast element missing"); };
await settles(fbSet("p/toastthrows", { a: 1 }));
check("a throwing toast is reported, not swallowed", warns.some((w) => w.includes("toast() threw")), JSON.stringify(warns));
check("the write failure is still raised when the toast throws", errors.some((e) => e.includes("could not confirm")));
globalThis.toast = goodToast;

reset();
restMode = "http503"; sdkMode = "hang";
globalThis.toast = undefined;
await settles(fbSet("p/notoast", { a: 1 }));
check("an unavailable toast is reported", warns.some((w) => w.includes("toast() unavailable")), JSON.stringify(warns));
globalThis.toast = goodToast;

// 6. fbRemove has the identical protections.
reset();
restMode = "http503"; sdkMode = "hang";
const r6 = await settles(fbRemove("p/gone"));
check("fbRemove rejects instead of hanging", r6 === "rejected", `(got ${r6})`);
check("fbRemove raises a health event", health.some((h) => h.stage === "fbRemove"));

reset();
check("fbRemove resolves on the happy path", (await settles(fbRemove("p/ok"))) === "resolved");

realLog(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
