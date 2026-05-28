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

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag    = 'P13.138';
  window.Corsair.buildBlurb  = 'Nudge Engine Phase 1B — Follow-Up Nudge Engine. Builds on Phase 1A matcher. New sibling module js/corsair/nudge.js scans matched pendingCapture entries (unmatched skipped — graceful degrade until the operator clicks Re-match on the 68 pre-P13.137 entries) and groups by matchedNodeId. For each grouped entity, computeStateForEntity finds last inbound and last outbound timestamps; classify applies tunable thresholds in one place (THRESHOLDS const): awaiting_your_reply when an inbound has no subsequent outbound for ≥1 day; going_cold at 14+d no touch; no_recent_contact at 30+d. Brief gets a 7th column "AWAITING REPLY" between AGED IN STAGE and the edge of the grid. Each nudge surfaces: type pill (OWED gold / COLD yellow / STALE gray), entity name (click → dossier), plain-language reasoning ("Inbound \\"subject\\" · 6d · no reply · matched via sender domain"), opp linkage if known, and three dismiss controls (DONE / NOT NOW / SNOOZE). Dismissals persist to users/{uid}/workspaces/{wsId}/nudgeDismissals with auto-revival: a DONE dismissal auto-clears when a fresher inbound arrives after the dismissal timestamp. NOT NOW hides 24h; SNOOZE hides 7d. Doctrine respected: surfaces and routes only. Never drafts, sends, or auto-replies. Every nudge shows its dates + direction + match confidence so the operator trusts the surface before acting.';
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
