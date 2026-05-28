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
  window.Corsair.buildTag    = 'P13.124';
  window.Corsair.buildBlurb  = 'Audit Finding 3.1 CLOSED — Anthropic API key was deployed in Atlas workspace config + exfiltratable as window.apiKey from any browser session. Operator deleted the deployed key in Anthropic Console (sk-ant-api03-uEVW4q5M...) + cleared the apiKey field from Firebase config. New anthropicProxy Firebase Function (functions/src/http/anthropicProxy.ts) holds the key as a Firebase secret (ANTHROPIC_API_KEY), validates caller is authenticated AND a member of the workspace via users/{uid}/workspaces/{wsId} access record, forwards /v1/messages with model whitelist + max_tokens ceiling + message-count cap, returns response body. Browser-side _apiFetch + _callIntelClaude + RFP PDF analyzer all routed through proxy. The dangerous-direct-browser-access header is gone. One-time deploy: firebase functions:secrets:set ANTHROPIC_API_KEY then firebase deploy --only functions:anthropicProxy. All pure-code Critical findings from the adversarial audit are now closed. Critical Findings closed total: 17 (+ 3.1 architectural fix shipped — proxy code live; operator needs to mint new key + deploy function).';
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
