#!/usr/bin/env node
/**
 * verify-dated-extraction.mjs — P13.403 acceptance test.
 *
 * Checks emitted meeting intel against the DEADLINE CAPTURE contract added to the
 * extraction prompt (`_INTEL_SCHEMA_TAIL` in FLiIntel.html). Read-only: it never
 * writes to Firebase and never mutates its input.
 *
 * WHY THIS EXISTS: the change is a prompt change, so the only honest acceptance is
 * to look at what the model actually emitted. Eyeballing one record proves nothing
 * repeatable, and "it looked right" is how an unmeasured error rate gets inherited
 * (LOG 2026-08-12: a Date.parse hazard survived because nothing executed against it).
 *
 * USAGE
 *   # one meeting, or the whole meetings node, as JSON on stdin or a file path
 *   firebase database:get "/workspaces/<WS>/meetings/<ID>" --project fli-network \
 *     | node scripts/verify-dated-extraction.mjs
 *   node scripts/verify-dated-extraction.mjs /tmp/meeting.json
 *
 *   # --new-only : ignore every record predating P13.403 (no basis field at all), so
 *   # you can point the whole meetings node at it without knowing which meeting you
 *   # reprocessed — the reprocessed ones are exactly the ones carrying the new fields.
 *   # Says so loudly when it finds none, rather than printing a zero-violation pass
 *   # over an empty set.
 *   firebase database:get "/workspaces/<WS>/meetings" --project fli-network -o all.json
 *   node scripts/verify-dated-extraction.mjs all.json --new-only
 *
 * EXIT CODES
 *   0  every dated field satisfies the contract
 *   1  at least one violation (each is printed with its record path)
 *   2  bad input (no JSON, no intel found)
 *
 * THE CONTRACT (must match the prompt exactly; if they drift, the prompt wins and
 * this file is the thing that is wrong):
 *   - actionItems[]: `deadline` (verbatim, may be ''), `deadlineIso` (strict
 *     YYYY-MM-DD or absent/null), `deadlineBasis` in {stated, derived, none}
 *   - milestones[]:  `date` (verbatim), `dateIso`, `dateBasis` — same rules
 *   - basis 'none'  <=>  Iso field absent or null.   Never one without the other.
 *   - A null Iso field is EXPECTED not to survive a Firebase write (RTDB drops
 *     nulls) — unverified here, and deliberately not depended on: ABSENT and NULL
 *     are treated as the same fact either way. The basis string is the durable
 *     evidence, which is why it is the field that must exist.
 */

const NEW_ONLY = process.argv.includes('--new-only');

// --baseline <pct> : the datedness this change must not fall below.
// P13.403 taught this the expensive way — the script passed a run in which the number
// the change existed to move went DOWN (38.9% -> 9.7%), because it only ever checked
// that the FIELDS were well formed. A contract check is not an outcome check. If a
// change is justified by a metric, the instrument has to assert the metric.
const BASE_I = process.argv.indexOf('--baseline');
const BASELINE = BASE_I > -1 ? parseFloat(process.argv[BASE_I + 1]) : null;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BASES = new Set(['stated', 'derived', 'none']);

/** Strict calendar validity — rejects 2026-13-45, which is date-shaped and not a date. */
function isRealIsoDate(s) {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function checkItem(item, path, cfg, out) {
  const verbatim = item[cfg.verbatim];
  const iso = item[cfg.iso];
  const basis = item[cfg.basis];

  // No basis field at all = the record predates P13.403. Under --new-only it is
  // skipped, not reported: it is out of scope, and drowning one reprocessed meeting
  // in 591 legacy complaints hides the answer the run exists to give.
  if (NEW_ONLY && basis === undefined) { out.counts.legacy++; return; }
  const isoEmpty = iso === undefined || iso === null || iso === '';

  if (basis === undefined) {
    out.violations.push(`${path}: missing "${cfg.basis}" — the item was emitted without the date question being answered`);
  } else if (!BASES.has(basis)) {
    out.violations.push(`${path}: "${cfg.basis}" is ${JSON.stringify(basis)}, expected one of ${[...BASES].join(' | ')}`);
  }

  if (!isoEmpty && !isRealIsoDate(String(iso))) {
    out.violations.push(`${path}: "${cfg.iso}" is ${JSON.stringify(iso)} — must be a real calendar date as strict YYYY-MM-DD`);
  }

  // The two-way lock. Either half alone is the failure mode that matters:
  // basis 'none' with a date = a guess wearing a refusal; a date with basis
  // 'none' = a date nothing downstream is allowed to trust.
  if (basis === 'none' && !isoEmpty) {
    out.violations.push(`${path}: basis "none" but ${cfg.iso}=${JSON.stringify(iso)} — a refusal must not carry a date`);
  }
  if ((basis === 'stated' || basis === 'derived') && isoEmpty) {
    out.violations.push(`${path}: basis "${basis}" but ${cfg.iso} is empty — a claimed date must be present`);
  }

  if (verbatim === undefined) {
    out.violations.push(`${path}: missing "${cfg.verbatim}" — the verbatim field is never dropped`);
  }

  out.counts.total++;
  if (BASES.has(basis)) out.counts[basis]++;
  // Legacy records predate P13.403 entirely: no basis field at all.
  if (basis === undefined) out.counts.legacy++;
}

function checkIntel(intel, path, out) {
  (intel.actionItems || []).forEach((a, i) =>
    checkItem(a, `${path}.actionItems[${i}] "${String(a.task || '').slice(0, 48)}"`,
      { verbatim: 'deadline', iso: 'deadlineIso', basis: 'deadlineBasis' }, out));
  (intel.milestones || []).forEach((m, i) =>
    checkItem(m, `${path}.milestones[${i}] "${String(m.milestone || '').slice(0, 48)}"`,
      { verbatim: 'date', iso: 'dateIso', basis: 'dateBasis' }, out));
}

/** Accepts a single meeting record, a map of meetings, or a bare intel object. */
function collect(root, out) {
  if (!root || typeof root !== 'object') return 0;
  if (root.intel) { checkIntel(root.intel, root.id || root.meta?.title || 'meeting', out); return 1; }
  if (Array.isArray(root.actionItems) || Array.isArray(root.milestones)) { checkIntel(root, 'intel', out); return 1; }
  let n = 0;
  for (const [key, val] of Object.entries(root)) {
    if (val && typeof val === 'object' && val.intel) { checkIntel(val.intel, key, out); n++; }
  }
  return n;
}

/**
 * Decode by BOM, not by assumption. PowerShell's `>` redirect writes UTF-16LE with a
 * BOM, so `firebase database:get ... > all.json` on Windows produces a file that is
 * valid JSON and unreadable as UTF-8 — it fails on a mojibake character that looks
 * like corrupt data rather than an encoding mismatch. Read bytes, check the first
 * few, decode accordingly. (`-o all.json` on the firebase CLI avoids it entirely.)
 */
function decodeByBom(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return Buffer.from(buf.slice(2)).swap16().toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  // No BOM: a UTF-16LE stream of ASCII JSON still has a NUL in byte 1.
  if (buf.length >= 2 && buf[0] !== 0x00 && buf[1] === 0x00) return buf.toString('utf16le');
  return buf.toString('utf8');
}

async function readInput() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--baseline');
  const arg = args.find((a, i) => !a.startsWith('--') && !(bi > -1 && i === bi + 1));
  if (arg) return decodeByBom((await import('node:fs')).readFileSync(arg));
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return decodeByBom(Buffer.concat(chunks));
}

const raw = (await readInput()).trim();
if (!raw) { console.error('No input. Pipe JSON in, or pass a file path.'); process.exit(2); }

let parsed;
try { parsed = JSON.parse(raw); }
catch (e) { console.error('Input is not JSON: ' + e.message); process.exit(2); }

const out = { violations: [], counts: { total: 0, stated: 0, derived: 0, none: 0, legacy: 0 } };
const meetings = collect(parsed, out);
if (!meetings) { console.error('No meeting intel found in the input.'); process.exit(2); }

const c = out.counts;
const dated = c.stated + c.derived;
const pct = c.total ? ((dated / c.total) * 100).toFixed(1) : '0.0';
console.log(`meetings read: ${meetings}`);
console.log(`dated fields:  ${c.total} total — ${c.stated} stated, ${c.derived} derived, ${c.none} none${NEW_ONLY ? '' : `, ${c.legacy} pre-P13.403 (no basis field)`}`);
if (NEW_ONLY) console.log(`skipped:       ${c.legacy} pre-P13.403 field(s) with no basis, out of scope`);
if (NEW_ONLY && c.total === 0) {
  console.log('\nNOTHING TO CHECK — no record carries the P13.403 fields yet.');
  console.log('Either no meeting has been reprocessed since the deploy, or the reprocess did not take.');
  process.exit(1);
}
// Datedness is counted from what was EMITTED, not from what is valid, so it is only
// a real number once the contract holds. Printing it beside violations without saying
// so is exactly the confident-wrong-figure failure this system keeps paying for.
const suffix = out.violations.length
  ? '   ⚠ UNRELIABLE — violations below inflate this; fix them, then re-read'
  : '   (baseline before this change: ~6%)';
console.log(`DATEDNESS:     ${dated}/${c.total} = ${pct}%${suffix}`);

if (out.violations.length) {
  console.log(`\n${out.violations.length} CONTRACT VIOLATION(S):`);
  out.violations.forEach(v => console.log('  - ' + v));
  process.exit(1);
}
console.log('\nCONTRACT OK — every dated field is well formed.');

if (BASELINE !== null && !Number.isNaN(BASELINE)) {
  const got = parseFloat(pct);
  if (got + 1e-9 < BASELINE) {
    console.log(`\nOUTCOME FAIL — datedness ${got}% is BELOW the ${BASELINE}% baseline.`);
    console.log('The fields are well formed and the number this change exists to move went the wrong way.');
    console.log('A passing contract is not a working feature.');
    process.exit(1);
  }
  console.log(`OUTCOME OK — datedness ${got}% meets the ${BASELINE}% baseline.`);
} else {
  console.log('(no --baseline given: contract checked, OUTCOME NOT CHECKED)');
}
