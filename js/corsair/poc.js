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
  // Roles in defense capture that map to "decision-maker" — the higher
  // the entry, the higher the ranking. Match against role/title string
  // (lowercased, contains-match).
  { match: ['ceo', 'chief executive'], score: 95 },
  { match: ['cto', 'chief technology', 'chief technical'], score: 90 },
  { match: ['cfo', 'chief financial'], score: 85 },
  { match: ['program manager', 'pm '], score: 95 },
  { match: ['contracting officer', 'ko', 'cor ', 'contracting officer rep'], score: 90 },
  { match: ['program executive', 'peo'], score: 90 },
  { match: ['technical director', 'technical lead', 'engineering director'], score: 80 },
  { match: ['vp ', 'vice president'], score: 80 },
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
    ? 'For this US government agency, list senior decision-makers a defense BD operator would target: Program Managers (PMs), Contracting Officers (KOs), Technical Directors, Program Executive Officers (PEOs), and the agency leadership (Director, Deputy Director, Chief of Staff). Include those listed on the official agency .gov leadership pages and on public press releases.'
    : 'For this defense contractor or company, list senior decision-makers a defense BD operator would target: CEO, CTO, CFO, Vice Presidents of Business Development, Program Managers for major contracts, and Directors of relevant divisions. Include those listed on the company official About page, press releases, and SEC filings.';
  const system = 'You are a defense BD intelligence analyst. The operator needs to identify decision-makers at a target organization. Doctrine: ONLY use public professional information — official .gov pages, company About pages, press releases, SEC filings, news coverage, LinkedIn public profiles. Do NOT use information from behind logins, paid databases, or breach data. For every person you surface, you MUST provide: (1) name, (2) role/title, (3) source URL where the information appears publicly, (4) honest confidence level (high if from an official .gov or company site; medium if from press releases or LinkedIn; low if inferred). If you cannot find solid sources for a person, do not include them — operator trust depends on never being given fabricated names.';
  const user = roleAsk + '\n\nTarget organization: ' + orgName + '\n\nReturn ONLY a JSON array of candidates in this exact shape, no preamble, no markdown fence:\n[\n  {"name":"...","role":"...","sourceUrl":"https://...","sourceLabel":"agency.gov leadership page","confidence":"high","email":"","linkedin":""}\n]\n\nUp to 8 candidates. Confidence values: "high" | "medium" | "low". If you are unsure or cannot verify a candidate from a public source, omit them. Empty array if you find nothing solid.';

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
