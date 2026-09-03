#!/usr/bin/env node
/**
 * DECISION-METRICS BASELINE — read-only. Evidence stream A.
 *
 * WHY THIS EXISTS.
 * On 2026-08-06 `whole-system-direction-v1.md` named three decision metrics —
 * commitment slippage, pipeline velocity, nothing-dropped — and said of them:
 * "cheap to start, IMPOSSIBLE TO RECONSTRUCT LATER." Twenty-five days later no
 * instrument existed and exactly one number had ever been quoted (11.8%
 * slippage) with nothing behind it. This script is that instrument. Every day
 * it does not run is a day of curve that cannot be recovered.
 *
 * It is also the thing CLAUDE.md Rule 2 has been missing since the day Rule 2
 * was written: nothing in this system measures whether the corpus is getting
 * better or worse, so every downstream artifact inherits an unmeasured error
 * rate under a rule that forbids exactly that.
 *
 * FIVE RULES THIS SCRIPT ENCODES — each paid for by a logged failure.
 *
 *   1. THE SHIPPED SELECTOR IS THE ONLY SELECTOR. Datedness and staleness come
 *      from `functions/lib/jobs/actionItemArchive.js` — the same compiled
 *      module the sweep and the brief call. Manifest v1 reimplemented the rule
 *      in parallel and under-reported by 2 records (LOG 2026-08-12). If you
 *      find yourself writing the rule twice, the second copy is the bug.
 *
 *   2. NUMBERS ARE PUBLIC, DETAIL IS NOT. The metrics row carries counts and
 *      percentages only — no owner, no task text, no meeting title — and is
 *      written to `metrics/`, which is committed, because a curve nobody can
 *      version is not a curve. Per-item detail goes to `sweep-manifests/`,
 *      which is gitignored. THIS REPO IS PUBLIC.
 *
 *   3. A METRIC THAT CANNOT FAIL IS WORSE THAN NO METRIC. Completion rate is
 *      reported as `null` with a stated reason, NEVER as 0% or 100%. Nothing
 *      but the sweep writes completion fields — there is no operator UI to tick
 *      an item done (owed since 2026-08-11, deferred four times) — so every
 *      open item is open BY CONSTRUCTION. A completion percentage computed off
 *      that data would be a confident false pass, which is the exact shape of
 *      the P13.390 build-tag failure.
 *
 *   4. IT IS READ-ONLY. No write path to Firebase. Not a disabled one, not a
 *      flagged one.
 *
 *   5. IT FAILS LOUDLY AND REFUSES TO GUESS. Zero records is a REFUSAL, not a
 *      clean zero — a baseline of nothing looks identical to a baseline of a
 *      broken read, and one of those is a lie. `--workspace` is required and
 *      never defaulted: workspaces are fully dynamic and a hardcoded id is how
 *      a job runs against the wrong tenant (CLAUDE.md Rule 4).
 *
 * WHAT IT DELIBERATELY DOES NOT MEASURE.
 *   `meta.date` stores the date a meeting was LOGGED, not the date it happened
 *   (fact store #25 [V]: a 2026-07-29 call is stored as 2026-08-06). Any
 *   "days from meeting to action" computed off that field would be measuring
 *   data-entry lag and calling it pipeline velocity. Velocity therefore reports
 *   what the schema actually supports — record age and overdue distribution —
 *   and names the missing field rather than substituting a plausible one.
 *
 * USAGE
 *   node scripts/metrics-baseline.mjs --workspace <id> [--project fli-network]
 *   node scripts/metrics-baseline.mjs --workspace <id> --from-file meetings.json
 *   node scripts/metrics-baseline.mjs --workspace <id> --label "FLi"
 *
 * Run it for EACH workspace. Two curves, never merged — mixing tenants in one
 * series is the metric equivalent of a workspace bleed.
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
  console.error(`\nMETRICS BASELINE — REFUSED\n${msg}\n`);
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
const label = arg("label") ?? "";
if (!workspace) {
  die(
    "--workspace <id> is required.\n" +
    "Workspaces are dynamic; this script will not guess which tenant to read.\n" +
    "  firebase database:get /workspaces --shallow --project " + project
  );
}

/** FAIL FAST, NOT HALFWAY. v2 wrote the JSON row and the detail file and THEN
 *  crashed with a raw Node stack trace when `metrics/METRICS.md` was open in
 *  Word — EBUSY on Windows. Two artifacts on disk, no curve row, and a stack
 *  trace instead of a sentence. A run either happens or it does not; proving
 *  the append target is writable costs one open() and removes a half-committed
 *  state entirely. Caught on real hardware 2026-08-31. */
{
  const dir = path.join(ROOT, "metrics");
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, "METRICS.md");
  try {
    fs.appendFileSync(probe, "");
  } catch (e) {
    die(
      `Cannot append to ${probe} — ${e.code || e.message}.\n` +
      (e.code === "EBUSY" || e.code === "EPERM"
        ? "That file is open in another program (Word puts a `~$` lock file beside it).\n" +
          "Close it and run again. Nothing has been written."
        : "Fix the permission and run again. Nothing has been written.")
    );
  }
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
    "The baseline would describe a rule that is not the shipped one.\n" +
    "Rebuild first:  cd functions && npm run build"
  );
}
const { isStaleActionItem, hasUnguessableDeadline, ACTION_ITEM_OVERDUE_DAYS } = require(LIB);
for (const [name, fn] of Object.entries({ isStaleActionItem, hasUnguessableDeadline })) {
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
    `\n⚠  READING FROM A FILE, NOT FROM LIVE.\n` +
    `   The baseline is as stale as that file, and a dated row implies it is not.\n`
  );
} else {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corsair-metrics-")), "meetings.json");
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
      `Not falling back to anything — a baseline built on a partial read is a lie\n` +
      `that looks like a data point forever.\n` +
      `stderr:\n${(r.stderr || "").trim()}`
    );
  }
  if (!fs.existsSync(tmp)) die("firebase reported success but wrote no file.");
  meetings = JSON.parse(fs.readFileSync(tmp, "utf8"));
  source = `live:${project}${nodePath}`;
  if (meetings === null) die(`${nodePath} is empty or unreadable. Wrong workspace id?`);
}
if (!meetings || typeof meetings !== "object") die("meetings node is not an object.");

/** CLAUDE.md Rule 4: confirm the workspace from live `info/name` before acting.
 *  v1 took the id on trust and duly wrote a curve row for a workspace literally
 *  named TEST — one meeting, one undated item — into a series meant to carry a
 *  six-month decision. A metrics series polluted by a scratch tenant is worse
 *  than a short one, because the pollution is invisible once the row is old. */
let wsName = null;
if (!fromFile) {
  const rn = spawnSync(
    "firebase",
    ["database:get", `/workspaces/${workspace}/info/name`, "--project", project],
    { shell: true, encoding: "utf8" }
  );
  if (rn.status !== 0) die(`Could not read /workspaces/${workspace}/info/name. Refusing to label a series by an unconfirmed id.`);
  wsName = String(rn.stdout || "").trim().replace(/^"|"$/g, "");
  if (!wsName) die(`/workspaces/${workspace}/info/name is empty. Refusing rather than guessing which tenant this is.`);
  if (/^(test|demo|scratch|sandbox)\b/i.test(wsName) && argv.indexOf("--allow-test") === -1) {
    die(
      `Workspace ${workspace} is named "${wsName}".\n` +
      "Refusing to write a scratch tenant into the decision-metrics series.\n" +
      "Pass --allow-test if you genuinely mean to."
    );
  }
  console.error(`Workspace confirmed from live info/name: "${wsName}"`);
}

// ── 3. measurement ──────────────────────────────────────────────────────────
const now = Date.now();
const DAY = 86_400_000;
const today = new Date(now).toISOString().slice(0, 10);

/** Same exclusion the sweep uses, matched on TITLE not on a record id — the id
 *  is one re-ingest away from being wrong (relay 014). */
const DEMO_TITLE = /^\s*AUDIT TEST\b/i;

/** RECORD KEYS CARRY THE TIMESTAMP — in FOUR different formats, measured against
 *  the live Atlas corpus on 2026-08-31 (591 keys) rather than assumed.
 *
 *  v1 of this script recognised only `<13-digit-ms>-<suffix>` — the shape of the
 *  six recent FLi ids that happened to be in the fact store — and refused on 572
 *  of 591 Atlas records. The refusal was correct and the inference was not: six
 *  recent records from one workspace were generalised to a corpus of 591. That
 *  is the container failure in miniature, and the guard is the only reason it
 *  surfaced as a refusal instead of a wrong curve.
 *
 *  The four, with observed counts from that measurement:
 *    523  mtg-auto-<16 hex>                     first 11 hex = epoch ms   [C]
 *     30  mtg-auto-<calendar-id>_<basic-ISO-Z>  the ISO suffix            [V]
 *     19  [mtg-]<13-digit ms>-<suffix>          the digits                [V]
 *     12  <13-digit ms>                         the digits                [V]
 *
 *  THE TWO BASES ARE NOT THE SAME QUANTITY and are never silently blended.
 *  `created` is when the record was written. `occurred` is when the meeting
 *  actually happened — and the 30 calendar-derived keys carry it verbatim,
 *  which makes them the only records in the corpus where true meeting time is
 *  recoverable today. The row reports the basis mix so a reader can see what
 *  the age column is made of. */
const SANE_FROM = Date.parse("2024-01-01T00:00:00Z");
const SANE_TO = now + 7 * DAY;
const sane = (t) => (Number.isFinite(t) && t >= SANE_FROM && t <= SANE_TO ? t : null);

function recordTimeFromKey(k) {
  const s = String(k);

  // 1. Calendar-derived: `mtg-auto-<event-id>_<YYYYMMDDTHHMMSSZ>`. The suffix is
  //    the OCCURRENCE time. Recurring events repeat the id with a new suffix.
  const cal = /_(\d{8})T(\d{6})Z$/.exec(s);
  if (cal) {
    const [, d, t] = cal;
    const ms = Date.parse(
      `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T` +
      `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`
    );
    const v = sane(ms);
    if (v !== null) return { ms: v, basis: "occurred" };
  }

  // 2. `mtg-auto-<16 hex>` — the leading 11 hex digits are epoch ms. Verified
  //    across 523 records: decodes to 2026-04-19 … 2026-08-06, monotonic with
  //    the dated records around it. Eleven digits is correct for any ms value
  //    between 2004 and 2527; outside that the sane-window check rejects it.
  const auto = /^mtg-auto-([0-9a-f]{16})$/.exec(s);
  if (auto) {
    const v = sane(parseInt(auto[1].slice(0, 11), 16));
    if (v !== null) return { ms: v, basis: "created" };
  }

  // 3 & 4. Optional `mtg-` prefix, then epoch ms, with or without a suffix.
  const digits = /^(?:mtg-)?(\d{13})(?:-|$)/.exec(s);
  if (digits) {
    const v = sane(Number(digits[1]));
    if (v !== null) return { ms: v, basis: "created" };
  }

  return null;
}

const detail = [];
const spared = {};
let meetingsRead = 0;
let meetingsDemo = 0;
let meetingsArchived = 0;
let keysParsed = 0;
let keysUnparsed = 0;
const basisCounts = {};
let newestMeetingMs = null;
let itemsTotal = 0;
let itemsArchived = 0;
let itemsLive = 0;
let itemsDated = 0;
let itemsUnguessable = 0;
let itemsUndated = 0;
let itemsOverdue = 0;
let itemsWithCompletionField = 0;
const overdueDays = [];
const liveAgeDays = [];

/** Any field that would indicate a human marked something finished. If NONE of
 *  these ever appears, completion is unmeasurable and must be reported as such
 *  rather than as zero. */
const COMPLETION_FIELDS = ["done", "completed", "completedAt", "closedAt", "status"];
function hasCompletionSignal(a) {
  for (const f of COMPLETION_FIELDS) {
    const v = a[f];
    if (v === true) return true;
    if (typeof v === "string" && /^(done|complete|completed|closed)$/i.test(v.trim())) return true;
    if (f.endsWith("At") && typeof v === "string" && v.trim()) return true;
  }
  return false;
}

for (const mk of Object.keys(meetings)) {
  const m = meetings[mk] || {};
  meetingsRead++;

  const title = (m.meta && m.meta.title) || "";
  if (DEMO_TITLE.test(String(title))) { meetingsDemo++; continue; }
  if (m.archivedAt) meetingsArchived++;

  const rt = recordTimeFromKey(mk);
  const created = rt === null ? null : rt.ms;
  if (rt === null) keysUnparsed++;
  else {
    keysParsed++;
    basisCounts[rt.basis] = (basisCounts[rt.basis] || 0) + 1;
    if (newestMeetingMs === null || created > newestMeetingMs) newestMeetingMs = created;
  }

  const list = m.intel && m.intel.actionItems;
  if (!Array.isArray(list)) continue;

  for (let i = 0; i < list.length; i++) {
    const a = list[i] || {};
    itemsTotal++;

    if (a.archivedAt) { itemsArchived++; continue; }
    itemsLive++;

    if (hasCompletionSignal(a)) itemsWithCompletionField++;
    if (created !== null) liveAgeDays.push(Math.floor((now - created) / DAY));

    const unguessable = hasUnguessableDeadline(a);
    const raw = String(a.deadline ?? "").trim();
    const strictISO = /^\d{4}-\d{2}-\d{2}$/.test(raw);

    if (strictISO) itemsDated++;
    else if (unguessable) itemsUnguessable++;
    else itemsUndated++;

    const d = isStaleActionItem(a, now);
    if (d.stale) {
      itemsOverdue++;
      if (Number.isFinite(d.overdueDays)) overdueDays.push(d.overdueDays);
      detail.push({
        path: `workspaces/${workspace}/meetings/${mk}/intel/actionItems/${i}`,
        owner: a.owner || "",
        priority: a.priority || "",
        deadline: raw,
        daysOverdue: d.overdueDays,
        task: a.task || "",
        sourceMeeting: title,
      });
    } else {
      spared[d.reason] = (spared[d.reason] || 0) + 1;
    }
  }
}

// ── 4. non-vacuity — a baseline of nothing is a refusal, not a data point ───
if (meetingsRead === 0) die("Zero meetings read. That is a broken read, not an empty corpus.");
if (itemsTotal === 0) {
  die(
    `Read ${meetingsRead} meetings and found ZERO action items.\n` +
    "Refusing to write a baseline of nothing — it is indistinguishable from a\n" +
    "schema change that silently emptied this measurement, and it would sit in\n" +
    "the curve forever looking like a fact."
  );
}
/** NOTE THE SHAPE OF THIS CONDITION. The first version read
 *  `keysParsed > 0 && ...`, which made it impossible to fire in the one case
 *  that matters most — EVERY key unparsable — and it duly published a row with
 *  an empty age column and said nothing. Caught by the harness on 2026-08-31,
 *  in the script whose own header says a check that cannot fail is worse than
 *  no check. The guard now keys off the total, so 100% unparsed refuses. */
const keysTotal = keysParsed + keysUnparsed;
if (keysTotal > 0 && keysUnparsed / keysTotal > 0.05) {
  die(
    `${keysUnparsed} of ${keysTotal} record keys did not parse as \`<epoch-ms>-<suffix>\`.\n` +
    "The age curve rests on that format. Refusing rather than publishing ages\n" +
    "derived from a misread key shape — a blank age column in a committed row\n" +
    "looks like 'no items' rather than 'the reader was wrong'."
  );
}
if (keysTotal === 0) die("No meeting keys were examined at all. That is a broken read.");

const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
};

const completionMeasurable = itemsWithCompletionField > 0;

const row = {
  version: 1,
  date: today,
  generatedAt: new Date().toISOString(),
  workspace,
  workspaceName: wsName,
  label,
  source,
  rule: `slippage = shipped selector isStaleActionItem (> ${ACTION_ITEM_OVERDUE_DAYS} days past a strict-ISO deadline)`,

  corpus: {
    meetingsRead,
    meetingsDemoExcluded: meetingsDemo,
    meetingsArchived,
    daysSinceNewestMeeting: newestMeetingMs === null ? null : Math.floor((now - newestMeetingMs) / DAY),
  },

  // M1 — THE GATE METRIC. Every other number below is measured over this slice.
  datedness: {
    liveItems: itemsLive,
    withStrictISODeadline: itemsDated,
    withUnguessableDate: itemsUnguessable,
    withNoDate: itemsUndated,
    pctDated: pct(itemsDated, itemsLive),
    note:
      "Slippage is only meaningful over the dated slice. If pctDated is small, " +
      "the slippage figure describes a minority of reality and must be quoted with this number beside it.",
  },

  // M2 — SLIPPAGE.
  slippage: {
    overdueItems: itemsOverdue,
    pctOfDated: pct(itemsOverdue, itemsDated),
    pctOfLive: pct(itemsOverdue, itemsLive),
    medianDaysOverdue: median(overdueDays),
    maxDaysOverdue: overdueDays.length ? Math.max(...overdueDays) : null,
  },

  // M3 — NOTHING-DROPPED. Age of live items by record creation time.
  age: {
    medianDays: median(liveAgeDays),
    p90Days: liveAgeDays.length
      ? [...liveAgeDays].sort((a, b) => a - b)[Math.floor(liveAgeDays.length * 0.9)]
      : null,
    oldestDays: liveAgeDays.length ? Math.max(...liveAgeDays) : null,
    basisCounts,
    basis:
      "record-key timestamp, four formats, measured against the live corpus 2026-08-31. " +
      "`created` = when the record was written; `occurred` = true meeting time, carried verbatim " +
      "by calendar-derived keys. The two are counted separately and never blended silently.",
  },

  // M4 — DELIBERATELY NULL. See rule 3 in the header.
  completion: {
    measurable: completionMeasurable,
    itemsCarryingAnyCompletionField: itemsWithCompletionField,
    rate: null,
    reason: completionMeasurable
      ? "Completion fields now exist on some records. Rate still withheld until it is known WHO writes them — " +
        "if the sweep is still the only writer, the rate measures the sweep, not the operator."
      : "NOT MEASURABLE. No record carries a completion field. Nothing but the archive sweep writes one, and " +
        "there is no operator-facing way to tick an item done (owed since 2026-08-11, deferred four times). " +
        "Every item is open BY CONSTRUCTION. Reporting 0% here would be a confident false pass.",
  },

  // M5 — what the schema cannot support, named rather than substituted.
  notMeasured: {
    pipelineVelocity:
      "Requires the date a meeting HAPPENED. `meta.date` stores the date it was LOGGED " +
      "(fact store #25 [V]). Computing velocity from it would measure data-entry lag. " +
      "Unblocked by adding a true occurredAt field at ingest — AND note basisCounts.occurred above: " +
      "calendar-derived records already carry real meeting time in the key, so velocity is computable " +
      "for that slice today without any schema change.",
    captureLatency:
      "Requires occurredAt as above, plus the source timestamp from Otter/Granola.",
  },

  spared,
};

// ── 5. write — numbers public, detail private ───────────────────────────────
const metricsDir = path.join(ROOT, "metrics");
fs.mkdirSync(metricsDir, { recursive: true });
const rowPath = path.join(metricsDir, `baseline-${workspace}-${today}.json`);
fs.writeFileSync(rowPath, JSON.stringify(row, null, 2));

const detailDir = path.join(ROOT, "sweep-manifests");
fs.mkdirSync(detailDir, { recursive: true });
const detailPath = path.join(detailDir, `metrics-detail-${workspace}-${today}.json`);
fs.writeFileSync(detailPath, JSON.stringify({ generatedAt: row.generatedAt, workspace, overdue: detail }, null, 2));

// The human-readable curve. Append-only; one line per run per workspace.
const curvePath = path.join(metricsDir, "METRICS.md");
if (!fs.existsSync(curvePath)) {
  fs.writeFileSync(
    curvePath,
    "# METRICS — evidence stream A\n\n" +
    "*Append-only. One row per run per workspace, written by `scripts/metrics-baseline.mjs`.\n" +
    "Numbers only — no names, no task text; this repo is PUBLIC. Per-item detail lives in\n" +
    "gitignored `sweep-manifests/`. Never merge workspaces into one series.*\n\n" +
    "**Reading it:** `dated%` is the gate — slippage is measured only over dated items, so a\n" +
    "slippage figure quoted without it describes a minority of reality. `completion` is\n" +
    "deliberately blank until something other than the archive sweep writes a completion field.\n\n" +
    "| date | ws | label | meetings | stale-days | live items | dated% | overdue | slip%(dated) | med od | max od | med age | oldest | completion |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"
  );
}
const cell = (v) => (v === null || v === undefined ? "—" : String(v));
const curveRow =
  `| ${today} | \`${workspace}\` | ${label || "—"} | ${row.corpus.meetingsRead} | ` +
  `${cell(row.corpus.daysSinceNewestMeeting)} | ${itemsLive} | ${cell(row.datedness.pctDated)} | ` +
  `${itemsOverdue} | ${cell(row.slippage.pctOfDated)} | ${cell(row.slippage.medianDaysOverdue)} | ` +
  `${cell(row.slippage.maxDaysOverdue)} | ${cell(row.age.medianDays)} | ${cell(row.age.oldestDays)} | ` +
  `${completionMeasurable ? "see json" : "unmeasurable"} |\n`;
try {
  fs.appendFileSync(curvePath, curveRow);
} catch (e) {
  /** Not a swallow — this exits non-zero and hands the operator the exact row
   *  so the curve can be repaired by hand. The JSON artifacts above are already
   *  on disk and are the system of record; the table is the human view. */
  console.error(
    `\nCURVE APPEND FAILED — ${e.code || e.message}\n` +
    `The JSON row and detail file WERE written and are intact:\n  ${rowPath}\n  ${detailPath}\n` +
    `Only ${curvePath} could not be appended. Paste this line into it:\n\n${curveRow}`
  );
  process.exit(1);
}

// ── 6. report ───────────────────────────────────────────────────────────────
const finishedAt = new Date();
console.log(`
BASELINE WRITTEN — nothing was modified in Firebase.
  ${rowPath}
  ${detailPath}   (gitignored — carries names and task text)
  ${curvePath}    (append-only curve)

  workspace ......... ${workspace} "${wsName ?? "(from file — unconfirmed)"}" ${label ? `[${label}]` : ""}
  source ............ ${source}
  meetings read ..... ${meetingsRead}   demo excluded ${meetingsDemo}
  corpus freshness .. ${cell(row.corpus.daysSinceNewestMeeting)} days since newest record
  live items ........ ${itemsLive}   (archived ${itemsArchived} of ${itemsTotal} total)

  DATED ............. ${itemsDated}/${itemsLive} = ${cell(row.datedness.pctDated)}%   ← the gate metric
    unguessable ..... ${itemsUnguessable}
    no date ......... ${itemsUndated}
  OVERDUE ........... ${itemsOverdue}   = ${cell(row.slippage.pctOfDated)}% of dated, ${cell(row.slippage.pctOfLive)}% of live
    median .......... ${cell(row.slippage.medianDaysOverdue)} days
    worst ........... ${cell(row.slippage.maxDaysOverdue)} days
  AGE ............... basis ${JSON.stringify(basisCounts)}
  ................... median ${cell(row.age.medianDays)}d · p90 ${cell(row.age.p90Days)}d · oldest ${cell(row.age.oldestDays)}d
  COMPLETION ........ ${completionMeasurable ? "partially measurable — see json" : "NOT MEASURABLE"}
    ${row.completion.reason}

  Commit \`metrics/\`. Do NOT commit \`sweep-manifests/\` — it is gitignored for a reason.
`);
console.log(`elapsed ${finishedAt.getTime() - startedAt.getTime()}ms`);
