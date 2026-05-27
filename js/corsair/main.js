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
  window.Corsair.buildTag    = 'P13.76';
  window.Corsair.buildBlurb  = 'Mark Done / Drop snooze on watch cards (roadmap gap I). Commitment items (OVERDUE/DUE SOON) keep their existing real-mutation buttons via _rhythmDismiss — those write status:fulfilled/broken + closedAt. New: same-shape buttons on the other six watch-card kinds (COOLING T1/T2, RFP IMMINENT/SOON, AWARD IMMINENT/SOON, SLIPPED RFP, STALLED, STAGE ACTION, PIPELINE GAP). These use localStorage snooze — DONE hides 7 days, DROP hides 30 days, per-browser, underlying record unchanged. Card resurfaces if condition still applies after snooze expires. Snooze map key is `corsair-rhythm-snooze` (JSON: { itemKey: untilTs }). Item keys: slip:/rfp:/award:/cool:/stall:/stage: + entityId, plus `pipgap` singleton. Filter runs after sort, before counts, so section headers reflect what is actually visible. Bryce can now clear his morning queue in 60 seconds without drilling. Also restores main.js↔HTML build-tag parity — P13.75.1 fix was HTML-only and never reached the live DOM (main.js still wrote P13.75 over the top per the dual-source rule).';
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
