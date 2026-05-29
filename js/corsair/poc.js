// Corsair P13.139 — POC Identification (Phase 2A).
//
// Given a target Org (company or government agency), surface decision-
// maker candidates with honest source + confidence labeling. Per
// doctrine:
//   • Compose existing OSINT plugins first (Phase 2 audit confirmed
//     FACA / advisoryBoards / senateLda / plumBook all produce Person
//     nodes + Edges into workspaces/{wsId}/{nodes,edges}/ when their
//     scheduled jobs run for that workspace).
//   • Fall back to an on-demand search via the Anthropic proxy (which
//     supports tool forwarding — Claude's web_search tool surfaces
//     public professional information without scraping behind logins).
//   • Every candidate carries a `source` and `confidence` label —
//     hard match vs heuristic vs LLM-suggested, never dressed up as
//     fact when it's a lead to confirm.
//   • Candidates are NEVER auto-injected into the workspace. Operator
//     reviews and promotes one at a time.
//
// Doctrine line: this module reports public professional identities.
// Only open sources. No scraping behind logins, no breach data, no
// covert gathering. If a source crosses that line, surface and skip.
//
// Inputs:
//   window.nodes        — person + company + government nodes in the workspace
//   window.links        — edges (the legacy "links" structure)
//   window.opportunities— for opp linkage on candidate cards
//
// Public API:
//   window.Corsair.poc.findExisting(orgId)        → Array of candidates
//                                                   from current workspace data
//   window.Corsair.poc.searchOpenSources(orgName) → Promise<Array> via
//                                                   Anthropic proxy
//   window.Corsair.poc.addCandidateAsContact(c)   → adds Person node to ws

const ROLE_PRIORITY_DEFENSE = [
  // P13.164 — re-ranked per Sovereign Intelligence audit Lens 2: mission-
  // mapping roles (PM/KO/PEO/SAE/MDA/Acquisition Executive) outrank generic
  // C-suite in agency contexts. CEO dropped 95→88 so PM/KO/PEO beat the
  // C-suite default. SAE / Acquisition Executive / Senior Procurement
  // Executive / MDA / TPOC added at 92 — they were defaulting to 30,
  // ranked behind random "manager".
  // Higher entry = higher ranking. Match against role/title string
  // (lowercased, contains-match).
  { match: ['program manager', 'pm '], score: 95 },
  { match: ['sae', 'acquisition executive', 'senior procurement', 'mda', 'milestone decision', 'tpoc'], score: 92 },
  { match: ['contracting officer', 'ko', 'cor ', 'contracting officer rep'], score: 90 },
  { match: ['program executive', 'peo'], score: 90 },
  { match: ['ceo', 'chief executive'], score: 88 },
  { match: ['cto', 'chief technology', 'chief technical'], score: 86 },
  { match: ['cfo', 'chief financial'], score: 84 },
  { match: ['technical director', 'technical lead', 'engineering director'], score: 80 },
  { match: ['vp ', 'vice president'], score: 78 },
  { match: ['director'], score: 70 },
  { match: ['chief'], score: 70 },
  { match: ['lead'], score: 55 },
  { match: ['manager'], score: 45 },
];

function _scoreRoleDefense(role) {
  const r = String(role || '').toLowerCase();
  if (!r) return 25;
  for (let i = 0; i < ROLE_PRIORITY_DEFENSE.length; i++) {
    const cfg = ROLE_PRIORITY_DEFENSE[i];
    for (let j = 0; j < cfg.match.length; j++) {
      if (r.indexOf(cfg.match[j]) !== -1) return cfg.score;
    }
  }
  return 30;
}

function _safeStr(s) { return String(s == null ? '' : s); }

function _esc(s) {
  return window._escHTML ? window._escHTML(_safeStr(s)) : _safeStr(s);
}

function _norm(s) { return String(s || '').toLowerCase().trim(); }

// Find candidates already in the workspace whose .org / .affiliation /
// .govOrg / linked-edge points at the target org. Returns ranked array.
function findExisting(orgId) {
  if (!orgId) return [];
  const allNodes = window.nodes || [];
  const allLinks = window.links || [];
  const targetOrgKey = String(orgId);

  // Resolve the org name so we can also match free-text affiliation
  // fields (FACA / advisory-board affiliation strings are stored as
  // text, not foreign keys).
  let targetOrgName = '';
  for (let i = 0; i < allNodes.length; i++) {
    if (allNodes[i] && String(allNodes[i].id) === targetOrgKey) {
      targetOrgName = _norm(allNodes[i].name);
      break;
    }
  }
  if (!targetOrgName) return [];

  // Build a lookup of person nodes by id for quick edge-traversal.
  const personById = new Map();
  for (let i = 0; i < allNodes.length; i++) {
    const n = allNodes[i];
    if (n && n.type === 'person') personById.set(String(n.id), n);
  }

  // Map each edge by source/target so we can find people linked to orgId.
  // Edge types from the OSINT plugins: member_of, acting_at, lobbyist_at,
  // formerly_at, employed_by. Plus legacy generic links.
  const personLinkedToOrg = new Map(); // personId → { rels: [{label, weight}] }
  for (let i = 0; i < allLinks.length; i++) {
    const l = allLinks[i];
    if (!l) continue;
    const srcId = String((l.source && l.source.id) || l.source || '');
    const tgtId = String((l.target && l.target.id) || l.target || '');
    if (srcId === targetOrgKey && personById.has(tgtId)) {
      _pushRel(personLinkedToOrg, tgtId, l.label || 'linked');
    } else if (tgtId === targetOrgKey && personById.has(srcId)) {
      _pushRel(personLinkedToOrg, srcId, l.label || 'linked');
    }
  }

  // Walk all person nodes, score by affiliation match + edge presence.
  const candidates = [];
  for (let i = 0; i < allNodes.length; i++) {
    const p = allNodes[i];
    if (!p || p.type !== 'person') continue;
    const orgMatchName = _norm(p.org) === targetOrgName
                      || _norm(p.affiliation) === targetOrgName
                      || _norm(p.govOrg) === targetOrgName;
    const edgeRels = personLinkedToOrg.get(String(p.id));
    if (!orgMatchName && !edgeRels) continue;

    const roleScore = _scoreRoleDefense(p.role || p.title);
    // Confidence: orgMatchName (direct affiliation) is hard match;
    // edgeRels alone is medium; neither is unreachable here.
    const confidence = orgMatchName ? 'high' : (edgeRels && edgeRels.rels.length >= 2 ? 'medium' : 'low');
    const sourceLbl = orgMatchName
      ? 'Workspace contact · direct affiliation'
      : (edgeRels ? 'Workspace contact · via ' + edgeRels.rels.map(function(r){return r.label;}).join(', ') : 'Workspace contact');

    candidates.push({
      id: 'poc-existing-' + String(p.id),
      kind: 'existing',
      personId: String(p.id),
      name: p.name || '(unnamed)',
      role: p.role || p.title || '',
      org: p.org || p.affiliation || p.govOrg || '',
      email: p.email || '',
      linkedin: p.linkedin || p.linkedIn || '',
      source: sourceLbl,
      confidence: confidence,
      score: roleScore + (orgMatchName ? 10 : 0),
    });
  }

  candidates.sort(function(a, b) { return b.score - a.score; });
  return candidates;
}

function _pushRel(map, key, label) {
  if (!map.has(key)) map.set(key, { rels: [] });
  map.get(key).rels.push({ label: label, weight: 1 });
}

// On-demand search via the Anthropic proxy. Uses Claude's web_search
// tool (forwarded through the existing anthropicProxy callable, which
// supports tools per anthropicProxy.ts:156). Returns candidate objects
// shaped like findExisting() output so the UI can merge them.
//
// Doctrine: prompt asks for PUBLIC PROFESSIONAL information only —
// LinkedIn profiles, company About pages, press releases. No login-
// required sources. Every candidate carries a source URL so the
// operator can verify before promoting.
async function searchOpenSources(orgName, orgType) {
  if (!orgName) return [];
  if (!window._fbFunctions || !window._httpsCallable) {
    throw new Error('AI proxy unavailable — Firebase Functions SDK not loaded.');
  }
  if (!window.currentWsId) {
    throw new Error('No workspace selected.');
  }
  const isAgency = orgType === 'government' || orgType === 'agency';
  const roleAsk = isAgency
    ? 'Target is a US government agency or defense organization. Search for the agency\'s official leadership team page (look for "Leadership", "Senior Officials", "Organization", "Front Office"). Identify defense BD decision-makers in this priority order: (1) Agency head / Director / Administrator, (2) Acquisition Executive / SAE / PEO, (3) Program Managers and Deputy PMs for current programs, (4) Contracting Officers (Senior Procurement Executive, KO leads), (5) Technical Division Chiefs / S&T directors, (6) Deputy Director / Chief of Staff. Search also for recent contract awards (USAspending, SAM.gov) to find PM/KO names tied to specific programs. Press releases from the past 12 months often name acting officials.'
    : 'Target is a defense contractor or commercial company. Search for the company\'s official "About", "Leadership", "Executive Team", or "Investor Relations" page. Identify defense BD decision-makers in this priority order: (1) CEO and President, (2) CTO / Chief Technology Officer, (3) VP/SVP of Business Development or Government Affairs (especially Defense / National Security), (4) VP/Division Presidents of relevant business units (e.g., Space Systems, Missiles, C5ISR), (5) Program Managers for major DoD contracts (search recent contract awards on SAM.gov / USAspending for PM names), (6) Chief Scientist / Chief Engineer. SEC 10-K filings name executive officers. LinkedIn public profiles confirm titles. For prime contractors (Lockheed, Northrop, Raytheon, Boeing, General Dynamics, L3Harris, etc.) also identify the heads of relevant defense business units, not just the corporate C-suite.';
  const system = 'You are a defense BD intelligence analyst with web search access. The operator is about to act on the names you return — they will be added to a workspace contact list and used in real outreach. Fabricating names destroys operator trust permanently. Doctrine, in order: \n\n' +
    '(1) PUBLIC PROFESSIONAL INFORMATION ONLY. Official .gov leadership pages, official company About/Leadership pages, SEC 10-K and proxy filings, press releases from the org\'s own newsroom or wire services (PR Newswire, BusinessWire), public LinkedIn profiles. No behind-login content, no paid databases, no breach data, no inferred guesses dressed as facts.\n\n' +
    '(2) EVERY CANDIDATE MUST HAVE A VERIFIABLE SOURCE URL. Before you include a person, you have actually navigated to a public page where that exact name + title appears. The sourceUrl field must be the page where the operator can verify the claim. No source URL = do not include.\n\n' +
    '(3) CONFIDENCE LABELING IS HONEST. "high" = name+title appears on the org\'s OWN official .gov or .com leadership page. "medium" = name+title appears in a press release, SEC filing, or current LinkedIn profile that the person controls. "low" = inferred from indirect mentions (news coverage, third-party org charts). When in doubt, label down.\n\n' +
    '(4) DEFENSE BD SPECIFIC. Program Managers, Contracting Officers, Technical Directors, PEOs, SAEs are first-class targets — not just C-suite. For contractors, identify business-unit heads relevant to defense, not only corporate CEOs.\n\n' +
    '(5) FEWER STRONG > MORE WEAK. Three high-confidence candidates with verifiable sources beats eight low-confidence guesses. If you only find 2, return 2. Empty array is acceptable if the org is obscure or no public leadership info exists.';
  const user = roleAsk + '\n\nTarget organization: ' + orgName + '\n\nUse web_search to find official sources. Return ONLY a JSON array of candidates in this exact shape, no preamble, no markdown fence:\n[\n  {"name":"Jane Smith","role":"Director of Acquisition","sourceUrl":"https://www.agency.gov/leadership","sourceLabel":"Agency leadership page","confidence":"high","email":"","linkedin":""}\n]\n\nUp to 8 candidates, ordered most-senior first. Confidence values: "high" | "medium" | "low". Email/linkedin only if found on a public profile — empty string is fine. If you cannot find solid sources for even one candidate, return [].';

  const callable = window._httpsCallable(window._fbFunctions, 'anthropicProxy');
  const result = await callable({
    workspaceId: window.currentWsId,
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: system,
    messages: [{ role: 'user', content: user }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  });
  const data = (result && result.data) || {};
  // Extract the JSON array from the last assistant text block. Claude
  // sometimes wraps its tool-use turns; we want the final text reply.
  const blocks = data.content || [];
  let jsonText = '';
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i] && blocks[i].type === 'text' && blocks[i].text) {
      jsonText = String(blocks[i].text).trim();
      break;
    }
  }
  if (!jsonText) return [];
  // Strip any code-fence wrapping defensively.
  jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch (e) {
    console.warn('[poc] LLM returned non-JSON:', jsonText.slice(0, 200));
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.slice(0, 8).map(function(p, ix) {
    const conf = (p.confidence === 'high' || p.confidence === 'medium' || p.confidence === 'low')
      ? p.confidence : 'low';
    const roleScore = _scoreRoleDefense(p.role || '');
    return {
      id: 'poc-search-' + Date.now() + '-' + ix,
      kind: 'search',
      personId: null,
      name: _safeStr(p.name),
      role: _safeStr(p.role),
      org: orgName,
      email: _safeStr(p.email),
      linkedin: _safeStr(p.linkedin),
      sourceUrl: _safeStr(p.sourceUrl),
      source: _safeStr(p.sourceLabel || 'Public web') + ' (Claude · web_search)',
      confidence: conf,
      // LLM-suggested scores capped below workspace-direct so existing
      // candidates always sort above search candidates within same role tier.
      score: Math.min(roleScore, 75),
    };
  });
}

// Promote a candidate to a Person node in the workspace. Caller does
// the actual addNode call; this just shapes the payload so it matches
// the existing schema.
function shapeCandidateForWorkspace(c, targetOrgName) {
  if (!c) return null;
  return {
    name: c.name,
    type: 'person',
    role: c.role || '',
    org: c.org || targetOrgName || '',
    email: c.email || '',
    linkedin: c.linkedin || '',
    notes: c.sourceUrl ? 'Sourced from: ' + c.sourceUrl : (c.source ? 'Sourced from: ' + c.source : ''),
    priority: c.confidence === 'high' ? 1 : c.confidence === 'medium' ? 2 : 3,
  };
}

if (typeof window !== 'undefined') {
  window.Corsair = window.Corsair || {};
  window.Corsair.poc = {
    findExisting: findExisting,
    searchOpenSources: searchOpenSources,
    shapeCandidateForWorkspace: shapeCandidateForWorkspace,
    scoreRoleDefense: _scoreRoleDefense,
  };
}

export { findExisting, searchOpenSources, shapeCandidateForWorkspace };
