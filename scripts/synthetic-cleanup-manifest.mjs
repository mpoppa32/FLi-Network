#!/usr/bin/env node
/**
 * SYNTHETIC-DATA CLEANUP MANIFEST — read-only. Produces the delete list Mike
 * says yes or no to. It has NO delete path; the deleter is a separate program
 * that does not exist yet and must not be written until he answers.
 *
 * WHY THE MANIFEST EXISTS AT ALL. Deleting the AUDIT TEST meeting alone leaves
 * its fabricated people in the node graph — a cleanup that looks complete and
 * is not (relay 014, LOG 2026-08-12). So the unit of work is the meeting AND
 * its graph residue, and the residue can only be identified by reading every
 * other place a node could be referenced.
 *
 * THE FAILURE MODE THIS IS DESIGNED AGAINST IS OVER-INCLUSION.
 * A real node deleted because a fake meeting happened to touch it is the
 * disaster case; a synthetic node left behind is merely untidy. So the rule is
 * inverted from the usual: **a node is proposed for deletion only if EVERY
 * reference to it traces back to a synthetic meeting.** One reference we cannot
 * explain keeps it. Anything not positively established as synthetic is KEPT —
 * the same fail-safe direction as `isStale` and `isStaleActionItem`.
 *
 * WHAT IT REPORTS PER NODE — every reference surface found in the live schema,
 * measured 2026-08-25 rather than assumed:
 *   · other meetings listing it in `node.meetings`
 *   · links (numeric id space) where it is source or target
 *   · edges (`org_*` id space, from the OSINT syncs)
 *   · commitments by `sourceMtgId`, and by `owner` name match
 *   · opportunities by `lead` name, `customerOrgId`, and `meetings[]`
 *   · its NAME appearing in any other meeting's keyPeople / companies
 *   · other nodes whose `org` names it
 *   · A REAL TWIN — another node with the same normalized name. This is the
 *     one that decides the hard cases: the synthetic meeting created a node
 *     called "Anduril", and the REAL Anduril already exists separately as
 *     `org_52c29621-760` ("ANDURIL INDUSTRIES, INC.") from the awards sync.
 *     Deleting the synthetic node does not remove the real company from the
 *     graph, and the manifest must SHOW that rather than assert it.
 *
 * USAGE
 *   node scripts/synthetic-cleanup-manifest.mjs --workspace <id> [--project fli-network]
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`\nSYNTHETIC CLEANUP MANIFEST — REFUSED\n${msg}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const workspace = arg("workspace");
const project = arg("project") ?? "fli-network";
const outArg = arg("out");
if (!workspace) {
  die(
    "--workspace <id> is required and is never defaulted.\n" +
    "  firebase database:get /workspaces --shallow --project " + project
  );
}

/** Synthetic demo data, matched on TITLE — never a hardcoded record id, which
 *  is one re-ingest away from being wrong. The title is what identified it. */
const DEMO_TITLE = /^\s*AUDIT TEST\b/i;

function fbGet(nodePath, { allowNull = false } = {}) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corsair-synth-")), "get.json");
  const r = spawnSync(
    "firebase",
    ["database:get", nodePath, "--project", project, "--output", tmp],
    { shell: true, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 }
  );
  if (r.status !== 0) {
    die(`firebase database:get ${nodePath} exited ${r.status}\n${(r.stderr || "").trim()}\n` +
        "Not falling back to anything — a partial read would produce a delete list that is a lie.");
  }
  if (!fs.existsSync(tmp)) die(`firebase reported success but wrote no file for ${nodePath}`);
  const v = JSON.parse(fs.readFileSync(tmp, "utf8"));
  if (v === null && !allowNull) die(`${nodePath} is empty or unreadable. Wrong workspace id?`);
  return v;
}

// ── confirm the workspace, then read every surface ──────────────────────────
const info = fbGet(`/workspaces/${workspace}/info`);
if (!info || !info.name) die(`Could not read /workspaces/${workspace}/info/name.`);
console.error(`Workspace: ${workspace} = "${info.name}"`);
console.error("Reading meetings, nodes, links, edges, commitments, opportunities …");

const meetings = fbGet(`/workspaces/${workspace}/meetings`);
const nodes = fbGet(`/workspaces/${workspace}/nodes`, { allowNull: true }) || {};
const links = fbGet(`/workspaces/${workspace}/links`, { allowNull: true }) || {};
const edges = fbGet(`/workspaces/${workspace}/edges`, { allowNull: true }) || {};
const commitments = fbGet(`/workspaces/${workspace}/commitments`, { allowNull: true }) || {};
const opportunities = fbGet(`/workspaces/${workspace}/opportunities`, { allowNull: true }) || {};

// ── 1. the synthetic meetings ───────────────────────────────────────────────
const syntheticMeetings = Object.entries(meetings)
  .filter(([, m]) => DEMO_TITLE.test(String((m && m.meta && m.meta.title) || "")))
  .map(([k, m]) => ({
    id: k,
    title: m.meta.title,
    date: m.meta.date,
    loggedBy: m.loggedBy,
    actionItems: ((m.intel && m.intel.actionItems) || []).map((a, i) => ({
      index: i,
      task: a.task,
      owner: a.owner,
      priority: a.priority,
      deadline: a.deadline,
      archivedAt: a.archivedAt ?? null,
    })),
    keyPeople: ((m.intel && m.intel.keyPeople) || []).map((p) => ({ name: p.name, org: p.org, role: p.role })),
    companies: (m.intel && m.intel.companies) || [],
  }));

if (!syntheticMeetings.length) die("No meeting matches /^\\s*AUDIT TEST\\b/i. Nothing to do.");
const synthIds = new Set(syntheticMeetings.map((m) => m.id));
/** A node's `meetings` array mixes numbers and strings; compare as strings. */
const isSynthMeetingRef = (x) => synthIds.has(String(x));

// ── 2. candidate nodes: anything the synthetic meetings touched ─────────────
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const synthNames = new Set();
syntheticMeetings.forEach((m) => {
  m.keyPeople.forEach((p) => p.name && synthNames.add(norm(p.name)));
});

const candidates = [];
for (const [nk, n] of Object.entries(nodes)) {
  const ms = Array.isArray(n && n.meetings) ? n.meetings : [];
  if (!ms.some(isSynthMeetingRef)) continue;
  candidates.push({ key: nk, node: n, meetingRefs: ms });
}

// ── 3. per-candidate reference scan ─────────────────────────────────────────
const meetingTitle = (id) => {
  const m = meetings[String(id)];
  return (m && m.meta && m.meta.title) || `(no meeting record for ${id})`;
};

const report = candidates.map(({ key, node, meetingRefs }) => {
  const idStr = String(node.id ?? key);
  const name = String(node.name ?? "");
  const nname = norm(name);

  const otherMeetings = meetingRefs
    .filter((x) => !isSynthMeetingRef(x))
    .map((x) => ({ id: String(x), title: meetingTitle(x) }));

  const linkRefs = Object.entries(links)
    .filter(([, l]) => String(l.source) === idStr || String(l.target) === idStr)
    .map(([lk, l]) => ({ key: lk, label: l.label, source: String(l.source), target: String(l.target) }));

  const edgeRefs = Object.entries(edges)
    .filter(([, e]) => String(e.source) === idStr || String(e.target) === idStr)
    .map(([ek, e]) => ({ key: ek, label: e.label }));

  // Commitments: by source meeting, and by owner name (owner is free text —
  // an email or a person's name — so this is a loose match ON PURPOSE. A loose
  // match here can only ever SPARE a node, never delete one.
  const commitRefs = Object.entries(commitments)
    .filter(([, c]) => {
      const fromSynth = isSynthMeetingRef(c.sourceMtgId);
      const ownerMatch = nname && norm(c.owner).includes(nname);
      return (ownerMatch && !fromSynth) || (fromSynth && ownerMatch);
    })
    .map(([ck, c]) => ({ key: ck, owner: c.owner, sourceMtgId: c.sourceMtgId, synthetic: isSynthMeetingRef(c.sourceMtgId) }));

  const oppRefs = Object.entries(opportunities)
    .filter(([, o]) => {
      const leadMatch = nname && norm(o.lead) === nname;
      const orgMatch = o.customerOrgId && String(o.customerOrgId) === idStr;
      const mtgMatch = Array.isArray(o.meetings) && o.meetings.some((x) => String(x) === idStr);
      return leadMatch || orgMatch || mtgMatch;
    })
    .map(([ok, o]) => ({ key: ok, name: o.name, lead: o.lead }));

  // The node's NAME appearing in any NON-synthetic meeting's intel. This is the
  // strongest evidence that a person/company is real to this workspace.
  const nameInOtherMeetings = [];
  for (const [mk, m] of Object.entries(meetings)) {
    if (synthIds.has(mk) || !nname) continue;
    const kp = (m.intel && m.intel.keyPeople) || [];
    const co = (m.intel && m.intel.companies) || [];
    const inKp = kp.some((p) => norm(p && p.name) === nname);
    const inCo = (Array.isArray(co) ? co : []).some((c) => norm(typeof c === "string" ? c : c && c.name) === nname);
    if (inKp || inCo) nameInOtherMeetings.push({ id: mk, title: meetingTitle(mk), via: inKp ? "keyPeople" : "companies" });
    if (nameInOtherMeetings.length >= 25) break;
  }

  const orgMentions = Object.entries(nodes)
    .filter(([ok, o]) => ok !== key && nname && norm(o.org) === nname)
    .map(([ok, o]) => ({ key: ok, name: o.name }));

  /** The decider for the hard cases — does a DIFFERENT node already carry this
   *  same entity? If so, deleting this one does not remove the entity. */
  const realTwins = Object.entries(nodes)
    .filter(([ok, o]) => {
      if (ok === key || !nname) return false;
      const on = norm(o.name);
      return on === nname || on.startsWith(nname + " ") || nname.startsWith(on + " ");
    })
    .map(([ok, o]) => ({ key: ok, name: o.name, type: o.type, meetings: (Array.isArray(o.meetings) ? o.meetings.length : 0) }));

  const nonSyntheticRefs =
    otherMeetings.length + linkRefs.length + edgeRefs.length +
    commitRefs.filter((c) => !c.synthetic).length + oppRefs.length +
    nameInOtherMeetings.length + orgMentions.length;

  return {
    key,
    id: idStr,
    name,
    type: node.type,
    org: node.org ?? null,
    role: node.role ?? null,
    disposition: nonSyntheticRefs === 0 ? "DELETE" : "KEEP",
    nonSyntheticRefs,
    references: {
      otherMeetings, links: linkRefs, edges: edgeRefs,
      commitments: commitRefs, opportunities: oppRefs,
      nameInOtherMeetings, orgMentions, realTwins,
    },
  };
});

// Links that exist ONLY between nodes being deleted would dangle; report them.
const deleteIds = new Set(report.filter((r) => r.disposition === "DELETE").map((r) => r.id));
const orphanedLinks = Object.entries(links)
  .filter(([, l]) => deleteIds.has(String(l.source)) || deleteIds.has(String(l.target)))
  .map(([lk, l]) => ({ key: lk, source: String(l.source), target: String(l.target), label: l.label }));

const syntheticCommitments = Object.entries(commitments)
  .filter(([, c]) => isSynthMeetingRef(c.sourceMtgId))
  .map(([ck, c]) => ({ key: ck, task: c.task, owner: c.owner, status: c.status }));

// ── 4. write ────────────────────────────────────────────────────────────────
const finishedAt = new Date();
const manifest = {
  version: 1,
  kind: "synthetic-cleanup",
  generatedAt: finishedAt.toISOString(),
  generatedAtMs: finishedAt.getTime(),
  workspace,
  workspaceName: info.name,
  matchedOn: String(DEMO_TITLE),
  authorization: "NONE YET — this manifest exists so Mike can give or withhold it.",
  acceptance: {
    maxAgeMinutes: 60,
    requirement:
      "Any deleter MUST refuse a manifest older than maxAgeMinutes, MUST re-verify each " +
      "node's reference counts against live data immediately before deleting, and MUST " +
      "delete nothing whose disposition is not exactly DELETE.",
    approved: false,
    deleted: false,
  },
  rule:
    "A node is proposed for deletion ONLY if every reference to it traces to a synthetic " +
    "meeting. One unexplained reference keeps it. Over-inclusion is the disaster case.",
  syntheticMeetings,
  syntheticCommitments,
  nodes: report,
  orphanedLinks,
  counts: {
    syntheticMeetings: syntheticMeetings.length,
    actionItems: syntheticMeetings.reduce((s, m) => s + m.actionItems.length, 0),
    nodesTouched: report.length,
    nodesToDelete: report.filter((r) => r.disposition === "DELETE").length,
    nodesToKeep: report.filter((r) => r.disposition === "KEEP").length,
    orphanedLinks: orphanedLinks.length,
    syntheticCommitments: syntheticCommitments.length,
  },
};

const outDir = path.join(ROOT, "sweep-manifests");
fs.mkdirSync(outDir, { recursive: true });
const out = outArg
  ? path.resolve(outArg)
  : path.join(outDir, `synthetic-cleanup-${workspace}-${finishedAt.toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));

// ── 5. the one screen Mike decides against ──────────────────────────────────
const L = [];
L.push("");
L.push("═══ SYNTHETIC DATA CLEANUP — PROPOSED. NOTHING HAS BEEN DELETED. ═══");
L.push(`workspace ${workspace} "${info.name}"   ·   generated ${manifest.generatedAt}`);
L.push("");
L.push("THE MEETING (delete):");
syntheticMeetings.forEach((m) => {
  L.push(`  ${m.id}  ${m.date}  "${m.title}"`);
  L.push(`     logged by ${m.loggedBy} · ${m.actionItems.length} action items` +
         ` (${m.actionItems.filter((a) => a.archivedAt).length} archived, none swept)`);
});
L.push("");
L.push(`NODES TO DELETE (${manifest.counts.nodesToDelete}) — every reference traces to the synthetic meeting:`);
report.filter((r) => r.disposition === "DELETE").forEach((r) => {
  L.push(`  ✗ ${String(r.name).padEnd(20)} ${String(r.type || "").padEnd(8)} ${r.org ? `(${r.org})` : ""}`);
  L.push(`      id ${r.key}   ·   non-synthetic references: ${r.nonSyntheticRefs}`);
  if (r.references.realTwins.length) {
    r.references.realTwins.forEach((t) =>
      L.push(`      ⚠ REAL TWIN SURVIVES: "${t.name}" (${t.key}, ${t.meetings} meetings) — the entity stays in the graph`));
  }
});
L.push("");
L.push(`NODES TO KEEP (${manifest.counts.nodesToKeep}) — the synthetic meeting touched them, but they are real:`);
report.filter((r) => r.disposition === "KEEP").forEach((r) => {
  const x = r.references;
  L.push(`  ✓ ${String(r.name).padEnd(20)} ${String(r.type || "").padEnd(8)} — ${r.nonSyntheticRefs} non-synthetic refs`);
  L.push(`      meetings ${x.otherMeetings.length} · links ${x.links.length} · edges ${x.edges.length}` +
         ` · commitments ${x.commitments.filter((c) => !c.synthetic).length} · opps ${x.opportunities.length}` +
         ` · named in ${x.nameInOtherMeetings.length} other meetings · org-of ${x.orgMentions.length}`);
});
L.push("");
L.push(`LINKS that would dangle: ${orphanedLinks.length}`);
orphanedLinks.forEach((l) => L.push(`  ${l.key}  ${l.source} -> ${l.target}  "${l.label}"`));
L.push(`COMMITMENTS sourced from the synthetic meeting: ${syntheticCommitments.length}`);
syntheticCommitments.forEach((c) => L.push(`  ${c.key}  [${c.status}] ${String(c.task).slice(0, 60)}`));
L.push("");
L.push(`manifest: ${out}`);
L.push("(gitignored — it carries verbatim names and task text from live data)");
L.push("");
L.push("MIKE'S CALL: delete the meeting + the ✗ nodes above, or not. No deleter");
L.push("exists yet; it will be written only against a yes.");
console.log(L.join("\n"));
