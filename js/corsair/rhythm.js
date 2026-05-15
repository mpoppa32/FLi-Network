// Corsair rhythm-view module — RHYTHM MODE full action queue
//
// Renders the dedicated Rhythm mode body (the full agentic-loop queue
// shown when the user clicks the Rhythm tile in the mode rail). Reads
// action items from the engine via window._corsairBuildRhythm, groups
// them by severity, renders a click-to-graph row for each.
//
// The rhythm ENGINE itself (_corsairBuildRhythm, _corsairRenderRhythm,
// _corsairRefreshRhythm, _corsairToggleRhythm) remains in FLiIntel.html
// for now — it depends on module-scope helpers (_computeAlerts,
// _buildDecayAlerts, getProcurementAlerts) that aren't yet on window.
//
// Triggered by switchView('rhythm') in FLiIntel.html.
//
// Exposes:
//   window._renderRhythmView    - renders the Rhythm mode body
//   window._rhythmJumpToGraph   - jumps to Graph mode, focuses entity
//   window.Corsair.rhythm.*     - canonical namespace

window._renderRhythmView = function() {
  var body = document.getElementById('rhythm-view-body');
  var meta = document.getElementById('rhythm-view-meta');
  if (!body) return;
  var items = [];
  try {
    items = (typeof window._corsairBuildRhythm === 'function' ? window._corsairBuildRhythm() : []) || [];
  } catch (e) {
    items = [];
  }

  if (!items.length) {
    body.innerHTML = '<div class="empty-state" style="text-align:center;padding:80px 20px;color:var(--t3)">' +
      '<div style="font-family:Antonio,sans-serif;font-size:22px;color:var(--bone);margin-bottom:8px">All clear</div>' +
      '<div style="font-size:13px;color:var(--t2);margin-bottom:24px">No overdue commitments, no slipping milestones, no decaying relationships.</div>' +
      '<button class="btn btn-gold btn-sm" onclick="switchView(\'graph\')">Open Graph</button>' +
      '</div>';
    if (meta) meta.textContent = '';
    return;
  }

  // Group by severity
  var groups = { critical: [], warn: [], info: [] };
  items.forEach(function(it) { (groups[it.sev] || groups.info).push(it); });

  var critN = groups.critical.length, warnN = groups.warn.length, infoN = groups.info.length;
  if (meta) {
    meta.innerHTML = '<span style="color:#ef4444">' + critN + ' critical</span> · <span style="color:var(--amber)">' + warnN + ' watch</span> · <span style="color:var(--t2)">' + infoN + ' info</span>';
  }

  var sevConfig = {
    critical: { label: 'Critical · Overdue', color: '#ef4444',      rule: 'rgba(239,68,68,.7)' },
    warn:     { label: 'Watch · Due Soon',   color: 'var(--amber)', rule: 'rgba(245,158,11,.55)' },
    info:     { label: 'Steady State',       color: 'var(--t2)',    rule: 'rgba(125,118,105,.45)' }
  };

  var html = '';
  ['critical', 'warn', 'info'].forEach(function(sev) {
    var arr = groups[sev];
    if (!arr.length) return;
    var cfg = sevConfig[sev];
    html += '<div style="margin-bottom:24px">';
    html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:' + cfg.color + ';margin-bottom:10px;display:flex;align-items:center;gap:8px">';
    html += '<span style="width:4px;height:14px;background:' + cfg.color + ';border-radius:1px"></span>' + cfg.label + ' <span style="color:var(--t3);font-weight:600">· ' + arr.length + '</span></div>';
    html += '<div style="display:grid;gap:6px">';
    arr.sort(function(a, b) { return (a.rank || 0) - (b.rank || 0); });
    arr.forEach(function(it, ix) {
      var click = it.click ? it.click.replace(/"/g, '&quot;') : '';
      var subj  = (it.subject || '').replace(/</g, '&lt;');
      var actor = (it.actor   || '').replace(/</g, '&lt;');
      var kind  = (it.kind    || '').replace(/</g, '&lt;');
      var mtxt  = (it.meta    || '').replace(/</g, '&lt;');
      var oppMatch = it.click ? it.click.match(/selectOpp\(['"]([^'"]+)['"]\)/) : null;
      var graphTarget = oppMatch ? oppMatch[1] : '';
      html += '<div class="rhythm-row" style="background:linear-gradient(180deg,var(--s1),rgba(7,13,24,.6));border:1px solid var(--b1);border-left:3px solid ' + cfg.rule + ';border-radius:2px;padding:11px 14px;cursor:pointer;transition:border-color 160ms,transform 160ms" onclick="' + click + '" onmouseover="this.style.borderColor=\'rgba(212,130,58,.4)\';this.style.transform=\'translateX(2px)\'" onmouseout="this.style.borderColor=\'var(--b1)\';this.style.transform=\'\'">';
      html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
      html += '<div style="min-width:140px"><div style="font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:' + cfg.color + '">' + kind + '</div><div style="font-family:IBM Plex Mono,monospace;font-size:10px;color:var(--t3);margin-top:2px">' + mtxt + '</div></div>';
      html += '<div style="flex:1;min-width:200px"><div style="font-family:Antonio,sans-serif;font-size:16px;color:var(--bone);font-weight:700;letter-spacing:-.01em;line-height:1.2">' + subj + '</div>' + (actor ? '<div style="font-size:11px;color:var(--t3);margin-top:3px">' + actor + '</div>' : '') + '</div>';
      html += '<button onclick="event.stopPropagation();window._rhythmJumpToGraph(\'' + (graphTarget || '').replace(/\'/g, '&#39;') + '\',\'' + subj.replace(/\'/g, '&#39;') + '\')" title="View in Graph" style="padding:5px 9px;background:rgba(212,130,58,.06);border:1px solid rgba(212,130,58,.28);border-radius:2px;color:var(--gold);font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;flex-shrink:0;transition:background 160ms" onmouseover="this.style.background=\'rgba(212,130,58,.16)\'" onmouseout="this.style.background=\'rgba(212,130,58,.06)\'">Graph ↗</button>';
      html += '<div style="color:var(--t3);font-size:16px;font-weight:300">›</div>';
      html += '</div></div>';
    });
    html += '</div></div>';
  });

  body.innerHTML = html;
};

// Loop hook — jump from a rhythm row to the Graph, focused on the relevant entity
window._rhythmJumpToGraph = function(oppId, subjectLabel) {
  if (typeof window.switchView === 'function') window.switchView('graph');
  setTimeout(function() {
    if (oppId && window._copFocusInGraph) {
      window._copFocusInGraph(oppId);
      return;
    }
    // Try to match subject text against a graph node
    var nodes = window.nodes || [];
    if (subjectLabel && nodes.length) {
      var lc = (subjectLabel || '').toLowerCase().trim();
      var match = nodes.find(function(n) { return (n.name || '').toLowerCase() === lc; })
              || nodes.find(function(n) { return (n.name || '').toLowerCase().indexOf(lc) >= 0; });
      if (match && window.openEntityInspector) {
        window.openEntityInspector(match.id);
      }
    }
  }, 220);
};

window.Corsair = window.Corsair || {};
window.Corsair.rhythm = {
  renderView:  window._renderRhythmView,
  jumpToGraph: window._rhythmJumpToGraph
};
