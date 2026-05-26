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
  window.Corsair.buildTag    = 'P13.51';
  window.Corsair.buildBlurb  = 'DENSITY PASS ROUND 2 — universal layout classes lifted. P13.50 hit type-scale + Brief; P13.51 hits the chrome shared across every surface. .card padding 13/15 → 16/18 + margin-bottom 8 → 12; .card-urgent and .card-warn matched. .btn padding 7/15 → 10/18; .btn-sm 4/10 → 6/13. input/select/textarea padding 8/11 → 10/14. .fld margin-bottom 9 → 14; .lbl margin-bottom 3 → 5. .tools-menu-item padding 8/12 → 11/14 with font-size promoted from hardcoded 12px to var(--text-sm). .modal padding 22/24 → 26/28 with .modal-title margin-bottom 14 → 18. Every drawer, dialog, form, and toolbar now breathes proportionally with the lifted type scale.';
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
