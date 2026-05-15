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
    nextDefaultAction: nextDefaultAction
  };
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
  nextDefaultAction
};
