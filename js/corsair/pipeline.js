// Corsair pipeline module — stage spine: OPP_STAGES + locked STAGE_SPEC
//
// Single source of truth for pursuit pipeline stages, exit criteria,
// artifacts, aging thresholds, and default next actions.
//
// OPP_STAGES preserves the legacy shape ({key, label, color}) so existing
// renderers in FLiIntel.html keep working unchanged. STAGE_SPEC adds the
// gates / artifacts / aging / nextAction per stage that Phase 6 wires
// into Inspector + Rhythm + COP + Brief.
//
// Stage spec was locked by operator on 2026-05-14 against Shipley capture
// management norms and DoD acquisition flow. Edit here to revise.

const OPP_STAGES = [
  { key: 'awareness',   label: 'Opportunity ID',      color: '#7d7669' },
  { key: 'tracking',    label: 'Qualify',             color: '#b5ad9f' },
  { key: 'engaged',     label: 'Capture Planning',    color: '#5b8fc4' },
  { key: 'rfp',         label: 'Bid Decision',        color: '#5fb3b8' },
  { key: 'proposal',    label: 'Proposal',            color: '#a98fcf' },
  { key: 'negotiation', label: 'Final Proposal Rev.', color: '#d4823a' },
  { key: 'submitted',   label: 'Submitted',           color: '#f0a560' },
  { key: 'award',       label: 'Evaluation / Award',  color: '#f4ede0' },
  { key: 'won',         label: 'Won — Post-Award',    color: '#3a8a5c' },
  { key: 'lost',        label: 'Lost / No-Bid',       color: '#b34040' }
];

const STAGE_SPEC = {
  awareness: {
    gates: [
      'Customer/agency identified',
      'Budget line or PoR located',
      'Primary need articulated'
    ],
    artifacts: ['opp profile', 'agency profile', 'budget reference'],
    ageLimit: 30,
    nextAction: 'Schedule customer discovery call'
  },
  tracking: {
    gates: [
      'Customer call held',
      'Problem statement validated',
      'Stakeholder map (KO, PM, end user, decision authority)',
      'Competitive intel gathered'
    ],
    artifacts: ['call notes', 'stakeholder map', 'problem statement', 'competitor profile'],
    ageLimit: 60,
    nextAction: 'Hold customer call, validate problem'
  },
  engaged: {
    gates: [
      'Win strategy documented',
      'Teaming partners identified',
      'Price-to-win established',
      'Gap analysis complete',
      'Capture plan briefed to CMR board'
    ],
    artifacts: ['capture plan', 'win strategy', 'teaming agreements (draft)', 'gap analysis', 'PTW analysis'],
    ageLimit: 90,
    nextAction: 'Brief capture plan to CMR board'
  },
  rfp: {
    gates: [
      'Solicitation received',
      'Bid/no-bid affirmative',
      'Proposal manager assigned',
      'Proposal kickoff complete',
      'Outline approved'
    ],
    artifacts: ['solicitation', 'bid/no-bid memo', 'proposal outline', 'schedule'],
    ageLimit: 14,
    nextAction: 'Confirm bid/no-bid; assign PM'
  },
  proposal: {
    gates: [
      'Pink team complete',
      'Red team complete',
      'All volumes drafted',
      'Pricing model approved by capture team'
    ],
    artifacts: ['technical volume', 'mgmt volume', 'past-perf volume', 'cost volume', 'color-team feedback'],
    ageLimit: 30,
    nextAction: 'Schedule pink team review'
  },
  negotiation: {
    gates: [
      'Gold team complete',
      'Final revisions integrated',
      'Production complete',
      'QC passed',
      'Pricing locked'
    ],
    artifacts: ['final proposal package', 'BAFO response', 'pricing lock'],
    ageLimit: 14,
    nextAction: 'Lock pricing; complete gold team'
  },
  submitted: {
    gates: [
      'Submission confirmed',
      'Q&A cycle complete',
      'Orals delivered (if applicable)',
      'BAFO submitted (if requested)'
    ],
    artifacts: ['submission receipt', 'Q&A log'],
    ageLimit: 45,
    nextAction: 'Check evaluation status with KO'
  },
  award: {
    gates: [
      'Notification received',
      'Debrief requested'
    ],
    artifacts: ['award notification', 'debrief request'],
    ageLimit: 14,
    nextAction: 'Request debrief'
  },
  won: {
    gates: [],
    artifacts: ['contract', 'transition plan', 'baseline schedule'],
    ageLimit: null,
    nextAction: 'Establish transition baseline'
  },
  lost: {
    gates: [],
    artifacts: ['debrief transcript', 'lessons learned', 'pass-down notes'],
    ageLimit: 14,
    nextAction: 'Capture lessons in pass-down note'
  }
};

function oppStageConfig(key) {
  return OPP_STAGES.find(function(s) { return s.key === key; }) || OPP_STAGES[0];
}

function oppStageIndex(key) {
  return OPP_STAGES.findIndex(function(s) { return s.key === key; });
}

function oppStageGates(key) {
  return (STAGE_SPEC[key] && STAGE_SPEC[key].gates) || [];
}

function oppStageArtifacts(key) {
  return (STAGE_SPEC[key] && STAGE_SPEC[key].artifacts) || [];
}

function oppStageAgeLimit(key) {
  if (!STAGE_SPEC[key]) return null;
  return STAGE_SPEC[key].ageLimit;
}

function oppStageNextAction(key) {
  return (STAGE_SPEC[key] && STAGE_SPEC[key].nextAction) || '';
}

function daysInStage(opp) {
  if (!opp || !opp.stageEnteredAt) return 0;
  return Math.floor((Date.now() - Number(opp.stageEnteredAt)) / 86400000);
}

function isStageStuck(opp) {
  if (!opp) return false;
  var limit = oppStageAgeLimit(opp.stage);
  if (limit == null) return false;
  return daysInStage(opp) > limit;
}

function nextDefaultAction(opp) {
  if (!opp) return '';
  return oppStageNextAction(opp.stage);
}

// P13.131 (reconciliation audit, Day 1 — Sales Motion #1) — enforce the
// exit-criteria gates that already exist in STAGE_SPEC + Inspector
// dossier (Phase 6.4). Until now, gates rendered as checkboxes but the
// advance click went through regardless. Policy:
//   - Same-stage save → ok
//   - Backward move → ok (regression is operator's call)
//   - Forward to 'lost' → ok (no-bid is always allowed)
//   - Forward from 'awareness' → require ALL gates (qualification is binary;
//     this is the intake gate the audit asked for — every opp must satisfy
//     customer/budget/problem before entering pipeline)
//   - All other forward moves → require ≥ opts.ratio of gates (default 0.5)
// Returns { ok: true } or { ok: false, reason, missingGates, checkedCount,
// total, required, isIntakeGate }.
function validateStageAdvance(opp, fromStage, toStage, opts) {
  opts = opts || {};
  var ratio = (opts.ratio != null) ? opts.ratio : 0.5;
  if (!fromStage || !toStage || fromStage === toStage) return { ok: true };
  // Drop to 'lost' is always allowed from anywhere
  if (toStage === 'lost') return { ok: true };
  var fromIdx = oppStageIndex(fromStage);
  var toIdx = oppStageIndex(toStage);
  // Backward move
  if (fromIdx >= 0 && toIdx >= 0 && toIdx <= fromIdx) return { ok: true };
  var gates = oppStageGates(fromStage);
  if (!gates.length) return { ok: true };
  var checks = (opp && opp.exitCriteriaChecks && opp.exitCriteriaChecks[fromStage]) || {};
  var checkedCount = gates.reduce(function(n, g) { return n + (checks[g] === true ? 1 : 0); }, 0);
  var missing = gates.filter(function(g) { return checks[g] !== true; });
  var isIntakeGate = (fromStage === 'awareness');
  var required = isIntakeGate ? gates.length : Math.ceil(gates.length * ratio);
  if (checkedCount >= required) return { ok: true };
  var fromLabel = (oppStageConfig(fromStage).label || fromStage);
  var toLabel = (oppStageConfig(toStage).label || toStage);
  var reason = isIntakeGate
    ? 'Cannot promote to ' + toLabel + ': all ' + gates.length + ' qualification gates required (' + checkedCount + '/' + gates.length + ' checked). Open the dossier to qualify.'
    : 'Cannot advance from ' + fromLabel + ' to ' + toLabel + ': at least ' + required + '/' + gates.length + ' exit criteria required (' + checkedCount + ' checked). Open the dossier to fill gates.';
  return {
    ok: false,
    reason: reason,
    missingGates: missing,
    checkedCount: checkedCount,
    total: gates.length,
    required: required,
    isIntakeGate: isIntakeGate
  };
}

// Phase 6.2 — composite stage health for an opportunity.
// Composes with the existing _computePursuitHealth (which scores
// aging/coverage/momentum). This one is stage-specific:
//   daysInStage             how long the opp has been in current stage
//   aged                    boolean — past the stage's aging threshold
//   exitCriteriaCompletion  0..1 fraction of gates checked
//   gateReviewOverdue       boolean — placeholder until the gate-review
//                           schedule lands as its own feature
function _computeStageHealth(opp) {
  if (!opp) {
    return { daysInStage: 0, aged: false, exitCriteriaCompletion: 0, gateReviewOverdue: false };
  }
  var gates = oppStageGates(opp.stage) || [];
  var checks = (opp.exitCriteriaChecks && opp.exitCriteriaChecks[opp.stage]) || {};
  var checkedCount = gates.reduce(function(n, g) { return n + (checks[g] === true ? 1 : 0); }, 0);
  var completion = gates.length > 0 ? (checkedCount / gates.length) : 0;
  return {
    daysInStage:            daysInStage(opp),
    aged:                   isStageStuck(opp),
    exitCriteriaCompletion: completion,
    gateReviewOverdue:      false
  };
}

if (typeof window !== 'undefined') {
  // Back-compat globals — existing FLiIntel.html code references these by name
  window.OPP_STAGES = OPP_STAGES;
  window.oppStageConfig = oppStageConfig;
  window.oppStageIndex = oppStageIndex;

  // Canonical namespace
  window.Corsair = window.Corsair || {};
  window.Corsair.pipeline = {
    stages: OPP_STAGES,
    spec: STAGE_SPEC,
    config: oppStageConfig,
    index: oppStageIndex,
    gates: oppStageGates,
    artifacts: oppStageArtifacts,
    ageLimit: oppStageAgeLimit,
    nextAction: oppStageNextAction,
    daysInStage: daysInStage,
    isStageStuck: isStageStuck,
    nextDefaultAction: nextDefaultAction,
    computeStageHealth: _computeStageHealth,
    validateAdvance: validateStageAdvance
  };
  // Bare global for back-compat with FLiIntel.html callers that look it up by name
  window._computeStageHealth = _computeStageHealth;
  window._validateStageAdvance = validateStageAdvance;
}

export {
  OPP_STAGES,
  STAGE_SPEC,
  oppStageConfig,
  oppStageIndex,
  oppStageGates,
  oppStageArtifacts,
  oppStageAgeLimit,
  oppStageNextAction,
  daysInStage,
  isStageStuck,
  nextDefaultAction,
  _computeStageHealth,
  validateStageAdvance
};
