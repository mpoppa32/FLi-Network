#!/usr/bin/env node
/**
 * REPAIR — remove a DELETED meeting's id from the `node.meetings` arrays that
 * still list it. Closes the residue of the 2026-08-25 hard delete.
 *
 * WHY THIS IS NOT "RE-DECIDING THE DELETE" (Mike's ruling, 2026-08-25,
 * verbatim "repair"): removing a dead id from a history array is not revisiting
 * which records die, it is COMPLETING the deletion that was already approved.
 * The deleter deliberately refused to do this in the same breath as the delete
 * — writing to KEEP nodes needed its own authorization, and now it has one.
 *
 * SCOPE IS THE WHOLE SAFETY MODEL HERE. This program writes exactly one field
 * on exactly three nodes, and every one of those is pinned by id, by expected
 * count before, and by expected count after. It cannot touch a fourth node, a
 * second field, or a different id, and it refuses rather than adapting if the
 * live shape is not what was approved.
 *
 * THE INVARIANT IT ACTUALLY VERIFIES is not "the array is shorter". It is:
 *   1. the dead id is gone from all three arrays;
 *   2. every OTHER entry survives, in its original order;
 *   3. every other FIELD on each node is byte-identical to before.
 * (3) is the one that catches the real disaster — a write that quietly reshapes
 * a node while producing a correct-looking array.
 *
 * A NOTE ON ANDURIL, AND A CORRECTION TO THE SPEC. The instruction was "the
 * array becomes empty; leave it empty, do not delete the field." **RTDB cannot
 * represent an empty array.** Measured, not assumed — probed in the TEST
 * workspace 2026-08-25: writing `{arr: []}` over `{arr:[1,2], keep:"x"}` yields
 * `{"keep":"x"}`; the key is removed and the sibling survives. So after this
 * runs, Anduril has NO `meetings` field. That is behaviourally identical for
 * every consumer in this codebase — they all read
 * `Array.isArray(n.meetings) ? n.meetings : []` — but it is a real difference
 * from what was asked for, and it is asserted below rather than glossed.
 *
 * USAGE
 *   node scripts/repair-dangling-meeting-refs.mjs --workspace <id> --expect-name Atlas [--apply]
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`\nREPAIR — REFUSED\n${msg}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const workspace = arg("workspace");
const expectName = arg("expect-name");
const project = arg("project") ?? "fli-network";
const APPLY = argv.includes("--apply");
if (!workspace) die("--workspace <id> is required.");
if (!expectName) die("--expect-name <name> is required — checked against live info/name before any write.");

/** The deleted meeting whose id is being swept out of history arrays. */
const DEAD_MEETING = "1779914425960-rwmlx";

/** Exactly what Mike authorized, with the shape he was shown. A live array that
 *  does not match `before` means the graph moved after he decided. */
const TARGETS = [
  { key: "1776579969490", name: "Atlas", before: 6, after: 5 },
  { key: "1776709183168", name: "Mike Poppa", before: 26, after: 25 },
  { key: "1779839272913-w0y6v-3", name: "Anduril", before: 1, after: 0 },
];

function fbGet(nodePath, { allowNull = false } = {}) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corsair-rep-")), "get.json");
  const r = spawnSync("firebase", ["database:get", nodePath, "--project", project, "--output", tmp],
    { shell: true, encoding: "utf8", maxBuffer: 1024 * 1024 * 128 });
  if (r.status !== 0) die(`firebase database:get ${nodePath} exited ${r.status}\n${(r.stderr || "").trim()}`);
  if (!fs.existsSync(tmp)) die(`firebase wrote no file for ${nodePath}`);
  const v = JSON.parse(fs.readFileSync(tmp, "utf8"));
  if (v === null && !allowNull) die(`${nodePath} is empty or unreadable.`);
  return v;
}

// ── gate 1: the workspace ───────────────────────────────────────────────────
const info = fbGet(`/workspaces/${workspace}/info`);
if (String(info.name) !== String(expectName)) {
  die(`WORKSPACE MISMATCH — live name is "${info.name}", you asserted "${expectName}". Nothing written.`);
}
console.log(`Workspace confirmed: ${workspace} = "${info.name}"`);

// ── gate 2: the meeting must ACTUALLY be gone ───────────────────────────────
// Removing a reference to a meeting that still exists would be data loss, not
// repair — this is the check that separates the two.
if (fbGet(`/workspaces/${workspace}/meetings/${DEAD_MEETING}`, { allowNull: true }) !== null) {
  die(
    `Meeting ${DEAD_MEETING} STILL EXISTS. Refusing.\n` +
    "This program removes references to a DELETED meeting. If the meeting is\n" +
    "live, these are not dangling references — they are correct history."
  );
}
console.log(`Confirmed deleted: meetings/${DEAD_MEETING}`);

// ── gate 3: each node matches the approved shape ────────────────────────────
const before = [];
for (const t of TARGETS) {
  const node = fbGet(`/workspaces/${workspace}/nodes/${t.key}`, { allowNull: true });
  if (!node) die(`Node ${t.key} ("${t.name}") not found. Refusing.`);
  if (String(node.name) !== t.name) die(`Node ${t.key} is named "${node.name}", expected "${t.name}". Refusing.`);
  const arr = Array.isArray(node.meetings) ? node.meetings : null;
  if (arr === null) die(`Node ${t.key} ("${t.name}") has no meetings array. Refusing.`);
  if (arr.length !== t.before) {
    die(`Node ${t.key} ("${t.name}") has ${arr.length} meeting entries, approved shape said ${t.before}.\n` +
        "The graph moved after Mike decided. Re-present and get a fresh decision.");
  }
  if (!arr.some((x) => String(x) === DEAD_MEETING)) {
    die(`Node ${t.key} ("${t.name}") does not contain ${DEAD_MEETING}. Nothing to repair — refusing rather than writing.`);
  }
  const next = arr.filter((x) => String(x) !== DEAD_MEETING);
  if (next.length !== t.after) die(`Node ${t.key}: filtered to ${next.length}, approved shape said ${t.after}. Refusing.`);
  before.push({ ...t, node, arr, next });
}
console.log("All three nodes match the approved shape.");

// ── gate 4: capture ─────────────────────────────────────────────────────────
const outDir = path.join(ROOT, "sweep-manifests");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const capturePath = path.join(outDir, `PRE-REPAIR-CAPTURE-${workspace}-${stamp}.json`);
fs.writeFileSync(capturePath, JSON.stringify({
  capturedAt: new Date().toISOString(),
  workspace, workspaceName: info.name,
  authorization: 'Mike, 2026-08-25, verbatim "repair" (relay 023)',
  deadMeeting: DEAD_MEETING,
  note: "Full pre-repair copy of each node. Restores the arrays if this goes wrong.",
  nodes: before.map((b) => ({ key: b.key, name: b.name, record: b.node })),
}, null, 2));
const reread = JSON.parse(fs.readFileSync(capturePath, "utf8"));
if ((reread.nodes || []).length !== TARGETS.length) die("Capture re-read failed. Refusing to write.");
console.log(`Capture verified: ${capturePath}`);

// ── the payload, asserted ───────────────────────────────────────────────────
const updates = {};
for (const b of before) updates[`nodes/${b.key}/meetings`] = b.next;
const keys = Object.keys(updates);
if (keys.length !== 3) die(`Expected exactly 3 update keys, built ${keys.length}. Refusing.`);
const allowed = new Set(TARGETS.map((t) => `nodes/${t.key}/meetings`));
for (const k of keys) {
  if (!allowed.has(k)) die(`Key outside the approved set: ${k}`);
  if (!Array.isArray(updates[k])) die(`Key ${k} is not an array — this program only rewrites meetings arrays.`);
  if (updates[k].some((x) => String(x) === DEAD_MEETING)) die(`Key ${k} still contains the dead id. Refusing.`);
}

console.log(`
REPAIR PLAN — ${APPLY ? "APPLY" : "DRY RUN — nothing will be written"}
  dead meeting id ... ${DEAD_MEETING}
${before.map((b) => `  ${b.name.padEnd(12)} ${String(b.arr.length)} → ${b.next.length} entries`).join("\n")}
  capture ........... ${path.basename(capturePath)}
${before.some((b) => b.next.length === 0)
    ? "\n  NOTE: an array reaching 0 entries means RTDB REMOVES the `meetings` key\n" +
      "  entirely — an empty array is not representable. Verified below as\n" +
      "  'absent or empty', with every other field asserted unchanged.\n"
    : ""}`);

if (!APPLY) {
  console.log("Dry run complete. Re-run with --apply to write.");
  process.exit(0);
}

// ── apply ───────────────────────────────────────────────────────────────────
const updateFile = path.join(outDir, `repair-payload-${workspace}-${stamp}.json`);
fs.writeFileSync(updateFile, JSON.stringify(updates, null, 2));
console.log(`Writing ${keys.length} arrays under /workspaces/${workspace} …`);
const r = spawnSync("firebase",
  ["database:update", `/workspaces/${workspace}`, updateFile, "--project", project, "--force"],
  { shell: true, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
if (r.status !== 0) die(`firebase database:update exited ${r.status}. VERIFY STATE before re-running.`);

// ── verify, both directions ─────────────────────────────────────────────────
console.log("\nVerifying — dead id gone, every other entry and field intact …");
let ok = 0;
const problems = [];
for (const b of before) {
  const after = fbGet(`/workspaces/${workspace}/nodes/${b.key}`, { allowNull: true });
  if (!after) { problems.push(`${b.name}: node is GONE`); continue; }
  const arr = Array.isArray(after.meetings) ? after.meetings : [];

  if (arr.some((x) => String(x) === DEAD_MEETING)) problems.push(`${b.name}: dead id still present`);
  if (arr.length !== b.after) problems.push(`${b.name}: ${arr.length} entries, expected ${b.after}`);
  // Every surviving entry, in its original order.
  if (JSON.stringify(arr.map(String)) !== JSON.stringify(b.next.map(String))) {
    problems.push(`${b.name}: surviving entries differ from the intended set/order`);
  }
  // THE REAL INVARIANT — nothing else on the node moved.
  const strip = (n) => { const c = { ...n }; delete c.meetings; return JSON.stringify(c, Object.keys(c).sort()); };
  if (strip(after) !== strip(b.node)) problems.push(`${b.name}: a field OTHER than meetings changed`);

  if (!problems.some((p) => p.startsWith(b.name))) ok++;
  console.log(`  ${b.name.padEnd(12)} ${b.arr.length} → ${arr.length}` +
    `${Array.isArray(after.meetings) ? "" : "   (meetings key absent — empty array is not representable in RTDB)"}`);
}

// Nothing anywhere should still point at the dead meeting.
const nodesAfter = fbGet(`/workspaces/${workspace}/nodes`, { allowNull: true }) || {};
const stillDangling = Object.entries(nodesAfter)
  .filter(([, n]) => (Array.isArray(n.meetings) ? n.meetings : []).some((x) => String(x) === DEAD_MEETING))
  .map(([k, n]) => `${n.name} (${k})`);

console.log(`
REPAIR COMPLETE
  nodes repaired + verified ......... ${ok} of ${TARGETS.length}
  nodes anywhere still listing it ... ${stillDangling.length}   ${stillDangling.join(", ")}
  capture ........................... ${capturePath}
${problems.length ? "\n  PROBLEMS:\n    " + problems.join("\n    ") : ""}
`);
if (problems.length || stillDangling.length) process.exit(1);
