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

// Phase 5b — table state (sort + filter + search). Module-scope; persists
// across re-renders within a session. localStorage / Firebase persistence
// (Phase 5c saved views) lands in subsequent commits.
var _tblState = {
  sortKey: 'default',          // column key or 'default' for stage+days desc
  sortDir: 'asc',              // 'asc' | 'desc'
  filterStage: '',             // stage key or '' for all
  filterHealth: '',            // 'hot' | 'warm' | 'cold' or '' for all
  filterAged: false,           // true = only aged-in-stage
  search:  ''
};

window._tblSetSort = function(key) {
  if (_tblState.sortKey === key) {
    _tblState.sortDir = (_tblState.sortDir === 'asc') ? 'desc' : 'asc';
  } else {
    _tblState.sortKey = key;
    _tblState.sortDir = (key === 'value' || key === 'weighted' || key === 'days' || key === 'pwin') ? 'desc' : 'asc';
  }
  window._renderTableView();
};

window._tblSetFilter = function(field, value) {
  if (field === 'aged') _tblState.filterAged = !_tblState.filterAged;
  else _tblState[field] = value;
  window._renderTableView();
};

window._tblSetSearch = function(v) {
  _tblState.search = String(v || '').toLowerCase().trim();
  // Re-render only the rows, not the whole header (preserves search input focus)
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  var stages = (pipelineMod && pipelineMod.stages) || [];
  var processed = _tblProcessOpps(window.opportunities || [], pipelineMod, stages);
  var tbody = document.querySelector('#table-view-body .tbl tbody');
  if (tbody) {
    tbody.innerHTML = _tblRenderRows(processed, pipelineMod);
  }
  var countEl = document.getElementById('tbl-count');
  if (countEl) countEl.textContent = processed.length;
};

window._tblClearFilters = function() {
  _tblState.filterStage = '';
  _tblState.filterHealth = '';
  _tblState.filterAged = false;
  _tblState.search = '';
  _tblState.sortKey = 'default';
  _tblState.sortDir = 'asc';
  window._renderTableView();
};

// Phase 5c — inline editing.
// Click stage / value / pwin cells to swap them for inputs. Enter or
// blur commits via saveOpp (which auto-handles Phase 6.1 stage history
// on stage changes). Esc cancels and restores the display value.
// Re-render the tbody after commit so derived columns (weighted) refresh.

function _tblFindOpp(oppId) {
  return (window.opportunities || []).find(function(o) { return String(o.id) === String(oppId); }) || null;
}

function _tblRerenderRows() {
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  var stages = (pipelineMod && pipelineMod.stages) || [];
  var processed = _tblProcessOpps(window.opportunities || [], pipelineMod, stages);
  var tbody = document.querySelector('#table-view-body .tbl tbody');
  if (tbody) tbody.innerHTML = _tblRenderRows(processed, pipelineMod);
  var countEl = document.getElementById('tbl-count');
  if (countEl) countEl.textContent = processed.length;
}

window._tblEditStage = function(event, oppId) {
  if (event) event.stopPropagation();
  var opp = _tblFindOpp(oppId);
  if (!opp) return;
  var cell = event && event.currentTarget;
  if (!cell) return;
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  if (!pipelineMod || !pipelineMod.stages) return;
  var safeId = String(oppId).replace(/'/g, '&#39;');
  var opts = pipelineMod.stages.map(function(s) {
    return '<option value="' + s.key + '"' + (s.key === opp.stage ? ' selected' : '') + '>' + _tEsc(s.label) + '</option>';
  }).join('');
  cell.innerHTML = '<select class="tbl-edit-input tbl-edit-select" onclick="event.stopPropagation()" ' +
    'onchange="window._tblCommitStage(\'' + safeId + '\',this.value)" ' +
    'onblur="setTimeout(function(){if(document.activeElement&&document.activeElement.tagName!==\'OPTION\')window._tblRerenderRowsPublic()},100)">' + opts + '</select>';
  var sel = cell.querySelector('select');
  if (sel) sel.focus();
};

window._tblCommitStage = async function(oppId, newStage) {
  var opp = _tblFindOpp(oppId);
  if (!opp) return;
  if (opp.stage === newStage) { _tblRerenderRows(); return; }
  opp.stage = newStage;
  // saveOpp handles stage history + stageEnteredAt automatically (Phase 6.1)
  try { if (typeof window.saveOpp === 'function') await window.saveOpp(opp); }
  catch (e) { console.warn('[Table] commit stage failed:', e); }
  _tblRerenderRows();
};

window._tblEditValue = function(event, oppId) {
  if (event) event.stopPropagation();
  var opp = _tblFindOpp(oppId);
  if (!opp) return;
  var cell = event && event.currentTarget;
  if (!cell) return;
  var safeId = String(oppId).replace(/'/g, '&#39;');
  var current = opp.value != null ? Number(opp.value) : '';
  cell.innerHTML = '<input type="number" class="tbl-edit-input tbl-edit-num" value="' + current + '" placeholder="$" ' +
    'onclick="event.stopPropagation()" ' +
    'onkeydown="window._tblHandleEditKey(event,\'value\',\'' + safeId + '\')" ' +
    'onblur="window._tblCommitValue(\'' + safeId + '\',this.value,false)">';
  var inp = cell.querySelector('input');
  if (inp) { inp.focus(); inp.select(); }
};

window._tblCommitValue = async function(oppId, val, viaEnter) {
  var opp = _tblFindOpp(oppId);
  if (!opp) return;
  var n = parseFloat(val);
  opp.value = isNaN(n) ? null : n;
  try { if (typeof window.saveOpp === 'function') await window.saveOpp(opp); }
  catch (e) { console.warn('[Table] commit value failed:', e); }
  _tblRerenderRows();
};

window._tblEditPwin = function(event, oppId) {
  if (event) event.stopPropagation();
  var opp = _tblFindOpp(oppId);
  if (!opp) return;
  var cell = event && event.currentTarget;
  if (!cell) return;
  var safeId = String(oppId).replace(/'/g, '&#39;');
  var current = opp.pwin != null ? Math.round(Number(opp.pwin) * 100) : '';
  cell.innerHTML = '<input type="number" min="0" max="100" step="5" class="tbl-edit-input tbl-edit-num" value="' + current + '" placeholder="%" ' +
    'onclick="event.stopPropagation()" ' +
    'onkeydown="window._tblHandleEditKey(event,\'pwin\',\'' + safeId + '\')" ' +
    'onblur="window._tblCommitPwin(\'' + safeId + '\',this.value,false)">';
  var inp = cell.querySelector('input');
  if (inp) { inp.focus(); inp.select(); }
};

window._tblCommitPwin = async function(oppId, val, viaEnter) {
  var opp = _tblFindOpp(oppId);
  if (!opp) return;
  var n = parseFloat(val);
  if (isNaN(n)) opp.pwin = null;
  else opp.pwin = Math.max(0, Math.min(1, n / 100));
  try { if (typeof window.saveOpp === 'function') await window.saveOpp(opp); }
  catch (e) { console.warn('[Table] commit pwin failed:', e); }
  _tblRerenderRows();
};

window._tblHandleEditKey = function(event, field, oppId) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (field === 'value') window._tblCommitValue(oppId, event.target.value, true);
    else if (field === 'pwin') window._tblCommitPwin(oppId, event.target.value, true);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    _tblRerenderRows(); // discards in-flight edit
  }
};

window._tblRerenderRowsPublic = _tblRerenderRows;

function _tblProcessOpps(allOpps, pipelineMod, stages) {
  var stageOrder = {};
  stages.forEach(function(s, i) { stageOrder[s.key] = i; });

  // Filter
  var opps = allOpps.slice().filter(function(o) {
    if (!o) return false;
    if (_tblState.filterStage && o.stage !== _tblState.filterStage) return false;
    if (_tblState.filterHealth) {
      var h = (typeof window._computePursuitHealth === 'function') ? window._computePursuitHealth(o) : { status: 'unknown' };
      if (h.status !== _tblState.filterHealth) return false;
    }
    if (_tblState.filterAged) {
      var aged = pipelineMod && typeof pipelineMod.isStageStuck === 'function' && pipelineMod.isStageStuck(o);
      if (!aged) return false;
    }
    if (_tblState.search) {
      var hay = String((o.name || '') + ' ' + (o.agency || '') + ' ' + (o.customer || '') + ' ' + (o.captureLead || '') + ' ' + (o.notes || '')).toLowerCase();
      if (hay.indexOf(_tblState.search) < 0) return false;
    }
    return true;
  });

  // Sort
  var dir = _tblState.sortDir === 'desc' ? -1 : 1;
  function cmp(a, b, val) { return val < 0 ? -dir : val > 0 ? dir : 0; }
  function nameOf(o) { return (o.name || '').toLowerCase(); }
  function valueOf(o) { return Number(o.value || 0); }
  function pwinOf(o) { return Number(o.pwin || 0); }
  function weightedOf(o) { return Number(o.value || 0) * Number(o.pwin || 0); }
  function daysOf(o) {
    return (pipelineMod && typeof pipelineMod.daysInStage === 'function') ? pipelineMod.daysInStage(o) : 0;
  }
  function customerOf(o) { return String(o.agency || o.customer || '').toLowerCase(); }
  function leadOf(o) { return String(o.captureLead || '').toLowerCase(); }
  function nextOf(o) {
    var d = o.rfpDate || o.awardDate || o.due;
    return d ? new Date(d).getTime() : 9e15;
  }

  if (_tblState.sortKey === 'default') {
    opps.sort(function(a, b) {
      var sa = stageOrder[a.stage] != null ? stageOrder[a.stage] : 999;
      var sb = stageOrder[b.stage] != null ? stageOrder[b.stage] : 999;
      if (sa !== sb) return sa - sb;
      return daysOf(b) - daysOf(a);
    });
  } else if (_tblState.sortKey === 'name') {
    opps.sort(function(a, b) { return cmp(a, b, nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0); });
  } else if (_tblState.sortKey === 'customer') {
    opps.sort(function(a, b) { return cmp(a, b, customerOf(a) < customerOf(b) ? -1 : customerOf(a) > customerOf(b) ? 1 : 0); });
  } else if (_tblState.sortKey === 'stage') {
    opps.sort(function(a, b) {
      var sa = stageOrder[a.stage] != null ? stageOrder[a.stage] : 999;
      var sb = stageOrder[b.stage] != null ? stageOrder[b.stage] : 999;
      return cmp(a, b, sa - sb);
    });
  } else if (_tblState.sortKey === 'days') {
    opps.sort(function(a, b) { return cmp(a, b, daysOf(a) - daysOf(b)); });
  } else if (_tblState.sortKey === 'value') {
    opps.sort(function(a, b) { return cmp(a, b, valueOf(a) - valueOf(b)); });
  } else if (_tblState.sortKey === 'pwin') {
    opps.sort(function(a, b) { return cmp(a, b, pwinOf(a) - pwinOf(b)); });
  } else if (_tblState.sortKey === 'weighted') {
    opps.sort(function(a, b) { return cmp(a, b, weightedOf(a) - weightedOf(b)); });
  } else if (_tblState.sortKey === 'next') {
    opps.sort(function(a, b) { return cmp(a, b, nextOf(a) - nextOf(b)); });
  } else if (_tblState.sortKey === 'lead') {
    opps.sort(function(a, b) { return cmp(a, b, leadOf(a) < leadOf(b) ? -1 : leadOf(a) > leadOf(b) ? 1 : 0); });
  }

  return opps;
}

var TBL_COLS = [
  { key: 'status',   label: '',            align: 'center', w: '24px',  sortable: false },
  { key: 'name',     label: 'Pursuit',     align: 'left',   w: '260px', sticky: true, sortable: true },
  { key: 'customer', label: 'Customer',    align: 'left',   w: '180px', sortable: true },
  { key: 'stage',    label: 'Stage',       align: 'left',   w: '140px', sortable: true },
  { key: 'days',     label: 'Days',        align: 'right',  w: '60px',  sortable: true },
  { key: 'value',    label: 'Value',       align: 'right',  w: '90px',  sortable: true },
  { key: 'pwin',     label: 'pWin',        align: 'right',  w: '60px',  sortable: true },
  { key: 'weighted', label: 'Weighted',    align: 'right',  w: '90px',  sortable: true },
  { key: 'next',     label: 'Next',        align: 'right',  w: '80px',  sortable: true },
  { key: 'lead',     label: 'Lead',        align: 'center', w: '46px',  sortable: true },
  { key: 'action',   label: 'Next Action', align: 'left',   w: '220px', sortable: false },
  { key: 'health',   label: 'Health',      align: 'center', w: '70px',  sortable: false },
  { key: 'lastMtg',  label: 'Last Mtg',    align: 'right',  w: '70px',  sortable: false },
  { key: 'coverage', label: 'Coverage',    align: 'center', w: '80px',  sortable: false },
  { key: 'tags',     label: 'Tags',        align: 'left',   w: '120px', sortable: false },
  { key: 'notes',    label: 'Notes',       align: 'left',   w: '220px', sortable: false }
];

function _tblRenderRows(opps, pipelineMod) {
  if (opps.length === 0) {
    return '<tr><td colspan="' + TBL_COLS.length + '" class="tbl-empty">No pursuits match the current filters.</td></tr>';
  }
  var html = '';
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

    html += '<tr class="tbl-row' + (aged ? ' tbl-row-aged' : '') + '" data-opp-id="' + safeId + '">';
    html += '<td class="tbl-cell tbl-cell-center"><span class="tbl-dot" style="background:' + dotColor + '" title="' + (aged ? 'aged in stage' : (health.status || 'unknown')) + '"></span></td>';
    html += '<td class="tbl-cell tbl-cell-left tbl-cell-sticky"><span class="tbl-name" onclick="window.openEntityInspector(\'' + safeId + '\')">' + _tEsc(o.name || '(unnamed)') + '</span></td>';
    html += '<td class="tbl-cell tbl-cell-left tbl-cell-meta">' + (o.agency ? _tEsc(o.agency) : (o.customer ? _tEsc(o.customer) : '—')) + '</td>';
    html += '<td class="tbl-cell tbl-cell-left tbl-cell-editable" onclick="window._tblEditStage(event,\'' + safeId + '\')" title="Click to edit stage"><span class="tbl-stage-pill"><span class="tbl-stage-dot" style="background:' + (stageCfg.color || '#7d7669') + '"></span>' + _tEsc(stageLabel) + '</span></td>';
    html += '<td class="tbl-cell tbl-cell-right tbl-cell-num' + (aged ? ' tbl-cell-warn' : '') + '">' + days + '</td>';
    html += '<td class="tbl-cell tbl-cell-right tbl-cell-num tbl-cell-editable" onclick="window._tblEditValue(event,\'' + safeId + '\')" title="Click to edit value">' + _tFmtVal(o.value) + '</td>';
    html += '<td class="tbl-cell tbl-cell-right tbl-cell-num tbl-cell-editable" onclick="window._tblEditPwin(event,\'' + safeId + '\')" title="Click to edit win probability (0–100)">' + pwinPct + '</td>';
    html += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + _tFmtVal(weighted) + '</td>';
    html += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + _tNextMilestone(o) + '</td>';
    html += '<td class="tbl-cell tbl-cell-center">' + _tCaptureLead(o) + '</td>';
    html += '<td class="tbl-cell tbl-cell-left tbl-cell-meta">' + _tNextAction(o) + '</td>';
    html += '<td class="tbl-cell tbl-cell-center">' + _tHealthPill(health) + '</td>';
    html += '<td class="tbl-cell tbl-cell-right tbl-cell-num">' + _tLastMeeting(o) + '</td>';
    html += '<td class="tbl-cell tbl-cell-center">' + _tCoverageBadge(o) + '</td>';
    html += '<td class="tbl-cell tbl-cell-left">' + _tTags(o) + '</td>';
    html += '<td class="tbl-cell tbl-cell-left tbl-cell-meta">' + _tNotesPreview(o) + '</td>';
    html += '</tr>';
  });
  return html;
}

window._renderTableView = function() {
  var body = document.getElementById('table-view-body');
  if (!body) return;
  var pipelineMod = window.Corsair && window.Corsair.pipeline;
  var stages = (pipelineMod && pipelineMod.stages) || [];
  var allOpps = window.opportunities || [];

  var processed = _tblProcessOpps(allOpps, pipelineMod, stages);
  var anyFilter = !!(_tblState.filterStage || _tblState.filterHealth || _tblState.filterAged || _tblState.search || _tblState.sortKey !== 'default');

  // Filter chips bar
  var h = '<div class="tbl-filters">';
  // Search input
  h += '<input type="text" class="tbl-search" placeholder="Search name / customer / lead / notes…" oninput="window._tblSetSearch(this.value)" value="' + _tEsc(_tblState.search) + '">';

  // Stage filter chip
  h += '<select class="tbl-filter-select" onchange="window._tblSetFilter(\'filterStage\',this.value)" title="Filter by stage">';
  h += '<option value=""' + (_tblState.filterStage === '' ? ' selected' : '') + '>All stages</option>';
  stages.forEach(function(s) {
    h += '<option value="' + s.key + '"' + (_tblState.filterStage === s.key ? ' selected' : '') + '>' + _tEsc(s.label) + '</option>';
  });
  h += '</select>';

  // Health filter chip
  h += '<select class="tbl-filter-select" onchange="window._tblSetFilter(\'filterHealth\',this.value)" title="Filter by pursuit health">';
  h += '<option value=""' + (_tblState.filterHealth === '' ? ' selected' : '') + '>All health</option>';
  ['hot','warm','cold','unknown'].forEach(function(s) {
    h += '<option value="' + s + '"' + (_tblState.filterHealth === s ? ' selected' : '') + '>' + s.toUpperCase() + '</option>';
  });
  h += '</select>';

  // Aged toggle
  h += '<button class="tbl-filter-toggle' + (_tblState.filterAged ? ' tbl-filter-toggle-on' : '') + '" onclick="window._tblSetFilter(\'aged\',true)" title="Only show pursuits past their stage aging threshold">AGED</button>';

  // Clear
  if (anyFilter) {
    h += '<button class="tbl-filter-clear" onclick="window._tblClearFilters()">Clear</button>';
  }

  // Count
  h += '<div class="tbl-meta-count" style="margin-left:auto"><strong id="tbl-count">' + processed.length + '</strong> of ' + allOpps.length + ' pursuits</div>';
  h += '</div>';

  // Table
  h += '<div class="tbl-scroll">';
  h += '<table class="tbl">';
  h += '<thead><tr>';
  TBL_COLS.forEach(function(c) {
    var sortInd = '';
    if (c.sortable && _tblState.sortKey === c.key) {
      sortInd = '<span class="tbl-sort-arrow">' + (_tblState.sortDir === 'asc' ? '▲' : '▼') + '</span>';
    }
    var clickable = c.sortable ? ' tbl-th-sortable" onclick="window._tblSetSort(\'' + c.key + '\')"' : '"';
    h += '<th class="tbl-th tbl-th-' + c.align + (c.sticky ? ' tbl-th-sticky' : '') + clickable + ' style="width:' + c.w + ';min-width:' + c.w + '">' + c.label + sortInd + '</th>';
  });
  h += '</tr></thead>';
  h += '<tbody>' + _tblRenderRows(processed, pipelineMod) + '</tbody>';
  h += '</table>';
  h += '</div>';

  body.innerHTML = h;
  console.log('[Table] Phase 5b rendered: ' + processed.length + ' / ' + allOpps.length + ' pursuits, sort=' + _tblState.sortKey + '/' + _tblState.sortDir);
};

window.Corsair = window.Corsair || {};
window.Corsair.table = {
  render: window._renderTableView
};
