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
  window.Corsair.buildTag    = 'P13.107';
  window.Corsair.buildBlurb  = 'Audit Findings 1.1 + 1.3 — saveMeeting was a one-liner that wrote the meeting to Firebase and stopped. P13.102 auto-score was therefore frozen at the moment of last opp save: operator logs a meeting → tier badge does not change → "is this thing actually live." Now saveMeeting links meeting to opp.meetings[] idempotently, patches CorsairIndex.meetingsByOppId synchronously (closes the 150ms staleness window where a render between fbSet and the debounced rebuild would show the pre-meeting score), and calls saveOpp to re-trigger the P13.102 auto-score hook. Two re-render catches are logged so a recompute failure surfaces in console instead of disappearing into a successful-looking meeting save. The audit-log + strip-render wrapper chain on saveMeeting still composes correctly (both wrappers call _origSM via apply). Adversarial audit Day 2 — second critical pure-code fix.';
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
