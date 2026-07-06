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
import { readRange, readSpreadsheetSummary } from "../sources/atlasMaster/client";
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
// P13.386 — lenient variant for tabs (Shipments Log) whose SKU column drops
// the -N/-C suffix. "ATL-3008-1300KV" -> "3008 1300KV" (== the NDAA display
// name, so it lands on the same product as the catalog's -N variant).
function productFromSkuLoose(sku: string): string | null {
  const s = String(sku ?? "").trim();
  const m = s.match(/^ATL-(.+?)(?:-(N|C))?$/i);
  if (!m) return null;
  const base = m[1].replace(/-/g, " ").toUpperCase().replace(/(\d)KV/g, "$1KV");
  return m[2] && m[2].toUpperCase() === "C" ? `${base} Commercial` : base;
}
// P13.386 — a sheet date cell -> "YYYY-MM". The Sheets API returns FORMATTED
// values (verified: availability arrives as "7/1/2026", not a serial), so the
// month header row is formatted date strings. Handle every plausible form:
// M/D/YYYY (the observed format), ISO, "May 2026"/"May-26", and raw Excel
// serials as a fallback (25569 = the serial for 1970-01-01 UTC). Returns null
// for anything that isn't a real month (e.g. the "Q2 '26" quarter labels).
const _MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function monthKey(cell: unknown): string | null {
  const s = String(cell ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?/); // ISO YYYY-MM[-DD]
  if (m) return m[1] + "-" + m[2];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY (observed)
  if (m) return m[3] + "-" + m[1].padStart(2, "0");
  m = s.toLowerCase().match(/^([a-z]{3})[a-z]*[\s'\-]+(\d{2,4})/); // "May 2026" / "May-26"
  if (m && _MONTH_ABBR[m[1]]) return (m[2].length === 2 ? "20" + m[2] : m[2]) + "-" + _MONTH_ABBR[m[1]];
  const n = parseFloat(s.replace(/[^0-9.\-]/g, "")); // raw Excel serial fallback
  if (!isNaN(n) && n > 20000 && n < 80000) {
    const d = new Date(Math.round((n - 25569) * 86400000));
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  }
  return null;
}
function intUnits(raw: unknown): number | null {
  const t = String(raw ?? "").replace(/[^0-9.\-]/g, "");
  if (!t || t === "-" || t === ".") return null;
  const v = parseFloat(t);
  return isNaN(v) ? null : Math.round(v);
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
  // P13.386 — monthly series facts (capacity / shipped_output). Present ONLY
  // on series records; read exclusively through the client getSeriesThrough.
  series?: string;
  month?: string;
}
interface MappedFact {
  product: string;
  customer: string; // "" = customer-less (general) — product facts
  attribute: string;
  value: string;
  unit: string;
  tab: string;
  series?: string; // P13.386
  month?: string;  // P13.386
  label?: string;  // P13.386 — display label for series/aggregate facts
  source?: string; // A (2026-07-06) — overrides the "Atlas master sheet" source label (e.g. Atlas_Pricing)
}
// P13.386 — metrics that are internal posture and NEVER leave (email guard).
const FORCE_INTERNAL = new Set([
  "cogm", "production_status", "committed", "quoted", "shipped_to_date",
]);
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
  seriesRows: number;   // P13.386 — monthly capacity + shipped-output cells read
  orderRows: number;    // P13.386 — Orders Master lines summed
  shipmentRows: number; // P13.386 — Shipments Log lines summed
  pricingRows: number;  // A (2026-07-06) — SKUs priced from Atlas_Pricing (0 = sheet unreadable, master fallback used)
  created: number;
  updated: number;
  reconfirmed: number;
  skippedBadRows: number;
  changes: FactsSyncChange[];
}

/** Read the catalog + pipeline + production tabs and map them to fact rows. */
// A (2026-07-06) — AUTHORITATIVE pricing from Tom's Atlas_Pricing sheet.
// Reads the "Atlas Standard Motor" tab (the current customer Volume Price List)
// and produces, per SKU: a `price` fact (list price) + a `volume_pricing` fact
// (the full qty → unit-price ladder). The tab title is resolved from the sheet
// summary so an exact-name change won't break it. Best-effort by design: the
// caller swallows read failures (e.g. sheet not shared with the sync grant),
// leaving the master List Price fallback in place. Returns the products it
// priced so the caller can skip the master List Price for them (one source).
async function readPricingFacts(uid: string): Promise<{ facts: MappedFact[]; pricedProducts: Set<string>; pricingRows: number }> {
  const facts: MappedFact[] = [];
  const pricedProducts = new Set<string>();
  let pricingRows = 0;

  // Resolve the volume-list tab by CONTENT, not just name: the sheet also has a
  // "Standard Motors" catalog tab (no volume table). Try the "standard motor"
  // tabs — atlas-named first — and use whichever actually holds the volume table.
  const summary = await readSpreadsheetSummary(uid, CFG.sheets.pricing);
  const candidates = summary.tabs
    .filter((t) => /standard\s*motor/i.test(t.title))
    .sort((a, b) => (/atlas/i.test(b.title) ? 1 : 0) - (/atlas/i.test(a.title) ? 1 : 0));
  let rows: string[][] = [];
  let vt: { header: string[]; start: number } | null = null;
  for (const cand of candidates) {
    rows = await readRange(uid, CFG.sheets.pricing, `${cand.title}!A1:Z60`);
    vt = findTable(rows, ["Order Quantity", "Discount off List"]);
    if (vt) break;
  }
  if (!vt) return { facts, pricedProducts, pricingRows };
  const qtyCol = vt.header.indexOf("Order Quantity");

  // Remaining header cells that look like part numbers are the priced SKUs.
  const skuCols: Array<{ col: number; product: string }> = [];
  vt.header.forEach((h, col) => {
    const s = String(h ?? "").trim();
    if (/^ATL-/i.test(s)) {
      const product = productFromSku(s);
      if (product) skuCols.push({ col, product });
    }
  });

  for (const { col, product } of skuCols) {
    const ladder: string[] = [];
    let listPrice: string | null = null;
    for (let i = vt.start; i < rows.length; i++) {
      const row = rows[i] || [];
      const qty = String(row[qtyCol] ?? "").trim();
      if (!qty || !/\d/.test(qty)) break; // end of the contiguous volume table
      const cell = row[col];
      const p = money(cell);
      const label = p ?? (String(cell ?? "").trim() ? "negotiated" : null);
      if (!label) continue;
      if (!listPrice && p) listPrice = p;
      ladder.push(`${qty} ${label}`);
    }
    if (!ladder.length) continue;
    pricingRows++;
    pricedProducts.add(product);
    if (listPrice) {
      facts.push({ product, customer: "", attribute: "price", value: listPrice, unit: "$/unit (list)", tab: "Atlas Standard Motor", source: "Atlas_Pricing sheet (Standard Motor list)" });
    }
    facts.push({ product, customer: "", attribute: "volume_pricing", value: ladder.join("  ·  "), unit: "$/unit by order qty", tab: "Atlas Standard Motor", source: "Atlas_Pricing sheet (Standard Motor list)" });
  }
  return { facts, pricedProducts, pricingRows };
}

async function readMappedFacts(uid: string): Promise<{ facts: MappedFact[]; catalogRows: number; pipelineRows: number; skipped: number; seriesRows: number; orderRows: number; shipmentRows: number; pricingRows: number }> {
  const facts: MappedFact[] = [];
  let skipped = 0;

  // ── Pricing (AUTHORITATIVE): Tom's Atlas_Pricing supersedes the master
  //    sheet's List Price so the two can't drift. Best-effort — if the sync
  //    grant can't read Tom's sheet, pricingRows stays 0 and the master List
  //    Price fallback below stands (sync never breaks over a pricing read).
  let pricingRows = 0;
  const pricedProducts = new Set<string>();
  try {
    const pr = await readPricingFacts(uid);
    facts.push(...pr.facts);
    pr.pricedProducts.forEach((p) => pricedProducts.add(p));
    pricingRows = pr.pricingRows;
  } catch {
    /* Atlas_Pricing unreadable (e.g. not shared with the sync grant) — fall back to master List Price */
  }

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
    // Skip the master List Price when Atlas_Pricing already priced this SKU
    // (authoritative) — otherwise the two sources would fight over one fact.
    if (price && !pricedProducts.has(product)) facts.push({ product, customer: "", attribute: "price", value: price, unit: "$/unit", tab: "Standard Motors" });
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

  // ── P13.386 — Production Planning: monthly capacity + shipped-output series ──
  // No clean header signature (section-based), so locate the "AGGREGATE
  // CAPACITY FLOW" marker, take the month-serial header row beneath it, then
  // read the "Capacity" and "Shipped (Output)" rows, pairing each column's
  // value with its month. Stored blank-product so ONLY getSeriesThrough sees
  // them. Attribute carries the month for id uniqueness.
  let seriesRows = 0;
  const ppRows = await readRange(uid, CFG.sheets.master, "Production Planning!A1:Z60");
  const markerIdx = ppRows.findIndex((r) => String((r || [])[0] ?? "").trim() === "AGGREGATE CAPACITY FLOW");
  if (markerIdx >= 0) {
    // month header: first row after the marker with real month values in col >= 3
    let monthRowIdx = -1;
    for (let i = markerIdx; i < Math.min(markerIdx + 4, ppRows.length); i++) {
      const r = ppRows[i] || [];
      if (monthKey(r[3]) || monthKey(r[4]) || monthKey(r[5])) { monthRowIdx = i; break; }
    }
    if (monthRowIdx >= 0) {
      const monthRow = ppRows[monthRowIdx] || [];
      const colMonths: Record<number, string> = {};
      for (let c = 0; c < monthRow.length; c++) {
        const mo = monthKey(monthRow[c]);
        if (mo) colMonths[c] = mo;
      }
      const seriesRowSpec: Array<{ label: string; series: string; unit: string }> = [
        { label: "Capacity", series: "capacity", unit: "units/mo" },
        { label: "Shipped (Output)", series: "shipped_output", unit: "units/mo" },
      ];
      for (const spec of seriesRowSpec) {
        const rowIdx = ppRows.findIndex((r, i) => i > markerIdx && String((r || [])[0] ?? "").trim() === spec.label);
        if (rowIdx < 0) continue;
        const dataRow = ppRows[rowIdx] || [];
        for (const cStr in colMonths) {
          const c = Number(cStr);
          const month = colMonths[c];
          const val = intUnits(dataRow[c]);
          if (val === null) continue; // blank cell — skip (0 is a real value, kept)
          seriesRows++;
          facts.push({
            product: "", customer: "",
            attribute: spec.series + "@" + month, // id-uniqueness carrier
            series: spec.series, month,
            value: String(val), unit: spec.unit,
            label: "Aggregate " + spec.series.replace("_", " ") + " " + month,
            tab: "Production Planning",
          });
        }
      }
    }
  }

  // ── P13.386 — Orders Master: committed (firm) + quoted per SKU ───────────────
  let orderRows = 0;
  const omRows = await readRange(uid, CFG.sheets.master, "Orders Master!A1:Z400");
  const om = findTable(omRows, ["Order ID", "SKU / Project", "Quantity"]);
  if (om) {
    const oc = (name: string) => om.header.indexOf(name);
    const oSku = oc("SKU / Project"), oQty = oc("Quantity"), oStage = oc("Stage");
    const committed: Record<string, number> = {};
    const quoted: Record<string, number> = {};
    for (let i = om.start; i < omRows.length; i++) {
      const row = omRows[i] || [];
      const product = productFromSku(String(row[oSku] ?? ""));
      const qty = intUnits(row[oQty]);
      if (!product || qty === null) continue;
      orderRows++;
      const stage = String(row[oStage] ?? "").trim().toLowerCase();
      if (stage === "quote") quoted[product] = (quoted[product] || 0) + qty;
      else committed[product] = (committed[product] || 0) + qty; // PO Received / Shipped = firm
    }
    for (const product in committed) {
      facts.push({ product, customer: "", attribute: "committed", value: String(committed[product]), unit: "units ordered (firm)", tab: "Orders Master" });
    }
    for (const product in quoted) {
      facts.push({ product, customer: "", attribute: "quoted", value: String(quoted[product]), unit: "units quoted (not firm)", tab: "Orders Master" });
    }
  }

  // ── P13.386 — Shipments Log: shipped-to-date per SKU ─────────────────────────
  let shipmentRows = 0;
  const slRows = await readRange(uid, CFG.sheets.master, "Shipments Log!A1:Z400");
  const sl = findTable(slRows, ["Shipment ID", "SKU", "Quantity"]);
  if (sl) {
    const sc = (name: string) => sl.header.indexOf(name);
    const sSku = sc("SKU"), sQty = sc("Quantity");
    const shipped: Record<string, number> = {};
    for (let i = sl.start; i < slRows.length; i++) {
      const row = slRows[i] || [];
      const product = productFromSkuLoose(String(row[sSku] ?? ""));
      const qty = intUnits(row[sQty]);
      if (!product || qty === null) continue;
      shipmentRows++;
      shipped[product] = (shipped[product] || 0) + qty;
    }
    for (const product in shipped) {
      facts.push({ product, customer: "", attribute: "shipped_to_date", value: String(shipped[product]), unit: "units shipped", tab: "Shipments Log" });
    }
  }

  return { facts, catalogRows, pipelineRows, skipped, seriesRows, orderRows, shipmentRows, pricingRows };
}

/**
 * Reflect the master sheet onto workspaces/{ws}/facts.
 * dryRun computes the full report without writing anything.
 */
export async function syncSheetToFacts(uid: string, opts: { dryRun: boolean }): Promise<FactsSyncReport> {
  const dryRun = opts.dryRun;
  const now = Date.now();
  const dateLabel = new Date(now).toISOString().slice(0, 10);

  const { facts: mapped, catalogRows, pipelineRows, skipped, seriesRows, orderRows, shipmentRows, pricingRows } = await readMappedFacts(uid);

  const snap = await db.ref(`workspaces/${WS}/facts`).get();
  const existing: Record<string, FactRecord> = (snap.exists() ? snap.val() : {}) || {};

  const report: FactsSyncReport = {
    dryRun, catalogRows, pipelineRows, seriesRows, orderRows, shipmentRows, pricingRows,
    created: 0, updated: 0, reconfirmed: 0, skippedBadRows: skipped, changes: [],
  };

  for (const m of mapped) {
    const id = factId(m.product, m.customer, m.attribute);
    const prior = existing[id] || null;
    const label = m.label || `${m.product || m.customer} ${m.attribute}`;
    const src = m.source
      ? `${m.source} - synced ${dateLabel}`
      : `Atlas master sheet - ${m.tab} tab - synced ${dateLabel}`;

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
    // P13.386 — force-internal: named posture metrics + ALL monthly series.
    if (m.series || FORCE_INTERNAL.has(m.attribute)) visibility = "internal";

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
      ...(m.series ? { series: m.series, month: m.month } : {}),
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
