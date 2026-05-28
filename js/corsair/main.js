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
  window.Corsair.buildTag    = 'P13.140';
  window.Corsair.buildBlurb  = 'XSS sweep batch 3 — closes the remaining ~18 cross-user surfaces identified by the post-P13.130 reconciliation audit. 25 individual interpolations across 15 callsites now wrapped in window._escHTML: path-finder header + path-finder no-results + path-finder hop title + path-finder node initials + path-finder link label + recommended-move via.name/result.target.name/via.role + path-finder org no-results + defense-pulse loading state opp.name + competitive-research loading + intelligence-report header companyName + teaming-partners loading opp.name + decay-alert name + decay-alert role/org + node-modal name + node-modal role+org + latest-stance pull-quote + agentic-action name + agentic-action role/org + agentic-action last-meeting title + agentic-action Log-Meeting button (refactored from onclick("...name...") to data-name attribute pattern — closes the attribute-context leak that simple HTML-escape would have broken) + entity-touches loading state + meeting-history empty state + linked-vehicles row (type, name, agency, expires) + ticker-workspace name + user-profile modal (photoURL, displayName, email — last is self-XSS only but defense-in-depth). Inspector.js partial-escape verified: body-text contexts only, no attribute leak, left untouched. With P13.129 + P13.130 + this commit, the originally-Critical audit 3.3 (25+ XSS via unescaped innerHTML) is fully closed across daily-workflow surfaces; only LLM-output formatting in research panels remains intentionally raw (markdown-ish formatting from Claude is required for the UX).';
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
