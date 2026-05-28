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
  window.Corsair.buildTag    = 'P13.133';
  window.Corsair.buildBlurb  = 'Revenue Surface Day 6 — closed-deal tray. The reconciliation audit Finding #7 (Pipeline Surface): the COP Kanban filtered won + lost opps out entirely (cop.js:265-267 active-board filter) so the operator had no place to see win/loss tally, recent closures, or pull up the lost-stage "Capture lessons in pass-down note" action surface — closed deals just vanished from view. Now: a two-column Closed Deals tray renders below the active Kanban, Won (green left-stripe) and Lost/No-Bid (red left-stripe). Each column shows count + total value rolled up + the 5 most-recent closures sorted by stageEnteredAt desc (the timestamp the opp moved to its current closed stage, set by saveOpp Phase 6.1 transition tracking). Card click → opens the dossier so the operator can see the lost-stage nextAction prompt or write the debrief into the existing pursuit-stage panel. Tray only renders when at least one closed opp exists, so demo workspaces with no closures stay clean. Reevo parity on closed-deal visibility: closures are first-class with debrief surface, not dropped on the floor.';
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
