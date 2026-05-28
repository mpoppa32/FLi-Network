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
  window.Corsair.buildTag    = 'P13.132';
  window.Corsair.buildBlurb  = 'Revenue Surface Day 7 — meeting-driven stage-advance loop. The reconciliation audit Finding #4 (Critical, info integrity): meeting logging captured attendance + stances + commitments and P13.107 already re-scored the linked opp on save, but the engagement → action loop never closed. Operator logged a meeting, the score updated, then nothing else happened — the operator had to remember to go check gates manually and advance manually. Now: at the moment saveMeeting finishes and the linked opp re-scores, pipeline.validateAdvance checks whether the opp now satisfies current-stage gates for a non-terminal next stage. If yes, an action toast surfaces with a one-click Advance → button that calls _advancePursuitStage (which still validates per P13.131, so the click is safe). Brief stale + aged columns get a small READY badge on opps where gates are clear, and both columns sort ready-first so the highest-leverage moves are at the top of the morning brief. Compounds with P13.131: operator who has done qualification work in the dossier sees that work surface as actionable signals everywhere they look — at meeting save, in the morning brief, and in the dossier advance button.';
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
