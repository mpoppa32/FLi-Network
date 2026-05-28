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
  window.Corsair.buildTag    = 'P13.131';
  window.Corsair.buildBlurb  = 'Revenue Surface audit, Day 1 of 7 — Sales Motion gate enforcement. Pipeline.js STAGE_SPEC has rich exit-criteria gates per stage (Customer/agency identified, Budget located, Problem articulated for awareness; Pink team / Red team / Gold team / BAFO for proposal+; KO debrief for award; etc.) and Phase 6.4 already rendered them as checkboxes in the Inspector dossier with a styled "advance ready" button — but the advance click went through regardless of gate state, and the table inline-stage-edit dropdown bypassed the inspector entirely. Now gated: pipeline.js validateStageAdvance enforces ALL gates from awareness (intake qualification is binary) and ≥50% from any other forward move. Same-stage saves, backward moves, and any drop to lost are always allowed. Enforced at three call sites: _tblCommitStage (table.js — dropdown bypass closed, opens dossier on block), _advancePursuitStage (Inspector advance button — blocked with reason toast), and a defense-in-depth check before mutation in both. Also closes reconciliation audit Finding #8 along the way: both call sites now revert opp.stage to prevStage on saveOpp rejection, so the UI no longer keeps a stale-but-mutated value after a failed Firebase write.';
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
