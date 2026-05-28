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
  window.Corsair.buildTag    = 'P13.136';
  window.Corsair.buildBlurb  = 'Revenue Surface Day 5 — Kanban card density. Audit Critical #5 (Pipeline Surface): Kanban cards showed value/pwin/days and an aged badge but no health pill (HOT/WARM/COLD lived in Table only — operator had to inspector-click to see it on a Kanban card) and no age-limit framing ("30d" told the operator nothing without knowing each stage threshold). Three additions: (1) Health pill in card top-right corner, computed from window._computePursuitHealth (already used by Table at line 844). Small Mono-typeface chip colored green/yellow/red, with hover tooltip linking the verdict to the dossier breakdown. (2) Days-in-stage subtitle reframed as "30d in stage / Limit 14" — operator now reads the relationship between current age and stage threshold without remembering each stage cap. Aged cards get red bold styling on this line; on-track stay dim. (3) Aged cards (per pipeline.isStageStuck) get a red 1px outline + inset shadow so the "stuck past threshold" state is unmistakable from a card-scan distance. Card name now reserves right-padding for the health pill so the pill never overlaps long names. Together with P13.134 confidence chips, Kanban cards now carry: name, health, score+confidence, value/pwin, days+limit, sparse/aged visual treatment — single-pane decisioning without inspector-click. Reevo card density parity.';
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
