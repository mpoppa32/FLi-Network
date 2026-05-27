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
  window.Corsair.buildTag    = 'P13.77';
  window.Corsair.buildBlurb  = 'TODAY view + MORE-menu restructure. The mode-brief button was lying: label said BRIEF, onclick said switchView(intel) — there was no brief-view. New today-view is a real single-purpose landing surface: header with sales-loop stepper (1. Today > 2. Pipeline > 3. Network > 4. Activity) + 4 primary action buttons (Log Meeting, New Contact, New Pursuit, New Follow-up) + the full rhythm watch queue embedded inline. On switchView(today), the existing #corsair-rhythm panel is moved INTO today-view via DOM relocation (same element, same event wiring, no duplicate render) and styled flat via the .today-embedded class. On switch away, _exitTodayView restores it to its sibling slot in #main-app. Three registries updated per the new-view-checklist (_CORSAIR_VIEWS array, switchView routing, _relocateViewsIntoMainApp). Legacy saved corsair-default-view of brief or intel now migrates to today on next load, and today/accounts are added to validLanding. MORE menu was a 24-item flat dump under 5 weak labels (Views / Workflows / Analytics / Procurement / Intelligence); restructured into 4 cleanly-named buckets with one-line subheaders: NETWORK (who you know), CAPTURE (act on opportunities), INSIGHTS (see patterns), DATA & HELP (manage). max-height:80vh + overflow:auto so the dropdown never escapes the viewport on small screens. Welcome tour step 1 in both core-loop and daily-rhythm tours updated to match the new TODAY framing.';
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
