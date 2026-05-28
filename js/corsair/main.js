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
  window.Corsair.buildTag    = 'P13.137';
  window.Corsair.buildBlurb  = 'Nudge Engine Phase 1A — email-to-account matcher. Phase 0 audit confirmed the foundation was dirty: 68 captured Atlas entries, 0% match rate. capture/normalizer.ts had been writing matchedNodeId/oppId/oppName as null and no matcher code path existed to populate them. Direction (in/out) and Gmail thread headers were also missing. This ship lands the matcher server-side in the capture dispatcher so all future Gmail/Calendar sync entries arrive pre-joined. New functions/src/capture/matcher.ts loads workspace context once per sync (personByEmail, companyByName, companyByDomain, oppsByCustomerName, oppsByPersonId, operatorEmails), then matchEntry resolves sender via priority chain: sender email → person, then attendee email (skipping operator) → person, then sender domain → company by explicit domain or second-level name contains. Opp linkage picks the most-recently-advanced open opp. Direction tagged inbound/outbound by sender vs operator-emails. Thread headers (threadId, messageId, inReplyTo) extracted and persisted on every entry for Phase 1B reply-chain detection. New backfillCaptureMatches Firebase Function re-runs the matcher across every existing pendingCapture entry — operator clicks Re-match in the Auto-Capture Review header once and the 68 pre-P13.137 Atlas entries get matched in one shot. Idempotent. Captures the foundation Phase 1B nudge engine builds on.';
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
