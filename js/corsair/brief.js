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
  var decay = [];
  if (simFn) {
    var people = nodes_.filter(function(n) { return n && n.type === 'person'; });
    people.forEach(function(p) {
      var lastTs = null;
      for (var i = 0; i < mtgs_.length; i++) {
        var m = mtgs_[i];
        var ts = _mtgTime(m);
        if (ts == null) continue;
        var names = _attendeeNamesOf(m);
        for (var k = 0; k < names.length; k++) {
          try { if (simFn(names[k], p.name) >= 0.72) { if (lastTs == null || ts > lastTs) lastTs = ts; break; } } catch (e) {}
        }
      }
      if (lastTs != null) {
        var daysSince = Math.floor((nowMs - lastTs) / DAY);
        if (daysSince >= 30) decay.push({ id: p.id, name: p.name, org: p.org || p.govOrg || '', days: daysSince });
      }
    });
    decay.sort(function(a, b) { return b.days - a.days; });
  }

  // ─── 2. Stale pursuits: active-stage opps without recent meetings ───
  var STAGE_ACTIVE = { proposal: 1, negotiation: 1, submitted: 1, award: 1, engaged: 1, rfp: 1 };
  var stale = [];
  for (var oi = 0; oi < opps_.length; oi++) {
    var o = opps_[oi];
    if (!o) continue;
    var stg = String(o.stage || '').toLowerCase();
    if (!STAGE_ACTIVE[stg]) continue;
    var oid = String(o.id);
    var latest = null;
    for (var mi = 0; mi < mtgs_.length; mi++) {
      var mm = mtgs_[mi];
      if (!mm) continue;
      var tagged = (mm.oppId != null && String(mm.oppId) === oid)
                || (Array.isArray(o.meetings) && o.meetings.indexOf(mm.id) !== -1);
      if (!tagged) continue;
      var ts2 = _mtgTime(mm);
      if (ts2 != null && (latest == null || ts2 > latest)) latest = ts2;
    }
    var days2 = latest == null ? 9999 : Math.floor((nowMs - latest) / DAY);
    if (days2 >= 14) {
      var health = (typeof window._computePursuitHealth === 'function')
                  ? window._computePursuitHealth(o, mtgs_)
                  : { score: 0, status: 'unknown' };
      stale.push({
        id: o.id, name: o.name || 'Pursuit', stage: stg.toUpperCase(),
        days: days2 === 9999 ? null : days2,
        health: health
      });
    }
  }
  stale.sort(function(a, b) {
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

  // Render helpers
  function _renderCol(listId, countId, items, formatter) {
    var listEl  = document.getElementById(listId);
    var countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = items.length;
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<div class="brief-empty">— clear —</div>';
      return;
    }
    listEl.innerHTML = items.slice(0, 3).map(formatter).join('');
  }
  _renderCol('brief-decay-list', 'brief-decay-count', decay, function(d) {
    var orgStr = d.org ? ' · ' + String(d.org).slice(0, 16) : '';
    return '<div class="brief-item" onclick="if(window._openLogForContact)window._openLogForContact(\'' + (d.name || '').replace(/\'/g, '') + '\')">' +
           '<span class="brief-item-title">' + (d.name || '(unnamed)') + orgStr + '</span>' +
           '<span class="brief-item-meta">' + d.days + 'd</span></div>';
  });
  _renderCol('brief-stale-list', 'brief-stale-count', stale, function(s) {
    var h = s.health || { score: 0, status: 'unknown' };
    var pillTxt = h.status === 'unknown' ? '—' : String(h.score);
    var pill = '<span class="health-pill health-' + h.status + '" title="Health ' + h.score + ' · ' + (h.factors ? (h.factors.attendees + ' attendees · ' + h.factors.meetings + ' meetings') : '') + '">' + pillTxt + '</span>';
    return '<div class="brief-item" onclick="if(window.selectOpp)window.selectOpp(\'' + s.id + '\')">' +
           '<span class="brief-item-title">' + pill + s.name + '</span>' +
           '<span class="brief-item-meta">' + (s.days == null ? 'never' : s.days + 'd · ' + s.stage) + '</span></div>';
  });
  _renderCol('brief-upcoming-list', 'brief-upcoming-count', upcoming, function(u) {
    var when = u.when === 0 ? 'today' : u.when === 1 ? 'tomorrow' : '+' + u.when + 'd';
    return '<div class="brief-item" onclick="if(window.goIntelById)window.goIntelById(\'' + u.id + '\')">' +
           '<span class="brief-item-title">' + u.title + '</span>' +
           '<span class="brief-item-meta">' + when + '</span></div>';
  });
  _renderCol('brief-commit-list', 'brief-commit-count', commitDue, function(c) {
    var when = c.days <= 0 ? 'overdue' : c.days === 1 ? 'tomorrow' : 'in ' + c.days + 'd';
    var ownerStr = c.owner ? ' · ' + String(c.owner).slice(0, 14) : '';
    return '<div class="brief-item">' +
           '<span class="brief-item-title">' + c.title.slice(0, 60) + ownerStr + '</span>' +
           '<span class="brief-item-meta">' + when + '</span></div>';
  });
  _renderCol('brief-coverage-list', 'brief-coverage-count', coverage, function(c) {
    var pillKlass = c.status === 'dark' ? 'health-cold' : c.status === 'sparse' ? 'health-cold' : 'health-warm';
    var pillTxt = c.status === 'dark' ? 'DARK' : String(c.score);
    var pill = '<span class="health-pill ' + pillKlass + '" title="' + c.factors.engagedRecent + '/' + (c.factors.oppCount * 2) + ' coverage · ' + c.factors.peopleAtOrg + ' contacts · ' + c.factors.oppCount + ' opps">' + pillTxt + '</span>';
    return '<div class="brief-item">' +
           '<span class="brief-item-title">' + pill + c.name + '</span>' +
           '<span class="brief-item-meta">' + c.factors.oppCount + ' opp' + (c.factors.oppCount === 1 ? '' : 's') + '</span></div>';
  });
  console.log('[Brief] 7.1/7.3 rendered: decay=' + decay.length + ' stale=' + stale.length + ' upcoming=' + upcoming.length + ' commits=' + commitDue.length + ' coverage=' + coverage.length);
};

window.Corsair = window.Corsair || {};
window.Corsair.brief = {
  render: window.renderDailyBrief
};
