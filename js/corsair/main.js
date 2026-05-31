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
  window.Corsair.buildTag    = 'P13.239';
  window.Corsair.buildBlurb  = 'Function-role relevance (CEO/CFO/COO/Operator) — the role you hold boosts the Catch kinds it cares about to the top of Top Catches and lets the rest recede (never hard-hides; CEO stays broad). window._roleOf + ROLE_CATCH_BOOST applied pre-sort in _atlasComputeCatches; per-member role picker in the Team view beside department; functionRole field is distinct from the Owner/Admin permission role. Notices reshaped: customer-quiet (not teammate-quiet) is next. Prior: Department-scoped name visibility (P5 slice pulled forward by operator) — names show within your own department, the department label across departments; window._teamActorLabel is the single dial (degrades to names-to-all when unset, matching the Vision default); per-member department picker in the Team view (self/admin editable, rules-covered); applied to the Team Activity feed (meeting + event rows) + the overlap Catch. Prior: Property 4 (Proactive Surfacing) Ship P4-1 — team OVERLAP Catch: 2+ teammates touching the same pursuit/org within 10d now surface as an account-framed "coordinate" Catch in _atlasComputeCatches (reads meetings loggedByUid + /events actorUid; shown to all; surfaces+routes, no human scoring). Prior — Team Entanglement layer (DG-3 / DG-7 / DG-1). DG-3: quick-meeting (touch) attribution fixed — loggedBy now stores displayName + loggedByUid (was storing the UID in loggedBy), and the Team Activity feed guards against UID-shaped strings + tags touch entries QUICK NOTE. DG-7: every meeting/opp-derived surface now live-refreshes on a teammate write — Outreach, Drone, Coverage, Reckoning, Posture, plus an in-place refresh of the open entity drawer (only when the changed entity is the one on screen). DG-1: the Atlas Team Activity feed now interleaves meetings with a new team event stream at /workspaces/{wsId}/events (covered by the workspaces/$other rule; members read, non-observers write). window._corsairEmitEvent is fire-and-forget (never blocks the underlying save); window._teamEventsSubscribe mirrors _atlasSubscribeUpdates. Wired emitters: opp stage change (post-write, skips first-save + bulk re-score), commitment close, outreach marked-sent, manual contact/org add (not auto-extraction), talking-points edit, and posture reads — Position + Trajectory only; Path is operator-PRIVATE per posture.js doctrine and is intentionally NOT emitted. Nudge-dismissal events deferred pending operator decision on team visibility.';
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
