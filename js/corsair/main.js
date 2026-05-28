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
  window.Corsair.buildTag    = 'P13.108';
  window.Corsair.buildBlurb  = 'Audit Finding 3.4 — sign-out wiped window.currentUser but left credential-class keys persisting in localStorage. Shared-device leak: User A signs out, User B opens DevTools, reads fli-apikey-{uid} (Anthropic), fli-dgkey-{uid} (Deepgram), flintel_mcp_token, flintel_samgov_key, corsair-slack-config with one console line. New window._corsairSignOutCleanup() wipes everything matching fli-/flintel_/corsair- EXCEPT a whitelisted set of UI preferences (default view, forecast collapse state, kanban toggle, quickstart dismissals, tour completions). Deny-by-default — any new credential-class key added in future will be wiped automatically. Also nulls in-memory tokens: window.apiKey, deepgramKey, wsApiKey, _gAccessToken, _gAccessToken_send, _msAccessToken_send. Called from all three sign-out paths: ws-signout-btn primary, signout-btn in settings modal, ws-signout-btn settings alt. Adversarial audit Day 2 — third critical pure-code fix.';
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
