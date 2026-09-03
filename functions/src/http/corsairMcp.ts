// Corsair — corsairMcp: the corpus as a TOOL, not a destination.
//
// WHY THIS EXISTS.
// Today Corsair is a place you go. The relationship graph, the commitments and
// the meeting history are reachable only through an authenticated browser
// session, which is why the headless operator layer has been using Gmail as a
// PROXY for context Corsair already holds. `operatorData` fixed half of that
// with one fixed-shape GET; this finishes it. As an MCP server the corpus
// becomes a tool that any agent surface — a scheduled task, a coding session, a
// browser agent, a phone — can query natively, with the model choosing what to
// ask rather than us choosing in advance what to return.
//
// That is the difference between an assistant that has been handed a summary
// and one that can go and look.
//
// PROTOCOL: MCP revision 2026-07-28 — the STATELESS revision, which is why this
// fits Cloud Functions with no modification at all:
//   - No `initialize`/`notifications/initialized` handshake. Every request
//     carries its protocol version and client identity in `_meta`.
//   - No protocol sessions and no `Mcp-Session-Id`. Nothing to pin a caller to
//     an instance, so autoscaling and cold starts are invisible to the client.
//   - `server/discover` is MANDATORY: it advertises supported versions,
//     capabilities and identity.
//   - Every result carries `resultType` ("complete" here — this server never
//     needs a round trip back to the client).
//   - List results carry `ttlMs` + `cacheScope` so clients can cache the tool
//     list instead of re-fetching it every turn.
//   - `Mcp-Method` / `Mcp-Name` request headers are required on POST and are
//     validated against the JSON-RPC body (HeaderMismatchError, -32020).
//
// SECURITY POSTURE — read this before adding a tool.
// This server is READ-ONLY and has no write path. Not a disabled one, not a
// flagged one. That is deliberate and it is the whole safety argument: this
// system already runs the lethal trifecta (private data + untrusted content +
// outbound comms), and against adaptive attacks every published prompt-
// injection defence has been broken. A read-only tool surface cannot be turned
// into an action by an injected instruction, because there is no action to
// reach. Anything that mutates Corsair stays behind the app and the operator.
//
// Workspace isolation is enforced AT THE PROTOCOL BOUNDARY: every tool takes
// `workspace` as a REQUIRED argument, and `list_workspaces` exists so no caller
// ever has to hardcode an id. CLAUDE.md Rule 4, expressed as a schema instead
// of a convention.
//
// AUTH: the existing OPERATOR_API_TOKEN (v2 in Secret Manager), constant-time
// compared via the helper `operatorData` already exports. Deliberately NOT a
// second secret — one credential to rotate, one place it can leak from.
//
// Setup:
//   export { corsairMcp } from "./http/corsairMcp";   // in functions/src/index.ts
//   cd functions && npm run build
//   firebase deploy --only functions:corsairMcp
//
// ACCEPTANCE (define done before building — not the builder's say-so):
//   1. POST server/discover with a correct token → 200, protocolVersions
//      contains "2026-07-28", serverInfo present. No token → 401.
//   2. POST tools/list → 6 tools in a stable order, each with an inputSchema
//      whose `required` includes "workspace" (except list_workspaces), and a
//      result carrying ttlMs + cacheScope + resultType:"complete".
//   3. POST tools/call list_workspaces → the three live workspaces BY NAME.
//   4. POST tools/call corpus_health on Atlas → meetingCount 591±, and
//      datedness matching metrics/baseline-1777435779676-*.json for that day.
//      If those two numbers disagree, ONE of the two readers is wrong and the
//      disagreement is the finding — do not average them.
//   5. Mismatched Mcp-Method header → -32020. Unknown protocol version → -32022.

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db } from "../framework/rtdb";
import { createLogger } from "../framework/logger";
import { tokenMatches, clean, nOf, matchNodes } from "./operatorData";

const OPERATOR_API_TOKEN = defineSecret("OPERATOR_API_TOKEN");

const PROTOCOL_VERSION = "2026-07-28";
/** Accepted on the wire. Kept explicit so an unknown version is a loud -32022
 *  rather than a silent best-effort parse of a shape we do not understand. */
const SUPPORTED_VERSIONS = [PROTOCOL_VERSION];

const SERVER_INFO = { name: "corsair", title: "Corsair — Defense Capture OS", version: "1.0.0" };

/** _meta keys are namespaced by the spec. Written once, referenced everywhere,
 *  so a typo is a compile error rather than a silently-ignored field. */
const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

/** Error codes from the 2026-07-28 allocation policy. -32020..-32099 is the
 *  range reserved for the specification; do not invent codes in it. */
const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedProtocolVersion: -32022,
} as const;

/** Bounds. Every one of these exists so a single call cannot walk the whole
 *  corpus — an unbounded tool is a denial-of-service the caller writes for you. */
const LIMITS = {
  meetings: { dflt: 10, cap: 40 },
  commitments: { dflt: 20, cap: 60 },
  entityMeetings: 40,
  notesChars: 4000,
};

// ── tool surface ────────────────────────────────────────────────────────────
// Order is FIXED and deterministic: the spec asks for it so clients can cache
// the list and so prompt-cache hit rates stay high.

const WS_PROP = {
  workspace: { type: "string", description: "Workspace id. Required. Call list_workspaces first — never hardcode one." },
};

const TOOLS = [
  {
    name: "list_workspaces",
    title: "List workspaces",
    description:
      "List every Corsair workspace with its id and live name. Call this before any other tool. " +
      "Workspace ids are dynamic and a hardcoded id is how a job reads the wrong tenant.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "corpus_health",
    title: "Corpus health",
    description:
      "How trustworthy is this workspace's data right now: meeting count, days since the newest " +
      "record, live action items, and DATEDNESS — the share of action items carrying a deadline the " +
      "system can actually read. Datedness is the gate metric: every commitment number is measured " +
      "over that slice only. Call this before quoting any commitment figure.",
    inputSchema: { type: "object", properties: { ...WS_PROP }, required: ["workspace"] },
  },
  {
    name: "search_meetings",
    title: "Search meetings",
    description:
      "Full-text search over meeting titles, attendees and summaries. Returns metadata and a short " +
      "summary, never the full transcript — call get_meeting for one record's detail.",
    inputSchema: {
      type: "object",
      properties: {
        ...WS_PROP,
        query: { type: "string", description: "Case-insensitive substring. Empty returns the most recent." },
        limit: { type: "number", description: `Max results, default ${LIMITS.meetings.dflt}, cap ${LIMITS.meetings.cap}.` },
      },
      required: ["workspace"],
    },
  },
  {
    name: "get_meeting",
    title: "Get one meeting",
    description:
      "Full structured intelligence for one meeting: summary, decisions, action items, risks, people, " +
      "companies. Meeting ids come from search_meetings.",
    inputSchema: {
      type: "object",
      properties: { ...WS_PROP, id: { type: "string", description: "Meeting record id." } },
      required: ["workspace", "id"],
    },
  },
  {
    name: "list_commitments",
    title: "List open commitments",
    description:
      "Open action items across the workspace, newest first, each tagged with whether its deadline is " +
      "machine-readable. IMPORTANT: most action items carry no readable deadline, so any filter on " +
      "deadline silently hides the majority. This tool returns undated items too, and says so.",
    inputSchema: {
      type: "object",
      properties: {
        ...WS_PROP,
        limit: { type: "number", description: `Max results, default ${LIMITS.commitments.dflt}, cap ${LIMITS.commitments.cap}.` },
        onlyDated: { type: "boolean", description: "Restrict to items with a strict ISO deadline. Default false." },
      },
      required: ["workspace"],
    },
  },
  {
    name: "get_entity_360",
    title: "Entity dossier",
    description:
      "Everything known about one person or company: node record, meeting history, action items owed, " +
      "and the notes that mention them. This is the half of the corpus no capture platform on the " +
      "market instruments — what was said, not what was published.",
    inputSchema: {
      type: "object",
      properties: { ...WS_PROP, name: { type: "string", description: "Person or company. Exact match wins; substring falls back." } },
      required: ["workspace", "name"],
    },
  },
] as const;

// ── helpers ─────────────────────────────────────────────────────────────────

const ok = (result: Record<string, unknown>) => ({
  ...result,
  resultType: "complete" as const,
  _meta: { [META.serverInfo]: SERVER_INFO },
});

const textResult = (payload: unknown) =>
  ok({
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
    isError: false,
  });

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

/** Strict-ISO only, matching the shipped archive selector's contract. Free text
 *  like "Before 2026-09-17" is a bound, not a due date, and is never guessed at. */
const isStrictISO = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim());

/** The four record-key timestamp formats measured against the live corpus on
 *  2026-08-31 (591 Atlas keys). `occurred` is true meeting time and is only
 *  available on calendar-derived keys; `created` is when the record was written.
 *  They are NOT the same quantity and are reported separately, never blended. */
function recordTime(key: string): { ms: number; basis: "created" | "occurred" } | null {
  const s = String(key);
  const from = Date.parse("2024-01-01T00:00:00Z");
  const to = Date.now() + 7 * 86400000;
  const sane = (t: number) => (Number.isFinite(t) && t >= from && t <= to ? t : null);

  const cal = /_(\d{8})T(\d{6})Z$/.exec(s);
  if (cal) {
    const [, d, t] = cal;
    const ms = sane(Date.parse(
      `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`
    ));
    if (ms !== null) return { ms, basis: "occurred" };
  }
  const auto = /^mtg-auto-([0-9a-f]{16})$/.exec(s);
  if (auto) {
    const ms = sane(parseInt(auto[1].slice(0, 11), 16));
    if (ms !== null) return { ms, basis: "created" };
  }
  const digits = /^(?:mtg-)?(\d{13})(?:-|$)/.exec(s);
  if (digits) {
    const ms = sane(Number(digits[1]));
    if (ms !== null) return { ms, basis: "created" };
  }
  return null;
}

async function workspaceName(ws: string): Promise<string | null> {
  const snap = await db.ref(`workspaces/${ws}/info/name`).get();
  return snap.exists() ? String(snap.val()) : null;
}

// ── tool implementations ────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, any>): Promise<unknown> {
  if (name === "list_workspaces") {
    const snap = await db.ref("workspaces").get();
    const out: Array<{ id: string; name: string }> = [];
    // Annotated rather than inferred: `db` is loosely typed in the framework
    // module, and an implicit any here compiles locally and fails the repo's
    // strict build. Explicit is free.
    snap.forEach((child: any) => {
      out.push({ id: String(child.key), name: clean(child.child("info/name").val()) || "(unnamed)" });
      return false; // false = keep iterating
    });
    return { workspaces: out.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  const ws = String(args.workspace ?? "").trim();
  if (!ws || ws.includes("/") || ws.includes(".")) throw Object.assign(new Error("workspace is required"), { code: ERR.invalidParams });
  const wsName = await workspaceName(ws);
  if (wsName === null) throw Object.assign(new Error(`Workspace ${ws} not found.`), { code: ERR.invalidParams });

  const meetingsSnap = await db.ref(`workspaces/${ws}/meetings`).get();
  const meetings: Record<string, any> = meetingsSnap.exists() ? meetingsSnap.val() : {};
  const keys = Object.keys(meetings);

  if (name === "corpus_health") {
    let live = 0, dated = 0, newest: number | null = null;
    const basis: Record<string, number> = {};
    for (const k of keys) {
      const rt = recordTime(k);
      if (rt) {
        basis[rt.basis] = (basis[rt.basis] || 0) + 1;
        if (newest === null || rt.ms > newest) newest = rt.ms;
      }
      const list = meetings[k]?.intel?.actionItems;
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (a?.archivedAt) continue;
        live++;
        if (isStrictISO(a?.deadline)) dated++;
      }
    }
    return {
      workspace: ws,
      workspaceName: wsName,
      meetingCount: keys.length,
      daysSinceNewestRecord: newest === null ? null : Math.floor((Date.now() - newest) / 86400000),
      liveActionItems: live,
      datedActionItems: dated,
      datednessPct: live === 0 ? null : Math.round((dated / live) * 1000) / 10,
      recordTimeBasis: basis,
      caution:
        "datednessPct is the gate metric. Any commitment figure is measured over the dated slice only; " +
        "quoting one without this number describes a minority of reality.",
    };
  }

  if (name === "search_meetings") {
    const q = clean(args.query).toLowerCase();
    const limit = nOf(args.limit, LIMITS.meetings.dflt, LIMITS.meetings.cap);
    const rows = keys.map((k) => {
      const m = meetings[k] || {};
      const rt = recordTime(k);
      return {
        id: k,
        title: clean(m?.meta?.title),
        date: clean(m?.meta?.date),
        attendees: clean(m?.meta?.attendees),
        summary: clean(m?.intel?.summary).slice(0, 400),
        recordTimeMs: rt?.ms ?? null,
        recordTimeBasis: rt?.basis ?? null,
        actionItemCount: Array.isArray(m?.intel?.actionItems) ? m.intel.actionItems.length : 0,
      };
    });
    const hits = q
      ? rows.filter((r) => `${r.title} ${r.attendees} ${r.summary}`.toLowerCase().includes(q))
      : rows;
    hits.sort((a, b) => (b.recordTimeMs ?? 0) - (a.recordTimeMs ?? 0));
    return {
      workspaceName: wsName,
      matched: hits.length,
      returned: Math.min(hits.length, limit),
      note: "meta.date is the date the meeting was LOGGED, not when it happened. Sort by recordTimeMs.",
      meetings: hits.slice(0, limit),
    };
  }

  if (name === "get_meeting") {
    const id = String(args.id ?? "").trim();
    if (!id || id.includes("/") || id.includes(".")) throw Object.assign(new Error("id is required"), { code: ERR.invalidParams });
    const m = meetings[id] ?? meetings[`mtg-${id}`];
    if (!m) throw Object.assign(new Error(`Meeting ${id} not found in ${wsName}.`), { code: ERR.invalidParams });
    const rt = recordTime(id);
    return {
      workspaceName: wsName,
      id,
      recordTimeMs: rt?.ms ?? null,
      recordTimeBasis: rt?.basis ?? null,
      meta: m.meta ?? null,
      intel: m.intel ?? null,
      // Top-level field, verified against the live schema 2026-08-31. v1 read
      // `intel.notes`, which exists on no record, so every get_meeting silently
      // returned an empty transcript. Present only on hand-logged meetings;
      // auto-captured calendar stubs never had one.
      notes: clean(m?.notes).slice(0, LIMITS.notesChars),
      hasSourceNotes: String(m?.notes ?? "").trim().length > 0,
    };
  }

  if (name === "list_commitments") {
    const limit = nOf(args.limit, LIMITS.commitments.dflt, LIMITS.commitments.cap);
    const onlyDated = args.onlyDated === true;
    const rows: any[] = [];
    let undatedTotal = 0;
    for (const k of keys) {
      const list = meetings[k]?.intel?.actionItems;
      if (!Array.isArray(list)) continue;
      const rt = recordTime(k);
      list.forEach((a: any, i: number) => {
        if (!a || a.archivedAt) return;
        const iso = isStrictISO(a.deadline);
        if (!iso) undatedTotal++;
        if (onlyDated && !iso) return;
        rows.push({
          path: `workspaces/${ws}/meetings/${k}/intel/actionItems/${i}`,
          task: clean(a.task),
          owner: clean(a.owner),
          priority: clean(a.priority),
          deadline: clean(a.deadline),
          deadlineIsMachineReadable: iso,
          sourceMeeting: clean(meetings[k]?.meta?.title),
          recordTimeMs: rt?.ms ?? null,
        });
      });
    }
    rows.sort((a, b) => (b.recordTimeMs ?? 0) - (a.recordTimeMs ?? 0));
    return {
      workspaceName: wsName,
      total: rows.length,
      undatedTotal,
      returned: Math.min(rows.length, limit),
      caution: onlyDated
        ? "onlyDated=true — this EXCLUDES the majority of open commitments. Say so when you quote a count."
        : "Includes undated items deliberately. deadlineIsMachineReadable tells you which can be tracked.",
      commitments: rows.slice(0, limit),
    };
  }

  if (name === "get_entity_360") {
    const term = clean(args.name);
    if (!term) throw Object.assign(new Error("name is required"), { code: ERR.invalidParams });
    const nodesSnap = await db.ref(`workspaces/${ws}/nodes`).get();
    const nodes: any[] = nodesSnap.exists() ? Object.values(nodesSnap.val()) : [];
    const matched = matchNodes(term, nodes).slice(0, 3);
    const t = term.toLowerCase();

    const mentions = keys
      .map((k) => ({ k, m: meetings[k] || {}, rt: recordTime(k) }))
      .filter(({ m }) =>
        `${m?.meta?.title ?? ""} ${m?.meta?.attendees ?? ""} ${m?.intel?.summary ?? ""}`.toLowerCase().includes(t)
      )
      .sort((a, b) => (b.rt?.ms ?? 0) - (a.rt?.ms ?? 0))
      .slice(0, LIMITS.entityMeetings);

    const owed: any[] = [];
    for (const k of keys) {
      const list = meetings[k]?.intel?.actionItems;
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (!a || a.archivedAt) continue;
        if (String(a.owner ?? "").toLowerCase().includes(t)) {
          owed.push({ task: clean(a.task), deadline: clean(a.deadline), deadlineIsMachineReadable: isStrictISO(a.deadline), sourceMeeting: clean(meetings[k]?.meta?.title) });
        }
      }
    }

    return {
      workspaceName: wsName,
      term,
      nodes: matched.map((n) => ({ name: clean(n.name), type: clean(n.type), org: clean(n.org), role: clean(n.role), priority: n.priority ?? null, notes: clean(n.notes).slice(0, 1200) })),
      meetingMentions: mentions.map(({ k, m, rt }) => ({
        id: k,
        title: clean(m?.meta?.title),
        recordTimeMs: rt?.ms ?? null,
        summary: clean(m?.intel?.summary).slice(0, 500),
      })),
      actionItemsOwed: owed,
      caution: matched.length === 0
        ? "No graph node matched. Meeting mentions below are a text search only — absence of a node is not absence of the person."
        : undefined,
    };
  }

  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: ERR.methodNotFound });
}

// ── handler ─────────────────────────────────────────────────────────────────

export const corsairMcp = onRequest(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120, secrets: [OPERATOR_API_TOKEN] },
  async (req, res) => {
    const log = createLogger({ source: "http_corsairMcp" });

    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only. Streamable HTTP; the GET endpoint was removed in 2026-07-28." });
      return;
    }

    const expected = OPERATOR_API_TOKEN.value();
    if (!expected) {
      log.error("missing_secret");
      res.status(500).json({ error: "OPERATOR_API_TOKEN not configured." });
      return;
    }
    const header = String(req.headers.authorization ?? "");
    if (!tokenMatches(header.replace(/^Bearer\s+/i, "").trim(), expected)) {
      log.warn("unauthorized", { hasHeader: Boolean(header) });
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const body: any = req.body;
    if (!body || typeof body !== "object" || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      res.status(200).json(rpcError(body?.id, ERR.invalidRequest, "Expected a JSON-RPC 2.0 request object."));
      return;
    }
    const { id, method, params } = body;

    // Routable headers are required on POST and MUST agree with the body.
    // A gateway that routed on the header while the body said something else is
    // exactly the class of bug this check exists to make impossible.
    const hdrMethod = String(req.headers["mcp-method"] ?? "");
    if (hdrMethod && hdrMethod !== method) {
      res.status(200).json(rpcError(id, ERR.headerMismatch, `Mcp-Method header "${hdrMethod}" does not match body method "${method}".`));
      return;
    }

    const claimed = params?._meta?.[META.protocolVersion] ?? body?._meta?.[META.protocolVersion];
    if (claimed && !SUPPORTED_VERSIONS.includes(String(claimed))) {
      res.status(200).json(rpcError(id, ERR.unsupportedProtocolVersion,
        `Unsupported protocol version "${claimed}".`, { supported: SUPPORTED_VERSIONS }));
      return;
    }

    try {
      if (method === "server/discover") {
        res.status(200).json({ jsonrpc: "2.0", id, result: ok({
          protocolVersions: SUPPORTED_VERSIONS,
          serverInfo: SERVER_INFO,
          capabilities: { tools: { listChanged: false } },
          instructions:
            "Corsair is a defense-capture corpus of MEETING intelligence — what was said, not what was " +
            "published. Always call list_workspaces first; workspace ids are dynamic. Call corpus_health " +
            "before quoting any commitment number: most action items carry no machine-readable deadline, " +
            "so a deadline-filtered count silently hides the majority. Read-only; there is no write path.",
        })});
        return;
      }

      if (method === "tools/list") {
        res.status(200).json({ jsonrpc: "2.0", id, result: ok({
          tools: TOOLS,
          ttlMs: 300000,
          cacheScope: "private",
        })});
        return;
      }

      if (method === "tools/call") {
        const toolName = String(params?.name ?? "");
        if (!TOOLS.some((t) => t.name === toolName)) {
          res.status(200).json(rpcError(id, ERR.methodNotFound, `Unknown tool: ${toolName}`));
          return;
        }
        const hdrName = String(req.headers["mcp-name"] ?? "");
        if (hdrName && hdrName !== toolName) {
          res.status(200).json(rpcError(id, ERR.headerMismatch, `Mcp-Name header "${hdrName}" does not match tool "${toolName}".`));
          return;
        }
        const started = Date.now();
        const payload = await callTool(toolName, (params?.arguments ?? {}) as Record<string, any>);
        log.info("tool_called", { tool: toolName, ms: Date.now() - started });
        res.status(200).json({ jsonrpc: "2.0", id, result: textResult(payload) });
        return;
      }

      res.status(200).json(rpcError(id, ERR.methodNotFound, `Unknown method: ${method}`));
    } catch (e: any) {
      const code = typeof e?.code === "number" ? e.code : ERR.internal;
      // Loud in the log, generic on the wire — an error message is an oracle.
      log.error("threw", { method, message: e?.message });
      res.status(200).json(rpcError(id, code, code === ERR.internal ? "Internal error." : String(e?.message ?? "Error")));
    }
  }
);
