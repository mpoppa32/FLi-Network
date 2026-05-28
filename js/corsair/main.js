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
  window.Corsair.buildTag    = 'P13.114';
  window.Corsair.buildBlurb  = 'Audit Finding 2.4 — renderDailyBrief decay scan was O(people × meetings × attendees × stringSim) = 99,500 iters on Atlas, projected 9.95M at 10x scale (1990 nodes × 5000 meetings). Brief re-renders on every meeting save, view switch, opp save → noticeable hang at scale. Now O(meetings × attendees) for the index pass + O(people) for the emit pass. Exact-match fast path covers ~80% of names cleanly; fuzzy simFn fallback only fires for attendee names that did not exact-match. Also fixed the stale-pursuits scan in same render — was O(opps × meetings) = 61,000 iters, now uses CorsairIndex.meetingsByOppId for O(1) per-opp lookup with linear fallback if index is cold. Expected first-render perceived improvement: small at 122 opps (already fast), order-of-magnitude at 10x. Critical Findings closed total: 11.';
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
