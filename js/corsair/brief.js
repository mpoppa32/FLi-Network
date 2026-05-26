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
      // CRM P0.4: manual operator-set nextAction + target date
      var naTs = null;
      if (o.nextActionDate) {
        var _t = Date.parse(String(o.nextActionDate) + 'T00:00:00');
        if (!isNaN(_t)) naTs = _t;
      }
      stale.push({
        id: o.id, name: o.name || 'Pursuit', stage: stg.toUpperCase(),
        days: days2 === 9999 ? null : days2,
        health: health,
        nextAction: o.nextAction || '',
        nextActionDate: o.nextActionDate || '',
        nextActionTs: naTs
      });
    }
  }
  // CRM P0.4: sort by nextActionDate ascending (nulls last), then health ascending
  stale.sort(function(a, b) {
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
    var safeName = (d.name || '').replace(/\'/g, '');
    var safeOrg = (d.org || '').replace(/\'/g, '');
    // P12.9: ✉ button for one-click outreach draft. event.stopPropagation
    // keeps the parent click (open log-meeting) from firing too.
    var outreachBtn = '<button class="brief-item-act" title="Draft outreach" onclick="event.stopPropagation();window._openOutreachDraft&&window._openOutreachDraft(\'' + safeName + '\',' + (d.days||0) + ',\'' + safeOrg + '\')" style="margin-left:6px;padding:2px 7px;border:1px solid var(--gold);border-radius:3px;background:rgba(212,130,58,.12);color:var(--gold);font-size:10px;cursor:pointer;font-family:IBM Plex Mono,monospace;flex-shrink:0">✉</button>';
    return '<div class="brief-item" onclick="if(window._openLogForContact)window._openLogForContact(\'' + safeName + '\')" style="align-items:center">' +
           '<span class="brief-item-title">' + (d.name || '(unnamed)') + orgStr + '</span>' +
           '<span class="brief-item-meta">' + d.days + 'd</span>' +
           outreachBtn + '</div>';
  });
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
    var headRow = '<span class="brief-item-title">' + pill + s.name + '</span>' +
                  '<span class="brief-item-meta" style="display:flex;align-items:center;gap:6px">' + scoreChip + '<span>' + (s.days == null ? 'never' : s.days + 'd · ' + s.stage) + '</span></span>';
    if (naLine) {
      return '<div class="brief-item" style="flex-direction:column;align-items:stretch;gap:0" onclick="if(window.selectOpp)window.selectOpp(\'' + s.id + '\')">' +
             '<div style="display:flex;justify-content:space-between;gap:8px;width:100%">' + headRow + '</div>' +
             naLine +
             '</div>';
    }
    return '<div class="brief-item" onclick="if(window.selectOpp)window.selectOpp(\'' + s.id + '\')">' + headRow + '</div>';
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
      aged.push({ id: ao.id, name: ao.name || '(unnamed)', stage: ao.stage, days: dis, limit: lim, over: dis - lim });
    }
    aged.sort(function(a, b) { return b.over - a.over; }); // most over first
  }
  _renderCol('brief-aged-list', 'brief-aged-count', aged, function(a) {
    var safeName = (a.name || '').replace(/\'/g, '');
    return '<div class="brief-item" onclick="if(window.selectOpp)window.selectOpp(\'' + a.id + '\')">' +
           '<span class="brief-item-title">' + a.name + '</span>' +
           '<span class="brief-item-meta">' + a.days + 'd · ' + a.stage + ' (+' + a.over + 'd)</span></div>';
  });

  console.log('[Brief] 7.1/7.3 rendered: decay=' + decay.length + ' stale=' + stale.length + ' upcoming=' + upcoming.length + ' commits=' + commitDue.length + ' coverage=' + coverage.length + ' aged=' + aged.length);
};

window.Corsair = window.Corsair || {};
window.Corsair.brief = {
  render: window.renderDailyBrief
};
