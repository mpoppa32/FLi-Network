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
import './nudge.js';
import './poc.js';

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag    = 'P13.141';
  window.Corsair.buildBlurb  = 'COP Kanban filter chips — audit High #9 (Visual Flow / filter-sort sync) closed. Before: operator scanning the 8-column Pipeline Board had to hunt across each column to find aged opps or ready-to-advance opps; the only sort was by stage and only filter was by view. Now: four filter chips above the Kanban — All (default) / Ready (pipeline.validateAdvance ok for next stage) / Aged (pipelineMod.isStageStuck) / Sparse data (scoreConfidence === sparse). One click filters all 8 columns simultaneously. Column counts + value/weighted rollups recompute off the post-filter card set so the header math stays honest when a filter is active. Click an active chip again to clear back to All. State on window._copKanbanFilter survives single re-render via renderBoard fallback chain. Compounds with the P13.132 Brief READY badges, P13.134 confidence chips, and P13.136 health-pill/age-limit-framing card density: operator now has Brief column for ready-but-stale + Kanban chip for ready across pipeline + chip for aged across pipeline + chip for sparse-data across pipeline. Single-pane triage for the four states that drive next actions — no view-switching, no column-hunting.';
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
