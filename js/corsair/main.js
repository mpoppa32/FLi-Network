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
  window.Corsair.buildTag    = 'P13.50';
  window.Corsair.buildBlurb  = 'PLATFORM-WIDE DENSITY PASS — Mike: "everything on the brief screen is too packed in, fonts too small, won\'t be accepted as professional." Fix is two-layer. Layer 1: type-scale tokens bumped (--text-2xs 10→12, --text-xs 11→13, --text-sm 12→14, --text-base 14→15, ... --text-3xl 40→44) + line-heights more generous. Layer 2: ~800 hardcoded inline font-size:Xpx values across the file bumped proportionally (8→11, 9→12, 10→13, 11→14) since most inline styles bypass the tokens. Brief CSS specifically: card padding 18→22, brief-cols switched from fixed repeat(5,1fr) to auto-fill minmax(200px,1fr) so 6-column layout adapts cleanly without the awkward 6th-column-wraps state, col padding 12→16, brief-item padding 7→10, brief-item font-size sm→base, brief-empty font fixed-10px → var(--text-xs). Health pill bumped 9→var(--text-2xs). All operator surfaces lift; the platform now reads as Salesforce-tier instead of Spotify-tier.';
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
