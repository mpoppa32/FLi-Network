// Corsair brief module — Daily Brief Card renderer
//
// renderDailyBrief: the operator's morning landing card at the top of the
// Log Meeting screen. Surfaces four priority columns (decay, stale,
// upcoming, commits) plus weak coverage (#5). All data is computed from
// in-memory workspace state — no extra Firebase calls.
//
// Reads via window.* globals:
//   window.nodes, window.meetings, window.opportunities, window.commitments
//   window.nameSimilarity (token-based name matching for decay alerts)
//   window._computePursuitHealth, window._computeAccountCoverage
//   window._openLogForContact, window.selectOpp, window.goIntelById
//
// Triggered by switchView('intel') in FLiIntel.html and by various
// post-data-load hooks that defensively check window.renderDailyBrief.
//
// Exposes:
//   window.renderDailyBrief
//   window.Corsair.brief.*

// P13.169 — NEW-since-last-read delta marker. Baseline = column counts at
// last session close (persisted to localStorage). On every render this
// session, "current count - baseline" is shown as a +N gold chip when
// positive. Baseline only updates on beforeunload, so deltas hold stable
// across re-renders during a single session.
var _briefBaselineCounts = null;
var _BRIEF_BUCKETS = ['decay','stale','upcoming','commit','coverage','aged','nudge','osint'];
function _briefBaselineLoad() {
  if (_briefBaselineCounts !== null) return _briefBaselineCounts;
  var wsId = (window.currentWsId) || 'default';
  try {
    _briefBaselineCounts = JSON.parse(localStorage.getItem('corsair-brief-baseline-' + wsId) || '{}') || {};
  } catch(e){ _briefBaselineCounts = {}; }
  return _briefBaselineCounts;
}
function _briefMarkDeltas() {
  var baseline = _briefBaselineLoad();
  _BRIEF_BUCKETS.forEach(function(b){
    var el = document.getElementById('brief-' + b + '-count');
    if (!el) return;
    var raw = String(el.textContent || el.innerText || '0').replace(/\s.*$/, '');
    var current = parseInt(raw, 10) || 0;
    var last = baseline[b];
    if (last != null && current > last) {
      var delta = current - last;
      // Only re-render the span body if it doesn't already carry a +N.
      if (el.querySelector && !el.querySelector('.brief-new-chip')) {
        el.innerHTML = current + ' <span class="brief-new-chip" style="color:var(--gold);background:rgba(212,130,58,.18);border:1px solid rgba(212,130,58,.55);padding:1px 5px;border-radius:2px;font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.10em;margin-left:4px;text-transform:uppercase">+' + delta + ' NEW</span>';
      }
    }
  });
}
// Persist current counts as new baseline on session close. Listens once.
(function(){
  if (typeof window === 'undefined' || window._briefBaselineUnloadWired) return;
  window._briefBaselineUnloadWired = true;
  window.addEventListener('beforeunload', function(){
    try {
      var wsId = (window.currentWsId) || 'default';
      var counts = {};
      _BRIEF_BUCKETS.forEach(function(b){
        var el = document.getElementById('brief-' + b + '-count');
        if (el) {
          var raw = String(el.textContent || el.innerText || '0').replace(/\s.*$/, '');
          counts[b] = parseInt(raw, 10) || 0;
        }
      });
      localStorage.setItem('corsair-brief-baseline-' + wsId, JSON.stringify(counts));
    } catch(e){}
  });
})();

window.renderDailyBrief = function() {
  var card = document.getElementById('brief-card');
  if (!card) return;
  var dateEl = document.getElementById('brief-date');
  if (dateEl) {
    var d = new Date();
    var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    dateEl.textContent = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }
  var nowMs = Date.now();
  var DAY = 86400000;
  var nodes_   = window.nodes        || [];
  var mtgs_    = window.meetings     || [];
  var opps_    = window.opportunities|| [];
  var commits_ = window.commitments  || [];
  var simFn    = (typeof window.nameSimilarity === 'function') ? window.nameSimilarity : null;

  // Helpers
  function _mtgTime(m) {
    if (!m) return null;
    if (m.meta) {
      if (typeof m.meta.ts === 'number') return m.meta.ts;
      if (m.meta.date) { var t = Date.parse(String(m.meta.date)); if (!isNaN(t)) return t; }
    }
    if (typeof m.ts === 'number') return m.ts;
    if (m.createdAt) { var t2 = Date.parse(String(m.createdAt)); if (!isNaN(t2)) return t2; }
    return null;
  }
  function _attendeeNamesOf(m) {
    var out = [];
    if (m && m.meta && Array.isArray(m.meta.attendees)) m.meta.attendees.forEach(function(a) { if (a && a.name) out.push(a.name); });
    if (m && m.intel && Array.isArray(m.intel.keyPeople)) m.intel.keyPeople.forEach(function(p) { if (p && p.name) out.push(p.name); });
    return out;
  }

  // ─── 1. Decay alerts: people not touched in 30+ days ─────────────────
  // P13.114 (audit Finding 2.4): was O(people × meetings × attendees × simFn)
  // — 99,500 iterations on Atlas (199 nodes × 500 meetings), projected
  // 9.95M at 10x scale (1990 × 5000). Now O(meetings × attendees) for the
  // index pass, then O(people) for the lookup. Exact-match fast path
  // dominates when names are normalized; fuzzy fallback only fires for
  // names that didn't exact-match.
  var decay = [];
  if (simFn) {
    var people = nodes_.filter(function(n) { return n && n.type === 'person'; });
    // Build exact-name lookup: lowercase trimmed name → person node
    var personByExactName = new Map();
    people.forEach(function(p){
      if (p && p.name) {
        var key = String(p.name).toLowerCase().trim();
        if (key) personByExactName.set(key, p);
      }
    });
    // Walk meetings once. For each attendee name, exact-match first
    // (O(1)); fuzzy fallback only on misses. Record latest ts per person.
    var lastTsByPersonId = new Map();
    for (var dmi = 0; dmi < mtgs_.length; dmi++) {
      var dm = mtgs_[dmi];
      var dts = _mtgTime(dm);
      if (dts == null) continue;
      var dnames = _attendeeNamesOf(dm);
      if (!dnames.length) continue;
      var seenPersons = {};
      for (var dni = 0; dni < dnames.length; dni++) {
        var dname = dnames[dni];
        if (!dname) continue;
        var dexact = personByExactName.get(String(dname).toLowerCase().trim());
        if (dexact) {
          if (!seenPersons[dexact.id]) {
            seenPersons[dexact.id] = true;
            var prevExact = lastTsByPersonId.get(dexact.id);
            if (prevExact == null || dts > prevExact) lastTsByPersonId.set(dexact.id, dts);
          }
        } else {
          // Fuzzy fallback — only fires when no exact match exists
          for (var dpi = 0; dpi < people.length; dpi++) {
            var dp = people[dpi];
            if (!dp || !dp.name || seenPersons[dp.id]) continue;
            try {
              if (simFn(dname, dp.name) >= 0.72) {
                seenPersons[dp.id] = true;
                var prevFz = lastTsByPersonId.get(dp.id);
                if (prevFz == null || dts > prevFz) lastTsByPersonId.set(dp.id, dts);
                break;
              }
            } catch(e){}
          }
        }
      }
    }
    // Now O(people) emit
    for (var dpix = 0; dpix < people.length; dpix++){
      var dpx = people[dpix];
      var dlastTs = lastTsByPersonId.get(dpx.id);
      if (dlastTs != null) {
        var daysSince = Math.floor((nowMs - dlastTs) / DAY);
        if (daysSince >= 30) decay.push({ id: dpx.id, name: dpx.name, org: dpx.org || dpx.govOrg || '', days: daysSince });
      }
    }
    decay.sort(function(a, b) { return b.days - a.days; });
  }

  // ─── 2. Stale pursuits: active-stage opps without recent meetings ───
  // P13.114 (audit Finding 2.4): was O(opps × meetings) — 61,000 iters on
  // Atlas, projected 6.1M at 10x. Now uses CorsairIndex.meetingsByOppId
  // (already pre-built by the index rebuild) for O(1) lookup per opp.
  // Falls back to the legacy linear scan if the index is unavailable
  // (cold load before first rebuild, or if the workspace just switched).
  var STAGE_ACTIVE = { proposal: 1, negotiation: 1, submitted: 1, award: 1, engaged: 1, rfp: 1 };
  var stale = [];
  var _idx = window.CorsairIndex;
  var _hasIdx = !!(_idx && _idx.meetingsByOppId && typeof _idx.meetingsByOppId.get === 'function');
  for (var oi = 0; oi < opps_.length; oi++) {
    var o = opps_[oi];
    if (!o) continue;
    var stg = String(o.stage || '').toLowerCase().trim();
    if (!STAGE_ACTIVE[stg]) continue;
    var oid = String(o.id);
    var latest = null;
    if (_hasIdx) {
      var oppMtgs = _idx.meetingsByOppId.get(oid) || [];
      for (var omi = 0; omi < oppMtgs.length; omi++) {
        var oMtg = oppMtgs[omi];
        var ots = _mtgTime(oMtg);
        if (ots != null && (latest == null || ots > latest)) latest = ots;
      }
    } else {
      // Fallback: original linear scan
      for (var mi = 0; mi < mtgs_.length; mi++) {
        var mm = mtgs_[mi];
        if (!mm) continue;
        var tagged = (mm.oppId != null && String(mm.oppId) === oid)
                  || (Array.isArray(o.meetings) && o.meetings.indexOf(mm.id) !== -1);
        if (!tagged) continue;
        var ts2 = _mtgTime(mm);
        if (ts2 != null && (latest == null || ts2 > latest)) latest = ts2;
      }
    }
    var days2 = latest == null ? 9999 : Math.floor((nowMs - latest) / DAY);
    if (days2 >= 14) {
      var health = (typeof window._computePursuitHealth === 'function')
                  ? window._computePursuitHealth(o, mtgs_)
                  : { score: 0, status: 'unknown' };
      // CRM P0.4: manual operator-set nextAction + target date
      var naTs = null;
      if (o.nextActionDate) {
        var _t = Date.parse(String(o.nextActionDate) + 'T00:00:00');
        if (!isNaN(_t)) naTs = _t;
      }
      // P13.132 Day 7 — flag opps where current-stage gates are satisfied
      // so they get a READY badge. Operator already did the qualification
      // work; surfacing the stuck-but-ready state turns the stale column
      // into an advance-this-now list when applicable.
      var staleReady = false;
      var pipeS = (window.Corsair && window.Corsair.pipeline) ? window.Corsair.pipeline : null;
      if (pipeS && typeof pipeS.validateAdvance === 'function' && typeof pipeS.index === 'function') {
        var curIdxS = pipeS.index(o.stage);
        var stagesS = pipeS.stages || [];
        if (curIdxS >= 0 && curIdxS < stagesS.length - 1) {
          var nextSS = stagesS[curIdxS + 1];
          if (nextSS && nextSS.key !== 'won' && nextSS.key !== 'lost') {
            var vS = pipeS.validateAdvance(o, o.stage, nextSS.key);
            staleReady = !!(vS && vS.ok);
          }
        }
      }
      stale.push({
        id: o.id, name: o.name || 'Pursuit', stage: stg.toUpperCase(),
        days: days2 === 9999 ? null : days2,
        health: health,
        nextAction: o.nextAction || '',
        nextActionDate: o.nextActionDate || '',
        nextActionTs: naTs,
        ready: staleReady
      });
    }
  }
  // CRM P0.4: sort by nextActionDate ascending (nulls last), then health ascending
  // P13.132 Day 7: ready-to-advance opps float to the top — operator did the
  // qualification work; surface the highest-leverage move first.
  stale.sort(function(a, b) {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    var ta = a.nextActionTs == null ? Number.MAX_SAFE_INTEGER : a.nextActionTs;
    var tb = b.nextActionTs == null ? Number.MAX_SAFE_INTEGER : b.nextActionTs;
    if (ta !== tb) return ta - tb;
    var sa = (a.health && a.health.score) || 0;
    var sb = (b.health && b.health.score) || 0;
    if (sa !== sb) return sa - sb;
    var da = a.days == null ? 999999 : a.days;
    var db = b.days == null ? 999999 : b.days;
    return db - da;
  });

  // ─── 3. Upcoming: meetings in the next 7 days ───────────────────────
  var upcoming = [];
  var horizon = nowMs + 7 * DAY;
  for (var ui = 0; ui < mtgs_.length; ui++) {
    var um = mtgs_[ui];
    if (!um) continue;
    var uts = _mtgTime(um);
    if (uts == null) continue;
    if (uts > nowMs && uts <= horizon) {
      upcoming.push({
        id: um.id,
        title: (um.meta && um.meta.title) || 'Untitled',
        ts: uts,
        when: Math.ceil((uts - nowMs) / DAY)
      });
    }
  }
  upcoming.sort(function(a, b) { return a.ts - b.ts; });

  // ─── 4. Commitments due in 14 days ──────────────────────────────────
  var commitDue = [];
  var cHorizon = nowMs + 14 * DAY;
  for (var ci = 0; ci < commits_.length; ci++) {
    var c = commits_[ci];
    if (!c) continue;
    if (c.done || c.status === 'done' || c.completed) continue;
    var dts = null;
    if (c.deadline)   { var dt  = Date.parse(String(c.deadline)); if (!isNaN(dt))  dts = dt; }
    else if (c.dueAt) { var dt2 = Date.parse(String(c.dueAt));    if (!isNaN(dt2)) dts = dt2; }
    if (dts == null) continue;
    if (dts <= cHorizon) {
      var dd = Math.ceil((dts - nowMs) / DAY);
      commitDue.push({
        id: c.id,
        title: c.text || c.title || c.what || c.task || 'Commitment',
        owner: c.owner || '',
        days: dd
      });
    }
  }
  commitDue.sort(function(a, b) { return a.days - b.days; });

  // ─── 5. Weak coverage: pursued orgs with low engaged-contact ratio ───
  var coverage = [];
  if (typeof window._computeAccountCoverage === 'function') {
    var orgsAll = nodes_.filter(function(n) { return n && n.type === 'company'; });
    for (var ci2 = 0; ci2 < orgsAll.length; ci2++) {
      var org = orgsAll[ci2];
      var cov = window._computeAccountCoverage(org, { nodes: nodes_, meetings: mtgs_, opps: opps_ });
      if (cov.factors.oppCount > 0 && cov.score < 40) {
        coverage.push({
          id: org.id,
          name: org.name || '(unnamed)',
          score: cov.score,
          status: cov.status,
          factors: cov.factors
        });
      }
    }
    coverage.sort(function(a, b) { return a.score - b.score; });
  }

  // ─── CRM P1.7: today/tomorrow agenda strip ──────────────────────────
  // Three-cell row at the top of the brief: today's meetings, due-today
  // commitments, this-week deadlines. Each cell is clickable when populated.
  (function _renderAgenda() {
    var agendaEl = document.getElementById('brief-agenda');
    if (!agendaEl) return;
    var startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    var endOfDay = startOfDay.getTime() + DAY - 1;
    var endOfWeek = startOfDay.getTime() + 7 * DAY - 1;

    // Today's meetings
    var todayMtgs = mtgs_.filter(function(m) {
      var t = _mtgTime(m);
      return t != null && t >= startOfDay.getTime() && t <= endOfDay;
    }).sort(function(a, b) { return _mtgTime(a) - _mtgTime(b); });

    // Due-today commitments (open status, deadline = today)
    var dueToday = commits_.filter(function(c) {
      if (!c || c.status !== 'open') return false;
      var dd = c.deadline || c.dueAt;
      if (!dd) return false;
      var t = Date.parse(String(dd) + (String(dd).length === 10 ? 'T00:00:00' : ''));
      if (isNaN(t)) return false;
      return t >= startOfDay.getTime() && t <= endOfDay;
    });

    // This-week deadlines: any commit deadline in next 7 days OR opp rfp/award date in next 7 days
    var weekDeadlines = [];
    commits_.forEach(function(c) {
      if (!c || c.status !== 'open') return;
      var dd = c.deadline || c.dueAt;
      if (!dd) return;
      var t = Date.parse(String(dd) + (String(dd).length === 10 ? 'T00:00:00' : ''));
      if (isNaN(t)) return;
      if (t >= startOfDay.getTime() && t <= endOfWeek) {
        weekDeadlines.push({ kind: 'commit', ts: t, label: c.task || c.title || 'Commitment' });
      }
    });
    opps_.forEach(function(o) {
      if (!o) return;
      ['rfpDate', 'awardDate'].forEach(function(k) {
        if (!o[k]) return;
        var t = Date.parse(String(o[k]) + 'T00:00:00');
        if (isNaN(t)) return;
        if (t >= startOfDay.getTime() && t <= endOfWeek) {
          weekDeadlines.push({ kind: 'opp', ts: t, label: (o.name || 'Pursuit') + (k === 'rfpDate' ? ' · RFP' : ' · AWD') });
        }
      });
    });
    weekDeadlines.sort(function(a, b) { return a.ts - b.ts; });

    // Show the strip if at least one cell has content
    var anyContent = todayMtgs.length || dueToday.length || weekDeadlines.length;
    agendaEl.setAttribute('data-empty', anyContent ? '0' : '1');
    if (!anyContent) { agendaEl.innerHTML = ''; return; }

    function _esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function(c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

    var cells = [];
    // Cell 1: Today's meetings
    if (todayMtgs.length) {
      var first = todayMtgs[0];
      var t1 = (first.meta && first.meta.title) || 'Meeting';
      var when = '';
      var ts = _mtgTime(first);
      if (ts) {
        var hh = new Date(ts).getHours();
        var mm = new Date(ts).getMinutes();
        if (hh || mm) when = hh + ':' + String(mm).padStart(2, '0') + ' · ';
      }
      var more = todayMtgs.length > 1 ? ' (+' + (todayMtgs.length - 1) + ')' : '';
      cells.push('<div class="brief-agenda-item" onclick="window.switchView&amp;&amp;window.switchView(\'intel\');window.goIntelById&amp;&amp;window.goIntelById(\'' + first.id + '\')">' +
                 '<span class="agenda-icon">📅</span>' +
                 '<div class="agenda-body">' +
                   '<div class="agenda-lbl">TODAY · ' + todayMtgs.length + ' MTG' + (todayMtgs.length === 1 ? '' : 'S') + '</div>' +
                   '<div class="agenda-detail">' + when + _esc(t1) + more + '</div>' +
                 '</div></div>');
    } else {
      cells.push('<div class="brief-agenda-item is-empty"><span class="agenda-icon">📅</span><div class="agenda-body"><div class="agenda-lbl">TODAY</div><div class="agenda-detail agenda-detail-dim">no meetings</div></div></div>');
    }

    // Cell 2: Due-today commitments
    if (dueToday.length) {
      var c1 = dueToday[0];
      var task = c1.task || c1.title || c1.what || 'Commitment';
      var moreC = dueToday.length > 1 ? ' (+' + (dueToday.length - 1) + ')' : '';
      cells.push('<div class="brief-agenda-item" onclick="window.switchView&amp;&amp;window.switchView(\'intel\');window.switchIntelTab&amp;&amp;window.switchIntelTab(\'board\')">' +
                 '<span class="agenda-icon">⏰</span>' +
                 '<div class="agenda-body">' +
                   '<div class="agenda-lbl">DUE TODAY · ' + dueToday.length + '</div>' +
                   '<div class="agenda-detail">' + _esc(task) + moreC + '</div>' +
                 '</div></div>');
    } else {
      cells.push('<div class="brief-agenda-item is-empty"><span class="agenda-icon">⏰</span><div class="agenda-body"><div class="agenda-lbl">DUE TODAY</div><div class="agenda-detail agenda-detail-dim">nothing due</div></div></div>');
    }

    // Cell 3: This-week deadlines
    if (weekDeadlines.length) {
      var w1 = weekDeadlines[0];
      var daysOut = Math.ceil((w1.ts - nowMs) / DAY);
      var whenLbl = daysOut <= 0 ? 'today' : daysOut === 1 ? 'tmrw' : '+' + daysOut + 'd';
      var moreW = weekDeadlines.length > 1 ? ' (+' + (weekDeadlines.length - 1) + ')' : '';
      cells.push('<div class="brief-agenda-item" onclick="window.switchView&amp;&amp;window.switchView(\'' + (w1.kind === 'opp' ? 'opps' : 'intel') + '\')">' +
                 '<span class="agenda-icon">🎯</span>' +
                 '<div class="agenda-body">' +
                   '<div class="agenda-lbl">7-DAY · ' + weekDeadlines.length + ' DEADLINE' + (weekDeadlines.length === 1 ? '' : 'S') + '</div>' +
                   '<div class="agenda-detail">' + _esc(w1.label) + ' · ' + whenLbl + moreW + '</div>' +
                 '</div></div>');
    } else {
      cells.push('<div class="brief-agenda-item is-empty"><span class="agenda-icon">🎯</span><div class="agenda-body"><div class="agenda-lbl">7-DAY DEADLINES</div><div class="agenda-detail agenda-detail-dim">none upcoming</div></div></div>');
    }

    agendaEl.innerHTML = cells.join('');
  })();

  // Render helpers (P13.53 — added emptyText param so each column gets a
  // helpful "what this column is for" message instead of cryptic "no data".
  // First-time users now understand each surface even when empty.)
  function _renderCol(listId, countId, items, formatter, emptyText) {
    var listEl  = document.getElementById(listId);
    var countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = items.length;
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<div class="brief-empty">' + (emptyText || '— clear —') + '</div>';
      return;
    }
    listEl.innerHTML = items.slice(0, 3).map(formatter).join('');
  }
  _renderCol('brief-decay-list', 'brief-decay-count', decay, function(d) {
    var orgStr = d.org ? ' · ' + String(d.org).slice(0, 16) : '';
    var safeName = (d.name || '').replace(/\'/g, '');
    var safeOrg = (d.org || '').replace(/\'/g, '');
    // P12.9: ✉ button for one-click outreach draft. event.stopPropagation
    // keeps the parent click (open log-meeting) from firing too.
    var outreachBtn = '<button class="brief-item-act" title="Draft a re-engage email or LinkedIn message for this contact" aria-label="Draft outreach" onclick="event.stopPropagation();window._openOutreachDraft&&window._openOutreachDraft(\'' + safeName + '\',' + (d.days||0) + ',\'' + safeOrg + '\')" style="margin-left:6px;padding:2px 7px;border:1px solid var(--gold);border-radius:3px;background:rgba(212,130,58,.12);color:var(--gold);font-size:10px;cursor:pointer;font-family:IBM Plex Mono,monospace;flex-shrink:0">✉ Draft</button>';
    return '<div class="brief-item" onclick="if(window._openLogForContact)window._openLogForContact(\'' + safeName + '\')" style="align-items:center">' +
           '<span class="brief-item-title">' + (d.name || '(unnamed)') + orgStr + '</span>' +
           '<span class="brief-item-meta">' + d.days + 'd</span>' +
           outreachBtn + '</div>';
  }, 'No T1/T2 contacts going cold. People you have not touched in 30+ days surface here.');
  _renderCol('brief-stale-list', 'brief-stale-count', stale, function(s) {
    var h = s.health || { score: 0, status: 'unknown' };
    var pillTxt = h.status === 'unknown' ? '—' : String(h.score);
    var pill = '<span class="health-pill health-' + h.status + '" title="Health ' + h.score + ' · ' + (h.factors ? (h.factors.attendees + ' attendees · ' + h.factors.meetings + ' meetings') : '') + '">' + pillTxt + '</span>';
    // P13.6: deal score chip — look up full opp record by id, compute via window._dealScore
    var scoreChip = '';
    if (typeof window._dealScoreChip === 'function' && s.id){
      var fullOpp = (window.opportunities || []).find(function(oo){ return String(oo.id) === String(s.id); });
      if (fullOpp) scoreChip = window._dealScoreChip(fullOpp);
    }
    // CRM P0.4: operator-set nextAction + target date inline
    var naLine = '';
    if (s.nextAction || s.nextActionTs) {
      var naText = (s.nextAction || '').slice(0, 60);
      var naDelta = '';
      if (s.nextActionTs != null) {
        var dd = Math.ceil((s.nextActionTs - nowMs) / DAY);
        naDelta = dd < 0 ? Math.abs(dd) + 'd overdue' : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : 'in ' + dd + 'd';
      }
      naLine = '<div class="brief-item-na" style="font-size:10px;color:var(--gold);font-family:IBM Plex Mono,monospace;margin-top:2px;display:flex;gap:6px;align-items:center">' +
               (naText ? '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">→ ' + naText + '</span>' : '<span style="flex:1"></span>') +
               (naDelta ? '<span style="flex-shrink:0;color:' + (s.nextActionTs != null && s.nextActionTs < nowMs ? '#ff6464' : 'var(--gold)') + '">' + naDelta + '</span>' : '') +
               '</div>';
    }
    // P13.132 Day 7 — READY badge when gates are clear. Inline in the title row
    // so it sits next to the name. Operator scans the column and the gold pip
    // signals "this one's ready to move."
    var readyBadge = s.ready ? '<span class="brief-ready-badge" title="All exit-criteria gates checked — ready to advance" style="display:inline-block;padding:1px 6px;margin-right:6px;background:rgba(212,130,58,.18);border:1px solid rgba(212,130,58,.55);border-radius:3px;color:var(--gold);font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;vertical-align:middle">READY</span>' : '';
    var headRow = '<span class="brief-item-title">' + pill + readyBadge + s.name + '</span>' +
                  '<span class="brief-item-meta" style="display:flex;align-items:center;gap:6px">' + scoreChip + '<span>' + (s.days == null ? 'never' : s.days + 'd · ' + s.stage) + '</span></span>';
    if (naLine) {
      return '<div class="brief-item" style="flex-direction:column;align-items:stretch;gap:0" onclick="if(window.selectOpp)window.selectOpp(\'' + s.id + '\')">' +
             '<div style="display:flex;justify-content:space-between;gap:8px;width:100%">' + headRow + '</div>' +
             naLine +
             '</div>';
    }
    return '<div class="brief-item" onclick="if(window.selectOpp)window.selectOpp(\'' + s.id + '\')">' + headRow + '</div>';
  }, 'No active pursuits stalling. Opps with no meeting in 14+ days appear here.');
  _renderCol('brief-upcoming-list', 'brief-upcoming-count', upcoming, function(u) {
    var when = u.when === 0 ? 'today' : u.when === 1 ? 'tomorrow' : '+' + u.when + 'd';
    return '<div class="brief-item" onclick="if(window.goIntelById)window.goIntelById(\'' + u.id + '\')">' +
           '<span class="brief-item-title">' + u.title + '</span>' +
           '<span class="brief-item-meta">' + when + '</span></div>';
  }, 'No meetings or deadlines logged for the next 7 days. Schedule a meeting or set an opp deadline to populate this column.');
  _renderCol('brief-commit-list', 'brief-commit-count', commitDue, function(c) {
    var when = c.days <= 0 ? 'overdue' : c.days === 1 ? 'tomorrow' : 'in ' + c.days + 'd';
    var ownerStr = c.owner ? ' · ' + String(c.owner).slice(0, 14) : '';
    // P13.156 — commit rows now drill to the commitments panel (no per-id
    // detail surface exists yet — opens the full open-commits view).
    return '<div class="brief-item" onclick="if(window.openCommitPanel)window.openCommitPanel()" style="cursor:pointer" title="Open commitments panel">' +
           '<span class="brief-item-title">' + c.title.slice(0, 60) + ownerStr + '</span>' +
           '<span class="brief-item-meta">' + when + '</span></div>';
  }, 'No commitments coming due. Open commits with deadlines surface here.');
  _renderCol('brief-coverage-list', 'brief-coverage-count', coverage, function(c) {
    var pillKlass = c.status === 'dark' ? 'health-cold' : c.status === 'sparse' ? 'health-cold' : 'health-warm';
    var pillTxt = c.status === 'dark' ? 'DARK' : String(c.score);
    var pill = '<span class="health-pill ' + pillKlass + '" title="' + c.factors.engagedRecent + '/' + (c.factors.oppCount * 2) + ' coverage · ' + c.factors.peopleAtOrg + ' contacts · ' + c.factors.oppCount + ' opps">' + pillTxt + '</span>';
    // P13.156 — coverage rows now drill to the org's Entity Inspector dossier.
    var safeId = String(c.id || '').replace(/\'/g, '');
    return '<div class="brief-item" onclick="if(window.openEntityInspector)window.openEntityInspector(\'' + safeId + '\')" style="cursor:pointer" title="Open this account in the Inspector">' +
           '<span class="brief-item-title">' + pill + c.name + '</span>' +
           '<span class="brief-item-meta">' + c.factors.oppCount + ' opp' + (c.factors.oppCount === 1 ? '' : 's') + '</span></div>';
  }, 'All pursued accounts have adequate contact coverage. Orgs with too few engaged contacts surface here.');

  // ─── 6. Aged in Stage: pursuits past their stage aging threshold (Phase 6.7) ─
  // Wires the column placeholder at FLiIntel.html:8627 that previously had no
  // renderer. Uses Corsair.pipeline.isStageStuck + daysInStage + ageLimit from
  // pipeline.js — already loaded as a sibling module.
  var aged = [];
  var pipe = (window.Corsair && window.Corsair.pipeline) ? window.Corsair.pipeline : null;
  if (pipe && typeof pipe.isStageStuck === 'function') {
    for (var ai = 0; ai < opps_.length; ai++) {
      var ao = opps_[ai];
      if (!ao || !ao.stage) continue;
      var stgL = String(ao.stage).toLowerCase();
      if (stgL === 'won' || stgL === 'lost') continue;
      if (!pipe.isStageStuck(ao)) continue;
      var dis = (typeof pipe.daysInStage === 'function') ? pipe.daysInStage(ao) : 0;
      var lim = (typeof pipe.ageLimit === 'function') ? pipe.ageLimit(ao.stage) : 0;
      // P13.132 Day 7 — same READY signal on aged column. Aged opps where
      // gates are clear are the highest-priority items in the morning brief:
      // they're past stage age limit AND ready to advance — operator has no
      // excuse left.
      var agedReady = false;
      if (typeof pipe.validateAdvance === 'function' && typeof pipe.index === 'function') {
        var curIdxA = pipe.index(ao.stage);
        var stagesA = pipe.stages || [];
        if (curIdxA >= 0 && curIdxA < stagesA.length - 1) {
          var nextSA = stagesA[curIdxA + 1];
          if (nextSA && nextSA.key !== 'won' && nextSA.key !== 'lost') {
            var vA = pipe.validateAdvance(ao, ao.stage, nextSA.key);
            agedReady = !!(vA && vA.ok);
          }
        }
      }
      aged.push({ id: ao.id, name: ao.name || '(unnamed)', stage: ao.stage, days: dis, limit: lim, over: dis - lim, ready: agedReady });
    }
    // Sort: ready opps first (operator can advance immediately), then by
    // most-over-limit. Closes the stuck-ready signal at the top of the
    // column so the highest-leverage moves are unmistakable.
    aged.sort(function(a, b) {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return b.over - a.over;
    });
  }
  _renderCol('brief-aged-list', 'brief-aged-count', aged, function(a) {
    var safeName = (a.name || '').replace(/\'/g, '');
    var readyBadgeA = a.ready ? '<span class="brief-ready-badge" title="All exit-criteria gates checked — ready to advance" style="display:inline-block;padding:1px 6px;margin-right:6px;background:rgba(212,130,58,.18);border:1px solid rgba(212,130,58,.55);border-radius:3px;color:var(--gold);font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;vertical-align:middle">READY</span>' : '';
    return '<div class="brief-item" onclick="if(window.selectOpp)window.selectOpp(\'' + a.id + '\')">' +
           '<span class="brief-item-title">' + readyBadgeA + a.name + '</span>' +
           '<span class="brief-item-meta">' + a.days + 'd · ' + a.stage + ' (+' + a.over + 'd)</span></div>';
  }, 'No pursuits stuck past their stage aging threshold. Stalled opps will surface here so you can unstick them.');

  // P13.138 — Follow-Up Nudge column. Renders after the rest of the
  // brief so its dismissal-state cache is wired before paint. Module
  // is loaded as a sibling import in main.js.
  if (typeof window._renderNudgeColumn === 'function') {
    try { window._renderNudgeColumn(); }
    catch (e) { console.warn('[Brief] nudge column render failed', e); }
  }

  // P13.167 — SIGNALS ON PIPELINE column. Promotes OSINT moat from
  // Today-only callout into the morning Brief. Reuses the same scoring
  // logic as the TODAY surface: term set from active opp agency/customer/
  // name/vehicle, hit-count score per dailyFeed signal, top 3 rendered.
  (function _renderOsintColumn(){
    var listEl = document.getElementById('brief-osint-list');
    var countEl = document.getElementById('brief-osint-count');
    if (!listEl) return;
    var feed = Array.isArray(window._dailyFeedData) ? window._dailyFeedData : [];
    var actives = (window.opportunities || []).filter(function(o){ return o && o.stage !== 'won' && o.stage !== 'lost'; });
    if (!feed.length || !actives.length) {
      if (countEl) countEl.textContent = '0';
      var msg = feed.length
        ? 'No matches against your active pursuits today.'
        : 'No OSINT feed pulled yet today. Click Pulse to trigger.';
      listEl.innerHTML = '<div class="brief-empty">' + msg + '</div>';
      return;
    }
    var terms = new Set();
    actives.forEach(function(o){
      [o.agency, o.customerOrg, o.name, o.vehicle].forEach(function(t){
        if (t && String(t).length > 2 && String(t).toLowerCase() !== 'agency unknown') {
          terms.add(String(t).toLowerCase().trim());
        }
      });
    });
    var scored = [];
    feed.forEach(function(s){
      if (!s) return;
      var blob = ((s.headline || '') + ' ' + (s.detail || '') + ' ' + (Array.isArray(s.tags) ? s.tags.join(' ') : '')).toLowerCase();
      var hits = 0;
      var matched = [];
      terms.forEach(function(t){ if (t && t.length > 2 && blob.indexOf(t) >= 0) { hits++; matched.push(t); } });
      if (hits > 0) scored.push({ s: s, hits: hits, matched: matched.slice(0, 2) });
    });
    scored.sort(function(a, b){
      if (b.hits !== a.hits) return b.hits - a.hits;
      var da = a.s.date ? new Date(a.s.date).getTime() : 0;
      var db = b.s.date ? new Date(b.s.date).getTime() : 0;
      return db - da;
    });
    if (countEl) countEl.textContent = String(scored.length);
    if (!scored.length) {
      listEl.innerHTML = '<div class="brief-empty">No matches against your active pursuits today.</div>';
      return;
    }
    var top = scored.slice(0, 3);
    var nodes = window.nodes || [];
    listEl.innerHTML = top.map(function(row){
      var s = row.s;
      var sev = s.severity || 'info';
      var sevCol = sev === 'high' ? '#ef4444' : sev === 'med' ? '#f0a560' : sev === 'low' ? '#6ed094' : '#5fb3b8';
      var headline = (window._escHTML ? window._escHTML(s.headline || '') : String(s.headline || '').replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; })).slice(0, 90);
      var cat = s.category ? String(s.category).toUpperCase().slice(0, 14) : '';
      var matchedChip = row.matched.length ? '<span class="brief-item-meta" style="color:' + sevCol + ';font-family:IBM Plex Mono,monospace;font-size:9px;letter-spacing:.06em">' + row.hits + ' hit' + (row.hits === 1 ? '' : 's') + '</span>' : '';
      var sUrl = s.url && /^https?:\/\//i.test(s.url) ? s.url : null;
      var clickAttr = sUrl
        ? 'onclick="window.open(\'' + String(sUrl).replace(/\'/g, '&#39;') + '\',\'_blank\',\'noopener,noreferrer\')"'
        : 'onclick="if(window.switchView)window.switchView(\'pulse\')"';
      // P13.172 — posture suggestion chips. For each network-matched person
      // node, detect transition keywords in the signal text. When match,
      // render one-click "↗ Apply <trajectory> for <person>" chip.
      var postureSuggHtml = '';
      if (typeof window._detectPostureTransition === 'function' && Array.isArray(s.networkMatches)) {
        var suggs = [];
        s.networkMatches.forEach(function(m){
          var p = nodes.find(function(n){ return String(n.id) === String(m.id) && n.type === 'person'; });
          if (!p) return;
          var sg = window._detectPostureTransition(s, p);
          if (sg) suggs.push({ person: p, sugg: sg });
        });
        if (suggs.length) {
          postureSuggHtml = suggs.slice(0, 2).map(function(item){
            var trajCol = item.sugg.trajectory === 'rising' ? '#22c55e' : item.sugg.trajectory === 'falling' ? '#ef4444' : '#f0a560';
            var trajLbl = item.sugg.trajectory.toUpperCase();
            var personEsc = String(item.person.name || '').replace(/'/g, '&#39;').replace(/[<>&"]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; });
            var hlEsc = String(item.sugg.headline || '').replace(/'/g, "\\'").replace(/[<>&"]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; });
            var urlEsc = String(item.sugg.sourceUrl || '').replace(/'/g, "\\'");
            return '<button onclick="event.stopPropagation();window._applyPostureSuggestion(\'' + item.person.id + '\',\'' + item.sugg.trajectory + '\',\'' + urlEsc + '\',\'' + hlEsc + '\')" title="OSINT-detected ' + item.sugg.trajectory + ' (' + item.sugg.triggerKeyword + ') · click to apply with this signal as evidence" style="background:rgba(0,0,0,.22);border:1px solid ' + trajCol + '60;color:' + trajCol + ';font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.08em;padding:2px 6px;border-radius:2px;cursor:pointer;margin-right:4px;text-transform:uppercase">↗ ' + trajLbl + ' · ' + personEsc + '</button>';
          }).join('');
        }
      }
      // P13.173 — Award→opp suggestion chips. Cross-ref signal against
      // each active pursuit; render chips for customer-activity or
      // competitor-win matches with one-click action.
      var oppSuggHtml = '';
      if (typeof window._detectAwardMatchForOpp === 'function') {
        var oppSuggs = [];
        actives.forEach(function(o){
          var sg = window._detectAwardMatchForOpp(s, o);
          if (sg) oppSuggs.push(sg);
        });
        if (oppSuggs.length) {
          oppSuggHtml = oppSuggs.slice(0, 2).map(function(item){
            var col = item.type === 'competitor_win' ? '#ef4444' : '#facc15';
            var lbl = item.type === 'competitor_win' ? '↗ MARK LOST?' : '↗ REVIEW';
            var action = item.type === 'competitor_win' ? 'mark_lost' : 'open';
            var oppNameEsc = String(item.oppName || '').replace(/'/g, '&#39;').replace(/[<>&"]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; });
            var hintEsc = String(item.hint || '').replace(/"/g, '&quot;');
            return '<button onclick="event.stopPropagation();window._applyAwardSuggestion(\'' + item.oppId + '\',\'' + action + '\')" title="' + hintEsc + '" style="background:rgba(0,0,0,.22);border:1px solid ' + col + '60;color:' + col + ';font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.08em;padding:2px 6px;border-radius:2px;cursor:pointer;margin-right:4px;text-transform:uppercase">' + lbl + ' · ' + oppNameEsc.slice(0, 30) + '</button>';
          }).join('');
        }
      }
      return '<div class="brief-item" ' + clickAttr + ' style="cursor:pointer;flex-direction:column;align-items:stretch;gap:3px">' +
        '<div style="display:flex;justify-content:space-between;gap:6px;align-items:center">' +
          '<span class="brief-item-title" style="display:flex;align-items:center;gap:6px">' +
            (cat ? '<span style="font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.10em;color:' + sevCol + ';border:1px solid ' + sevCol + '70;background:rgba(0,0,0,.22);padding:1px 5px;border-radius:2px">' + cat + '</span>' : '') +
            '<span>' + headline + '</span>' +
          '</span>' +
          matchedChip +
        '</div>' +
        (postureSuggHtml || oppSuggHtml ? '<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px">' + postureSuggHtml + oppSuggHtml + '</div>' : '') +
      '</div>';
    }).join('');
  })();

  // P13.169 — apply NEW delta chips on column counts AFTER all renders.
  try { _briefMarkDeltas(); } catch (deltaErr) { console.warn('[Brief] delta marker failed', deltaErr); }

  console.log('[Brief] 7.1/7.3 rendered: decay=' + decay.length + ' stale=' + stale.length + ' upcoming=' + upcoming.length + ' commits=' + commitDue.length + ' coverage=' + coverage.length + ' aged=' + aged.length);
};

window.Corsair = window.Corsair || {};
window.Corsair.brief = {
  render: window.renderDailyBrief
};
