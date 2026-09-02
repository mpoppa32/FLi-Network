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

async function readInput() {
  const arg = process.argv[2];
  if (arg) return (await import('node:fs')).readFileSync(arg, 'utf8');
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
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
console.log(`dated fields:  ${c.total} total — ${c.stated} stated, ${c.derived} derived, ${c.none} none, ${c.legacy} pre-P13.403 (no basis field)`);
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
console.log('\nOK — every dated field satisfies the contract.');
