// Corsair table module — The Table surface (Phase 5)
//
// The operator's morning surface. Spreadsheet-grade dense view of every
// active pursuit at-a-glance. Designed for the operator who runs her
// desk like a Bloomberg terminal — light mode, high information density,
// keyboard-friendly.
//
// Phase 5a (this commit): foundation — full table render with the
// master-prompt 16-column default. Sorting, filters, inline editing,
// bulk operations, saved views all land in subsequent commits.
//
// Reads workspace data via window.* globals:
//   window.opportunities, window.nodes, window.meetings,
//   window.commitments, window._computePursuitHealth,
//   window._computeAccountCoverage, window.getMtgsForNodeFast
//   window.Corsair.pipeline (stage spec / aging / health composite)
//
// Triggered by switchView('table') in FLiIntel.html.

function _tEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _tFmtVal(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  if (n > 0)    return '$' + Math.round(n);
  return '—';
}

function _tFmtRel(ts) {
  if (!ts) return '—';
  var t = (typeof ts === 'number') ? ts : new Date(ts).getTime();
  if (isNaN(t)) return '—';
  var diff = t - Date.now();
  var days = Math.round(diff / 86400000);
  if (days === 0)   return 'today';
  if (days === 1)   return 'in 1d';
  if (days === -1)  return '1d ago';
  if (days > 0)     return 'in ' + days + 'd';
  return Math.abs(days) + 'd ago';
}

function _tStatusDot(opp, health) {
  // Composite of stage health (aged or not) + pursuit health (hot/warm/cold)
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  var aged = pipelineMod && typeof pipelineMod.isStageStuck === 'function' && pipelineMod.isStageStuck(opp);
  if (aged) return '#9A2E2E';                  // red — aged, attention needed
  if (health && health.status === 'cold') return '#9A2E2E';
  if (health && health.status === 'warm') return '#B8691E';
  if (health && health.status === 'hot')  return '#2D7048';
  return '#7d7669';                            // unknown
}

function _tHealthPill(health) {
  if (!health || health.status === 'unknown') {
    return '<span class="tbl-health-pill tbl-health-unknown">—</span>';
  }
  var lbl = health.status === 'hot' ? 'HOT' : health.status === 'warm' ? 'WARM' : 'COLD';
  return '<span class="tbl-health-pill tbl-health-' + health.status + '">' + lbl + '</span>';
}

function _tCoverageBadge(opp) {
  var fn = window._computeAccountCoverage;
  if (typeof fn !== 'function') return '—';
  // Coverage is account-level (per org). Pursuit's customer org if known.
  var orgName = opp.agency || opp.customer || '';
  if (!orgName) return '—';
  var orgNode = (window.nodes || []).find(function(n) {
    return n && (n.type === 'company' || n.type === 'government') &&
           String(n.name || '').toLowerCase() === String(orgName).toLowerCase();
  });
  if (!orgNode) return '—';
  try {
    var cov = fn(orgNode, { nodes: window.nodes || [], meetings: window.meetings || [], opps: window.opportunities || [] });
    var lbl = (cov.status || 'sparse').toUpperCase();
    return '<span class="tbl-cov-badge tbl-cov-' + (cov.status || 'sparse') + '">' + lbl + '</span>';
  } catch (e) { return '—'; }
}

function _tLastMeeting(opp) {
  var mtgs = window.meetings || [];
  var oid = String(opp.id);
  var lastTs = null;
  for (var i = 0; i < mtgs.length; i++) {
    var m = mtgs[i];
    if (!m) continue;
    var tagged = (m.oppId != null && String(m.oppId) === oid) ||
                 (Array.isArray(opp.meetings) && opp.meetings.indexOf(m.id) !== -1);
    if (!tagged) continue;
    var t = (m.ts) ? new Date(m.ts).getTime() : (m.meta && m.meta.date ? new Date(m.meta.date).getTime() : null);
    if (t && (!lastTs || t > lastTs)) lastTs = t;
  }
  return lastTs ? _tFmtRel(lastTs) : '—';
}

function _tCaptureLead(opp) {
  var lead = opp.captureLead || '';
  if (!lead) return '—';
  // Initials chip
  var parts = String(lead).trim().split(/\s+/);
  var initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : (parts[0][0] || '?').toUpperCase();
  return '<span class="tbl-lead" title="' + _tEsc(lead) + '">' + initials + '</span>';
}

function _tTags(opp) {
  var tags = opp.tags;
  if (!Array.isArray(tags) || tags.length === 0) return '—';
  return tags.slice(0, 2).map(function(t) {
    return '<span class="tbl-tag">' + _tEsc(t) + '</span>';
  }).join('') + (tags.length > 2 ? '<span class="tbl-tag-more">+' + (tags.length - 2) + '</span>' : '');
}

function _tNotesPreview(opp) {
  var n = String(opp.notes || '').trim();
  if (!n) return '—';
  return _tEsc(n.length > 60 ? n.slice(0, 60) + '…' : n);
}

function _tNextMilestone(opp) {
  // Prefer rfpDate, then awardDate, then due
  var d = opp.rfpDate || opp.awardDate || opp.due;
  return d ? _tFmtRel(d) : '—';
}

function _tNextAction(opp) {
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  if (!pipelineMod || typeof pipelineMod.nextAction !== 'function') return '—';
  var act = pipelineMod.nextAction(opp.stage);
  return act ? _tEsc(act.length > 36 ? act.slice(0, 36) + '…' : act) : '—';
}

window._renderTableView = function() {
  var body = document.getElementById('table-view-body');
  if (!body) return;
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  var stages = (pipelineMod && pipelineMod.stages) || [];

  var opps = (window.opportunities || []).slice();
  // Default sort: by stage order, then days-in-stage desc within stage
  var stageOrder = {};
  stages.forEach(function(s, i) { stageOrder[s.key] = i; });
  opps.sort(function(a, b) {
    var sa = stageOrder[a.stage] != null ? stageOrder[a.stage] : 999;
    var sb = stageOrder[b.stage] != null ? stageOrder[b.stage] : 999;
    if (sa !== sb) return sa - sb;
    var da = (pipelineMod && typeof pipelineMod.daysInStage === 'function') ? pipelineMod.daysInStage(a) : 0;
    var db = (pipelineMod && typeof pipelineMod.daysInStage === 'function') ? pipelineMod.daysInStage(b) : 0;
    return db - da;
  });

  // Header
  var h = '<div class="tbl-meta">';
  h += '<span class="tbl-meta-count"><strong>' + opps.length + '</strong> pursuits</span>';
  h += '<span class="tbl-meta-sep">·</span>';
  h += '<span class="tbl-meta-hint">click name → dossier · sortable columns + filters land in next commit</span>';
  h += '</div>';

  h += '<div class="tbl-scroll">';
  h += '<table class="tbl">';
  h += '<thead><tr>';
  var cols = [
    { key: 'status',     label: '',          align: 'center', w: '24px' },
    { key: 'name',       label: 'Pursuit',   align: 'left',   w: '260px', sticky: true },
    { key: 'customer',   label: 'Customer',  align: 'left',   w: '180px' },
    { key: 'stage',      label: 'Stage',     align: 'left',   w: '140px' },
    { key: 'days',       label: 'Days',      align: 'right',  w: '60px'  },
    { key: 'value',      label: 'Value',     align: 'right',  w: '90px'  },
    { key: 'pwin',       label: 'pWin',      align: 'right',  w: '60px'  },
    { key: 'weighted',   label: 'Weighted',  align: 'right',  w: '90px'  },
    { key: 'next',       label: 'Next',      align: 'right',  w: '80px'  },
    { key: 'lead',       label: 'Lead',      align: 'center', w: '46px'  },
    { key: 'action',     label: 'Next Action', align: 'left', w: '220px' },
    { key: 'health',     label: 'Health',    align: 'center', w: '70px'  },
    { key: 'lastMtg',    label: 'Last Mtg',  align: 'right',  w: '70px'  },
    { key: 'coverage',   label: 'Coverage',  align: 'center', w: '80px'  },
    { key: 'tags',       label: 'Tags',      align: 'left',   w: '120px' },
    { key: 'notes',      label: 'Notes',     align: 'left',   w: '220px' }
  ];
  cols.forEach(function(c) {
    h += '<th class="tbl-th tbl-th-' + c.align + (c.sticky ? ' tbl-th-sticky' : '') + '" style="width:' + c.w + ';min-width:' + c.w + '">' + c.label + '</th>';
  });
  h += '</tr></thead>';

  h += '<tbody>';
  if (opps.length === 0) {
    h += '<tr><td colspan="' + cols.length + '" class="tbl-empty">No pursuits in workspace yet.</td></tr>';
  } else {
    opps.forEach(function(o) {
      var safeId = String(o.id).replace(/'/g, '&#39;');
      var stageCfg = (pipelineMod && typeof pipelineMod.config === 'function') ? pipelineMod.config(o.stage) : { label: o.stage, color: '#7d7669' };
      var stageLabel = (stageCfg && stageCfg.label) || o.stage || '—';
      var days = (pipelineMod && typeof pipelineMod.daysInStage === 'function') ? pipelineMod.daysInStage(o) : 0;
      var aged = (pipelineMod && typeof pipelineMod.isStageStuck === 'function') && pipelineMod.isStageStuck(o);
      var health = (typeof window._computePursuitHealth === 'function') ? window._computePursuitHealth(o) : { status: 'unknown', score: 0 };
      var dotColor = _tStatusDot(o, health);
      var weighted = Number(o.value || 0) * Number(o.pwin || 0);
      var pwinPct = o.pwin != null ? Math.round(Number(o.pwin) * 100) + '%' : '—';

      h += '<tr class="tbl-row' + (aged ? ' tbl-row-aged' : '') + '" data-opp-id="' + safeId + '">';

      // status dot
      h += '<td class="tbl-cell tbl-cell-center"><span class="tbl-dot" style="background:' + dotColor + '" title="' + (aged ? 'aged in stage' : (health.status || 'unknown')) + '"></span></td>';

      // name (sticky, click → dossier)
      h += '<td class="tbl-cell tbl-cell-left tbl-cell-sticky"><span class="tbl-name" onclick="window.openEntityInspector(\'' + safeId + '\')">' + _tEsc(o.name || '(unnamed)') + '</span></td>';

      // customer
      h += '<td class="tbl-cell tbl-cell-left tbl-cell-meta">' + (o.agency ? _tEsc(o.agency) : (o.customer ? _tEsc(o.customer) : '—')) + '</td>';

      // stage
      h += '<td class="tbl-cell tbl-cell-left"><span class="tbl-stage-pill"><span class="tbl-stage-dot" style="background:' + (stageCfg.color || '#7d7669') + '"></span>' + _tEsc(stageLabel) + '</span></td>';

      // days
      h += '<td class="tbl-cell tbl-cell-right tbl-cell-num' + (aged ? ' tbl-cell-warn' : '') + '">' + days + '</td>';

      // value (Plex Mono right)
      h += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + _tFmtVal(o.value) + '</td>';

      // pwin
      h += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + pwinPct + '</td>';

      // weighted
      h += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + _tFmtVal(weighted) + '</td>';

      // next milestone
      h += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + _tNextMilestone(o) + '</td>';

      // lead (initials)
      h += '<td class="tbl-cell tbl-cell-center">' + _tCaptureLead(o) + '</td>';

      // next action
      h += '<td class="tbl-cell tbl-cell-left tbl-cell-meta">' + _tNextAction(o) + '</td>';

      // health pill
      h += '<td class="tbl-cell tbl-cell-center">' + _tHealthPill(health) + '</td>';

      // last meeting
      h += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + _tLastMeeting(o) + '</td>';

      // coverage badge
      h += '<td class="tbl-cell tbl-cell-center">' + _tCoverageBadge(o) + '</td>';

      // tags
      h += '<td class="tbl-cell tbl-cell-left">' + _tTags(o) + '</td>';

      // notes preview
      h += '<td class="tbl-cell tbl-cell-left tbl-cell-meta">' + _tNotesPreview(o) + '</td>';

      h += '</tr>';
    });
  }
  h += '</tbody>';
  h += '</table>';
  h += '</div>';

  body.innerHTML = h;
  console.log('[Table] Phase 5a rendered: ' + opps.length + ' pursuits, 16 columns');
};

window.Corsair = window.Corsair || {};
window.Corsair.table = {
  render: window._renderTableView
};
