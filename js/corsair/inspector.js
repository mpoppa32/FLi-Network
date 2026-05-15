// Corsair inspector module — Entity Inspector dossier landing
//
// The Inspector is one of the five sacred Corsair modes. It renders an
// entity dossier landing page: recent investigations, Tier 1 decision
// makers, and the rest of the network. Triggered by:
//   - switchView('inspector') in FLiIntel.html (line ~12717)
//   - The inspector-search-inp input's oninput handler (line ~7818)
//   - openEntityInspector chains from Theater / COP / Ask Corsair
//
// Reads entity data from window.nodes (populated by the entity-graph
// module that still lives in FLiIntel.html).
//
// Exposes:
//   window._renderInspectorView   - main render function
//   window._pushInspectorRecent   - register a recently investigated entity
//   window._inspectorRecentIds    - rolling recents stack (max 12)
//   window.Corsair.inspector.*    - canonical namespace

window._inspectorRecentIds = window._inspectorRecentIds || [];

window._pushInspectorRecent = function(id) {
  if (!id) return;
  var r = window._inspectorRecentIds.filter(function(x) { return x !== id; });
  r.unshift(id);
  window._inspectorRecentIds = r.slice(0, 12);
};

function _inspectorPriColor(p) {
  return p === 1 ? 'var(--gold)' : p === 2 ? '#38bdf8' : 'var(--t3)';
}

function _inspectorTypeGlyph(t) {
  return t === 'company' ? '◧' : t === 'government' ? '◈' : '●';
}

function _inspectorChip(n) {
  var p = _inspectorPriColor(n.priority);
  var nm = (n.name || '').replace(/</g, '&lt;');
  return '<button onclick="window._pushInspectorRecent(\'' + n.id + '\');window.openEntityInspector&amp;&amp;window.openEntityInspector(\'' + n.id + '\')" style="padding:6px 12px;background:var(--s1);border:1px solid var(--b1);border-left:3px solid ' + p + ';border-radius:2px;color:var(--text);font-size:11px;font-family:IBM Plex Sans,sans-serif;cursor:pointer;transition:border-color 160ms" onmouseover="this.style.borderColor=\'var(--gold)\'" onmouseout="this.style.borderColor=\'var(--b1)\'">' + _inspectorTypeGlyph(n.type) + ' ' + nm + '</button>';
}

function _inspectorCard(n) {
  var p = _inspectorPriColor(n.priority);
  var nm = (n.name || '').replace(/</g, '&lt;');
  var role = (n.role || '').replace(/</g, '&lt;');
  var org = (n.org || '').replace(/</g, '&lt;');
  var meta = [role, org].filter(Boolean).join(' · ');
  return '<div onclick="window._pushInspectorRecent(\'' + n.id + '\');window.openEntityInspector&amp;&amp;window.openEntityInspector(\'' + n.id + '\')" style="background:linear-gradient(180deg,var(--s1),rgba(7,13,24,.5));border:1px solid var(--b1);border-left:3px solid ' + p + ';border-radius:2px;padding:10px 12px;cursor:pointer;transition:border-color 160ms,transform 160ms" onmouseover="this.style.borderColor=\'rgba(212,130,58,.4)\';this.style.transform=\'translateX(2px)\'" onmouseout="this.style.borderColor=\'var(--b1)\';this.style.transform=\'\'">' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><span style="color:' + p + ';font-size:13px">' + _inspectorTypeGlyph(n.type) + '</span><span style="font-family:Antonio,sans-serif;font-size:14px;font-weight:700;color:var(--bone);letter-spacing:-.005em">' + nm + '</span></div>' +
    (meta ? '<div style="font-size:11px;color:var(--t3);font-family:IBM Plex Mono,monospace">' + meta + '</div>' : '') +
    '</div>';
}

window._renderInspectorView = function() {
  var body = document.getElementById('inspector-view-body');
  if (!body) { console.warn('[Inspector] body element missing'); return; }
  var qEl = document.getElementById('inspector-search-inp');
  var q = (qEl && qEl.value || '').trim().toLowerCase();

  var allNodes = (typeof window.nodes !== 'undefined' && window.nodes) ? window.nodes : [];
  var pool = allNodes.slice();
  if (q) {
    pool = pool.filter(function(n) {
      return (n.name || '').toLowerCase().indexOf(q) >= 0
          || (n.org  || '').toLowerCase().indexOf(q) >= 0
          || (n.role || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  // T1 first, T2 next, others last
  pool.sort(function(a, b) {
    var pa = a.priority || 9, pb = b.priority || 9;
    if (pa !== pb) return pa - pb;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Always-visible top bar — confirms the mode rendered, surfaces totals
  var typeCount = { person: 0, company: 0, government: 0, other: 0 };
  allNodes.forEach(function(n) { typeCount[n.type] != null ? typeCount[n.type]++ : typeCount.other++; });
  var html = '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:18px;padding:10px 14px;background:linear-gradient(180deg,rgba(7,13,24,.55),rgba(10,16,32,.35));border:1px solid var(--b1);border-radius:2px">';
  html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3)"><span style="color:var(--gold);font-weight:700">' + allNodes.length + '</span> entities</div>';
  html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3)"><span style="color:var(--bone);font-weight:700">' + typeCount.person + '</span> people</div>';
  html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3)"><span style="color:var(--bone);font-weight:700">' + typeCount.company + '</span> orgs</div>';
  html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3)"><span style="color:var(--bone);font-weight:700">' + typeCount.government + '</span> gov</div>';
  if (q) html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--purple);margin-left:auto"><span style="font-weight:700">' + pool.length + '</span> matches for "' + q.replace(/</g, '&lt;') + '"</div>';
  html += '</div>';

  if (allNodes.length === 0) {
    html += '<div class="empty-state" style="text-align:center;padding:60px 20px;color:var(--t3)">' +
      '<div style="font-family:Antonio,sans-serif;font-size:22px;color:var(--bone);margin-bottom:8px">No entities yet</div>' +
      '<div style="font-size:13px;color:var(--t2);margin-bottom:24px">Build your network by logging a meeting — Corsair extracts every person, organization, and stance automatically.</div>' +
      '<button class="btn btn-gold btn-sm" onclick="switchView(\'intel\');switchIntelTab&amp;&amp;switchIntelTab(\'log\')">Log First Meeting</button>' +
      '</div>';
    body.innerHTML = html;
    return;
  }

  if (!q) {
    // Recents
    var recents = (window._inspectorRecentIds || []).map(function(id) { return allNodes.find(function(n) { return n.id === id; }); }).filter(Boolean);
    if (recents.length) {
      html += '<div style="margin-bottom:22px">';
      html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:10px;display:flex;align-items:center;gap:8px"><span style="width:4px;height:12px;background:var(--gold);border-radius:1px"></span>Recently Investigated</div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      recents.forEach(function(n) { html += _inspectorChip(n); });
      html += '</div></div>';
    }

    var t1 = pool.filter(function(n) { return n.priority === 1; }).slice(0, 24);
    if (t1.length) {
      html += '<div style="margin-bottom:22px">';
      html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:10px;display:flex;align-items:center;gap:8px"><span style="width:4px;height:12px;background:var(--amber);border-radius:1px"></span>Tier 1 — Decision Makers</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">';
      t1.forEach(function(n) { html += _inspectorCard(n); });
      html += '</div></div>';
    }

    // Always show the rest, even if no T1 entities
    var rest = pool.filter(function(n) { return n.priority !== 1; }).slice(0, 120);
    if (rest.length) {
      html += '<div>';
      html += '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;display:flex;align-items:center;gap:8px"><span style="width:4px;height:12px;background:var(--t3);border-radius:1px"></span>' + (t1.length ? 'All Other Entities' : 'Network') + ' · ' + rest.length + '</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">';
      rest.forEach(function(n) { html += _inspectorCard(n); });
      html += '</div></div>';
    }
  } else {
    if (pool.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">';
      pool.slice(0, 120).forEach(function(n) { html += _inspectorCard(n); });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--t3);font-size:13px">No entities match "' + q.replace(/</g, '&lt;') + '".</div>';
    }
  }

  body.innerHTML = html;
};

window.Corsair = window.Corsair || {};
window.Corsair.inspector = {
  render:     window._renderInspectorView,
  pushRecent: window._pushInspectorRecent,
  recentIds:  function() { return window._inspectorRecentIds; }
};
