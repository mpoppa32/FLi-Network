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
  window.Corsair.buildTag    = 'P13.105';
  window.Corsair.buildBlurb  = 'Watch Corsair tour now uses spotlights + callouts + arrows on REAL UI (correcting P13.104 which read "cinematic" as a narration overlay rather than the interactive walkthrough the operator wanted). Reuses the existing P13.45 _TOUR_CHAPTERS engine that already had spotlight + callout + arrow chrome — added autoAdvance support so each step pops up for 8-14s without requiring clicks. New "Watch Corsair" chapter (9 steps, ~90 sec) walks TODAY → Brief card → Network graph → Posture surface → Sovereign Briefing button → Pipeline → Table → Close, with the operator-approved Monaco narration in callout bodies. _startAtlasDemoTour() launches the chapter on the current workspace (no demo-workspace switch — runs on real Atlas data). Wired to the auth-screen Watch button (sign-in required first; helper alert otherwise) and the TODAY action-row Watch Tour button. .corsair-clean body class still applied during playback for clean recording.';
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
