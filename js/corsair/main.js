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
  window.Corsair.buildTag    = 'P13.246';
  window.Corsair.buildBlurb  = 'OSINT O-4 — ACTION CHIPS EVERYWHERE. The one-click chip block (RISING/FALLING/REPOSITIONING per network-matched person + MARK LOST?/REVIEW per active opp) used to live ONLY inside brief.js _renderOsintColumn (the Brief OSINT column was the only surface with action chips per the audit). Extracted into window._renderSignalActionChips(signal, opps, opts) and mounted on every signal-displaying surface: Brief OSINT column (refactored to call the helper, no logic change), Pulse signal cards (_renderFeedSignalCard — LOW-severity now gets chips too, audit gap closure), Today Catches signal-kind cards (Catch E now carries c._signal so chips render — lifts Top Catches from NAVIGATE-only to one-click-act), account drawer OSINT-this-week rows, Entity Inspector SIGNALS tab rows, pursuit drawer Signals+Posture rows (with trust chips folded in for visual parity). MARK LOST? routes through window._confirmStageAdvance via the rewritten _applyAwardSuggestion — fixes the audit gap "MARK LOST? chip uses bare browser confirm() bypassing the doctrine modal that the dossier stage-bar uses." Doctrine intact: every chip surfaces a one-click write the operator decides on; destructive writes (mark_lost) go through the STAGE_SPEC gates; no auto-anything. Prior: OSINT O-2 — ENTITY-SCOPED OSINT (account drawer + Inspector). Replaces the naive blob.indexOf substring match on the account drawer OSINT-this-week panel with subjectIds intersection + alternateNames walk via window._osintForEntity, so resolver-linked signals show up cleanly and BAH resolves to Booz Allen Hamilton without manual tagging. The TRACKED chip now expands into a rollup line carrying signalCount + sources list when the org is on the BriefOutput adversaryRollup or customerRollup. Per-signal CONF + AS OF + SOURCE + parseStatus chips render on each row via the new window._renderTrustChips helper (the canonical chip helper O-6 will swap in, but available to everyone right now). Adds a new SIGNALS tab to the Entity Inspector dossier (between DOSSIER and POSTURE; person + org only — meeting/commitment do not carry direct OSINT links), with the same _osintForEntity + trust-chip pipeline + rollup card + per-signal cards (severity-colored, click-to-source-url when http). Closes the audit Pulse Gap "Entity-Scoped OSINT Missing on Account Drawer + Inspector — Moment 2 Call Prep Blocker." Prior: OSINT O-1 — UNIFIED SIGNAL LAKE. The two parallel OSINT stores (client-only window._dailyFeedData manual-pull cache vs server-pipeline /signals + /derivedViews/dailyBrief/latest written by 21 plugin crons + briefSynthesisNightly) are now ONE for every consumer that should see the cloud view. Added two onValue listeners — uSig on workspaces/{wsId}/signals (ordered by occurredAt, last 500) + uBrief on workspaces/{wsId}/derivedViews/dailyBrief/latest — populating window._signals (normalized via window._signalToFeedItem) and window._brief (BriefOutput with itemsByCategory + adversaryRollup + customerRollup). Re-pointed five consumers: WORLD sentence (_renderTodayNarrative), pursuit drawer Signals+Posture panel, account drawer OSINT-this-week panel (with new TRACKED · ADVERSARY/CUSTOMER chip when BriefOutput rollup matches the open org), Top Catches Catch E (HIGH-severity signal kind), and brief.js SIGNALS ON PIPELINE column. Pulse view + _dailyFeedToSignalEntity write path intact — window._dailyFeedData stays the operator manual-pull session cache for the Pulse view only. Closes the audit Pulse Gap "Two Disjoint Signal Lakes" and unblocks O-2 (entity-scoped subjectIds intersection + chips everywhere). Prior: Commitment-coverage (DG-8, render-time) — the commitments-due Catch resolves the owner to a workspace member and frames it as coverage ("X owns it · confirm covered"), owner shown dept-scoped via _teamActorLabel; the person-surveillance angle (presence/last-seen) was dropped per operator direction — customers/deadlines, never watching people. Prior: Effort-vs-value Catch (Property 4 GAP-N) — cross-pipeline pattern: the heaviest active pursuit (>=2x median weighted) with 0 team touches in 21d while >=3 touches went to lighter work surfaces as a team-level "rebalance?" Catch (no individual named; mismatch labeled as the platform read; kind effort, boosted for CEO/CFO/COO). Prior: Customer-quiet Catch (Property 4 GAP-M) — accounts the team engaged before that have gone quiet 21d+ surface as an account-framed Catch (never person-framed; reads meetings + /events mapped to org nodes). The owning department Acknowledges with a why/plan (window._ackAccountQuiet -> workspaces/{wsId}/accountAck, team-shared), after which everyone sees "Dept tracking" + the Catch recedes, and the granular reason is gated to the owning dept + CEO/COO. COO-boosted, CFO-receded via ROLE_CATCH_BOOST. Prior: Function-role relevance (CEO/CFO/COO/Operator) — the role you hold boosts the Catch kinds it cares about to the top of Top Catches and lets the rest recede (never hard-hides; CEO stays broad). window._roleOf + ROLE_CATCH_BOOST applied pre-sort in _atlasComputeCatches; per-member role picker in the Team view beside department; functionRole field is distinct from the Owner/Admin permission role. Notices reshaped: customer-quiet (not teammate-quiet) is next. Prior: Department-scoped name visibility (P5 slice pulled forward by operator) — names show within your own department, the department label across departments; window._teamActorLabel is the single dial (degrades to names-to-all when unset, matching the Vision default); per-member department picker in the Team view (self/admin editable, rules-covered); applied to the Team Activity feed (meeting + event rows) + the overlap Catch. Prior: Property 4 (Proactive Surfacing) Ship P4-1 — team OVERLAP Catch: 2+ teammates touching the same pursuit/org within 10d now surface as an account-framed "coordinate" Catch in _atlasComputeCatches (reads meetings loggedByUid + /events actorUid; shown to all; surfaces+routes, no human scoring). Prior — Team Entanglement layer (DG-3 / DG-7 / DG-1). DG-3: quick-meeting (touch) attribution fixed — loggedBy now stores displayName + loggedByUid (was storing the UID in loggedBy), and the Team Activity feed guards against UID-shaped strings + tags touch entries QUICK NOTE. DG-7: every meeting/opp-derived surface now live-refreshes on a teammate write — Outreach, Drone, Coverage, Reckoning, Posture, plus an in-place refresh of the open entity drawer (only when the changed entity is the one on screen). DG-1: the Atlas Team Activity feed now interleaves meetings with a new team event stream at /workspaces/{wsId}/events (covered by the workspaces/$other rule; members read, non-observers write). window._corsairEmitEvent is fire-and-forget (never blocks the underlying save); window._teamEventsSubscribe mirrors _atlasSubscribeUpdates. Wired emitters: opp stage change (post-write, skips first-save + bulk re-score), commitment close, outreach marked-sent, manual contact/org add (not auto-extraction), talking-points edit, and posture reads — Position + Trajectory only; Path is operator-PRIVATE per posture.js doctrine and is intentionally NOT emitted. Nudge-dismissal events deferred pending operator decision on team visibility.';
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
