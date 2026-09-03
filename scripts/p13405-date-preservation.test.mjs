#!/usr/bin/env node
/**
 * p13405-date-preservation.test.mjs
 *
 * Pins P13.405: the P13.377 display normaliser must never persist to RTDB.
 *
 * THE BUG IT PINS (measured live 2026-09-03, not hypothetical):
 *   `rebuildMeetingsArray()` rewrites `m.meta.date` from `ts` for display, and its
 *   own comment claimed "In-memory only — this does NOT write back to RTDB." It
 *   mutates the object held in `meetingMap`, and `saveMeeting()` does
 *   `fbSet(path, m)` on the whole object — so every reprocess persisted the
 *   overwritten date. Two Atlas meetings lost their real dates this way
 *   (2026-07-20 -> 2026-08-06, 2026-08-03 -> 2026-09-03). 16 of 591 records were
 *   exposed, and that is a FLOOR: it was counted in UTC while the code uses the
 *   browser's LOCAL calendar. `meta.date` is the corpus clock — the ingest
 *   heartbeat, HPA deadline ordering, velocity and every "days ago" read it — and
 *   `ts` is the LOGGING time, so backfilled meetings were being silently re-dated
 *   to the day they were typed in.
 *
 * WHY IT EXTRACTS FROM THE HTML INSTEAD OF RE-IMPLEMENTING:
 *   A test that reimplements the logic tests the reimplementation. This one pulls
 *   the three real fragments out of `FLiIntel.html` at run time and drives those,
 *   so it cannot pass while the shipped bytes say something else. If a fragment
 *   stops matching, the test FAILS loudly rather than silently checking nothing —
 *   a vacuous green is the failure mode this file exists to avoid.
 *
 * USAGE   node scripts/p13405-date-preservation.test.mjs [path/to/FLiIntel.html]
 * EXIT    0 all assertions pass · 1 an assertion failed · 2 a fragment went missing
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = process.argv[2] || resolve(here, '..', 'FLiIntel.html');
const src = readFileSync(htmlPath, 'utf8');

function must(cond, msg) {
  if (!cond) { console.error('FRAGMENT NOT FOUND — ' + msg); console.error('The test cannot check anything. Failing loudly rather than reporting a vacuous pass.'); process.exit(2); }
}

// ── fragment 1: the helpers + Maps, verbatim from the shipped file ──
const hStart = src.indexOf('var _storedMeetingDate = new Map();');
const hEnd = src.indexOf('// ── ARRAY REBUILDERS');
must(hStart > -1 && hEnd > hStart, 'P13.405 helper block (var _storedMeetingDate ... before ARRAY REBUILDERS)');
const helpers = src.slice(hStart, hEnd);

// ── fragment 2: the normalisation body inside rebuildMeetingsArray ──
const normMatch = src.match(/if\(_mts && !isNaN\(_mts\)\)\{[\s\S]*?\n    \}/);
must(normMatch, 'the ts -> meta.date normalisation body');
must(normMatch[0].includes('_rememberStoredMeetingDate'), 'normalisation body no longer captures the stored date (P13.405 removed?)');

// ── fragment 3: the save-path swap ──
const saveMatch = src.match(/var _p13405disp = _preserveStoredMeetingDate\(m\);[\s\S]*?_restoreDisplayMeetingDate\(m, _p13405disp\);\n {2}\}/);
must(saveMatch, 'the saveMeeting date-preservation swap');

const harness = `
${helpers}
function rebuildOne(m){
  var _mts = (typeof m.meta.ts==='number') ? m.meta.ts
           : (typeof m.meta.ts==='string') ? Date.parse(m.meta.ts)
           : (typeof m.ts==='number') ? m.ts
           : (typeof m.ts==='string') ? Date.parse(m.ts) : NaN;
  ${normMatch[0]}
}
let WROTE = null;
async function fbSet(path, obj){ WROTE = JSON.parse(JSON.stringify(obj)); }
function wsPath(p){ return p; }
async function saveOne(m){
  ${saveMatch[0]}
}
export { rebuildOne, saveOne };
export const getWrote = () => WROTE;
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(harness, 'utf8').toString('base64'));
const { rebuildOne, saveOne, getWrote } = mod;

const mk = () => ({ id: 'm1', ts: '2026-08-06T09:15:13.256Z', meta: { date: '2026-07-20', title: 't' } });
const checks = [];
const check = (name, got, want) => checks.push([name, String(got), String(want)]);

// 1. load -> normalise -> save. The real scenario that destroyed two meetings.
let m = mk();
rebuildOne(m);
const display = m.meta.date;
await saveOne(m);
check('persisted date is the STORED one', getWrote().meta.date, '2026-07-20');
check('display value survives the save', m.meta.date, display);
check('normalisation still happens', display !== '2026-07-20' ? 'yes' : 'no', 'yes');

// 2. our own output must never be mistaken for the stored value on later rebuilds
rebuildOne(m); rebuildOne(m);
await saveOne(m);
check('persisted after 3 rebuilds', getWrote().meta.date, '2026-07-20');

// 3. a genuine edit arriving from RTDB must win over the remembered value
m.meta.date = '2026-07-25';
rebuildOne(m);
await saveOne(m);
check('external edit respected', getWrote().meta.date, '2026-07-25');

// 4. a meeting that was never normalised (no ts) must pass through untouched
await saveOne({ id: 'm2', meta: { date: '2026-01-02' } });
check('untracked meeting untouched', getWrote().meta.date, '2026-01-02');

let bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} got=${got} want=${want}`);
}
console.log(bad ? `\n${bad} FAILURE(S) — the display normaliser is reaching RTDB again.` : '\nall green — meta.date is safe from the display normaliser.');
process.exit(bad ? 1 : 0);
