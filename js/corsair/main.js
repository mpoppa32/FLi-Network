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
  window.Corsair.buildTag    = 'P13.72';
  window.Corsair.buildBlurb  = 'Slack webhook notifications (gap A from the 10-20 person rollout roadmap). Zero-OAuth integration: paste an Incoming Webhook URL in Settings → Slack Notifications, hit Test, and post directly to your channel from inside Corsair. Per-user/per-browser localStorage so each operator can pipe to their own DM or all share one #atlas-bd webhook. Two manual fire surfaces shipped: "# Slack" button on the Morning Briefing watch row (posts the 5-card watch list with Block Kit formatting) and "# Slack" button on the Brief Surface bar (posts the 6 column counts as a one-line digest). Foundation for v2 auto-fires (cooling threshold, dedupe queue, capture-lead assignment, daily 7am brief) — those need cron + Cloud Function deploy, not the manual path. window._slackNotify(text, blocks) helper is general-purpose for any future call site. Slack-purple #4a154b + Slack-yellow #ecb22e theming for instant recognizability.';
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
