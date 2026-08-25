#!/usr/bin/env node
/**
 * SYNTHETIC-DATA DELETER — the first authorized HARD DELETE in this codebase.
 *
 * Everything else that removes operator data ARCHIVES: `commitmentsAutoArchive`
 * and the action-item sweep both set fields and are reversible by clearing one.
 * This is not. `archive-never-delete` is the standing rule and this program is
 * the documented exception to it, authorized by Mike on 2026-08-25 ("delete
 * approved") against a specific manifest listing three fabricated person nodes
 * and one synthetic meeting.
 *
 * BECAUSE IT IS IRREVERSIBLE, THE DESIGN IS DIFFERENT FROM THE SWEEP:
 *
 *  1. IT NEVER DECIDES WHAT TO DELETE. It regenerates the manifest by running
 *     `synthetic-cleanup-manifest.mjs` in its own process, then checks that
 *     manifest's DELETE list against the list Mike actually approved. If they
 *     differ AT ALL — a name, an id, a count — it STOPS. His yes was against
 *     one exact list, not against "whatever the rule selects today".
 *  2. CAPTURE BEFORE DESTRUCTION. Every record is written to disk in full, and
 *     the capture file is re-read and re-parsed BEFORE a single delete runs.
 *     There is no undo for this; the capture is the undo of last resort.
 *  3. VERIFY BOTH DIRECTIONS AFTER. Deleted paths must read back null, and the
 *     KEEP nodes must read back untouched — a delete that also damaged Mike
 *     Poppa or Anduril would otherwise look like a clean success.
 *  4. DANGLER SWEEP. Deleting a meeting leaves its id behind in every
 *     `node.meetings` array that referenced it. Those are REPORTED, never
 *     silently repaired: repairing them means writing to nodes Mike told us to
 *     keep, which is exactly the re-deciding this program refuses to do.
 *
 * USAGE
 *   node scripts/synthetic-cleanup-delete.mjs --workspace <id> --expect-name Atlas [--apply]
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`\nDELETE — REFUSED\n${msg}\n`);
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

if (!workspace) die("--workspace <id> is required and is never defaulted.");
if (!expectName) die("--expect-name <name> is required — checked against live info/name before any write.");

/**
 * EXACTLY WHAT MIKE APPROVED, 2026-08-25, verbatim "delete approved", judged
 * against the manifest at commit e56503f. Pinned by BOTH id and name: the id is
 * what gets deleted, the name is what he read. A mismatch on either means the
 * corpus moved after he decided, and his authorization does not carry over.
 */
const APPROVED_NODES = [
  { key: "1779914426056-7uftp0", name: "Sarah Martinez" },
  { key: "1779914426056-wkce51", name: "Col. Robert Chen" },
  { key: "1779914426057-2vo1u2", name: "Bryce Williams" },
];
const APPROVED_MEETING = "1779914425960-rwmlx";
/** Approved to SURVIVE. Verified untouched after the delete. */
const APPROVED_KEEP = ["1776709183168", "1776579969490", "1779839272913-w0y6v-3"];

function fbGet(nodePath, { allowNull = false } = {}) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corsair-del-")), "get.json");
  const r = spawnSync("firebase", ["database:get", nodePath, "--project", project, "--output", tmp],
    { shell: true, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 });
  if (r.status !== 0) die(`firebase database:get ${nodePath} exited ${r.status}\n${(r.stderr || "").trim()}`);
  if (!fs.existsSync(tmp)) die(`firebase wrote no file for ${nodePath}`);
  const v = JSON.parse(fs.readFileSync(tmp, "utf8"));
  if (v === null && !allowNull) die(`${nodePath} is empty or unreadable.`);
  return v;
}

// ── gate 1: confirm the workspace ───────────────────────────────────────────
const info = fbGet(`/workspaces/${workspace}/info`);
if (String(info.name) !== String(expectName)) {
  die(`WORKSPACE MISMATCH — live name is "${info.name}", you asserted "${expectName}". Nothing deleted.`);
}
console.log(`Workspace confirmed: ${workspace} = "${info.name}"`);

// ── gate 2: regenerate the manifest IN THIS SESSION ─────────────────────────
const outDir = path.join(ROOT, "sweep-manifests");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const manifestPath = path.join(outDir, `synthetic-cleanup-REGEN-${workspace}-${stamp}.json`);

console.log("Regenerating the manifest from live data (never reusing a stored one) …");
const gen = spawnSync("node",
  [path.join(ROOT, "scripts/synthetic-cleanup-manifest.mjs"), "--workspace", workspace,
   "--project", project, "--out", manifestPath],
  { shell: true, encoding: "utf8" });
if (gen.status !== 0) die(`manifest generator exited ${gen.status}\n${(gen.stderr || "").trim()}`);
if (!fs.existsSync(manifestPath)) die("manifest generator reported success but wrote no file.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const ageMin = (Date.now() - Number(manifest.generatedAtMs || 0)) / 60000;
const maxAge = manifest?.acceptance?.maxAgeMinutes ?? 60;
if (!(ageMin >= 0)) die(`Manifest generatedAt is in the future. Clock skew — refusing.`);
if (ageMin > maxAge) die(`Manifest is ${ageMin.toFixed(1)}m old, limit ${maxAge}m. Refusing.`);
if (String(manifest.workspace) !== String(workspace)) die(`Manifest workspace mismatch.`);

// ── gate 3: the fresh list must equal the APPROVED list, exactly ────────────
const freshNodes = manifest.nodes.filter((n) => n.disposition === "DELETE")
  .map((n) => ({ key: n.key, name: n.name }))
  .sort((a, b) => a.key.localeCompare(b.key));
const approvedSorted = [...APPROVED_NODES].sort((a, b) => a.key.localeCompare(b.key));
const freshMeetings = manifest.syntheticMeetings.map((m) => m.id).sort();

const same = JSON.stringify(freshNodes) === JSON.stringify(approvedSorted) &&
             JSON.stringify(freshMeetings) === JSON.stringify([APPROVED_MEETING]);
if (!same) {
  die(
    "THE DELETE LIST HAS MOVED SINCE MIKE APPROVED IT. Nothing deleted.\n\n" +
    "  approved nodes : " + JSON.stringify(approvedSorted) + "\n" +
    "  fresh nodes    : " + JSON.stringify(freshNodes) + "\n" +
    "  approved meeting: " + APPROVED_MEETING + "\n" +
    "  fresh meetings  : " + JSON.stringify(freshMeetings) + "\n\n" +
    "His authorization was against the exact list above, not against whatever\n" +
    "the rule selects today. Re-present the manifest and get a fresh decision."
  );
}
console.log(`Delete list matches Mike's approved list exactly: ${freshNodes.length} nodes + 1 meeting.`);

// Any node that became a KEEP must still be a KEEP.
for (const k of APPROVED_KEEP) {
  const row = manifest.nodes.find((n) => n.key === k);
  if (!row) die(`Approved-KEEP node ${k} is no longer in the manifest at all. Refusing.`);
  if (row.disposition !== "KEEP") die(`Approved-KEEP node ${k} ("${row.name}") is now dispositioned ${row.disposition}. Refusing.`);
}

// ── gate 4: CAPTURE BEFORE DESTRUCTION ──────────────────────────────────────
console.log("Capturing every record to be deleted, in full …");
const capture = {
  capturedAt: new Date().toISOString(),
  workspace, workspaceName: info.name,
  authorization: 'Mike, 2026-08-25, verbatim "delete approved" (relay 022)',
  note: "Full pre-delete copy. This is the undo of last resort — the delete is irreversible.",
  meeting: { id: APPROVED_MEETING, record: fbGet(`/workspaces/${workspace}/meetings/${APPROVED_MEETING}`) },
  nodes: APPROVED_NODES.map((n) => ({ key: n.key, name: n.name, record: fbGet(`/workspaces/${workspace}/nodes/${n.key}`) })),
};
if (!capture.meeting.record) die("Could not read the meeting record for capture. Refusing to delete.");
for (const n of capture.nodes) if (!n.record) die(`Could not read node ${n.key} for capture. Refusing to delete.`);

const capturePath = path.join(outDir, `PRE-DELETE-CAPTURE-${workspace}-${stamp}.json`);
fs.writeFileSync(capturePath, JSON.stringify(capture, null, 2));

// Re-read and re-parse it. A capture that exists but does not parse is no capture.
const reread = JSON.parse(fs.readFileSync(capturePath, "utf8"));
if (!reread.meeting?.record?.meta?.title) die("Capture file re-read failed the sanity check. Refusing to delete.");
if ((reread.nodes || []).length !== APPROVED_NODES.length) die("Capture file is missing nodes. Refusing to delete.");
const capturedItems = (reread.meeting.record.intel?.actionItems || []).length;
console.log(`Capture verified: ${capturePath}`);
console.log(`  meeting "${reread.meeting.record.meta.title}" + ${capturedItems} action items + ${reread.nodes.length} nodes`);

// ── the delete payload, asserted ────────────────────────────────────────────
const updates = {};
updates[`meetings/${APPROVED_MEETING}`] = null;
for (const n of APPROVED_NODES) updates[`nodes/${n.key}`] = null;

const keys = Object.keys(updates);
if (keys.length !== 4) die(`Expected exactly 4 delete keys, built ${keys.length}. Refusing.`);
for (const k of keys) {
  if (updates[k] !== null) die(`Key ${k} is not null — this program only deletes.`);
  if (!/^(nodes|meetings)\/[A-Za-z0-9_-]+$/.test(k)) die(`Key outside the allowed shape: ${k}`);
}

console.log(`
DELETE PLAN — ${APPLY ? "APPLY, IRREVERSIBLE" : "DRY RUN — nothing will be deleted"}
  meeting ..... ${APPROVED_MEETING}  (+ ${capturedItems} action items nested under it)
  nodes ....... ${APPROVED_NODES.map((n) => `${n.name} (${n.key})`).join("\n                ")}
  keep ........ ${APPROVED_KEEP.join(", ")}
  capture ..... ${path.basename(capturePath)}
`);

if (!APPLY) {
  console.log("Dry run complete. Re-run with --apply to delete.");
  process.exit(0);
}

// ── apply ───────────────────────────────────────────────────────────────────
const updateFile = path.join(outDir, `delete-payload-${workspace}-${stamp}.json`);
fs.writeFileSync(updateFile, JSON.stringify(updates, null, 2));
console.log(`Deleting ${keys.length} paths under /workspaces/${workspace} …`);
const r = spawnSync("firebase",
  ["database:update", `/workspaces/${workspace}`, updateFile, "--project", project, "--force"],
  { shell: true, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
if (r.status !== 0) die(`firebase database:update exited ${r.status}. VERIFY STATE before re-running.`);

// ── verify both directions ──────────────────────────────────────────────────
console.log("\nVerifying — deleted paths must be null, kept paths must be intact …");
let deleted = 0;
const notDeleted = [];
if (fbGet(`/workspaces/${workspace}/meetings/${APPROVED_MEETING}`, { allowNull: true }) === null) deleted++;
else notDeleted.push(`meetings/${APPROVED_MEETING}`);
for (const n of APPROVED_NODES) {
  if (fbGet(`/workspaces/${workspace}/nodes/${n.key}`, { allowNull: true }) === null) deleted++;
  else notDeleted.push(`nodes/${n.key}`);
}

const keptOk = [];
const keptBad = [];
for (const k of APPROVED_KEEP) {
  const v = fbGet(`/workspaces/${workspace}/nodes/${k}`, { allowNull: true });
  if (v && v.name) keptOk.push(`${v.name} (${k})`);
  else keptBad.push(k);
}
// Anduril's reason for living: the opportunity that points at it.
const opps = fbGet(`/workspaces/${workspace}/opportunities`, { allowNull: true }) || {};
const anduril = Object.entries(opps).filter(([, o]) => String(o.customerOrgId) === "1779839272913-w0y6v-3")
  .map(([k, o]) => `${k} "${o.name}"`);

// ── dangler sweep ───────────────────────────────────────────────────────────
const deletedIds = new Set([APPROVED_MEETING, ...APPROVED_NODES.map((n) => n.key)]);
const nodesAfter = fbGet(`/workspaces/${workspace}/nodes`, { allowNull: true }) || {};
const linksAfter = fbGet(`/workspaces/${workspace}/links`, { allowNull: true }) || {};
const danglingLinks = Object.entries(linksAfter)
  .filter(([, l]) => deletedIds.has(String(l.source)) || deletedIds.has(String(l.target)))
  .map(([k, l]) => `${k}: ${l.source} -> ${l.target}`);
const danglingMeetingRefs = Object.entries(nodesAfter)
  .filter(([, n]) => (Array.isArray(n.meetings) ? n.meetings : []).some((x) => deletedIds.has(String(x))))
  .map(([k, n]) => `${n.name} (${k})`);

console.log(`
DELETE COMPLETE
  deleted ............... ${deleted} of 4 paths   ${notDeleted.length ? "STILL PRESENT: " + notDeleted.join(", ") : ""}
  kept, verified intact . ${keptOk.length} of ${APPROVED_KEEP.length}   ${keptBad.length ? "MISSING: " + keptBad.join(", ") : ""}
      ${keptOk.join("\n      ")}
  Anduril's opportunity . ${anduril.length ? anduril.join(", ") : "GONE — investigate"}
  capture ............... ${capturePath}

  DANGLERS
  links pointing at a deleted id ....... ${danglingLinks.length}   ${danglingLinks.join(", ")}
  KEEP nodes still listing the meeting . ${danglingMeetingRefs.length}
      ${danglingMeetingRefs.join("\n      ")}
`);
if (danglingMeetingRefs.length) {
  console.log(
    "  ^ REPORTED, NOT REPAIRED — deliberately. Removing that id means WRITING to\n" +
    "    nodes Mike told us to keep, which is the re-deciding this program refuses.\n" +
    "    It is his call as a follow-up. Note the pre-existing condition: the truth\n" +
    "    doc already records that node.meetings can hold ids with no record behind\n" +
    "    them, so this is a known shape, not a new class of damage.\n"
  );
}
if (notDeleted.length || keptBad.length) process.exit(1);
