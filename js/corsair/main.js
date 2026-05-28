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
  window.Corsair.buildTag    = 'P13.102';
  window.Corsair.buildBlurb  = 'Auto-score & rank pipeline on ingest — flips the Atlas worst-optic (122 opps · 0 scored · unordered list) into a pre-triaged stack-ranked priority feed. _dealScoreBreakdown extended with a 5th Static Profile factor (value/vehicle/source/agency) so freshly imported opps with zero engagement still rank meaningfully, plus tier (A/B/C) and confidence (high/partial/sparse) so thin-data scores are visibly honest. saveOpp hook persists score+tier+confidence+factors to every opp on every write — ingest, edit, stage change all rescore automatically and idempotently. New _bulkAutoScorePipeline() one-shot rescores the existing fleet; wired to the empty-state banner CTA (was CSV-paste). Table view default sorts by score desc with a new Score column showing tier badge + numeric; sparse-confidence opps render dashed-border + dim. Click any badge → existing factor-breakdown modal. Doctrine: system ranks, operator decides; every number shows its reasoning, no black-box.';
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
