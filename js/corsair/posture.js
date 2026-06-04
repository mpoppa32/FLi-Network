// Corsair posture module — Phase 7.5.1 data model + taxonomies
//
// The Posture Layer is the platform's philosophical positioning rendered
// as software. The doctrine governs every line of this module:
//   docs/doctrine-v1.0.md
//
// Two anchor sentences:
//   "Corsair does not make you more powerful. Corsair makes you more
//    clear-eyed. The power is yours."
//   "Confidence in her tools that removes all doubt."
//
// Path is workspace-scoped and TEAM-VISIBLE (Doctrine §XI "The Visibility of
// Path", ratified 2026-06-03 by Mike Poppa). A contact's Path is force
// protection no teammate should be siloed from, and §V (the pass-down) makes
// "who walks which path" survive the operator's departure. It is displayed as
// one operator's ATTRIBUTED, DATED read ("[Operator]'s read, as of [date]:
// [Path]") — never as platform-asserted fact about a person. A human records
// the read; the platform only surfaces evidence toward it (§VI forbids the
// platform scoring a human's character). Supersedes the earlier "PRIVATE to
// the operator / Doctrine VIII" citation — §VIII is the Brand Voice; §XI is
// the provision. This data layer stores Path on the shared node + its
// attribution (pathSetBy / pathAsOf); UI enforces the attributed-read display.
//
// Taxonomies are v1.0 — operator-authorized at master-prompt defaults
// 2026-05-15 with iteration license. Edit constants below as friction
// surfaces during build. Renames must remain operator-driven.

// ─── Position taxonomy ───────────────────────────────────────────────────
// Per-pursuit per-person. The same contact can be benefactor on one
// pursuit and rival on another. Operator-editable per-row in Inspector
// Posture tab.
const POSITION_TAXONOMY = [
  { key: 'peer',        label: 'Peer',        description: 'Equal standing, no leverage either direction' },
  { key: 'benefactor',  label: 'Benefactor',  description: 'Has helped the operator on this pursuit, owes nothing' },
  { key: 'debtor',      label: 'Debtor',      description: 'Owes the operator something on this pursuit' },
  { key: 'rival',       label: 'Rival',       description: 'Actively competing for the same outcome' },
  { key: 'gatekeeper',  label: 'Gatekeeper',  description: 'Controls access to a decision or decision-maker' },
  { key: 'ally',        label: 'Ally',        description: "Aligned with the operator's interest on this pursuit" },
  { key: 'neutral',     label: 'Neutral',     description: 'No current alignment or opposition' },
  { key: 'adversary',   label: 'Adversary',   description: 'Actively positioned against the operator on this pursuit' }
];

// ─── Path taxonomy (PRIVATE / workspace-scoped) ─────────────────────────
// The operator's read on how each contact operates inside the influence
// game. Workspace-private; never displayed outside the operator's
// workspace without explicit per-disclosure consent.
//
// The vocabulary carries Stan Taylor's framing without quoting Taylor.
const PATH_TAXONOMY = [
  { key: 'sovereign',    label: 'Sovereign',    description: 'Plays the game with eyes open; ethically self-determined; predictable within own framework' },
  { key: 'liberator',    label: 'Liberator',    description: 'Uses influence to free others from constraints; advocate, mentor, reformer' },
  { key: 'shadow',       label: 'Shadow',       description: 'Operates on the Black Path; manufactures dependencies, engineers beliefs; treat with extreme caution' },
  { key: 'sleepwalker',  label: 'Sleepwalker',  description: 'Unaware they are in the game; reacts to influence without recognizing it' }
];

// ─── Trajectory taxonomy ────────────────────────────────────────────────
// The operator's read on each contact's current career or organizational
// arc. Single value per contact, workspace-scoped.
const TRAJECTORY_TAXONOMY = [
  { key: 'rising',         label: 'Rising',         description: 'Gaining influence, taking on more responsibility, increasing visibility' },
  { key: 'falling',        label: 'Falling',        description: 'Losing influence, sidelined, being managed out, fading' },
  { key: 'repositioning',  label: 'Repositioning',  description: 'Transitioning roles, agencies, or sectors; status uncertain' },
  { key: 'stable',         label: 'Stable',         description: 'Steady-state; established; neither rising nor falling' }
];

// Trajectory dot colors — filled circles left of contact names in
// the Inspector Posture tab. Subdued by design; the Posture surface
// rewards reading, not glanceable color-coding.
const TRAJECTORY_COLORS = {
  rising:        '#7AB87A',   // soft green
  falling:       '#B86B6B',   // muted red
  repositioning: '#C49858',   // warm ochre
  stable:        '#8A8478'    // posture --t2
};

// ─── Ledger entry types ─────────────────────────────────────────────────
// Categories of obligations that can be logged in the Ledger surface.
// Each ledger entry has direction (owed-to-me | owed-by-me), type,
// counterparty, optional pursuit, dates, and state.
const LEDGER_TYPES = [
  { key: 'favor',         label: 'Favor',              description: 'Discretionary help extended or received' },
  { key: 'introduction',  label: 'Introduction',       description: 'Facilitated connection between parties' },
  { key: 'information',   label: 'Information shared', description: 'Non-public intelligence passed, with expectation of confidence or reciprocity' },
  { key: 'support',       label: 'Support given',      description: 'Vouched for, backed in a meeting, defended publicly' },
  { key: 'vote',          label: 'Vote cast',          description: 'Formal support in a decision-making body or evaluation' },
  { key: 'commitment',    label: 'Commitment made',    description: 'Promise of future action, deliverable, or response' },
  { key: 'cover',         label: 'Cover provided',     description: 'Handled a situation that would otherwise have fallen to counterparty' }
];

const LEDGER_DIRECTIONS = {
  OWED_TO_OPERATOR: 'owed-to-me',
  OWED_BY_OPERATOR: 'owed-by-me'
};

const LEDGER_STATES = {
  OPEN:     'open',
  RESOLVED: 'resolved',
  EXPIRED:  'expired'
};

// ─── Defaults ───────────────────────────────────────────────────────────

function defaultPostureForPerson() {
  return {
    byPursuit:   {},
    path:        null,
    trajectory:  null,
    tells:       [],
    lastUpdated: null
  };
}

function defaultPostureForPursuit() {
  return {
    adversaries:      [],
    predecessorNotes: '',
    influenceReads:   ''
  };
}

// ─── Read helpers ───────────────────────────────────────────────────────

function personPosture(person) {
  if (!person || typeof person !== 'object') return defaultPostureForPerson();
  return Object.assign(defaultPostureForPerson(), person.posture || {});
}

function pursuitPosture(opp) {
  if (!opp || typeof opp !== 'object') return defaultPostureForPursuit();
  return Object.assign(defaultPostureForPursuit(), opp.posture || {});
}

function positionOnPursuit(person, pursuitId) {
  if (!person || !pursuitId) return null;
  var p = personPosture(person);
  var entry = p.byPursuit && p.byPursuit[pursuitId];
  return entry ? entry.position : null;
}

function pathOf(person)        { return personPosture(person).path; }
function trajectoryOf(person)  { return personPosture(person).trajectory; }
function tellsOf(person)       { return personPosture(person).tells || []; }

function hasNonDefaultPosture(person) {
  if (!person || !person.posture) return false;
  var p = personPosture(person);
  if (p.path && p.path !== 'sovereign') return true;          // any explicit path read
  if (p.trajectory && p.trajectory !== 'stable') return true; // any non-default trajectory
  if (p.tells && p.tells.length > 0) return true;
  if (p.byPursuit && Object.keys(p.byPursuit).length > 0) return true;
  // operator has set posture at least once
  return p.lastUpdated != null;
}

// ─── Label lookups ──────────────────────────────────────────────────────

function _labelLookup(taxonomy, key) {
  if (!key) return '';
  var entry = taxonomy.find(function(t) { return t.key === key; });
  return entry ? entry.label : '';
}

function positionLabel(key)   { return _labelLookup(POSITION_TAXONOMY, key); }
function pathLabel(key)       { return _labelLookup(PATH_TAXONOMY, key); }
function trajectoryLabel(key) { return _labelLookup(TRAJECTORY_TAXONOMY, key); }
function ledgerTypeLabel(key) { return _labelLookup(LEDGER_TYPES, key); }

function trajectoryColor(key) {
  return TRAJECTORY_COLORS[key] || TRAJECTORY_COLORS.stable;
}

// ─── Cross-pursuit analysis ─────────────────────────────────────────────
// Used by Influence Across Pursuits (Phase 7.5.5). Surfaces when a
// contact holds conflicting positions across pursuits — e.g. ally on
// one, rival on another. Operationally important: the operator should
// know before she walks into the next meeting with them.

function positionsAcrossPursuits(person) {
  if (!person) return [];
  var p = personPosture(person);
  var byPursuit = p.byPursuit || {};
  return Object.keys(byPursuit).reduce(function(out, pid) {
    var pos = byPursuit[pid] && byPursuit[pid].position;
    if (pos) out.push({ pursuitId: pid, position: pos });
    return out;
  }, []);
}

// Specific pairs that count as a conflict. Neutral / peer / gatekeeper
// are not conflict-positive against the others (a gatekeeper can be
// neutral on one pursuit and an ally on another without contradiction).
const _CONFLICT_PAIRS = [
  ['ally',       'rival'],
  ['ally',       'adversary'],
  ['benefactor', 'rival'],
  ['benefactor', 'adversary'],
  ['debtor',     'adversary']
];

function hasConflictingPositions(person) {
  var arr = positionsAcrossPursuits(person);
  if (arr.length < 2) return false;
  var seen = {};
  arr.forEach(function(x) { if (x.position) seen[x.position] = true; });
  return _CONFLICT_PAIRS.some(function(pair) {
    return seen[pair[0]] && seen[pair[1]];
  });
}

// ─── Ledger helpers ─────────────────────────────────────────────────────

function ledgerEntryAge(entry) {
  if (!entry || !entry.dateIncurred) return null;
  return Math.floor((Date.now() - Number(entry.dateIncurred)) / 86400000);
}

function ledgerEntryAgingState(entry) {
  if (!entry) return 'fresh';
  if (entry.state === 'resolved') return 'resolved';
  if (entry.state === 'expired')  return 'expired';
  if (!entry.dateExpected)        return 'fresh';
  var now = Date.now();
  var expected = Number(entry.dateExpected);
  if (now > expected) return 'expired';      // past expected resolution
  var incurred = Number(entry.dateIncurred || now);
  var totalWindow = expected - incurred;
  var elapsed     = now - incurred;
  if (totalWindow > 0 && elapsed / totalWindow > 0.66) return 'maturing';
  return 'fresh';
}

// ─── Module exposure ────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.Corsair = window.Corsair || {};
  window.Corsair.posture = {
    // Taxonomies
    POSITION_TAXONOMY:   POSITION_TAXONOMY,
    PATH_TAXONOMY:       PATH_TAXONOMY,
    TRAJECTORY_TAXONOMY: TRAJECTORY_TAXONOMY,
    LEDGER_TYPES:        LEDGER_TYPES,
    LEDGER_DIRECTIONS:   LEDGER_DIRECTIONS,
    LEDGER_STATES:       LEDGER_STATES,
    TRAJECTORY_COLORS:   TRAJECTORY_COLORS,

    // Defaults
    defaultPostureForPerson:  defaultPostureForPerson,
    defaultPostureForPursuit: defaultPostureForPursuit,

    // Read helpers
    personPosture:      personPosture,
    pursuitPosture:     pursuitPosture,
    positionOnPursuit:  positionOnPursuit,
    pathOf:             pathOf,
    trajectoryOf:       trajectoryOf,
    tellsOf:            tellsOf,
    hasNonDefaultPosture: hasNonDefaultPosture,

    // Label lookups
    positionLabel:    positionLabel,
    pathLabel:        pathLabel,
    trajectoryLabel:  trajectoryLabel,
    ledgerTypeLabel:  ledgerTypeLabel,
    trajectoryColor:  trajectoryColor,

    // Cross-pursuit analysis
    positionsAcrossPursuits: positionsAcrossPursuits,
    hasConflictingPositions: hasConflictingPositions,

    // Ledger helpers
    ledgerEntryAge:         ledgerEntryAge,
    ledgerEntryAgingState:  ledgerEntryAgingState
  };
}

export {
  POSITION_TAXONOMY,
  PATH_TAXONOMY,
  TRAJECTORY_TAXONOMY,
  LEDGER_TYPES,
  LEDGER_DIRECTIONS,
  LEDGER_STATES,
  TRAJECTORY_COLORS,
  defaultPostureForPerson,
  defaultPostureForPursuit,
  personPosture,
  pursuitPosture,
  positionOnPursuit,
  pathOf,
  trajectoryOf,
  tellsOf,
  hasNonDefaultPosture,
  positionLabel,
  pathLabel,
  trajectoryLabel,
  ledgerTypeLabel,
  trajectoryColor,
  positionsAcrossPursuits,
  hasConflictingPositions,
  ledgerEntryAge,
  ledgerEntryAgingState
};
