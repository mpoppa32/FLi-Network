#!/usr/bin/env node
/**
 * ACTION-ITEM SWEEP — the only program that writes the archive fields.
 *
 * Companion to `scripts/sweep-manifest.mjs`, and deliberately a SEPARATE
 * program: the generator has no write path to Atlas at all, so "generate a
 * manifest" can never turn into "archive 54 records" through a wrong flag.
 *
 * WHAT IT WRITES, AND ONLY THIS:
 *   workspaces/{ws}/meetings/{mk}/intel/actionItems/{i}/archivedAt   (ISO string)
 *   workspaces/{ws}/meetings/{mk}/intel/actionItems/{i}/archivedNote (string)
 *
 * It does NOT set `done`. That is not pedantry — `done: true` asserts the work
 * was FINISHED, and this rule cannot know that. Until 2026-08-11 there was no
 * completion field at all, so an item 40 days overdue may simply have been done
 * with nowhere to say so (LOG 2026-08-11). `archivedAt` is what `isOpenActionItem`
 * tests, so archiving alone removes the item from the digest and operatorData;
 * claiming completion on top of that would be a fudge factor (Rule 2).
 *
 * ARCHIVE, NEVER DELETE. The update contains no nulls — a null in an RTDB
 * multi-path update is a DELETE — and that is asserted, not merely intended.
 *
 * THE GATES (all mandatory, all in code rather than in a checklist):
 *   1. The manifest is fresh — generated within `acceptance.maxAgeMinutes`, so a
 *      run can never be justified by an artifact describing a corpus that has
 *      since moved. This is what "same session as the sweep" means mechanically.
 *   2. The manifest is for THIS workspace, and the workspace's live `info/name`
 *      matches what the operator typed. Workspaces are dynamic; confirming the
 *      target before mutating is a standing rule (CLAUDE.md Rule 4).
 *   3. Every record is RE-SELECTED live, by the shipped selector, immediately
 *      before writing — the manifest proposes, the live read disposes.
 *   4. Every record's `task` text must still match the manifest at that path.
 *      Action items are ARRAY elements: if anything re-ordered the array between
 *      manifest and sweep, index 3 is now a different task and the path is a lie.
 *      This is the check that makes an index-addressed write safe.
 *   5. Demo data is refused by meeting id AND by disposition — belt and braces.
 *
 * DRY RUN BY DEFAULT. `--apply` is required to write anything.
 *
 * USAGE
 *   node scripts/sweep-action-items.mjs --manifest <path> --workspace <id> \
 *        --expect-name Atlas [--project fli-network] [--apply]
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`\nSWEEP — REFUSED\n${msg}\n`);
  process.exit(1);
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const manifestPath = arg("manifest");
const workspace = arg("workspace");
const expectName = arg("expect-name");
const project = arg("project") ?? "fli-network";
const APPLY = argv.includes("--apply");

if (!manifestPath) die("--manifest <path> is required.");
if (!workspace) die("--workspace <id> is required. This script will not guess a tenant.");
if (!expectName) {
  die(
    "--expect-name <name> is required.\n" +
    "It is checked against the workspace's live info/name before any write, so a\n" +
    "mistyped id cannot sweep the wrong tenant silently."
  );
}

// ── the shipped selector, or nothing ────────────────────────────────────────
const LIB = path.join(ROOT, "functions/lib/jobs/actionItemArchive.js");
const SRC = path.join(ROOT, "functions/src/jobs/actionItemArchive.ts");
if (!fs.existsSync(LIB)) die(`${LIB} does not exist. Build it:  cd functions && npm run build`);
if (fs.existsSync(SRC) && fs.statSync(SRC).mtimeMs > fs.statSync(LIB).mtimeMs) {
  die(`${LIB} is OLDER than its source. Rebuild:  cd functions && npm run build`);
}
const { isStaleActionItem, actionItemArchiveNote } = require(LIB);

// ── gate 1: the manifest, and its freshness ─────────────────────────────────
if (!fs.existsSync(manifestPath)) die(`Manifest not found: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const maxAgeMinutes = manifest?.acceptance?.maxAgeMinutes ?? 60;
const ageMs = Date.now() - Number(manifest.generatedAtMs || 0);
const ageMin = ageMs / 60000;

if (!Number.isFinite(Number(manifest.generatedAtMs)) || !manifest.generatedAtMs) {
  die("Manifest carries no generatedAtMs. Regenerate it.");
}
if (ageMs < 0) die(`Manifest generatedAt is in the FUTURE (${manifest.generatedAt}). Clock skew — refusing.`);
if (ageMin > maxAgeMinutes) {
  die(
    `Manifest is ${ageMin.toFixed(1)} minutes old; the limit is ${maxAgeMinutes}.\n` +
    `  generatedAt ${manifest.generatedAt}\n` +
    "REGENERATE IT IN THIS SESSION. A sweep justified by a stale manifest is a\n" +
    "sweep against a corpus that may have moved underneath it — the whole reason\n" +
    "the freshness contract is carried inside the artifact."
  );
}
if (manifest.acceptance?.swept === true) {
  die("This manifest is already marked swept. Regenerate rather than re-running a spent artifact.");
}
if (String(manifest.workspace) !== String(workspace)) {
  die(`Manifest is for workspace ${manifest.workspace}, you passed ${workspace}.`);
}

// ── gate 2: confirm the workspace before mutation ───────────────────────────
function fbGet(nodePath) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corsair-sweep-")), "get.json");
  const r = spawnSync(
    "firebase",
    ["database:get", nodePath, "--project", project, "--output", tmp],
    { shell: true, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 }
  );
  if (r.status !== 0) die(`firebase database:get ${nodePath} exited ${r.status}\n${(r.stderr || "").trim()}`);
  if (!fs.existsSync(tmp)) die(`firebase reported success but wrote no file for ${nodePath}`);
  return JSON.parse(fs.readFileSync(tmp, "utf8"));
}

const info = fbGet(`/workspaces/${workspace}/info`);
const liveName = info && info.name;
if (!liveName) die(`Could not read /workspaces/${workspace}/info/name. Wrong id?`);
if (String(liveName) !== String(expectName)) {
  die(`WORKSPACE MISMATCH — live name is "${liveName}", you asserted "${expectName}". Nothing written.`);
}
console.log(`Workspace confirmed: ${workspace} = "${liveName}"`);

// ── gate 3-5: re-select every record against LIVE data ──────────────────────
console.log(`Re-reading /workspaces/${workspace}/meetings …`);
const meetings = fbGet(`/workspaces/${workspace}/meetings`);
if (!meetings || typeof meetings !== "object") die("meetings node unreadable.");

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const nowIso = new Date(now).toISOString();
const demoIds = new Set(manifest.demoMeetingIds || []);

const proposed = (manifest.items || []).filter((r) => r.disposition === "ARCHIVE");
const updates = {};          // RELATIVE to /workspaces/{ws}/meetings
const willArchive = [];
const skipped = [];

for (const rec of proposed) {
  const { meetingId: mk, index: i } = rec;

  // Gate 5 — demo data, refused twice over.
  if (demoIds.has(mk)) {
    skipped.push({ ...rec, why: "demo_meeting_id" });
    continue;
  }
  const m = meetings[mk];
  const list = m && m.intel && m.intel.actionItems;
  if (!Array.isArray(list)) {
    skipped.push({ ...rec, why: "meeting_or_list_gone" });
    continue;
  }
  const live = list[i];
  if (!live || typeof live !== "object") {
    skipped.push({ ...rec, why: "index_empty" });
    continue;
  }
  // Gate 4 — the path still addresses the SAME task.
  if (String(live.task || "") !== String(rec.task || "")) {
    skipped.push({ ...rec, why: "task_text_moved", liveTask: String(live.task || "").slice(0, 60) });
    continue;
  }
  // Gate 3 — the shipped selector, on the live value, right now.
  const d = isStaleActionItem(live, now);
  if (!d.stale) {
    skipped.push({ ...rec, why: `no_longer_selected:${d.reason}` });
    continue;
  }

  const note = actionItemArchiveNote(d, today);
  updates[`${mk}/intel/actionItems/${i}/archivedAt`] = nowIso;
  updates[`${mk}/intel/actionItems/${i}/archivedNote`] = note;
  willArchive.push({ path: rec.path, mk, i, daysOverdue: d.overdueDays, task: rec.task });
}

// ── the shape of the write is asserted, not assumed ─────────────────────────
const keys = Object.keys(updates);
for (const k of keys) {
  if (updates[k] === null || updates[k] === undefined || updates[k] === "") {
    die(`Refusing: update key ${k} has an empty value. A null in a multi-path update is a DELETE.`);
  }
  if (!/^[A-Za-z0-9_-]+\/intel\/actionItems\/\d+\/(archivedAt|archivedNote)$/.test(k)) {
    die(`Refusing: update key does not match the archive-field shape: ${k}`);
  }
}

console.log(`
SWEEP PLAN
  manifest .......... ${path.basename(manifestPath)}  (${ageMin.toFixed(1)}m old, limit ${maxAgeMinutes}m)
  proposed .......... ${proposed.length}
  WILL ARCHIVE ...... ${willArchive.length}
  skipped ........... ${skipped.length}
  update keys ....... ${keys.length}   (2 per record: archivedAt + archivedNote)
  mode .............. ${APPLY ? "APPLY — WILL WRITE" : "DRY RUN — nothing will be written"}
`);
if (skipped.length) {
  console.log("SKIPPED (each one named, never silently dropped):");
  for (const s of skipped) console.log(`  ${s.why.padEnd(28)} ${s.path}  ${String(s.task).slice(0, 45)}`);
  console.log("");
}

if (!APPLY) {
  console.log("Dry run complete. Re-run with --apply to write.");
  process.exit(0);
}
if (!willArchive.length) {
  // The idempotency case: a second run finds everything already archived.
  console.log("Nothing to archive — 0 records selected. This is the expected result of a second run.");
  process.exit(0);
}

// ── write: ONE multi-path update, scoped to the meetings node ───────────────
const outDir = path.join(ROOT, "sweep-manifests");
fs.mkdirSync(outDir, { recursive: true });
const updateFile = path.join(outDir, `update-${workspace}-${nowIso.replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(updateFile, JSON.stringify(updates, null, 2));

console.log(`Applying ${keys.length} keys to /workspaces/${workspace}/meetings …`);
const r = spawnSync(
  "firebase",
  ["database:update", `/workspaces/${workspace}/meetings`, updateFile, "--project", project, "--force"],
  { shell: true, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] }
);
if (r.status !== 0) die(`firebase database:update exited ${r.status}. Verify state before re-running.`);

// ── VERIFY AFTER: re-read every swept path and count what is really there ───
console.log("\nRe-reading every swept path to verify …");
const after = fbGet(`/workspaces/${workspace}/meetings`);
let verified = 0;
const unverified = [];
for (const w of willArchive) {
  const item = after?.[w.mk]?.intel?.actionItems?.[w.i];
  const ok = item && String(item.archivedAt || "").trim() !== "" && String(item.archivedNote || "").includes("Reversible: clear archivedAt");
  if (ok) verified++;
  else unverified.push(w.path);
}

console.log(`
SWEEP COMPLETE
  attempted ......... ${willArchive.length}
  VERIFIED .......... ${verified}
  unverified ........ ${unverified.length}
  update record ..... ${updateFile}   (gitignored)
`);
if (unverified.length) {
  console.error("UNVERIFIED PATHS — these did NOT come back with archive fields:");
  unverified.forEach((p) => console.error("  " + p));
  process.exit(1);
}
