// Corsair — Bridge to the Atlas Relationship Console (build D, 2026-07-06).
//
// Returns ONLY customer-safe product facts from the Operational Truth Hub as a
// clean text block, so the console's "Draft with Claude" (draftReply /
// accountSummary) can answer pricing / spec / compliance / availability
// questions from live, authoritative data instead of guessing or leaving blanks.
//
// ZERO-LEAK, HARD: only facts the operator has classified `customer-safe` ever
// cross this endpoint. Internal facts (COGM, margins, committed/quoted volumes,
// production_status — all force-internal in factsSync) can never be marked
// customer-safe, so they can never appear here. This extends the drafter's
// existing zero-leak wall to the separate console.
//
// Auth: a shared secret in the `x-bridge-key` header (or ?key=), checked against
// the ATLAS_BRIDGE_KEY secret. The console passes it from Script Properties.

import { onRequest } from "firebase-functions/v2/https";
import { db } from "../framework/rtdb";
import { createLogger } from "../framework/logger";
import { ATLAS_MASTER_CONFIG as CFG } from "../sources/atlasMaster/config";

const WS = CFG.workspaceId;

interface FactRecord {
  product?: string;
  customer?: { name?: string } | null;
  attribute?: string;
  value?: string;
  unit?: string;
  visibility?: string;
}

const ATTR_LABEL: Record<string, string> = {
  price: "List price",
  volume_pricing: "Volume pricing",
  availability: "First available",
  capacity: "Monthly capacity",
};

export const draftingFacts = onRequest(
  { region: "us-central1", secrets: ["ATLAS_BRIDGE_KEY"] },
  async (req, res): Promise<void> => {
    const log = createLogger({ source: "draftingFacts" });
    const key = String(req.get("x-bridge-key") ?? req.query.key ?? "");
    const expected = process.env.ATLAS_BRIDGE_KEY || "";
    if (!expected || key !== expected) {
      res.status(403).send("forbidden");
      return;
    }
    try {
      const snap = await db.ref(`workspaces/${WS}/facts`).get();
      const facts: Record<string, FactRecord> = (snap.exists() ? snap.val() : {}) || {};

      // HARD zero-leak filter: customer-safe only, with a value.
      const safe = Object.values(facts).filter(
        (f) => f && f.visibility === "customer-safe" && f.attribute && f.value
      );

      // Group by product; customer-specific facts fold under their customer name.
      const byGroup: Record<string, string[]> = {};
      for (const f of safe) {
        const who = (f.product && f.product.trim())
          || (f.customer && f.customer.name)
          || "General";
        const label = ATTR_LABEL[f.attribute!] || f.attribute!.replace(/_/g, " ");
        const line = `${label}: ${f.value}${f.unit ? " " + f.unit : ""}`;
        (byGroup[who] = byGroup[who] || []).push(line);
      }

      const blocks = Object.keys(byGroup).sort().map(
        (g) => g + "\n" + byGroup[g].map((l) => "  - " + l).join("\n")
      );
      const text = blocks.length
        ? "ATLAS PRODUCT FACTS (current, customer-safe — from the Corsair Truth Hub):\n\n" + blocks.join("\n\n")
        : "";

      log.info("served", { facts: safe.length, groups: blocks.length });
      res.set("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(text);
    } catch (err) {
      const e = err as Error;
      log.error("threw", { message: e.message });
      res.status(500).send("error");
    }
  }
);
