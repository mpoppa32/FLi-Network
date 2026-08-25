#!/usr/bin/env node
/**
 * ACTION-ITEM SWEEP MANIFEST GENERATOR — read-only.
 *
 * WHY THIS IS IN THE REPO (relay 018, ruled a precondition of the sweep).
 * The manifest that authorised the 41-record sweep was generated on 2026-08-12
 * by an ad-hoc script in a session scratchpad. It survived a week on disk by
 * luck, was never versioned, and by 2026-08-18 described a corpus that no
 * longer existed (three new meetings ingested since). An acceptance artifact
 * that cannot be regenerated is not an acceptance artifact.
 *
 * THREE RULES THIS SCRIPT ENCODES:
 *
 *   1. THE MANIFEST IS THE SHIPPED SELECTOR'S OUTPUT, NOT A SECOND OPINION.
 *      It imports `functions/lib/jobs/actionItemArchive.js` — the compiled
 *      module the sweep itself will call. Manifest v1 was a parallel
 *      reimplementation and under-reported by 2 records (LOG 2026-08-12). If
 *      you find yourself writing the rule twice, the second copy is the bug.
 *
 *   2. THE OUTPUT NEVER ENTERS GIT. It carries verbatim task text, owner
 *      names and customer meeting titles from live Atlas; this repo is PUBLIC.
 *      Written to `sweep-manifests/`, which is gitignored. Standing rule.
 *
 *   3. IT IS READ-ONLY. This script has no write path to Atlas — not a
 *      disabled one, not a flagged one. The sweep is a separate program.
 *
 * USAGE
 *   node scripts/sweep-manifest.mjs --workspace <id> [--project fli-network]
 *   node scripts/sweep-manifest.mjs --workspace <id> --from-file meetings.json
 *
 * `--workspace` is REQUIRED and never defaulted: workspaces are fully dynamic
 * and a hardcoded id is how a sweep runs against the wrong tenant (Rule 4).
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Everything fails LOUDLY here. No silent fallbacks — a manifest built on a
 *  guess is worse than no manifest, because it looks authoritative. */
function die(msg) {
  console.error(`\nSWEEP MANIFEST — REFUSED\n${msg}\n`);
  process.exit(1);
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const workspace = arg("workspace");
const project = arg("project") ?? "fli-network";
const fromFile = arg("from-file");
const outArg = arg("out");
if (!workspace) {
  die(
    "--workspace <id> is required.\n" +
    "Workspaces are dynamic; this script will not guess which tenant to read.\n" +
    "  firebase database:get /workspaces --shallow --project " + project
  );
}

// ── 1. the shipped selector, or nothing ─────────────────────────────────────
const LIB = path.join(ROOT, "functions/lib/jobs/actionItemArchive.js");
const SRC = path.join(ROOT, "functions/src/jobs/actionItemArchive.ts");
if (!fs.existsSync(LIB)) {
  die(`${LIB} does not exist.\nBuild it first:  cd functions && npm run build`);
}
if (fs.existsSync(SRC) && fs.statSync(SRC).mtimeMs > fs.statSync(LIB).mtimeMs) {
  die(
    `${LIB} is OLDER than its TypeScript source.\n` +
    "The manifest would describe a selector that is not the one you are about to\n" +
    "ship. Rebuild first:  cd functions && npm run build"
  );
}
const {
  isStaleActionItem,
  actionItemArchiveNote,
  hasUnguessableDeadline,
  unguessableDeadlineNotice,
  ACTION_ITEM_OVERDUE_DAYS,
} = require(LIB);
for (const [name, fn] of Object.entries({
  isStaleActionItem,
  actionItemArchiveNote,
  hasUnguessableDeadline,
  unguessableDeadlineNotice,
})) {
  if (typeof fn !== "function") die(`${LIB} does not export ${name}. Wrong build, or the module moved.`);
}

// ── 2. the corpus ───────────────────────────────────────────────────────────
const startedAt = new Date();
let meetings;
let source;
if (fromFile) {
  const p = path.resolve(fromFile);
  if (!fs.existsSync(p)) die(`--from-file ${p} does not exist.`);
  meetings = JSON.parse(fs.readFileSync(p, "utf8"));
  source = `file:${p} (mtime ${fs.statSync(p).mtime.toISOString()})`;
  console.error(
    `\n⚠  READING FROM A FILE, NOT FROM ATLAS.\n` +
    `   The corpus is as stale as that file. For a sweep, regenerate from live\n` +
    `   data in the same session — a manifest older than the run it justifies\n` +
    `   is the same class of lie as a stale relay.\n`
  );
} else {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corsair-sweep-")), "meetings.json");
  const nodePath = `/workspaces/${workspace}/meetings`;
  console.error(`Fetching ${nodePath} from ${project} …`);
  const r = spawnSync(
    "firebase",
    ["database:get", nodePath, "--project", project, "--output", tmp],
    { shell: true, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 }
  );
  if (r.status !== 0) {
    die(
      `firebase database:get exited ${r.status}.\n` +
      `Not falling back to anything — a manifest built on a partial read would be a lie.\n` +
      `stderr:\n${(r.stderr || "").trim()}`
    );
  }
  if (!fs.existsSync(tmp)) die("firebase reported success but wrote no file.");
  meetings = JSON.parse(fs.readFileSync(tmp, "utf8"));
  source = `live:${project}${nodePath}`;
  if (meetings === null) die(`${nodePath} is empty or unreadable. Wrong workspace id?`);
}
if (!meetings || typeof meetings !== "object") die("meetings node is not an object.");

// ── 3. selection ────────────────────────────────────────────────────────────
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);

/** Synthetic demo data. Matched on TITLE, not on a hardcoded record id: the id
 *  is one re-ingest away from being wrong, and the title is what identified it
 *  in the first place. EXCLUDED from the sweep, never deleted (relay 014) —
 *  removing the meeting would leave its fabricated people in the node graph, a
 *  cleanup that looks complete and is not. Queued as its own decision. */
const DEMO_TITLE = /^\s*AUDIT TEST\b/i;

const items = [];
const unguessable = [];
const sparedByReason = {};
const demoMeetingIds = new Set();

for (const mk of Object.keys(meetings)) {
  const m = meetings[mk] || {};
  const title = (m.meta && m.meta.title) || "";
  const isDemo = DEMO_TITLE.test(String(title));
  if (isDemo) demoMeetingIds.add(mk);
  const list = m.intel && m.intel.actionItems;
  if (!Array.isArray(list)) continue;

  for (let i = 0; i < list.length; i++) {
    const a = list[i] || {};
    const recordPath = `workspaces/${workspace}/meetings/${mk}/intel/actionItems/${i}`;

    // The disclosure set, tracked alongside the sweep set so the two numbers
    // come from one pass over one corpus and cannot disagree.
    if (hasUnguessableDeadline(a)) {
      unguessable.push({
        path: recordPath,
        deadline: String(a.deadline ?? ""),
        priority: a.priority || "",
        owner: a.owner || "",
        task: a.task || "",
        sourceMeeting: title,
      });
    }

    const d = isStaleActionItem(a, now);
    if (!d.stale) {
      sparedByReason[d.reason] = (sparedByReason[d.reason] || 0) + 1;
      continue;
    }
    items.push({
      path: recordPath,
      meetingId: mk,
      index: i,
      owner: a.owner || "",
      priority: a.priority || "",
      deadline: String(a.deadline ?? ""),
      daysOverdue: d.overdueDays,
      task: a.task || "",
      sourceMeeting: title,
      disposition: isDemo ? "EXCLUDED_DEMO_DATA" : "ARCHIVE",
      archivedNote: actionItemArchiveNote(d, today),
    });
  }
}
items.sort((a, b) => b.daysOverdue - a.daysOverdue || a.path.localeCompare(b.path));
const toArchive = items.filter((r) => r.disposition === "ARCHIVE");
const excluded = items.filter((r) => r.disposition === "EXCLUDED_DEMO_DATA");

// ── 4. write ────────────────────────────────────────────────────────────────
const finishedAt = new Date();
const manifest = {
  version: 3,
  generatedAt: finishedAt.toISOString(),
  generatedAtMs: finishedAt.getTime(),
  generatedBy: "scripts/sweep-manifest.mjs → functions/lib/jobs/actionItemArchive.js (the shipped selector)",
  source,
  workspace,
  rule: `>${ACTION_ITEM_OVERDUE_DAYS} days overdue on a strict-ISO deadline; free text is UNDATED and never swept`,
  authorization: "Mike, 2026-08-11, verbatim: 'and sweep those'",
  acceptance: {
    // The freshness contract, carried in the artifact so the sweep can enforce
    // it rather than a human remembering to. A manifest older than the run it
    // justifies describes a corpus that may have moved underneath it.
    maxAgeMinutes: 60,
    requirement:
      "The sweep MUST refuse to run against a manifest whose generatedAtMs is more than " +
      "maxAgeMinutes old, and MUST re-verify each path still matches before writing.",
    swept: false,
    verifiedCount: null,
  },
  counts: {
    meetings: Object.keys(meetings).length,
    selected: items.length,
    toArchive: toArchive.length,
    excludedDemoData: excluded.length,
    unguessableDeadlines: unguessable.length,
  },
  sparedByReason,
  /** The refusal, stated in the artifact in the same words the brief states it
   *  in (one builder, `unguessableDeadlineNotice`) — so the audit record and the
   *  operator's inbox can never describe the same number differently. */
  refusalNotice: unguessableDeadlineNotice(unguessable.length),
  demoMeetingIds: [...demoMeetingIds],
  /** Disclosed in the brief, never swept: a date is present but its role needs
   *  the prose read ("Before 2026-09-17" is a bound, not a due date). */
  unguessableDeadlines: unguessable,
  items,
};

const outDir = path.join(ROOT, "sweep-manifests");
fs.mkdirSync(outDir, { recursive: true });
const out = outArg
  ? path.resolve(outArg)
  : path.join(outDir, `action-items-${workspace}-${finishedAt.toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));

console.log(`
MANIFEST v3 WRITTEN — nothing has been touched in Atlas.
  ${out}

  generatedAt ....... ${manifest.generatedAt}   (sweep must run within ${manifest.acceptance.maxAgeMinutes}m)
  source ............ ${source}
  workspace ......... ${workspace}
  meetings read ..... ${manifest.counts.meetings}
  SELECTED .......... ${items.length}
    → TO ARCHIVE .... ${toArchive.length}
    → excluded demo .. ${excluded.length}   ${demoMeetingIds.size ? `(${[...demoMeetingIds].join(", ")})` : ""}
  spared ............ ${JSON.stringify(sparedByReason)}
  UNREADABLE ........ ${unguessable.length}   ← disclosed in the brief, never swept

  ${unguessableDeadlineNotice(unguessable.length)}
`);
console.log(`elapsed ${finishedAt.getTime() - startedAt.getTime()}ms`);
