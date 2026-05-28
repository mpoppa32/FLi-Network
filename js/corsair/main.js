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
  window.Corsair.buildTag    = 'P13.110';
  window.Corsair.buildBlurb  = 'Audit Findings 1.4 + 7.1 — saveOpp mutated opp.stageHistory / stageEnteredAt / score / tier / scoreConfidence / scoreFactors / scoreComputedAt in-memory BEFORE the Firebase write. When fbSet threw (offline, permission denied, quota), the local opp had new values, the server had old, no UI signal to the operator. Eventually the Firebase listener rolled UI back, jarringly. Worst class of bug — silent partial corruption. Now: shallow-copy of all top-level keys + slice() for stageHistory/scoreFactors arrays before any mutation; try/catch around fbSet; on failure delete any added keys, restore originals, toast a specific reason (permission denied / offline / quota / generic), and rethrow so bulk-score and inline-edit callers can count this as failed instead of success. Reevo wraps every write in a transaction; this matches that contract. Adversarial audit Day 2 — fifth critical pure-code fix shipped (6 total Critical findings closed: 2.1, 1.5, 1.1, 1.3, 3.4, 1.2, 1.4, 7.1).';
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
