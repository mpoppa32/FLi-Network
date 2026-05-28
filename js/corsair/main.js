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
  window.Corsair.buildTag    = 'P13.134';
  window.Corsair.buildBlurb  = 'Revenue Surface Day 2 — confidence surfacing. Audit Critical #2 (Pipeline Surface): P13.102 auto-score landed tier+score on every opp but data-quality signal was hidden — Table chip showed "A 89°" with a tiny degree mark + dashed border + 78% opacity for sparse-data opps, easy to miss in a busy table. COP Kanban cards showed value/pwin/days but no score at all, so operator scanning the Kanban couldn\'t tell which deals were ranked high on earned engagement vs which were inferred from static profile only. Sparse-data deals at the top of the score sort were masquerading as hot. Three fixes shipped together: (1) Table chip now reads "A 89 ·thin" / "A 89 ·part" / "A 89" inline — confidence categorical visible without hover. (2) Table score sort gets confidence as next tiebreaker after score so high-confidence outranks sparse at the same numeric score. (3) Kanban cards get a tier+score chip (own row above value/pwin/days) plus sparse cards get dashed top border + faded opacity matching the Table. Net effect: operator scanning either surface can instantly distinguish earned-rank from inferred-rank without any hover or click. Trust restored to the score column.';
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
