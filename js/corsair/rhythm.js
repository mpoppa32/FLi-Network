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
// P10.19: "All clear" empty state sizes bumped for presence.
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
    body.innerHTML = '<div class="empty-state" style="text-align:center;padding:120px 24px;color:var(--t3)">' +
      '<div style="font-family:Antonio,\'Big Shoulders Display\',sans-serif;font-size:48px;font-weight:800;letter-spacing:0.02em;color:var(--text);margin-bottom:14px;line-height:1.05">All clear</div>' +
      '<div style="font-size:17px;color:var(--t2);margin-bottom:36px;line-height:1.5;max-width:520px;margin-left:auto;margin-right:auto">No overdue commitments, no slipping milestones, no decaying relationships.</div>' +
      '<button onclick="switchView(\'graph\')" style="display:inline-flex;align-items:center;gap:10px;padding:14px 28px;background:var(--gold);color:var(--s1);border:none;border-radius:6px;font-family:\'IBM Plex Sans\',sans-serif;font-size:15px;font-weight:600;letter-spacing:.02em;cursor:pointer;box-shadow:0 2px 8px rgba(184,105,30,.18);transition:all 180ms ease" onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 18px rgba(184,105,30,.28)\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'0 2px 8px rgba(184,105,30,.18)\'">Open Graph<span style="font-size:18px;line-height:1">→</span></button>' +
      '</div>';
    if (meta) meta.textContent = '';
    return;
  }

  // Group by severity
  var groups = { critical: [], warn: [], info: [] };
  items.forEach(function(it) { (groups[it.sev] || groups.info).push(it); });

  var critN = groups.critical.length, warnN = groups.warn.length, infoN = groups.info.length;
  if (meta) {
    meta.innerHTML = '<span style="color:var(--danger,#ef4444)">' + critN + ' critical</span> · <span style="color:var(--amber)">' + warnN + ' watch</span> · <span style="color:var(--t2)">' + infoN + ' info</span>';
  }

  var sevConfig = {
    critical: { label: 'Critical · Overdue', color: 'var(--danger, #ef4444)', rule: 'var(--danger, #ef4444)' },
    warn:     { label: 'Watch · Due Soon',   color: 'var(--amber)',           rule: 'var(--amber)' },
    info:     { label: 'Steady State',       color: 'var(--t2)',              rule: 'var(--rule-strong, var(--t3))' }
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
      html += '<div class="rhythm-row" style="background:var(--s1);border:1px solid var(--b1);border-left:3px solid ' + cfg.rule + ';border-radius:2px;padding:11px 14px;cursor:pointer;transition:border-color 160ms,transform 160ms,box-shadow 160ms" onclick="' + click + '" onmouseover="this.style.borderColor=\'var(--gold)\';this.style.transform=\'translateX(2px)\';this.style.boxShadow=\'0 2px 12px rgba(184,105,30,.12)\'" onmouseout="this.style.borderColor=\'var(--b1)\';this.style.transform=\'\';this.style.boxShadow=\'none\'">';
      html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
      html += '<div style="min-width:140px"><div style="font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:' + cfg.color + '">' + kind + '</div><div style="font-family:IBM Plex Mono,monospace;font-size:10px;color:var(--t3);margin-top:2px">' + mtxt + '</div></div>';
      html += '<div style="flex:1;min-width:200px"><div style="font-family:Antonio,sans-serif;font-size:16px;color:var(--text);font-weight:700;letter-spacing:-.01em;line-height:1.2">' + subj + '</div>' + (actor ? '<div style="font-size:11px;color:var(--t3);margin-top:3px">' + actor + '</div>' : '') + '</div>';
      html += '<button onclick="event.stopPropagation();window._rhythmJumpToGraph(\'' + (graphTarget || '').replace(/\'/g, '&#39;') + '\',\'' + subj.replace(/\'/g, '&#39;') + '\')" title="View in Graph" style="padding:5px 9px;background:var(--amber-bg, rgba(212,130,58,.06));border:1px solid var(--gold);border-radius:2px;color:var(--gold);font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;flex-shrink:0;transition:background 160ms" onmouseover="this.style.background=\'var(--gold)\';this.style.color=\'var(--s1)\'" onmouseout="this.style.background=\'var(--amber-bg, rgba(212,130,58,.06))\';this.style.color=\'var(--gold)\'">Graph ↗</button>';
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
