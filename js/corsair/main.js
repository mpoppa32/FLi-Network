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
  window.Corsair.buildTag    = 'P13.75';
  window.Corsair.buildBlurb  = 'Generate Opps from BD-target orgs (roadmap gap H). Atlas has 160 orgs (113 imported from Tom\'s Pipeline tab via P13.65) but the 122 existing opps were a separate Monday.com sync — there\'s no link between the imported BD targets and any trackable opp. This ships a "🌱 GEN BD OPPS" button in Forecast header that scans for orgs with the "Atlas Master Pipeline Intel" marker in notes, parses the Stage line (Cold→awareness, Contacted/Warm→tracking, Validation→engaged, Negotiation→negotiation), and bulk-creates one opp per org with customerOrgId linked + a _bdGenFromOrg marker so re-runs are idempotent. Modal previews the create list grouped by stage before commit. Also exposed window.saveOpp = saveOpp (was missing — the P13.74 bulk-score save path silently no-op\'d before). Combined with P13.74 Bulk Score, Atlas\'s pipeline can go from 122 ghost opps to ~235 trackable + scored opps in two operator clicks.';
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
