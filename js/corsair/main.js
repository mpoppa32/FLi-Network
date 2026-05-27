// Corsair main module — entry orchestrator
//
// Loads sibling modules under js/corsair/. Each imported module
// publishes to window.Corsair.<name> and (where back-compat is required)
// also exposes select helpers as bare window globals.

import './util.js';
import './pipeline.js';
import './state.js';
import './posture.js';
import './inspector.js';
import './cop.js';
import './rhythm.js';
import './brief.js';
import './theater.js';
import './table.js';

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag    = 'P13.67';
  window.Corsair.buildBlurb  = 'Top-4 visual polish pass for Bryce rollout. (1) More menu dropdown was overflowing off-screen at <1300px viewports — wide meta text on items like Trends & Leaderboard pushed the dropdown left past the viewport edge, hiding the labels entirely. Capped max-width to calc(100vw - 32px) and added text-overflow:ellipsis on the .tm-meta column. (2) Top nav mode-button labels (Brief/Accounts/Pipeline/Table/Inspector) were collapsing to icon-only at 1280px because viewport-with-scrollbar measures ~1271 on 1288px monitors — dropped the breakpoint to 1080px so labels survive on standard widescreen monitors. (3) Brief sidebar width 224→280px so meeting titles like "Moe x Tom introduction with Bry…" stop truncating. (4) Brief operator grid min-column 200→220px so the 6-column auto-fill grid wraps to comfortable proportions at 1280-1440px viewports instead of cramped narrow columns.';
  window.Corsair.modules     = window.Corsair.modules || {};

  if (typeof document !== 'undefined') {
    // Single source of truth — both surfaces read the same tag.
    var auth = document.getElementById('auth-build-tag');
    if (auth) auth.textContent = window.Corsair.buildTag;
    var hud = document.getElementById('de3d-build');
    if (hud)  hud.textContent  = window.Corsair.buildTag;

    // P11.10 layout fix: posture-view was inserted at body level after
    // the other top-level views, but the other views live inside the
    // #main-app flex container. flex:1 on posture-view therefore
    // resolved against <body> (not flex), giving it only ~389px of
    // height. Reparent it into #main-app so its flex:1 fills the
    // visible content area like the other views.
    var mainApp     = document.getElementById('main-app');
    var postureView = document.getElementById('posture-view');
    if (mainApp && postureView && postureView.parentNode !== mainApp) {
      mainApp.appendChild(postureView);
    }
  }

  console.log(
    '%c[Corsair] modules loaded · ' + window.Corsair.buildTag + ' · ' +
    window.Corsair.buildBlurb + ' · ' + new Date().toISOString(),
    'color:#d4823a;font-weight:bold'
  );
})();
