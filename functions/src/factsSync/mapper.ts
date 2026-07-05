// Corsair — Atlas master-sheet -> Truth Hub facts mapper.
//
// Automates the 2026-07-03 manual pull: reads the Standard Motors catalog tab
// (list price / COGM / monthly capacity / first-available per SKU, NDAA "-N"
// and Commercial "-C" variants) and the Pipeline tab (BD stage per company)
// and reflects them into workspaces/{ws}/facts — the Operational Truth Hub
// store (client: FLiIntel.html P13.381-383).
//
// Rules (design ratified by the operator 2026-07-03):
//   - ONE-WAY, sheet -> Corsair. Never writes to the sheet.
//   - Latest-wins with history: a changed value pushes the prior current onto
//     the fact's history array (capped), then overwrites. Never deletes.
//   - STICKY CLASSIFICATION: the sync NEVER changes `visibility` on an
//     existing fact — internal/customer-safe is the operator's call and it is
//     permanent until the operator changes it. New facts arrive 'internal'
//     (fail safe). COGM is forced internal always, both new and existing
//     (mirrors the client's _factAttrForcesInternal rule).
//   - Unchanged values get a cheap leaf re-confirm (confirmedAt/lastSyncedAt)
//     -- the sheet is the operator's source of truth, so "the sheet still
//     says X" IS a re-verification; history only grows on real changes.
//   - Sheet rows that disappear leave their facts untouched (they age to
//     stale naturally). No deletes.
//   - Value changes are appended to workspaces/{ws}/factChanges (ring buffer)
//     so the morning brief can surface "3115 list price $69 -> $72" moves.
//     TODO: emit real Signals into the OSINT lake once the shape is wired.
//
// Fact ids mirror the client's _factId slugs exactly, so the cron and the
// Log-fact modal address the same records:
//   fact_<product|account>__<customer|general>__<attribute>

import { db } from "../framework/rtdb";
import { readRange } from "../sources/atlasMaster/client";
import { ATLAS_MASTER_CONFIG as CFG } from "../sources/atlasMaster/config";

const WS = CFG.workspaceId;
const HISTORY_CAP = 50;
const CHANGES_CAP = 50;

// ── slug / id (must match the client's _fSlug/_factId byte-for-byte) ────────
function slug(s: unknown): string {
  return (
    String(s ?? "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "x"
  );
}
function factId(product: string, customer: string, attribute: string): string {
  return `fact_${slug(product || "account")}__${slug(customer || "general")}__${slug(attribute)}`;
}

// ── value normalizers (match the manual-pull formatting so the first sync
//     run does not churn history on cosmetic differences) ───────────────────
function money(raw: unknown): string | null {
  const t = String(raw ?? "").replace(/[^0-9.\-]/g, "");
  if (!t || t === "-" || t === ".") return null;
  const n = parseFloat(t);
  if (isNaN(n)) return null;
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}
function units(raw: unknown): string | null {
  const t = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  if (isNaN(n)) return null;
  return Math.round(n).toLocaleString("en-US");
}
function isoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // FORMATTED_VALUE gives locale dates like "7/1/2026"; already-ISO passes through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return s; // unknown format — keep verbatim rather than lose it
}
// "ATL-3115-900KV-N" -> { product: "3115 900KV" }  ·  "-C" -> "3115 900KV Commercial"
function productFromSku(sku: string): string | null {
  const m = String(sku ?? "").trim().match(/^ATL-(.+)-(N|C)$/i);
  if (!m) return null;
  const base = m[1].replace(/-/g, " ").toUpperCase().replace(/(\d)KV/g, "$1KV");
  return m[2].toUpperCase() === "C" ? `${base} Commercial` : base;
}

function findTable(rows: string[][], sig: readonly string[]): { header: string[]; start: number } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    const set = new Set(cells);
    if (sig.every((s) => set.has(s))) return { header: cells, start: i + 1 };
  }
  return null;
}

// ── record + report types ───────────────────────────────────────────────────
interface FactRecord {
  id: string;
  product: string;
  customer: { name: string; nodeId: string | null } | null;
  attribute: string;
  value: string;
  unit: string;
  sourceLabel: string;
  confirmedBy: string;
  confirmedAt: number;
  status: string;
  visibility: string;
  history?: unknown[];
  lastSyncedAt?: number;
}
interface MappedFact {
  product: string;
  customer: string; // "" = customer-less (general) — product facts
  attribute: string;
  value: string;
  unit: string;
  tab: string;
}
export interface FactsSyncChange {
  id: string;
  label: string;
  from: string | null;
  to: string;
  at: number;
}
export interface FactsSyncReport {
  dryRun: boolean;
  catalogRows: number;
  pipelineRows: number;
  created: number;
  updated: number;
  reconfirmed: number;
  skippedBadRows: number;
  changes: FactsSyncChange[];
}

/** Read the catalog + pipeline tabs and map them to Truth Hub fact rows. */
async function readMappedFacts(uid: string): Promise<{ facts: MappedFact[]; catalogRows: number; pipelineRows: number; skipped: number }> {
  const facts: MappedFact[] = [];
  let skipped = 0;

  // ── Standard Motors: per-SKU unit economics ───────────────────────────────
  const catRows = await readRange(uid, CFG.sheets.master, "Standard Motors!A1:Z100");
  const cat = findTable(catRows, ["SKU", "List Price", "Total COGM"]);
  if (!cat) throw new Error("Standard Motors table not found (SKU/List Price/Total COGM header row missing).");
  const cc = (name: string) => cat.header.indexOf(name);
  const cSku = cc("SKU"), cCap = cc("Monthly Capacity"), cPrice = cc("List Price"),
    cCogm = cc("Total COGM"), cAvail = cc("First Available"),
    cStatus = cc("Status"); // P13.385 — the honesty flag (Pre-Production vs Production)
  let catalogRows = 0;
  for (let i = cat.start; i < catRows.length; i++) {
    const row = catRows[i] || [];
    const product = productFromSku(String(row[cSku] ?? ""));
    if (!product) {
      if (String(row[cSku] ?? "").trim()) skipped++;
      continue;
    }
    catalogRows++;
    const price = money(row[cPrice]);
    const cogm = money(row[cCogm]);
    const cap = units(row[cCap]);
    const avail = cAvail >= 0 ? isoDate(row[cAvail]) : null;
    // P13.385 — production status: label in, label out, no interpretation.
    const status = cStatus >= 0 ? String(row[cStatus] ?? "").trim() : "";
    if (status) facts.push({ product, customer: "", attribute: "production_status", value: status, unit: "", tab: "Standard Motors" });
    if (price) facts.push({ product, customer: "", attribute: "price", value: price, unit: "$/unit", tab: "Standard Motors" });
    if (cogm) facts.push({ product, customer: "", attribute: "cogm", value: cogm, unit: "$/unit", tab: "Standard Motors" });
    if (cap) facts.push({ product, customer: "", attribute: "capacity", value: cap, unit: "units/mo (full ramp)", tab: "Standard Motors" });
    if (avail) facts.push({ product, customer: "", attribute: "availability", value: avail, unit: "first available", tab: "Standard Motors" });
  }

  // ── Pipeline: BD stage per company (customer-level facts, P13.383) ────────
  const pipRows = await readRange(uid, CFG.sheets.master, "Pipeline!A1:Z300");
  const pip = findTable(pipRows, ["Company", "Stage", "Atlas Owner"]);
  if (!pip) throw new Error("Pipeline table not found (Company/Stage/Atlas Owner header row missing).");
  const pc = (name: string) => pip.header.indexOf(name);
  const pCompany = pc("Company"), pStage = pc("Stage");
  let pipelineRows = 0;
  for (let i = pip.start; i < pipRows.length; i++) {
    const row = pipRows[i] || [];
    const company = String(row[pCompany] ?? "").trim();
    const stage = String(row[pStage] ?? "").trim();
    if (!company || !stage) continue;
    pipelineRows++;
    facts.push({ product: "", customer: company, attribute: "stage", value: stage, unit: "", tab: "Pipeline" });
  }

  return { facts, catalogRows, pipelineRows, skipped };
}

/**
 * Reflect the master sheet onto workspaces/{ws}/facts.
 * dryRun computes the full report without writing anything.
 */
export async function syncSheetToFacts(uid: string, opts: { dryRun: boolean }): Promise<FactsSyncReport> {
  const dryRun = opts.dryRun;
  const now = Date.now();
  const dateLabel = new Date(now).toISOString().slice(0, 10);

  const { facts: mapped, catalogRows, pipelineRows, skipped } = await readMappedFacts(uid);

  const snap = await db.ref(`workspaces/${WS}/facts`).get();
  const existing: Record<string, FactRecord> = (snap.exists() ? snap.val() : {}) || {};

  const report: FactsSyncReport = {
    dryRun, catalogRows, pipelineRows,
    created: 0, updated: 0, reconfirmed: 0, skippedBadRows: skipped, changes: [],
  };

  for (const m of mapped) {
    const id = factId(m.product, m.customer, m.attribute);
    const prior = existing[id] || null;
    const label = `${m.product || m.customer} ${m.attribute}`;
    const src = `Atlas master sheet - ${m.tab} tab - synced ${dateLabel}`;

    if (prior && String(prior.value) === m.value && String(prior.unit || "") === m.unit) {
      // Unchanged: cheap leaf re-confirm. Preserves visibility, history,
      // sourceLabel, confirmedBy — everything the operator may have touched.
      report.reconfirmed++;
      if (!dryRun) {
        await db.ref(`workspaces/${WS}/facts/${id}`).update({ confirmedAt: now, lastSyncedAt: now });
      }
      continue;
    }

    // New fact, or a real value change.
    let history: unknown[] = [];
    let visibility = "internal"; // fail safe — operator classifies later
    if (prior) {
      history = Array.isArray(prior.history) ? prior.history.slice(0) : [];
      history.unshift({
        value: prior.value, unit: prior.unit || "", sourceLabel: prior.sourceLabel || "",
        confirmedBy: prior.confirmedBy || "", confirmedAt: prior.confirmedAt || 0,
        status: prior.status || "confirmed",
        visibility: prior.visibility === "customer-safe" ? "customer-safe" : "internal",
      });
      if (history.length > HISTORY_CAP) history = history.slice(0, HISTORY_CAP);
      // Sticky classification: keep the operator's call on the existing fact.
      visibility = prior.visibility === "customer-safe" ? "customer-safe" : "internal";
    }
    if (m.attribute === "cogm" || m.attribute === "production_status") visibility = "internal"; // margin math + production posture never leave

    const rec: FactRecord = {
      id,
      product: m.product,
      customer: m.customer ? { name: m.customer, nodeId: null } : null,
      attribute: m.attribute,
      value: m.value,
      unit: m.unit,
      sourceLabel: src,
      confirmedBy: "master-sheet sync",
      confirmedAt: now,
      status: "confirmed",
      visibility,
      history,
      lastSyncedAt: now,
    };

    if (prior) {
      report.updated++;
      report.changes.push({ id, label, from: String(prior.value), to: m.value, at: now });
    } else {
      report.created++;
      report.changes.push({ id, label, from: null, to: m.value, at: now });
    }
    if (!dryRun) {
      await db.ref(`workspaces/${WS}/facts/${id}`).set(rec);
    }
  }

  // Ring buffer of recent value changes for the morning brief to read.
  if (!dryRun && report.changes.length) {
    const ref = db.ref(`workspaces/${WS}/factChanges`);
    const curSnap = await ref.get();
    const cur: FactsSyncChange[] = (curSnap.exists() ? curSnap.val() : []) || [];
    const merged = [...report.changes, ...(Array.isArray(cur) ? cur : Object.values(cur))].slice(0, CHANGES_CAP);
    await ref.set(merged);
  }

  return report;
}
