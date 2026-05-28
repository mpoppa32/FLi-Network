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
  window.Corsair.buildTag    = 'P13.104';
  window.Corsair.buildBlurb  = 'Cinematic Demo Mode — self-running 2-3 minute tour against real Atlas data, narration locked to the operator-approved script (Chapter 1 Pain → Chapter 6 Close). Declarative SEQUENCE array maps the 6 locked chapters onto switchView nav + DiscoveryEngine3D enterFocal camera flies (Ch 3 reveal centerpiece) + descent into the Posture surface (the Sovereign moment). Lower-third narration in Antonio brand font, top progress strip with 6 chapter ticks, vignette frame, fade-to-wordmark close on obsidian. Entry: Watch button on auth screen + discreet Watch Tour button on TODAY. Controls: Esc exit, Space pause, S skip. Body gets .corsair-clean class during playback hiding BUILD tag + dev HUDs so screen recording produces a clean shareable MP4. Reuses existing DiscoveryEngine3D camera primitives (fitToCluster, enterFocal, exitFocal) — no new graph engine. Atlas posture data richness is the limiter on the Ch 3 reveal; operator field note: populate richer posture/ledger data before recording for fuller impact. First render — timing pass expected.';
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
