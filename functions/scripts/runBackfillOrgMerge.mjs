// One-shot CLI-driven runner for backfillOrgMerge.
//
// Uses firebase-tools CLI for I/O (cached auth, no ADC needed) and ports
// the core merge logic from src/jobs/backfillOrgMergeCore.ts inline so
// the script is self-contained.
//
// Run from functions/ with: node scripts/runBackfillOrgMerge.mjs [--apply]
// Without --apply it's a dry run (prints plan, no writes).

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const WORKSPACE_ID = "1777435779676";
const PROJECT = "fli-network";
const EXCLUDE_IF_NORM_CONTAINS = ["aerovironment"];
const APPLY = process.argv.includes("--apply");

// ─── normalizers (copied from src/sources/usaSpending/orgResolver.ts and
//     src/framework/personResolver.ts so this script needs zero compiled deps)

function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\b(corporation|corp\.?|incorporated|inc\.?|llc|l\.l\.c\.|limited|ltd\.?|company|co\.?|holdings|group)\b/gi, "")
    .replace(/[,.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HONORIFIC_PREFIXES = [
  "the\\s+honorable", "lt\\s+gen", "maj\\s+gen", "brig\\s+gen", "rear\\s+adm",
  "vice\\s+adm", "dr", "mr", "mrs", "ms", "hon", "gen", "ltc", "ltg", "mg",
  "bg", "adm", "vadm", "radm", "rdml", "capt", "col", "lt\\s+col", "maj",
  "sgt", "amb", "prof", "sen", "rep",
];
const HONORIFIC_RE = new RegExp(`^(?:${HONORIFIC_PREFIXES.join("|")})\\.?\\s+`, "i");
const SUFFIX_RE = /\s+(?:jr\.?|sr\.?|ii|iii|iv|v|usa(?:f)?(?:\s*\(?ret\.?\)?)?|usn(?:\s*\(?ret\.?\)?)?|usmc(?:\s*\(?ret\.?\)?)?|uscg(?:\s*\(?ret\.?\)?)?|ussf(?:\s*\(?ret\.?\)?)?|\(?ret\.?\)?)$/i;

function normalizePersonName(name) {
  let s = String(name || "").trim();
  if (!s) return "";
  let prevLen = -1;
  while (s.length !== prevLen) { prevLen = s.length; s = s.replace(HONORIFIC_RE, ""); }
  prevLen = -1;
  while (s.length !== prevLen) { prevLen = s.length; s = s.replace(SUFFIX_RE, ""); }
  s = s.replace(/[,.]/g, "");
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  const parts = s.split(" ");
  if (parts.length >= 3) {
    s = parts.filter((p, i) => i === 0 || i === parts.length - 1 || p.length > 1).join(" ");
  }
  return s;
}

// ─── firebase-tools CLI shells ────────────────────────────────────────────

function fbGet(refPath, outFile) {
  // Use spawnSync for safer arg quoting on Windows/PowerShell.
  const args = ["database:get", refPath, "--project", PROJECT, "-o", outFile];
  const result = spawnSync("firebase", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`firebase database:get ${refPath} failed`);
}
function fbUpdate(refPath, inFile) {
  const args = ["database:update", refPath, inFile, "--project", PROJECT, "-f"];
  const result = spawnSync("firebase", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`firebase database:update ${refPath} failed`);
}

// ─── merge logic (faithful port of backfillOrgMergeCore.ts) ───────────────

function pickCanonical(cluster) {
  return [...cluster].sort((a, b) => {
    const aAuto = a.node.autoCreated ? 1 : 0;
    const bAuto = b.node.autoCreated ? 1 : 0;
    if (aAuto !== bAuto) return aAuto - bAuto;
    const aTime = parseCreated(a.node.created);
    const bTime = parseCreated(b.node.created);
    if (aTime !== bTime) return aTime - bTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}
function parseCreated(c) {
  if (c == null) return Number.MAX_SAFE_INTEGER;
  if (typeof c === "number") return c;
  const t = Date.parse(c);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}
function isExcluded(norm) {
  return EXCLUDE_IF_NORM_CONTAINS.some((needle) => norm.toLowerCase().includes(needle.toLowerCase()));
}
function isOrgType(t) {
  if (!t) return true;
  return ["company","government","foreign_government","program","committee","lobby_firm","university","ffrdc","trade_assoc","other"].includes(t);
}
function rewriteIdsInTree(value, idMap) {
  if (typeof value === "string") {
    const r = idMap.get(value);
    return r ? { value: r, count: 1 } : { value, count: 0 };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const next = value.map((v) => { const r = rewriteIdsInTree(v, idMap); count += r.count; return r.value; });
    return { value: next, count };
  }
  if (value && typeof value === "object") {
    let count = 0;
    const next = {};
    for (const [k, v] of Object.entries(value)) { const r = rewriteIdsInTree(v, idMap); count += r.count; next[k] = r.value; }
    return { value: next, count };
  }
  return { value, count: 0 };
}

function wsPath(...parts) {
  return "/workspaces/" + WORKSPACE_ID + (parts.length > 0 ? "/" + parts.join("/") : "");
}

// ─── main ────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orgmerge-"));
const snapshotPath = path.join(tmpDir, "workspace.json");
const updatesPath = path.join(tmpDir, "updates.json");

console.log(`[1/4] fetching /workspaces/${WORKSPACE_ID} via firebase-tools…`);
fbGet(`/workspaces/${WORKSPACE_ID}`, snapshotPath);
const ws = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
console.log(`      snapshot loaded (${(fs.statSync(snapshotPath).size / 1024 / 1024).toFixed(2)} MB)`);

const nodes = ws.nodes || {};
const awards = ws.awards || {};
const opportunities = ws.opportunities || {};
const signals = ws.signals || {};
const edges = ws.edges || {};
const awardsByPrime = ws.awardsByPrime || {};
const awardsByCustomer = ws.awardsByCustomer || {};
const awardsByPopEnd = ws.awardsByPopEnd || {};
const orgMergeCandidates = ws.orgMergeCandidates || {};
const personMergeCandidates = ws.personMergeCandidates || {};

const updates = {};
const result = {
  workspaceId: WORKSPACE_ID,
  apply: APPLY,
  orgClustersScanned: 0,
  personClustersScanned: 0,
  orgClustersMerged: 0,
  personClustersMerged: 0,
  clustersSkippedByExclude: 0,
  dupsDeleted: 0,
  totalRefsRewritten: 0,
  clusters: [],
};

function processType(type) {
  const normalizer = type === "org" ? normalizeName : normalizePersonName;
  const groups = new Map();
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || !node.name) continue;
    if (type === "org" && !isOrgType(node.type)) continue;
    if (type === "person" && node.type !== "person") continue;
    const norm = normalizer(node.name);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push({ id, node });
  }
  for (const [norm, cluster] of groups) {
    if (cluster.length < 2) continue;
    if (type === "org") result.orgClustersScanned++; else result.personClustersScanned++;
    if (isExcluded(norm)) { result.clustersSkippedByExclude++; console.log(`  - skip excluded: [${type}] ${norm} (${cluster.length} copies)`); continue; }
    const canonical = pickCanonical(cluster);
    const dups = cluster.filter((c) => c.id !== canonical.id);
    const idMap = new Map();
    for (const d of dups) idMap.set(d.id, canonical.id);
    const altSet = new Set();
    for (const existing of canonical.node.alternateNames || []) if (normalizer(existing) !== norm) altSet.add(existing);
    const newlyAdded = [];
    const dupDisplayNames = [];
    for (const d of dups) {
      if (d.node.name) {
        dupDisplayNames.push(d.node.name);
        if (normalizer(d.node.name) !== norm && !altSet.has(d.node.name)) { altSet.add(d.node.name); newlyAdded.push(d.node.name); }
      }
      for (const alt of d.node.alternateNames || []) {
        if (normalizer(alt) !== norm && !altSet.has(alt)) { altSet.add(alt); newlyAdded.push(alt); }
      }
    }
    const mergedAlternateNames = Array.from(altSet);
    if (mergedAlternateNames.length > 0) updates[`${wsPath("nodes", canonical.id)}/alternateNames`] = mergedAlternateNames;
    for (const d of dups) updates[wsPath("nodes", d.id)] = null;
    let refsRewritten = 0;

    // nodes.parentOrgId
    for (const [nodeId, n] of Object.entries(nodes)) {
      if (n?.parentOrgId && idMap.has(n.parentOrgId)) { updates[`${wsPath("nodes", nodeId)}/parentOrgId`] = idMap.get(n.parentOrgId); refsRewritten++; }
    }
    // awards
    for (const [awardId, award] of Object.entries(awards)) {
      if (!award) continue;
      for (const field of ["primeOrgId","primeParentOrgId","customerOrgId","customerToptierOrgId"]) {
        const v = award[field]; if (typeof v === "string" && idMap.has(v)) { updates[`${wsPath("awards", awardId)}/${field}`] = idMap.get(v); refsRewritten++; }
      }
      if (Array.isArray(award.subawards)) {
        let mut = false;
        const next = award.subawards.map((s) => { if (s && typeof s === "object" && typeof s.subOrgId === "string" && idMap.has(s.subOrgId)) { mut = true; refsRewritten++; return { ...s, subOrgId: idMap.get(s.subOrgId) }; } return s; });
        if (mut) updates[`${wsPath("awards", awardId)}/subawards`] = next;
      }
    }
    // awardsByPrime/Customer — move keys
    for (const [dupId, canonicalId] of idMap) {
      const dupP = awardsByPrime[dupId];
      if (dupP) {
        for (const [awardId, entry] of Object.entries(dupP)) { updates[wsPath("awardsByPrime", canonicalId, awardId)] = entry; refsRewritten++; }
        updates[wsPath("awardsByPrime", dupId)] = null;
      }
      const dupC = awardsByCustomer[dupId];
      if (dupC) {
        for (const [awardId, entry] of Object.entries(dupC)) { updates[wsPath("awardsByCustomer", canonicalId, awardId)] = entry; refsRewritten++; }
        updates[wsPath("awardsByCustomer", dupId)] = null;
      }
    }
    // awardsByPopEnd.primeOrgId
    for (const [day, dayEntries] of Object.entries(awardsByPopEnd)) {
      if (!dayEntries) continue;
      for (const [awardId, entry] of Object.entries(dayEntries)) {
        if (!entry) continue;
        if (typeof entry.primeOrgId === "string" && idMap.has(entry.primeOrgId)) { updates[`${wsPath("awardsByPopEnd", day, awardId)}/primeOrgId`] = idMap.get(entry.primeOrgId); refsRewritten++; }
      }
    }
    // opportunities.customerOrgId
    for (const [oppId, opp] of Object.entries(opportunities)) {
      if (opp?.customerOrgId && typeof opp.customerOrgId === "string" && idMap.has(opp.customerOrgId)) { updates[`${wsPath("opportunities", oppId)}/customerOrgId`] = idMap.get(opp.customerOrgId); refsRewritten++; }
    }
    // signals — subjectIds, relatedIds, attrs tree
    for (const [sigId, sig] of Object.entries(signals)) {
      if (!sig) continue;
      for (const field of ["subjectIds","relatedIds"]) {
        const arr = sig[field];
        if (Array.isArray(arr)) {
          let mut = false;
          const next = arr.map((v) => { if (typeof v === "string" && idMap.has(v)) { mut = true; refsRewritten++; return idMap.get(v); } return v; });
          if (mut) updates[`${wsPath("signals", sigId)}/${field}`] = next;
        }
      }
      if (sig.attrs && typeof sig.attrs === "object") {
        const r = rewriteIdsInTree(sig.attrs, idMap);
        if (r.count > 0) { updates[`${wsPath("signals", sigId)}/attrs`] = r.value; refsRewritten += r.count; }
      }
    }
    // edges
    for (const [edgeId, edge] of Object.entries(edges)) {
      if (!edge) continue;
      for (const ep of ["source","target"]) {
        const v = edge[ep]; if (typeof v === "string" && idMap.has(v)) { updates[`${wsPath("edges", edgeId)}/${ep}`] = idMap.get(v); refsRewritten++; }
      }
    }
    // candidate purge
    for (const [pairKey, c] of Object.entries(orgMergeCandidates)) {
      if (c && (idMap.has(c.idA) || idMap.has(c.idB))) { updates[wsPath("orgMergeCandidates", pairKey)] = null; refsRewritten++; }
    }
    for (const [pairKey, c] of Object.entries(personMergeCandidates)) {
      if (c && (idMap.has(c.idA) || idMap.has(c.idB))) { updates[wsPath("personMergeCandidates", pairKey)] = null; refsRewritten++; }
    }

    result.dupsDeleted += dups.length;
    result.totalRefsRewritten += refsRewritten;
    if (type === "org") result.orgClustersMerged++; else result.personClustersMerged++;
    result.clusters.push({ type, norm, canonicalId: canonical.id, canonicalName: canonical.node.name, mergedIds: dups.map(d => d.id), mergedDisplayNames: dupDisplayNames, alternateNamesAdded: newlyAdded, refsRewritten });
    console.log(`  + merge [${type}] ${norm}: keep ${canonical.id} ("${canonical.node.name}"), drop ${dups.map(d=>d.id).join(",")} (refs: ${refsRewritten})`);
  }
}

console.log(`[2/4] scanning clusters…`);
processType("org");
processType("person");

const updateKeys = Object.keys(updates).length;
fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2));
console.log(`[3/4] computed ${updateKeys} update keys; ${result.orgClustersMerged} org clusters, ${result.personClustersMerged} person clusters, ${result.dupsDeleted} dups, ${result.totalRefsRewritten} refs, ${result.clustersSkippedByExclude} excluded`);
console.log(`      updates written to: ${updatesPath}`);

if (!APPLY) {
  console.log(`[4/4] DRY RUN — no writes. Re-run with --apply to commit.`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`[4/4] applying via firebase database:update / …`);
fbUpdate("/", updatesPath);
console.log(`      done. Summary:`);
console.log(JSON.stringify(result, null, 2));
