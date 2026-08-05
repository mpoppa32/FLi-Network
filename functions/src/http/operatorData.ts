// Corsair — operatorData: authenticated read-only graph access for the
// headless operator layer.
//
// WHY: the Cowork morning-brief and meeting-prep tasks run headless — no
// browser, no Firebase user token — so today they read Corsair only through
// the daily digest email. The deep data (open commitments, ranked OSINT
// signals, per-attendee dossiers) lives behind Firebase auth and is only
// reachable interactively. This exposes it over one authenticated HTTP call.
//
// AUTH: onRequest (raw HTTP, NOT onCall — the caller has no Firebase user).
// A shared bearer token in Secret Manager (OPERATOR_API_TOKEN), compared in
// constant time. Read-only: this handler never writes, and it reads through
// the admin SDK, so database.rules.json is untouched and unweakened.
//
// Setup:
//   firebase functions:secrets:set OPERATOR_API_TOKEN   (40+ random chars)
//   firebase deploy --only functions:operatorData
//
// Usage:
//   GET /operatorData?ws={workspaceId}[&entities=Name%20One,Name%20Two]
//                    [&signals=7][&commitments=15]
//   Authorization: Bearer <token>

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createHash, timingSafeEqual } from "crypto";
import { db } from "../framework/rtdb";
import { createLogger } from "../framework/logger";
import { sortOpenCommitments } from "../jobs/dailyBriefDigest";

const OPERATOR_API_TOKEN = defineSecret("OPERATOR_API_TOKEN");

const COMMITMENTS_CAP = 15;
const SIGNALS_CAP = 7;
// Bounds on the dossier work so one call can't walk the whole meeting corpus.
const MAX_ENTITIES = 10;
const MAX_MEETINGS_PER_ENTITY = 40;

/**
 * Constant-time token compare. Hashing first makes the comparison
 * length-independent, so timingSafeEqual never throws on a length mismatch
 * and the wrong-length case leaks no more than the wrong-value case.
 */
function tokenMatches(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** External text lands in JSON consumed by an LLM prompt — strip angle
 *  brackets and collapse whitespace, same posture as the digest composer. */
function clean(s: unknown): string {
  return String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

interface NodeRecord {
  id?: string | number;
  name?: string;
  type?: string;
  org?: string;
  role?: string;
  priority?: number;
  notes?: string;
  meetings?: Array<string | number>;
}

/**
 * Resolve one requested entity term to workspace nodes. Mirrors the app's
 * findEntityMatch ordering: exact case-insensitive name wins outright;
 * otherwise fall back to substring over name/org so partial asks
 * ("Ikeuchi", "Mountain Horse") still land.
 */
function matchNodes(term: string, nodes: NodeRecord[]): NodeRecord[] {
  const t = term.toLowerCase().trim();
  if (!t) return [];
  const exact = nodes.filter((n) => String(n.name ?? "").toLowerCase().trim() === t);
  if (exact.length) return exact;
  return nodes.filter((n) => {
    const hay = `${n.name ?? ""} ${n.org ?? ""}`.toLowerCase();
    return hay.includes(t);
  });
}

/**
 * Meeting ids on a node are stored raw (e.g. 1776578863221 or
 * "1780515363495-ompra"), but some meetings are keyed with an "mtg-" prefix
 * (e.g. "mtg-1783490209686-6muz3"). Try the id as-is, then prefixed.
 * Missing meetings resolve to null and are skipped — never thrown on.
 */
async function loadMeeting(ws: string, id: string | number): Promise<any | null> {
  const key = String(id);
  if (!key || key.includes("/") || key.includes(".")) return null;
  try {
    const direct = await db.ref(`workspaces/${ws}/meetings/${key}`).get();
    if (direct.exists()) return direct.val();
    if (!key.startsWith("mtg-")) {
      const prefixed = await db.ref(`workspaces/${ws}/meetings/mtg-${key}`).get();
      if (prefixed.exists()) return prefixed.val();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Does this action-item / meeting-attendee owner refer to this entity?
 *
 * Deliberately conservative: a dossier drives operator decisions, so a false
 * attribution is worse than a miss. A bare first name matches ("Rick", "Tom"
 * on an action item → the "Rick" / "Tom Baron" node), but a DIFFERENT full
 * name that merely shares a first name does not — "Bill Akman" must never
 * pick up "Bill Allen"'s commitments, and both exist in this workspace.
 */
function ownedBy(owner: unknown, node: NodeRecord): boolean {
  const o = String(owner ?? "").toLowerCase().trim();
  const name = String(node.name ?? "").toLowerCase().trim();
  if (!o || !name) return false;
  if (o === name) return true;
  // Full node name embedded in the owner string ("Tom Baron <tom@atlas>").
  if (o.includes(name)) return true;
  // Single-token owner that exactly equals one token of the node name.
  const ownerTokens = o.split(/[\s<>@.,;]+/).filter(Boolean);
  if (ownerTokens.length === 1 && ownerTokens[0].length >= 3) {
    return name.split(/\s+/).includes(ownerTokens[0]);
  }
  return false;
}

export const operatorData = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    secrets: [OPERATOR_API_TOKEN],
  },
  async (req, res): Promise<void> => {
    const log = createLogger({ source: "http_operatorData" });

    // --- auth: bearer token, constant-time ---
    //
    // GOTCHA (verified live 2026-08-05): the *.cloudfunctions.net front end
    // intercepts `Authorization: Bearer` and tries to verify it as a Google
    // IAM identity token, returning an HTML 401 before the request ever
    // reaches this handler. The function's direct *.run.app URL passes the
    // header through untouched, so Bearer works there. `X-Operator-Token`
    // (same shape as draftingFacts' x-bridge-key) is accepted as a fallback
    // so BOTH URLs are usable. See corsair-ops-log-v1.md.
    const header = String(req.get("authorization") ?? "");
    const presented =
      /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ||
      String(req.get("x-operator-token") ?? "").trim();
    const expected = OPERATOR_API_TOKEN.value() || "";
    if (!expected) {
      log.error("missing_secret");
      res.status(500).json({ error: "OPERATOR_API_TOKEN not configured." });
      return;
    }
    if (!tokenMatches(presented, expected)) {
      log.warn("unauthorized", { hasHeader: Boolean(header) });
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    // --- read-only: reject anything that isn't a read ---
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).json({ error: "Method not allowed. This endpoint is read-only." });
      return;
    }

    const ws = String(req.query.ws ?? "").trim();
    if (!ws || ws.includes("/") || ws.includes(".")) {
      res.status(400).json({ error: "ws (workspace id) is required." });
      return;
    }

    const nOf = (raw: unknown, dflt: number, cap: number): number => {
      const v = Number(raw);
      return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), cap) : dflt;
    };
    const commitCap = nOf(req.query.commitments, COMMITMENTS_CAP, 100);
    const signalCap = nOf(req.query.signals, SIGNALS_CAP, 50);
    const entityTerms = String(req.query.entities ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_ENTITIES);

    try {
      const wsRef = db.ref(`workspaces/${ws}`);
      const infoSnap = await wsRef.child("info").get();
      if (!infoSnap.exists()) {
        res.status(404).json({ error: `Workspace ${ws} not found.` });
        return;
      }

      const [commitSnap, briefSnap] = await Promise.all([
        wsRef.child("commitments").get(),
        wsRef.child("derivedViews/dailyBrief/latest").get(),
      ]);

      // --- commitments: open only, deadline-sorted then newest ---
      const commitRaw = commitSnap.val() || {};
      const openCommits = sortOpenCommitments(Object.values(commitRaw));
      const commitments = {
        openCount: openCommits.length,
        top: openCommits.slice(0, commitCap).map((c: any) => ({
          task: clean(c.task || c.title),
          owner: clean(c.owner),
          deadline: clean(c.deadline),
          priority: clean(c.priority) || "med",
          sourceMtgTitle: clean(c.sourceMtgTitle),
        })),
      };

      // --- signals: flatten the synthesized brief, rank by relevance ---
      const brief = briefSnap.val() || null;
      const allItems: any[] = [];
      const byCat = (brief && brief.itemsByCategory) || {};
      for (const cat of Object.keys(byCat)) {
        const arr = byCat[cat];
        if (Array.isArray(arr)) allItems.push(...arr);
      }
      allItems.sort((a, b) => (b?.relevance?.total ?? 0) - (a?.relevance?.total ?? 0));
      const signals = allItems.slice(0, signalCap).map((it: any) => ({
        title: clean(it.title),
        subtitle: clean(it.subtitle),
        source: clean(it.source),
        link: clean(it.link),
        total: it?.relevance?.total ?? 0,
        why: Array.isArray(it?.relevance?.whySurfaced)
          ? it.relevance.whySurfaced.map(clean)
          : [],
      }));

      // --- entities: dossiers, only when asked for ---
      const entities: any[] = [];
      if (entityTerms.length) {
        const nodesSnap = await wsRef.child("nodes").get();
        const allNodes = Object.values(nodesSnap.val() || {}) as NodeRecord[];
        const seen = new Set<string>();

        for (const term of entityTerms) {
          for (const node of matchNodes(term, allNodes)) {
            const nodeKey = String(node.id ?? node.name ?? "");
            if (!nodeKey || seen.has(nodeKey)) continue;
            seen.add(nodeKey);
            try {
              const ids = Array.isArray(node.meetings)
                ? node.meetings.slice(-MAX_MEETINGS_PER_ENTITY)
                : [];
              const loaded = (await Promise.all(ids.map((id) => loadMeeting(ws, id))))
                .filter(Boolean) as any[];
              // Newest last: sort by meta.date, falling back to ts.
              loaded.sort((a, b) => {
                const da = Date.parse(a?.meta?.date || a?.ts || 0) || 0;
                const db_ = Date.parse(b?.meta?.date || b?.ts || 0) || 0;
                return da - db_;
              });
              const last = loaded[loaded.length - 1];

              // Most recent stance for this person, from meeting intel.keyPeople.
              let stance = "";
              for (let i = loaded.length - 1; i >= 0 && !stance; i--) {
                const kp = loaded[i]?.intel?.keyPeople;
                if (!Array.isArray(kp)) continue;
                const hit = kp.find((p: any) => ownedBy(p?.name, node));
                if (hit && hit.stance) stance = clean(hit.stance);
              }

              // Open action items owed by this entity: workspace commitments
              // plus per-meeting action items, both matched on owner.
              const openActionItems: string[] = [];
              openCommits.forEach((c: any) => {
                if (ownedBy(c.owner, node)) {
                  openActionItems.push(
                    clean(c.task || c.title) + (c.deadline ? ` (due ${clean(c.deadline)})` : "")
                  );
                }
              });
              loaded.forEach((m: any) => {
                const items = m?.intel?.actionItems;
                if (!Array.isArray(items)) return;
                items.forEach((a: any) => {
                  if (a && ownedBy(a.owner, node)) openActionItems.push(clean(a.task));
                });
              });

              entities.push({
                name: clean(node.name),
                type: clean(node.type),
                org: clean(node.org),
                priority: typeof node.priority === "number" ? node.priority : null,
                meetings: ids.length,
                lastMeeting: last
                  ? { title: clean(last?.meta?.title), date: clean(last?.meta?.date) }
                  : null,
                stance,
                openActionItems: [...new Set(openActionItems)].filter(Boolean).slice(0, 12),
                notes: clean(node.notes).slice(0, 600),
              });
            } catch (err) {
              // Never let one bad entity take down the whole response.
              log.warn("entity_failed", { term, message: (err as Error).message });
            }
          }
        }
      }

      const workspace = { id: ws, name: clean(infoSnap.val()?.name) || ws };
      log.info("served", {
        workspace: ws,
        openCommitments: commitments.openCount,
        signals: signals.length,
        entities: entities.length,
      });

      res.set("Cache-Control", "no-store");
      res.status(200).json({
        workspace,
        generatedAt: Date.now(),
        commitments,
        signals,
        entities,
      });
    } catch (err) {
      const e = err as Error;
      log.error("threw", { workspace: ws, message: e.message });
      res.status(500).json({ error: "Internal error." });
    }
  }
);
