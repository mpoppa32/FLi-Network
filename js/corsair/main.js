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
  window.Corsair.buildTag    = 'P13.135';
  window.Corsair.buildBlurb  = 'Revenue Surface Day 3 — Accounts triage speed. Audit Critical #3 (Account Tracking): "Where do I stand with this customer?" took 4+ view switches because account-level intelligence fragmented across COP, Brief, and Accounts views without a unifying triage surface. Three fixes ship together: (1) Default sort changed from "Pipeline $" to "Most recent touch" so the most-active orgs float to the top of the Accounts grid — operator scanning the 114-org universe sees who they have momentum with first, not who has the biggest dollar count. (2) Stage distribution chips added to each Account card — small color-coded chips below the opp-count row showing where the active opps with this org are concentrated (e.g., "3 Pre-RFP · 2 Proposal · 1 Submitted"). Operator can scan from outside the card and instantly know whether an account has early-stage exploration vs late-stage decision opps. (3) "NO T1" pill in the chip row when an org has people but no Tier-1 contact — surfaces the relationship coverage gap directly so the operator can prioritize an exec lift. _accBuildRollup was already computing the underlying data; this commit makes the structure visible at a glance instead of buried in the drawer. Persistence to account.rollup deferred (perf concern only — recompute is fast at 199 nodes; can revisit at 1000+).';
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
