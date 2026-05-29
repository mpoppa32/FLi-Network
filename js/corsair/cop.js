// Corsair COP module — Common Operating Picture
//
// One of the five sacred Corsair modes. Surfaces live situational
// awareness: what's CHANGING — meetings this week, commitments due
// soon, overdue commitments, cooling T1/T2 contacts, active opportunity
// counts by stage.
//
// P10.15: surface mode = light. Output wrapped in data-surface="light"
// so all descendant elements inherit the light token system. Inline
// gradients replaced with token references.
//
// Reads data via window.* globals exposed by FLiIntel.html:
//   window.meetings, window.commitments, window.nodes,
//   window.opportunities, window.getMtgsForNodeFast
//
// Triggered by renderBoard() in FLiIntel.html which calls
// window.renderCopSection() to splice this panel into the Board view.
//
// Exposes:
//   window._buildCopData        - assembles the KPIs + lists
//   window.renderCopSection     - returns the COP panel HTML
//   window.Corsair.cop.*        - canonical namespace

function _copEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

window._buildCopData = function() {
  var now = Date.now();
  var DAY = 86400000;
  var sevenDays = 7 * DAY;
  var fourteenDays = 14 * DAY;
  var thirtyDays = 30 * DAY;
  var fortyFiveDays = 45 * DAY;

  var recentMtgs = (window.meetings || []).filter(function(m) {
    if (!m || !m.ts) return false;
    return (now - new Date(m.ts).getTime()) < sevenDays;
  });

  var dueSoon = (window.commitments || []).filter(function(c) {
    if (!c || c.status !== 'open') return false;
    var dd = c.due || c.deadline;
    if (!dd) return false;
    var t = new Date(dd + (dd.length === 10 ? 'T00:00:00' : '')).getTime();
    return t > now && (t - now) < sevenDays;
  }).sort(function(a, b) {
    return new Date(a.due || a.deadline).getTime() - new Date(b.due || b.deadline).getTime();
  });

  var overdue = (window.commitments || []).filter(function(c) {
    if (!c || c.status !== 'open') return false;
    var dd = c.due || c.deadline;
    if (!dd) return false;
    return new Date(dd + (dd.length === 10 ? 'T00:00:00' : '')).getTime() < now;
  });

  var stale = [];
  if (window.nodes && typeof window.getMtgsForNodeFast === 'function') {
    window.nodes.forEach(function(n) {
      if (!n || n.type !== 'person') return;
      if (n.priority !== 1 && n.priority !== 2) return;
      var nodeMtgs = [];
      try { nodeMtgs = window.getMtgsForNodeFast(n.id) || []; } catch(e) {}
      var lastTs = 0;
      nodeMtgs.forEach(function(m) {
        if (m && m.ts) {
          var t = new Date(m.ts).getTime();
          if (t > lastTs) lastTs = t;
        }
      });
      var threshold = n.priority === 1 ? thirtyDays : fortyFiveDays;
      if (lastTs === 0 || (now - lastTs) > threshold) {
        stale.push({ node: n, lastTs: lastTs, daysSince: lastTs ? Math.floor((now - lastTs) / DAY) : 999 });
      }
    });
    stale.sort(function(a, b) {
      if (b.daysSince === 999 && a.daysSince !== 999) return 1;
      if (a.daysSince === 999 && b.daysSince !== 999) return -1;
      return b.daysSince - a.daysSince;
    });
  }

  var activeOpps = (window.opportunities || []).filter(function(o) {
    return o && o.stage !== 'won' && o.stage !== 'lost';
  });
  var oppByStage = {};
  activeOpps.forEach(function(o) {
    oppByStage[o.stage || 'awareness'] = (oppByStage[o.stage || 'awareness'] || 0) + 1;
  });

  // Phase 6.5 — Kanban data: pursuits-by-stage + rollups (count, value, weighted)
  var pursuitsByStage = {};
  var stageRollups = {};
  activeOpps.forEach(function(o) {
    var stg = o.stage || 'awareness';
    (pursuitsByStage[stg] = pursuitsByStage[stg] || []).push(o);
  });
  Object.keys(pursuitsByStage).forEach(function(stg) {
    var list = pursuitsByStage[stg];
    var totalValue = list.reduce(function(s, o) { return s + Number(o.value || 0); }, 0);
    var weighted   = list.reduce(function(s, o) { return s + Number(o.value || 0) * Number(o.pwin || 0); }, 0);
    stageRollups[stg] = { count: list.length, value: totalValue, weighted: weighted };
    list.sort(function(a, b) { return Number(b.value || 0) - Number(a.value || 0); });
  });

  // P13.133 Day 6 (reconciliation audit, Pipeline Surface #7) — closed-deal
  // visibility. Won and lost opps were previously skipped from the Kanban
  // entirely (cop.js:265-267 active-board filter) so the operator had no
  // place to see win/loss tally, recent closures, or pull up the lost-stage
  // "capture lessons" action surface. Compute count + total value + most-
  // recent N for each closure column. Closure date is opp.stageEnteredAt
  // (the timestamp the opp moved to its current — won or lost — stage,
  // set by saveOpp Phase 6.1 transition tracking).
  var wonOpps = [], lostOpps = [];
  (window.opportunities || []).forEach(function(o) {
    if (!o) return;
    var stg = String(o.stage || '').toLowerCase().trim();
    if (stg === 'won') wonOpps.push(o);
    else if (stg === 'lost') lostOpps.push(o);
  });
  function _sortClosed(a, b) {
    var ta = Number(a.stageEnteredAt || 0);
    var tb = Number(b.stageEnteredAt || 0);
    return tb - ta;
  }
  wonOpps.sort(_sortClosed);
  lostOpps.sort(_sortClosed);
  var closedRollup = {
    won: {
      count: wonOpps.length,
      value: wonOpps.reduce(function(s, o) { return s + Number(o.value || 0); }, 0),
      recent: wonOpps.slice(0, 5)
    },
    lost: {
      count: lostOpps.length,
      value: lostOpps.reduce(function(s, o) { return s + Number(o.value || 0); }, 0),
      recent: lostOpps.slice(0, 5)
    }
  };

  return {
    recentMtgsCount: recentMtgs.length,
    recentMtgs: recentMtgs.slice(0, 6),
    dueSoonCount: dueSoon.length,
    dueSoon: dueSoon.slice(0, 5),
    overdueCount: overdue.length,
    overdue: overdue.slice(0, 5),
    staleCount: stale.length,
    stale: stale.slice(0, 6),
    activeOppsCount: activeOpps.length,
    activeOpps: activeOpps,
    oppByStage: oppByStage,
    pursuitsByStage: pursuitsByStage,
    stageRollups: stageRollups,
    closedRollup: closedRollup
  };
};

window.renderCopSection = function() {
  var d = window._buildCopData();

  // P10.15: wrap output in data-surface="light" so all descendants
  // inherit the light token system. Theater + HUD remain dark.
  var h = '<div data-surface="light" style="background:var(--bg);color:var(--text);padding:8px 18px 20px;border-radius:8px">';

  // Section header
  h += '<div style="margin:16px 0 18px 0;display:flex;align-items:flex-end;justify-content:space-between;border-bottom:1px solid var(--rule);padding-bottom:12px">';
  h += '  <div style="display:flex;align-items:baseline;gap:14px">';
  h += '    <div style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:24px;font-weight:700;letter-spacing:0.02em;color:var(--text);line-height:1">Live Intelligence</div>';
  h += '    <div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-sm);letter-spacing:0.16em;color:var(--t3);text-transform:uppercase">What\'s Changing</div>';
  h += '  </div>';
  h += '  <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s ease-in-out infinite"></span><span style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.14em;color:var(--green);text-transform:uppercase">Live</span></div>';
  h += '</div>';

  // KPI row — 4 cards
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">';
  var kpis = [
    { val: d.recentMtgsCount, lbl: 'Meetings This Week', color: d.recentMtgsCount > 0 ? 'var(--green)' : 'var(--t3)', sub: 'Last 7 days' },
    { val: d.dueSoonCount,    lbl: 'Due Soon',           color: d.dueSoonCount    > 0 ? 'var(--amber)' : 'var(--t3)', sub: 'Next 7 days' },
    { val: d.overdueCount,    lbl: 'Overdue',            color: d.overdueCount    > 0 ? 'var(--red)'   : 'var(--t3)', sub: 'Past deadline' },
    { val: d.staleCount,      lbl: 'Cooling Contacts',   color: d.staleCount      > 0 ? 'var(--purple)': 'var(--t3)', sub: 'No touch 30d+' }
  ];
  kpis.forEach(function(k) {
    h += '<div style="background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:20px 22px;position:relative;overflow:hidden;transition:box-shadow 160ms">';
    h += '  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:' + k.color + ';opacity:.55"></div>';
    h += '  <div style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:48px;font-weight:800;color:' + k.color + ';line-height:1;letter-spacing:-0.02em">' + k.val + '</div>';
    h += '  <div style="font-size:var(--text-base);font-weight:600;color:var(--text);margin-top:10px;line-height:1.3">' + k.lbl + '</div>';
    h += '  <div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.12em;color:var(--t3);text-transform:uppercase;margin-top:4px">' + k.sub + '</div>';
    h += '</div>';
  });
  h += '</div>';

  // 2-column detail panels
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:8px">';

  // ── COOLING RELATIONSHIPS ──
  h += '<div style="background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:24px 26px">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--rule)">';
  h += '<div style="display:flex;align-items:center;gap:12px">';
  h += '<span style="width:5px;height:22px;background:var(--purple);border-radius:1px"></span>';
  h += '<div><div style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:var(--text-lg);font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--text)">Cooling Relationships</div>';
  h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.12em;color:var(--t3);text-transform:uppercase;margin-top:2px">Priority contacts going dark</div></div>';
  h += '</div>';
  h += '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-sm);font-weight:700;color:var(--purple);letter-spacing:0.1em">' + d.staleCount + ' / ' + d.staleCount + '</span>';
  h += '</div>';

  if (d.stale.length === 0) {
    h += '<div style="font-size:var(--text-base);color:var(--t2);padding:24px 0;line-height:1.6;text-align:center">All key contacts are warm.<br><span style="font-size:var(--text-sm);color:var(--t3);font-family:\'IBM Plex Mono\',monospace;letter-spacing:0.1em;text-transform:uppercase;margin-top:6px;display:inline-block">Strong cadence</span></div>';
  } else {
    d.stale.forEach(function(item, i) {
      var n = item.node;
      var daysLbl = item.daysSince >= 999 ? 'NEVER' : item.daysSince + 'd';
      var color = item.daysSince > 60 ? 'var(--red)' : item.daysSince > 30 ? 'var(--amber)' : 'var(--purple)';
      var sevLbl = item.daysSince > 60 ? 'CRITICAL' : item.daysSince > 30 ? 'WARNING' : 'WATCH';
      var border = i < d.stale.length - 1 ? 'border-bottom:1px solid var(--rule);' : '';
      h += '<div onclick="if(window.openEntityInspector)window.openEntityInspector(\'' + String(n.id).replace(/\'/g, '&#39;') + '\')" style="display:flex;align-items:center;gap:16px;padding:16px 0;cursor:pointer;' + border + 'transition:all .15s" onmouseover="this.style.transform=\'translateX(3px)\'" onmouseout="this.style.transform=\'translateX(0)\'">';
      h += '<div style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0"></div>';
      h += '<div style="flex:1;min-width:0">';
      h += '<div style="font-size:var(--text-md);font-weight:600;color:var(--text);line-height:1.3;margin-bottom:5px">' + _copEsc(n.name || '') + '</div>';
      h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-sm);letter-spacing:0.06em;color:var(--t3);text-transform:uppercase">' + (n.priority === 1 ? 'T1 KEY' : 'T2 ACTIVE') + (n.org ? ' · ' + _copEsc(n.org) : '') + '</div>';
      h += '</div>';
      h += '<div style="text-align:right;flex-shrink:0">';
      h += '<div style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:var(--text-xl);font-weight:700;color:' + color + ';line-height:1;letter-spacing:-0.02em">' + daysLbl + '</div>';
      h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-2xs);font-weight:700;letter-spacing:0.16em;color:' + color + ';text-transform:uppercase;margin-top:4px">' + sevLbl + '</div>';
      h += '</div>';
      h += '</div>';
    });
  }
  h += '</div>';

  // ── DUE THIS WEEK ──
  h += '<div style="background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:24px 26px">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--rule)">';
  h += '<div style="display:flex;align-items:center;gap:12px">';
  h += '<span style="width:5px;height:22px;background:var(--amber);border-radius:1px"></span>';
  h += '<div><div style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:var(--text-lg);font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--text)">Due This Week</div>';
  h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.12em;color:var(--t3);text-transform:uppercase;margin-top:2px">Commitments and deadlines</div></div>';
  h += '</div>';
  h += '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-sm);font-weight:700;color:var(--amber);letter-spacing:0.1em">' + (d.overdueCount + d.dueSoonCount) + ' ITEMS</span>';
  h += '</div>';

  if (d.dueSoon.length === 0 && d.overdue.length === 0) {
    h += '<div style="font-size:var(--text-base);color:var(--t2);padding:24px 0;line-height:1.6;text-align:center">No commitments due in the next 7 days.<br><span style="font-size:var(--text-sm);color:var(--t3);font-family:\'IBM Plex Mono\',monospace;letter-spacing:0.1em;text-transform:uppercase;margin-top:6px;display:inline-block">Inbox clear</span></div>';
  } else {
    var allItems = d.overdue.map(function(c) { return { c: c, overdue: true }; })
                   .concat(d.dueSoon.map(function(c) { return { c: c, overdue: false }; }));
    allItems.forEach(function(it, i) {
      var ci = it.c;
      var label = ci.text || ci.title || ci.what || 'Commitment';
      var border = i < allItems.length - 1 ? 'border-bottom:1px solid var(--rule);' : '';
      var color = it.overdue ? 'var(--red)' : 'var(--amber)';
      var sevLbl = it.overdue ? 'OVERDUE' : 'DUE';
      var dd = ci.due || ci.deadline;
      var dt = dd ? new Date(dd + (dd.length === 10 ? 'T00:00:00' : '')) : new Date();
      var dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      h += '<div style="display:flex;align-items:flex-start;gap:16px;padding:16px 0;' + border + '">';
      h += '<div style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;margin-top:5px"></div>';
      h += '<div style="flex:1;min-width:0">';
      h += '<div style="font-size:var(--text-md);font-weight:600;color:var(--text);line-height:1.4;margin-bottom:5px">' + _copEsc(label) + '</div>';
      h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-sm);letter-spacing:0.06em;color:var(--t3);text-transform:uppercase">' + (ci.owner ? _copEsc(ci.owner) + ' · ' : '') + dateStr + '</div>';
      if (ci.id) {
        h += '<div style="display:flex;gap:6px;margin-top:8px">';
        h += '<button onclick="event.stopPropagation();updateCommitmentStatus(\'' + ci.id + '\',\'fulfilled\').then(function(){renderBoard();});" style="font-size:8px;padding:2px 7px;border:1px solid var(--green);border-radius:2px;background:transparent;color:var(--green);cursor:pointer;font-family:IBM Plex Mono,monospace;letter-spacing:0.08em;text-transform:uppercase">✓ DONE</button>';
        h += '<button onclick="event.stopPropagation();updateCommitmentStatus(\'' + ci.id + '\',\'broken\').then(function(){renderBoard();});" style="font-size:8px;padding:2px 7px;border:1px solid var(--red);border-radius:2px;background:transparent;color:var(--red);cursor:pointer;font-family:IBM Plex Mono,monospace;letter-spacing:0.08em;text-transform:uppercase">✗ BROKEN</button>';
        h += '</div>';
      }
      h += '</div>';
      h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);font-weight:700;color:' + color + ';letter-spacing:0.16em;flex-shrink:0;padding-top:3px">' + sevLbl + '</div>';
      h += '</div>';
    });
  }
  h += '</div>';

  h += '</div>'; // close 2-column panels

  // ── PIPELINE BOARD (Phase 6.5 Kanban-by-stage) ──────────────────────
  // 10-column Kanban using the operator's locked stage spec from
  // Corsair.pipeline.stages. Each column header rolls up count, value,
  // weighted value (sum of value * pwin). Cards click into the
  // dossier (Phase 6.4 stage panel handles advancement).
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  if (pipelineMod && pipelineMod.stages) {
    var stages = pipelineMod.stages;
    var byStage = d.pursuitsByStage || {};
    var rollups = d.stageRollups   || {};

    h += '<div style="margin-top:24px">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--rule);flex-wrap:wrap;gap:10px">';
    h += '<div style="display:flex;align-items:center;gap:12px">';
    h += '<span style="width:5px;height:22px;background:var(--gold);border-radius:1px"></span>';
    h += '<div><div style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:var(--text-lg);font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--text)">Pipeline Board</div>';
    h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.12em;color:var(--t3);text-transform:uppercase;margin-top:2px">' + d.activeOppsCount + ' active pursuits across ' + stages.filter(function(s){return s.key!=='won'&&s.key!=='lost';}).length + ' stages</div></div>';
    h += '</div>';
    // P13.141 — Kanban filter chips (audit High #9 / Visual Flow). Operator
    // used to hunt across 8 columns to find aged or ready-to-advance deals;
    // now one click filters all columns simultaneously. State persists on
    // window so the filter survives renders. Filtered counts/rollups are
    // computed from the post-filter card set so the header math stays
    // honest. Click the active chip again to clear → All.
    var _filterMode = window._copKanbanFilter || 'all';
    function _chip(mode, label) {
      var active = _filterMode === mode;
      var bg = active ? 'rgba(212,130,58,.18)' : 'transparent';
      var bd = active ? 'var(--gold)' : 'var(--b2)';
      var fg = active ? 'var(--gold)' : 'var(--t2)';
      return '<button onclick="window._copSetKanbanFilter&amp;&amp;window._copSetKanbanFilter(\'' + mode + '\')" style="padding:5px 10px;border:1px solid ' + bd + ';border-radius:2px;background:' + bg + ';color:' + fg + ';font-family:IBM Plex Mono,monospace;font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">' + label + '</button>';
    }
    // P13.157 — Priority + Tag dropdowns built from distinct values across
    // the active opp set so the Atlas-imported mondayPriority (121/122 =
    // "Critical ⚠️") and mondayTags ("defense, sUAS") become operational
    // cuts. Empty workspace → dropdowns hidden so the chip row stays clean.
    var _priorityVals = [];
    var _tagVals = [];
    (d.activeOpps || []).forEach(function(o){
      if (!o) return;
      var pv = String(o.mondayPriority || '').trim();
      if (pv && _priorityVals.indexOf(pv) < 0) _priorityVals.push(pv);
      var tv = String(o.mondayTags || '').trim();
      if (tv) {
        tv.split(',').forEach(function(t){
          var tt = t.trim();
          if (tt && _tagVals.indexOf(tt) < 0) _tagVals.push(tt);
        });
      }
    });
    function _dropdown(prefix, label, options, currentMode) {
      var current = (currentMode && currentMode.indexOf(prefix + ':') === 0) ? currentMode.slice(prefix.length + 1) : '';
      var optsHtml = '<option value="">' + label + '</option>' +
        options.map(function(v){
          var sel = v === current ? ' selected' : '';
          var safe = _copEsc(v);
          return '<option value="' + safe + '"' + sel + '>' + safe + '</option>';
        }).join('');
      var active = !!current;
      var bg = active ? 'rgba(212,130,58,.18)' : 'transparent';
      var bd = active ? 'var(--gold)' : 'var(--b2)';
      var fg = active ? 'var(--gold)' : 'var(--t2)';
      return '<select onchange="window._copSetKanbanFilter&amp;&amp;window._copSetKanbanFilter(this.value?\'' + prefix + ':\'+this.value:\'all\')" style="padding:4px 8px;border:1px solid ' + bd + ';border-radius:2px;background:' + bg + ';color:' + fg + ';font-family:IBM Plex Mono,monospace;font-size:var(--text-xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer">' + optsHtml + '</select>';
    }

    h += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
         _chip('all', 'All') +
         _chip('ready', 'Ready') +
         _chip('aged', 'Aged') +
         _chip('sparse', 'Sparse data') +
         (_priorityVals.length ? _dropdown('priority', 'Priority', _priorityVals, _filterMode) : '') +
         (_tagVals.length ? _dropdown('tag', 'Tag', _tagVals, _filterMode) : '') +
         '<span style="font-family:IBM Plex Mono,monospace;font-size:var(--text-xs);letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-left:10px">click card → dossier</span>' +
         '</div>';
    h += '</div>';

    // Filter predicate matching the active chip. Aged uses
    // pipelineMod.isStageStuck; Ready uses pipelineMod.validateAdvance
    // against the next stage; Sparse uses scoreConfidence.
    function _matchesFilter(o) {
      if (_filterMode === 'all') return true;
      if (_filterMode === 'aged') {
        return typeof pipelineMod.isStageStuck === 'function' && pipelineMod.isStageStuck(o);
      }
      if (_filterMode === 'sparse') {
        return o && o.scoreConfidence === 'sparse';
      }
      // P13.157 — Priority / Tag filters drilled from the dropdowns.
      if (_filterMode.indexOf && _filterMode.indexOf('priority:') === 0) {
        var pVal = _filterMode.slice('priority:'.length);
        return String((o && o.mondayPriority) || '').trim() === pVal;
      }
      if (_filterMode.indexOf && _filterMode.indexOf('tag:') === 0) {
        var tVal = _filterMode.slice('tag:'.length);
        var oTags = String((o && o.mondayTags) || '').split(',').map(function(t){return t.trim();});
        return oTags.indexOf(tVal) !== -1;
      }
      if (_filterMode === 'ready' && typeof pipelineMod.validateAdvance === 'function' && typeof pipelineMod.index === 'function') {
        var stagesArr = pipelineMod.stages || [];
        var curIdx = pipelineMod.index(o.stage);
        if (curIdx < 0 || curIdx >= stagesArr.length - 1) return false;
        var nextS = stagesArr[curIdx + 1];
        if (!nextS || nextS.key === 'won' || nextS.key === 'lost') return false;
        var v = pipelineMod.validateAdvance(o, o.stage, nextS.key);
        return !!(v && v.ok);
      }
      return true;
    }

    h += '<div class="cop-kanban">';
    stages.forEach(function(s) {
      // Skip terminal stages in the active board (won + lost are end states)
      if (s.key === 'won' || s.key === 'lost') return;
      var rawCards = byStage[s.key] || [];
      var cards = rawCards.filter(_matchesFilter);
      // Recompute count + rollup off the FILTERED cards so the column
      // header math doesn't lie when a filter is active.
      var roll = { count: cards.length, value: 0, weighted: 0 };
      for (var ci = 0; ci < cards.length; ci++) {
        var cc = cards[ci];
        roll.value += Number(cc.value || 0);
        roll.weighted += Number(cc.value || 0) * Number(cc.pwin || 0);
      }

      h += '<div class="cop-kanban-col" data-stage="' + _copEsc(s.key) + '">';
      h += '<div class="cop-kanban-col-head">';
      h += '<div class="cop-kanban-col-title"><span class="cop-kanban-col-dot" style="background:' + s.color + '"></span>' + _copEsc(s.label) + '</div>';
      h += '<div class="cop-kanban-col-count">' + roll.count + '</div>';
      h += '</div>';

      // Rollup line: value · weighted
      // P13.148 — softer empty state when no values are scored yet.
      // Showing "$0 · $0 weighted" on every column makes a fresh
      // pipeline (or one mid-annotation, like the 122 Atlas opps) look
      // broken in demos. When the column has cards but no values,
      // surface a muted "value pending" instead.
      if (roll.count > 0) {
        h += '<div class="cop-kanban-col-rollup">';
        if (roll.value > 0) {
          h += '<span title="Total value">$' + _formatVal(roll.value) + '</span>';
          h += '<span class="cop-kanban-rollup-sep">·</span>';
          h += '<span title="Weighted (sum of value × pwin)">$' + _formatVal(roll.weighted) + ' weighted</span>';
        } else {
          h += '<span title="None of these opps have value/pwin set — click a card to add" style="color:var(--t3);font-style:italic">value pending</span>';
        }
        h += '</div>';
      }

      // Cards
      h += '<div class="cop-kanban-col-cards">';
      if (cards.length === 0) {
        h += '<div class="cop-kanban-col-empty">—</div>';
      } else {
        cards.forEach(function(o) {
          var aged = (typeof pipelineMod.isStageStuck === 'function') && pipelineMod.isStageStuck(o);
          var days = (typeof pipelineMod.daysInStage === 'function') ? pipelineMod.daysInStage(o) : null;
          var ageLimit = (typeof pipelineMod.ageLimit === 'function') ? pipelineMod.ageLimit(o.stage) : null;
          var safeId = String(o.id).replace(/'/g, '&#39;');
          var pwinPct = Math.round(Number(o.pwin || 0) * 100);

          // P13.134 Day 2 (Pipeline Surface #2) — surface score tier +
          // confidence on Kanban cards. Previously the card showed
          // value/pwin/days but NOT score at all — operator scanning the
          // Kanban couldn't tell which deals were ranked high (A tier on
          // earned data) vs. which were thin profiles auto-scored without
          // engagement signal. Now: small tier+score chip + sparse cards
          // get a dashed top border + faded opacity matching the Table.
          var scoreTier = (o.tier === 'A' || o.tier === 'B' || o.tier === 'C') ? o.tier : null;
          var scoreNum = (typeof o.score === 'number') ? o.score : null;
          var scoreConf = o.scoreConfidence || null;
          var isSparse = scoreConf === 'sparse';
          // P13.136 Day 5 (Pipeline Surface #5) — health pill in top-right
          // corner of card. Health came from window._computePursuitHealth
          // (already used by Table) — Kanban was missing this entirely
          // so operator had to inspector-click to see HOT/WARM/COLD.
          var health = (typeof window._computePursuitHealth === 'function')
            ? window._computePursuitHealth(o)
            : null;
          var healthStatus = (health && health.status) || null;
          var healthCol = healthStatus === 'hot' ? '#22c55e'
                        : healthStatus === 'warm' ? '#facc15'
                        : healthStatus === 'cold' ? '#ef4444'
                        : null;
          // Aged-and-over-limit cards get a red outline per audit ask —
          // makes "stuck and over the age threshold" unmistakable from
          // a card-scan distance.
          var cardCls = 'cop-kanban-card' + (aged ? ' cop-kanban-card-aged' : '') + (isSparse ? ' cop-kanban-card-sparse' : '');
          var cardStyleParts = [];
          if (isSparse) cardStyleParts.push('border-style:dashed', 'opacity:.78');
          if (aged) cardStyleParts.push('border:1px solid rgba(239,68,68,.55)', 'box-shadow:0 0 0 1px rgba(239,68,68,.18) inset');
          var cardInlineStyle = cardStyleParts.length ? ' style="' + cardStyleParts.join(';') + '"' : '';

          h += '<div class="' + cardCls + '"' + cardInlineStyle + ' onclick="window.openEntityInspector(\'' + safeId + '\')" title="Open dossier">';
          // Health pill — absolute top-right, small + colored. Skipped when
          // health module is unavailable (graceful degrade for cold load).
          if (healthCol && healthStatus) {
            h += '<span title="Health: ' + healthStatus + ' (Click → dossier for factor breakdown)" style="position:absolute;top:6px;right:8px;font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:' + healthCol + ';background:rgba(0,0,0,.32);border:1px solid ' + healthCol + '70;border-radius:2px;padding:1px 5px;line-height:1">' + healthStatus + '</span>';
          }
          h += '<div class="cop-kanban-card-name" style="padding-right:42px">' + _copEsc(o.name || '(unnamed)') + '</div>';
          // Score line — own row above value/pwin/days so the tier chip is
          // unambiguous and lines up across cards.
          if (scoreTier && scoreNum != null) {
            var tcol = scoreTier === 'A' ? '#22c55e' : scoreTier === 'B' ? '#facc15' : '#ef4444';
            var confSuffix = isSparse ? ' ·thin' : scoreConf === 'partial' ? ' ·part' : '';
            h += '<div style="display:inline-block;margin:4px 0 6px;padding:1px 6px;border:1px ' + (isSparse ? 'dashed' : 'solid') + ' ' + tcol + '70;border-radius:3px;background:rgba(0,0,0,.22);color:' + tcol + ';font-family:IBM Plex Mono,monospace;font-size:10px;font-weight:700;letter-spacing:.04em"><span style="letter-spacing:.10em">' + scoreTier + '</span> ' + scoreNum + confSuffix + '</div>';
          }
          var metaBits = [];
          if (o.value)        metaBits.push('$' + _formatVal(o.value));
          if (o.pwin != null) metaBits.push(pwinPct + '%');
          h += '<div class="cop-kanban-card-meta">' + metaBits.join(' · ') + '</div>';
          // P13.136 Day 5 — days-in-stage with explicit age limit so the
          // "30d" number reads as "30d / Limit 14" instead of operator
          // having to remember each stage's threshold. Aged opps get a
          // red label; on-track opps stay dim.
          if (days != null) {
            var daysCol = aged ? '#ef4444' : 'var(--t3)';
            var limitStr = (ageLimit != null) ? ' / Limit ' + ageLimit : '';
            h += '<div style="font-family:IBM Plex Mono,monospace;font-size:10px;letter-spacing:.06em;color:' + daysCol + ';margin-top:4px;font-weight:' + (aged ? '700' : '500') + '">' + days + 'd in stage' + limitStr + '</div>';
          }
          h += '</div>';
        });
      }
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    h += '</div>';
  }

  // ── CLOSED DEALS (P13.133 Day 6 — closed-deal tray) ──────────────────
  // Two-column rollup: Won and Lost. Each shows count + total value +
  // up to 5 most-recent closures sorted by stageEnteredAt desc. Card
  // click opens the dossier — for lost opps the Phase 6.4 stage panel
  // surfaces the "Capture lessons in pass-down note" next action that
  // was previously unreachable because the Kanban filtered closed
  // stages out. Reevo parity: closed deals are first-class with debrief
  // surface.
  var closed = d.closedRollup;
  if (closed && (closed.won.count > 0 || closed.lost.count > 0)) {
    h += '<div style="margin-top:24px">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--rule)">';
    h += '<div style="display:flex;align-items:center;gap:12px">';
    h += '<span style="width:5px;height:22px;background:var(--t2);border-radius:1px"></span>';
    h += '<div><div style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:var(--text-lg);font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--text)">Closed Deals</div>';
    h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.12em;color:var(--t3);text-transform:uppercase;margin-top:2px">' + closed.won.count + ' won · ' + closed.lost.count + ' lost · click card → debrief in dossier</div></div>';
    h += '</div>';
    h += '</div>';

    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';

    // Won column
    h += '<div style="background:var(--surface);border:1px solid rgba(58,138,92,.35);border-left:3px solid #3a8a5c;border-radius:8px;padding:18px 20px">';
    h += '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--rule)">';
    h += '<div style="display:flex;align-items:baseline;gap:10px"><span style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:32px;font-weight:800;color:#3a8a5c;line-height:1;letter-spacing:-0.02em">' + closed.won.count + '</span><span style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.14em;color:var(--t3);text-transform:uppercase">won</span></div>';
    h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-sm);color:#3a8a5c;letter-spacing:0.06em">$' + _formatVal(closed.won.value) + ' total</div>';
    h += '</div>';
    if (closed.won.recent.length === 0) {
      h += '<div style="font-size:var(--text-sm);color:var(--t3);font-style:italic;padding:8px 0">No wins on record. Yet.</div>';
    } else {
      closed.won.recent.forEach(function(o, i) {
        var safeIdW = String(o.id).replace(/'/g, '&#39;');
        var dateStr = o.stageEnteredAt
          ? new Date(Number(o.stageEnteredAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        var valStr = o.value ? '$' + _formatVal(o.value) : '';
        var border = i < closed.won.recent.length - 1 ? 'border-bottom:1px solid var(--rule);' : '';
        h += '<div onclick="window.openEntityInspector&amp;&amp;window.openEntityInspector(\'' + safeIdW + '\')" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;cursor:pointer;' + border + 'transition:transform .15s" onmouseover="this.style.transform=\'translateX(2px)\'" onmouseout="this.style.transform=\'translateX(0)\'">';
        h += '<div style="flex:1;min-width:0">';
        h += '<div style="font-size:var(--text-base);font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _copEsc(o.name || '(unnamed)') + '</div>';
        h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.06em;color:var(--t3);margin-top:2px">' + (dateStr || '—') + (valStr ? ' · ' + valStr : '') + '</div>';
        h += '</div>';
        h += '<span style="color:#3a8a5c;font-size:14px;flex-shrink:0">→</span>';
        h += '</div>';
      });
    }
    h += '</div>';

    // Lost column
    h += '<div style="background:var(--surface);border:1px solid rgba(179,64,64,.30);border-left:3px solid #b34040;border-radius:8px;padding:18px 20px">';
    h += '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--rule)">';
    h += '<div style="display:flex;align-items:baseline;gap:10px"><span style="font-family:\'Antonio\',\'Outfit\',sans-serif;font-size:32px;font-weight:800;color:#b34040;line-height:1;letter-spacing:-0.02em">' + closed.lost.count + '</span><span style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.14em;color:var(--t3);text-transform:uppercase">lost / no-bid</span></div>';
    h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-sm);color:#b34040;letter-spacing:0.06em">$' + _formatVal(closed.lost.value) + ' total</div>';
    h += '</div>';
    if (closed.lost.recent.length === 0) {
      h += '<div style="font-size:var(--text-sm);color:var(--t3);font-style:italic;padding:8px 0">No closed-lost on record.</div>';
    } else {
      closed.lost.recent.forEach(function(o, i) {
        var safeIdL = String(o.id).replace(/'/g, '&#39;');
        var dateStrL = o.stageEnteredAt
          ? new Date(Number(o.stageEnteredAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        var valStrL = o.value ? '$' + _formatVal(o.value) : '';
        var borderL = i < closed.lost.recent.length - 1 ? 'border-bottom:1px solid var(--rule);' : '';
        h += '<div onclick="window.openEntityInspector&amp;&amp;window.openEntityInspector(\'' + safeIdL + '\')" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;cursor:pointer;' + borderL + 'transition:transform .15s" onmouseover="this.style.transform=\'translateX(2px)\'" onmouseout="this.style.transform=\'translateX(0)\'">';
        h += '<div style="flex:1;min-width:0">';
        h += '<div style="font-size:var(--text-base);font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _copEsc(o.name || '(unnamed)') + '</div>';
        h += '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:var(--text-xs);letter-spacing:0.06em;color:var(--t3);margin-top:2px">' + (dateStrL || '—') + (valStrL ? ' · ' + valStrL : '') + '</div>';
        h += '</div>';
        h += '<span style="color:#b34040;font-size:14px;flex-shrink:0">→</span>';
        h += '</div>';
      });
    }
    h += '</div>';

    h += '</div>'; // close 2-col grid
    h += '</div>'; // close closed-deals section
  }

  h += '</div>'; // close data-surface="light" wrapper
  return h;
};

// Compact value formatter for COP Kanban (1.2M / 425K / 800)
function _formatVal(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

window.Corsair = window.Corsair || {};
window.Corsair.cop = {
  build:  window._buildCopData,
  render: window.renderCopSection
};

// P13.141 — Kanban filter toggle. Click sets the mode (or clears if
// the same mode is already active), then triggers a re-render. Uses
// the existing renderBoard() entry point so the whole Brief surface
// stays in sync. Survives a single click → state set → re-render.
window._copSetKanbanFilter = function(mode) {
  if (!mode) return;
  if (window._copKanbanFilter === mode) {
    window._copKanbanFilter = 'all';
  } else {
    window._copKanbanFilter = mode;
  }
  // Trigger the surfaces that paint the COP. renderBoard re-emits the
  // whole intel board including the cop section; fallbacks handle direct
  // COP view paint too.
  try { if (typeof window.renderBoard === 'function') window.renderBoard(); } catch(e){}
  try { if (typeof window._renderCopBoard === 'function') window._renderCopBoard(); } catch(e){}
  try { if (typeof window._renderCopForecast === 'function') window._renderCopForecast(); } catch(e){}
  // P13.158 — also re-render the Pipeline tab's Kanban so the chip-row
  // dropdowns work on that surface too (two parallel renderers).
  try { if (typeof window._renderKanbanBoard === 'function') window._renderKanbanBoard(); } catch(e){}
};
