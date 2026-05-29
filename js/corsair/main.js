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
  window.Corsair.buildTag    = 'P13.167';
  window.Corsair.buildBlurb  = 'Anthropic per-workspace hourly quota — audit Finding #6 closed. anthropicProxy.ts had model allow-list + max_tokens ceiling + message count cap but no rate quota — a logged-in workspace member could burn the monthly Anthropic budget via a runaway client loop or repeated RFI/POC search runs. Now: per-workspace sliding-window counter persisted at workspaces/{wsId}/quotas/anthropic/current as {hourKey, count, lastAt}. Each proxy call runs a Firebase transaction to atomically increment, keyed by UTC hour (YYYY-MM-DD-HH). When count > limit, throws HttpsError("resource-exhausted") with a structured message "Workspace AI quota: X/Y requests this hour. Try again in ~N min." Default limit 30 req/hr, overridable per-workspace via workspaces/{wsId}/settings/anthropicHourlyQuota (admin-only by Firebase rules), capped at a hard ceiling of 200 to prevent admin-tier accidents. Counter resets implicitly when the hour key changes — no scheduled cleanup needed. Quota-check failures fail open (log + continue) so a counter pathway bug never blocks legitimate calls. Client _apiFetch passes the structured proxy message through when message matches /quota/i, so the operator sees the actual limit + reset window instead of a generic "Too many requests" hide. Compounds with P13.127 sentinel apiKey + P13.131 stage gate enforcement: AI surfaces stay accessible to the team, but the workspace budget is now protected from runaway loops, accidental refresh hammers, and POC-search-on-every-org sprees.';
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
