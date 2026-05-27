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
  window.Corsair.buildTag    = 'P13.68';
  window.Corsair.buildBlurb  = 'Visual polish round 2 — push the rating from 8.4 toward 9+. (5) Table column widths: Weighted 90→110px and Next 80→96px so the uppercase + letter-spacing-14% headers stop ellipsizing to "WEIGHTE…" and "NE…". (6) Forecast top tiles now split scored vs unscored opps. Previously Atlas showed "122 OPEN OPPS / $0 PIPELINE / $0 WEIGHTED" — looked broken because the 122 stale-Qualify imports had no value/pwin set. Now each tile gets a subtext: "OPEN OPPS / 122 · 0 scored · 122 need setup" / "PIPELINE $ / $0 · add value + pwin to score" / "AVG DEAL / $0 · across 0 scored". The empty-state reads as actionable instead of broken. Avg-deal denominator also switched from total to scored — otherwise it always returns $0 for unscored workspaces. (7) Brief dark/light seam softened: rhythm-panel bottom margin 12→24px + extended drop-shadow (0 28px 40px -20px) so the abrupt cut between the dark watch row and the light operator brief feels intentional, not jarring.';
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
