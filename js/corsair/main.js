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
  window.Corsair.buildTag    = 'P13.115';
  window.Corsair.buildBlurb  = 'Audit Finding 2.2 — wireListeners() was guarded by !window._listenersWired so it ran ONCE per session. On workspace switch, connectWorkspace correctly unsubscribed the old listeners (forEach netListeners → empty) but wireListeners never re-fired, so the new workspace got zero live Firebase listeners. Users who switched workspaces without a hard-refresh saw stale or empty data with no live updates. The audit measured 25 onValue subscriptions vs 3 off() — 88% leak was actually worse than that: it was 100% leak on EVERY workspace switch because the second workspace got no listeners at all. Drop the guard — re-wire on every selectWorkspace. wsPath() resolves currentWsId at call time so each new subscription correctly points at the new workspace data. connectWorkspace runs first to clean old subscriptions; wireListeners runs second to attach fresh ones. The fix is one line; the audit framing led me to a real bug not visible at first glance. Critical Findings closed total: 12.';
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
