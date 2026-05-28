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
  window.Corsair.buildTag    = 'P13.109';
  window.Corsair.buildBlurb  = 'Audit Finding 1.2 — deleteOpp was a one-liner removing only the opp record, leaving meetings with m.oppId === id orphaned forever, commitments + ledger entries with pursuitId pointing at a phantom opp, and CorsairIndex.meetingsByOppId carrying a dead bucket. Sibling deleteMeeting already cascades commitments + tlCommitments — same pattern applied here. Preserve-by-default: meetings, commitments, ledger entries are NOT deleted (they retain intel value independent of the opp), only their FK is nulled and written back. CorsairIndex bucket dropped synchronously so follow-up renders see clean state. Local window.opportunities also spliced so the deleted opp does not briefly flash in a render between the cascade and the Firebase listener fire. Logged catches throughout (no silent failures per audit Finding 1.5). Console summary line: "[P13.109 deleteOpp] {id} cascaded: meetings N · commitments M · ledger K". Adversarial audit Day 2 — fourth critical pure-code fix shipped.';
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
