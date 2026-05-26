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
  window.Corsair.buildTag    = 'P13.52';
  window.Corsair.buildBlurb  = 'DENSITY PASS ROUND 3 — section headers, Pipeline cards, top-nav workspace badge. .cmd-section-title margin 18/0/10 → 24/0/14 + font-size 14 → 15 (more visual separation between sections on the dense Board view). .ctitle (card title) margin-bottom 9 → 12, gap 6 → 8. .cop-card margin 0/8/10 → 0/10/12 + border-radius 2 → 3; .cop-card-body padding 10/12/11 → 13/15/14 (Pipeline Kanban cards breathe). .ws-badge in topnav padding 4/11 → 7/14, font-size hardcoded 12px → var(--text-sm), gap 5 → 7. P13.50 + P13.51 + P13.52 together = three passes that take Corsair from "operator-dense" to "professionally readable" across every surface.';
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
