// Corsair P13.138 — Follow-Up Nudge Engine (Phase 1B).
//
// Reads matched pendingCapture entries (Phase 1A matcher populates
// matchedNodeId, oppId, direction, threadId on each entry) and derives
// a follow-up state per matched entity. Classifies into:
//   awaiting_your_reply  — there's an inbound from this entity with no
//                          subsequent outbound after it
//   going_cold           — no touch in 14+ days (under 30)
//   no_recent_contact    — no touch in 30+ days
//   current              — recently touched OR replied (no nudge)
//
// Doctrine — hard line:
//   • Nudges SURFACE and ROUTE. They never draft, send, or auto-reply.
//   • Every nudge shows its reasoning (dates + direction) so the
//     operator trusts it. No black-box "you should follow up."
//   • Every nudge is dismissable (done / not now / snooze) so the
//     operator stays sovereign over their own queue.
//   • Confidence is honest. A sender-domain match gets a weaker label
//     than a sender-email match. Operator sees the source.
//
// Inputs:
//   - window.pendingCapture: array of matched entries (P13.137)
//   - window.nodes: array of person + company nodes (for entity names)
//   - window.opportunities: array of opps (for opp linkage display)
//   - window.currentUser, window.currentWsId (for dismissal persistence)
//
// Outputs:
//   window.Corsair.nudge.compute()      → Array of nudge objects
//   window.Corsair.nudge.dismiss(id, type)  → persists dismissal
//   window.Corsair.nudge.thresholds     → tunable day-thresholds in one place

import { ref, set, onValue, remove as dbRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// Day-thresholds tunable in one place per doctrine.
const THRESHOLDS = {
  // Inbound that's been sitting this many days with no operator reply
  // surfaces as awaiting_your_reply. 1 day is the minimum — under that
  // it's just same-day backlog.
  awaitingReplyMinDays: 1,
  // No touch (in/out) for this many days starts the going_cold band.
  goingColdDays: 14,
  // ... and this many days promotes to no_recent_contact.
  noRecentDays: 30,
  // Dismissal default windows.
  notNowHours: 24,
  snoozeDays: 7,
};

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// Local in-memory cache of dismissals; subscribed to RTDB so other tabs/
// devices reflect dismissals immediately.
const _dismissals = new Map(); // nudgeId → { type, dismissedAt, until }
let _dismissalsWired = false;
let _dismissalsRef = null;

function _wireDismissals() {
  if (_dismissalsWired) return;
  const db = window._fbDb || (window._fbApp && (function(){ try { return window._fbApp; } catch(e){ return null; } })());
  // The bare global `db` from the FLiIntel.html module script is what's
  // used everywhere else; reuse it.
  const dbHandle = window.db || db;
  const uid = window.currentUser && window.currentUser.uid;
  const wsId = window.currentWsId;
  if (!dbHandle || !uid || !wsId) return;
  _dismissalsRef = ref(dbHandle, 'users/' + uid + '/workspaces/' + wsId + '/nudgeDismissals');
  onValue(_dismissalsRef, function(snap) {
    _dismissals.clear();
    const v = snap.val() || {};
    Object.keys(v).forEach(function(k) {
      _dismissals.set(k, v[k]);
    });
    // Re-render brief column when dismissals change
    if (typeof window._renderNudgeColumn === 'function') {
      try { window._renderNudgeColumn(); } catch(e) { console.warn('[nudge] re-render failed', e); }
    }
  });
  _dismissalsWired = true;
}

function _isDismissed(nudgeId) {
  const d = _dismissals.get(nudgeId);
  if (!d) return false;
  if (d.type === 'done') return true;
  const until = Number(d.until || 0);
  if (until && until > Date.now()) return true;
  return false;
}

function _safeStr(s) {
  return String(s == null ? '' : s);
}

function _esc(s) {
  return window._escHTML ? window._escHTML(_safeStr(s)) : _safeStr(s);
}

// Group matched captures by matchedNodeId. Returns Map<nodeId, captures[]>.
// Unmatched entries are dropped — no entity to nudge about.
function _groupMatched(captures) {
  const out = new Map();
  for (let i = 0; i < captures.length; i++) {
    const c = captures[i];
    if (!c || !c.matchedNodeId) continue;
    const key = String(c.matchedNodeId);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(c);
  }
  return out;
}

// For a single entity's captures, compute communication state.
function _computeStateForEntity(captures) {
  let lastInboundTs = 0, lastOutboundTs = 0;
  let lastInboundEntry = null, lastOutboundEntry = null;
  for (let i = 0; i < captures.length; i++) {
    const c = captures[i];
    const ts = Number(c.ts || 0);
    if (!ts) continue;
    const dir = c.direction;
    if (dir === 'inbound') {
      if (ts > lastInboundTs) { lastInboundTs = ts; lastInboundEntry = c; }
    } else if (dir === 'outbound') {
      if (ts > lastOutboundTs) { lastOutboundTs = ts; lastOutboundEntry = c; }
    }
  }
  const lastAnyTs = Math.max(lastInboundTs, lastOutboundTs);
  return {
    lastInboundTs: lastInboundTs || null,
    lastOutboundTs: lastOutboundTs || null,
    lastAnyTs: lastAnyTs || null,
    lastInboundEntry: lastInboundEntry,
    lastOutboundEntry: lastOutboundEntry,
  };
}

// Apply thresholds → classification. Returns { type, daysSince } or null.
function _classify(state) {
  if (!state.lastAnyTs) return null;
  const now = Date.now();
  // awaiting_your_reply takes priority over time-based bands. An inbound
  // with no outbound after it is the most actionable nudge.
  if (state.lastInboundTs && (!state.lastOutboundTs || state.lastOutboundTs < state.lastInboundTs)) {
    const daysOwing = Math.floor((now - state.lastInboundTs) / DAY_MS);
    if (daysOwing >= THRESHOLDS.awaitingReplyMinDays) {
      return { type: 'awaiting_your_reply', daysSince: daysOwing };
    }
  }
  const daysSinceTouch = Math.floor((now - state.lastAnyTs) / DAY_MS);
  if (daysSinceTouch >= THRESHOLDS.noRecentDays) {
    return { type: 'no_recent_contact', daysSince: daysSinceTouch };
  }
  if (daysSinceTouch >= THRESHOLDS.goingColdDays) {
    return { type: 'going_cold', daysSince: daysSinceTouch };
  }
  return null; // current — no nudge
}

// Build the per-nudge object the UI consumes.
function _buildNudge(entityId, captures, state, classification, nodeLookup, oppLookup) {
  const node = nodeLookup.get(String(entityId)) || { id: entityId, name: '(unknown)' };
  const type = classification.type;
  const daysSince = classification.daysSince;

  // Pick a representative capture for the click-through.
  const rep = (type === 'awaiting_your_reply')
    ? state.lastInboundEntry
    : (state.lastInboundEntry || state.lastOutboundEntry);

  // Try to identify a linked opp. Prefer the rep's oppId; fall back to
  // any of the entity's captures with an oppId set.
  let oppId = (rep && rep.oppId) || null;
  let oppName = (rep && rep.oppName) || null;
  if (!oppId) {
    for (let i = 0; i < captures.length; i++) {
      if (captures[i] && captures[i].oppId) { oppId = captures[i].oppId; oppName = captures[i].oppName || null; break; }
    }
  }
  // Resolve a fresher opp name from the live opportunities list if available.
  if (oppId && oppLookup.has(String(oppId))) {
    const o = oppLookup.get(String(oppId));
    if (o && o.name) oppName = o.name;
  }

  // Plain-language reasoning so the operator trusts the surface.
  let reasoning = '';
  const matchSource = (rep && rep.matchSource) || null;
  const confLbl = (matchSource === 'sender-email') ? ''
                : (matchSource === 'attendee-email') ? ' · matched via thread attendee'
                : (matchSource === 'sender-domain') ? ' · matched via sender domain'
                : '';
  if (type === 'awaiting_your_reply') {
    const subj = (rep && rep.meta && rep.meta.title) ? ' "' + String(rep.meta.title).slice(0, 60) + '"' : '';
    reasoning = 'Inbound' + subj + ' · ' + daysSince + 'd · no reply' + confLbl;
  } else if (type === 'going_cold') {
    reasoning = 'No touch in ' + daysSince + 'd · going cold' + confLbl;
  } else if (type === 'no_recent_contact') {
    reasoning = 'No touch in ' + daysSince + 'd' + confLbl;
  }

  // Priority for sort: awaiting > going_cold > no_recent (older > fresher
  // within the same type). Caps so a 60-day going_cold doesn't outrank
  // a 3-day awaiting_your_reply.
  let priority;
  if (type === 'awaiting_your_reply') priority = 80 + Math.min(daysSince, 20);
  else if (type === 'going_cold')     priority = 40 + Math.min(daysSince - THRESHOLDS.goingColdDays, 30);
  else                                priority = 10 + Math.min(daysSince - THRESHOLDS.noRecentDays, 30);

  return {
    id: 'nudge-' + String(entityId) + '-' + type,
    type: type,
    entityId: String(entityId),
    entityName: node.name || '(unknown)',
    entityType: node.type || 'person',
    reasoning: reasoning,
    daysSince: daysSince,
    lastInboundTs: state.lastInboundTs,
    lastOutboundTs: state.lastOutboundTs,
    oppId: oppId,
    oppName: oppName,
    threadId: (rep && rep.threadId) || null,
    matchSource: matchSource,
    priority: priority,
  };
}

// Public: compute the active nudge list. Dismissed/snoozed are filtered.
function compute() {
  _wireDismissals();
  const captures = (window.pendingCapture || []).slice();
  if (!captures.length) return [];

  const grouped = _groupMatched(captures);
  if (!grouped.size) return [];

  // Resolve entity names from window.nodes
  const nodeLookup = new Map();
  const allNodes = window.nodes || [];
  for (let i = 0; i < allNodes.length; i++) {
    if (allNodes[i] && allNodes[i].id != null) nodeLookup.set(String(allNodes[i].id), allNodes[i]);
  }
  // Resolve opps for fresh names
  const oppLookup = new Map();
  const allOpps = window.opportunities || [];
  for (let i = 0; i < allOpps.length; i++) {
    if (allOpps[i] && allOpps[i].id != null) oppLookup.set(String(allOpps[i].id), allOpps[i]);
  }

  const nudges = [];
  grouped.forEach(function(entityCaptures, entityId) {
    const state = _computeStateForEntity(entityCaptures);
    const classification = _classify(state);
    if (!classification) return;
    const nudge = _buildNudge(entityId, entityCaptures, state, classification, nodeLookup, oppLookup);
    if (_isDismissed(nudge.id)) return;
    // P13.138 — "done" dismissal auto-clears when a new inbound arrives.
    // If the operator marked done at time T and there's an inbound after
    // T, the entity needs attention again. Check this against the live
    // dismissal record.
    const dismissal = _dismissals.get(nudge.id);
    if (dismissal && dismissal.type === 'done' && nudge.lastInboundTs && nudge.lastInboundTs > Number(dismissal.dismissedAt || 0)) {
      // The dismissal is stale — drop it and surface the nudge.
      if (_dismissalsRef) {
        try { dbRemove(ref(_dismissalsRef, nudge.id)); } catch(e) { /* fail-safe */ }
      }
    } else if (dismissal) {
      return;
    }
    nudges.push(nudge);
  });

  nudges.sort(function(a, b) { return b.priority - a.priority; });
  return nudges;
}

// Public: dismiss a nudge. type = 'done' | 'not_now' | 'snooze'.
async function dismiss(nudgeId, type) {
  const dbHandle = window.db;
  const uid = window.currentUser && window.currentUser.uid;
  const wsId = window.currentWsId;
  if (!dbHandle || !uid || !wsId) return;
  const now = Date.now();
  let until = 0;
  if (type === 'not_now') until = now + THRESHOLDS.notNowHours * HOUR_MS;
  else if (type === 'snooze') until = now + THRESHOLDS.snoozeDays * DAY_MS;
  // 'done' has no until — it stands forever (or until a fresh inbound arrives,
  // per the staleness check in compute()).
  const record = { type: type, dismissedAt: now, until: until || null };
  await set(ref(dbHandle, 'users/' + uid + '/workspaces/' + wsId + '/nudgeDismissals/' + nudgeId), record);
}

// Render the nudge column inside the Brief surface. Wired up by the
// existing renderDailyBrief flow — see brief.js for the trigger hook.
function renderColumn() {
  const listEl  = document.getElementById('brief-nudge-list');
  const countEl = document.getElementById('brief-nudge-count');
  if (!listEl) return;
  const nudges = compute();
  if (countEl) countEl.textContent = nudges.length;
  if (!nudges.length) {
    listEl.innerHTML = '<div class="brief-empty">No follow-ups waiting. Inbox is clean.</div>';
    return;
  }
  // Cap at 6 items in the column so it stays scannable. Operator can
  // click into the dossier for the full picture.
  const top = nudges.slice(0, 6);
  listEl.innerHTML = top.map(function(n) {
    const typeColor = n.type === 'awaiting_your_reply' ? 'var(--gold)'
                    : n.type === 'going_cold' ? '#facc15'
                    : 'var(--t3)';
    const typePill = n.type === 'awaiting_your_reply' ? 'OWED'
                    : n.type === 'going_cold' ? 'COLD'
                    : 'STALE';
    const oppLine = n.oppName
      ? '<div style="font-size:11px;color:var(--t3);font-family:IBM Plex Mono,monospace;letter-spacing:.06em;margin-top:2px">↳ ' + _esc(n.oppName) + '</div>'
      : '';
    return '<div class="brief-item" style="flex-direction:column;align-items:stretch;gap:4px;cursor:default" data-nudge-id="' + _esc(n.id) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;width:100%">' +
        '<span class="brief-item-title" onclick="if(window.openEntityInspector)window.openEntityInspector(\'' + _esc(n.entityId) + '\')" style="cursor:pointer">' +
          '<span style="display:inline-block;padding:1px 5px;margin-right:6px;background:rgba(0,0,0,.22);border:1px solid ' + typeColor + '70;border-radius:2px;color:' + typeColor + ';font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em">' + typePill + '</span>' +
          _esc(n.entityName) +
        '</span>' +
        '<span class="brief-item-meta">' + n.daysSince + 'd</span>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--t3);line-height:1.4">' + _esc(n.reasoning) + '</div>' +
      oppLine +
      '<div style="display:flex;gap:4px;margin-top:4px">' +
        '<button onclick="window.Corsair.nudge.dismiss(\'' + _esc(n.id) + '\',\'done\')" title="Done — surface this again only on a fresh inbound" style="font-size:9px;padding:2px 7px;border:1px solid rgba(52,211,153,.4);border-radius:2px;background:transparent;color:var(--green);cursor:pointer;font-family:IBM Plex Mono,monospace;letter-spacing:.08em">DONE</button>' +
        '<button onclick="window.Corsair.nudge.dismiss(\'' + _esc(n.id) + '\',\'not_now\')" title="Hide for 24h" style="font-size:9px;padding:2px 7px;border:1px solid var(--b2);border-radius:2px;background:transparent;color:var(--t2);cursor:pointer;font-family:IBM Plex Mono,monospace;letter-spacing:.08em">NOT NOW</button>' +
        '<button onclick="window.Corsair.nudge.dismiss(\'' + _esc(n.id) + '\',\'snooze\')" title="Snooze 7 days" style="font-size:9px;padding:2px 7px;border:1px solid var(--b2);border-radius:2px;background:transparent;color:var(--t2);cursor:pointer;font-family:IBM Plex Mono,monospace;letter-spacing:.08em">SNOOZE</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Wire to window for both compute access and Brief-render hook.
if (typeof window !== 'undefined') {
  window.Corsair = window.Corsair || {};
  window.Corsair.nudge = {
    compute: compute,
    dismiss: dismiss,
    renderColumn: renderColumn,
    thresholds: THRESHOLDS,
  };
  // Brief calls this directly after its own column renders, so the
  // nudge column stays in sync with the rest of the daily brief.
  window._renderNudgeColumn = renderColumn;
}

export { compute, dismiss, renderColumn, THRESHOLDS };
