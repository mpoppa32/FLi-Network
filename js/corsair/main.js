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
  window.Corsair.buildTag    = 'P13.74';
  window.Corsair.buildBlurb  = 'Pipeline hide-unscored toggle + Bulk Score modal (roadmap gaps C+D). Closes the "122 ghost opps" eyesore Bryce sees on Atlas: every imported opp has stage=Qualify but no value/pwin, so the Forecast headline reads "122 · $0 · $0". Two complementary fixes shipped together. (C) Hide-Unscored toggle in Forecast header — when on, totals/funnel/months only consider opps with value or pwin set. Per-browser localStorage. Header now reads "5 shown · 117 hidden (unscored)" instead of cluttered $0 math. (D) Bulk Score modal — opens from a new "⊞ BULK SCORE" header button, takes a CSV paste (name,value,pwin,stage), matches by normalized name/agency/customer, previews matches before applying, then writes value+pwin+stage+scoredAt to each matched opp via saveOpp. Auto-rerenders Forecast/Table/Kanban after apply. Mike can score 122 opps in ~5 minutes instead of clicking each row.';
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
