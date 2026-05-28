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
  window.Corsair.buildTag    = 'P13.130';
  window.Corsair.buildBlurb  = 'Audit Finding 3.3 — second batch of cross-user XSS surfaces missed by the P13.116-P13.119 sweep and not in the P13.129 workspace-picker fix. Five more high-traffic innerHTML callsites: attendee-suggest dropdown (FLiIntel.html:12414 — e.name in two surfaces + sub composed from e.role/e.org), pending-invites list (26781 — inv.email, inv.role, inv.invitedBy, currentWs.name in three body + two attr surfaces), path-finder search results (28578 — n.name in avatar slice + body, plus n.role), network-panel T1 contacts sidebar (40836 — n.name + (n.org||n.role) in 40-row list), inbox/pending-capture oppName (41243). Also fixed the duplicate Resend-button HTML fragment at 26790 (the line was concatenating a stray style="..." after a complete button, rendering as literal text in the pending-invites panel). All cross-user attack vectors closed: teammate-poisoned names + Google display names + workspace names + invite metadata now all route through _escHTML. Inspector.js partial escape (only <) verified defensible for body-text contexts; left untouched. Medium-risk + lower-traffic callsites (~7-10 remaining) deferred to a follow-up sweep.';
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
