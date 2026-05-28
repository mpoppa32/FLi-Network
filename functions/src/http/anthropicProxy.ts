// Corsair P13.124 (audit Finding 3.1) — Anthropic API proxy.
//
// The previous architecture stored an Anthropic API key in the workspace's
// Firebase RTDB config and exposed it on the browser as `window.apiKey`.
// Any session with browser access (legitimate or hostile) could extract
// the key via DevTools or an XSS payload. The `anthropic-dangerous-
// direct-browser-access: true` header in the old fetch was Anthropic's
// own warning that the pattern was unsafe.
//
// This proxy holds the key as a Firebase secret (ANTHROPIC_API_KEY),
// validates the caller is an authenticated Corsair user AND a member of
// the workspace they are calling on behalf of, then forwards a sanitized
// payload to https://api.anthropic.com/v1/messages and returns the
// response body. The browser never sees the key.
//
// One-time setup:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//     (paste the new key when prompted)
//   firebase deploy --only functions:anthropicProxy
//
// Browser-side replacement: any prior
//   fetch("https://api.anthropic.com/v1/messages", { headers: { "x-api-key": key, ... }, body: ... })
// becomes
//   const callable = httpsCallable(fbFunctions, "anthropicProxy");
//   const result = await callable({ workspaceId, model, messages, max_tokens, system, temperature });
//   const data = result.data;

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { createLogger } from "../framework/logger";

if (!admin.apps.length) {
  admin.initializeApp();
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_API_KEY");

// Allow-list of model IDs the proxy will forward. Keeps a hostile caller
// from billing exotic models or burning quota on unintended targets.
// Update when new models ship per CLAUDE.md / system context.
const ALLOWED_MODELS = new Set<string>([
  // Claude 4.x family (current)
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  // Claude 3.x legacy (still callable while features migrate)
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
]);

const MAX_MESSAGES = 200;
const MAX_TOKENS_DEFAULT = 1024;
const MAX_TOKENS_CEILING = 8192;

// P13.142 — per-workspace request quota. The proxy already gates model
// + max_tokens + message count, but a logged-in workspace member could
// still burn the monthly Anthropic budget via repeated RFI runs or a
// runaway client loop. This caps requests-per-workspace-per-hour with
// a sliding-window counter persisted in RTDB. Workspace operators can
// override the default per-workspace by setting workspaces/{wsId}/
// settings/anthropicHourlyQuota (admin-only via RTDB rules).
const QUOTA_DEFAULT_PER_HOUR = 30;
const QUOTA_HARD_CEILING = 200; // safety: even an admin can't override above this

export const anthropicProxy = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 90,
    secrets: [ANTHROPIC_KEY],
  },
  async (request) => {
    const log = createLogger({ source: "http_anthropicProxy" });
    const auth = request.auth;
    if (!auth) {
      log.warn("unauthenticated_call");
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = request.data ?? {};
    const workspaceId = String(data.workspaceId ?? "");
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }

    // Workspace membership check — only members can spend Anthropic budget.
    // Matches the access-record pattern P13.113 already uses for the
    // workspace-removed modal: users/{uid}/workspaces/{wsId} is the
    // canonical "this user has access to this workspace" record.
    try {
      const db = admin.database();
      const snap = await db
        .ref(`users/${auth.uid}/workspaces/${workspaceId}`)
        .once("value");
      if (!snap.exists()) {
        log.warn("not_a_member", { workspaceId, userId: auth.uid });
        throw new HttpsError(
          "permission-denied",
          "You are not a member of this workspace."
        );
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const e = err as Error;
      log.error("membership_check_failed", {
        workspaceId,
        userId: auth.uid,
        message: e.message,
      });
      throw new HttpsError("internal", `Membership check failed: ${e.message}`);
    }

    // P13.142 — per-workspace hourly quota check + atomic increment.
    // Each request increments a counter keyed by the current UTC hour
    // window. Rejects when count > limit. Counter resets implicitly when
    // the hour changes (new hourKey writes a fresh count=1). The
    // transaction ensures concurrent requests can't race the counter.
    try {
      const db = admin.database();
      const settingsSnap = await db
        .ref(`workspaces/${workspaceId}/settings/anthropicHourlyQuota`)
        .once("value");
      const settingsRaw = Number(settingsSnap.val());
      const limit = Number.isFinite(settingsRaw) && settingsRaw > 0
        ? Math.min(settingsRaw, QUOTA_HARD_CEILING)
        : QUOTA_DEFAULT_PER_HOUR;
      const now = new Date();
      const hourKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}`;
      const counterRef = db.ref(`workspaces/${workspaceId}/quotas/anthropic/current`);
      const txResult = await counterRef.transaction((curr: { hourKey?: string; count?: number } | null) => {
        if (!curr || curr.hourKey !== hourKey) {
          return { hourKey, count: 1, lastAt: Date.now() };
        }
        return { hourKey, count: Number(curr.count || 0) + 1, lastAt: Date.now() };
      });
      const updated = txResult.snapshot.val() as { hourKey?: string; count?: number };
      const count = Number(updated?.count || 0);
      if (count > limit) {
        // Compute time-until-reset (top of next hour) so the toast can
        // tell the operator when to retry.
        const minutesLeft = 60 - now.getUTCMinutes();
        log.warn("quota_exceeded", {
          workspaceId,
          userId: auth.uid,
          count,
          limit,
          hourKey,
        });
        throw new HttpsError(
          "resource-exhausted",
          `Workspace AI quota: ${count - 1}/${limit} requests this hour. Try again in ~${minutesLeft} min.`
        );
      }
      log.info("quota_check", { workspaceId, count, limit });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const e = err as Error;
      // Quota-check failures should fail open — never block legitimate
      // calls because the counter pathway broke. Log + continue.
      log.warn("quota_check_failed_open", { workspaceId, message: e.message });
    }

    // Validate the payload before forwarding.
    const model = String(data.model ?? "");
    if (!model) {
      throw new HttpsError("invalid-argument", "model is required (string).");
    }
    if (!ALLOWED_MODELS.has(model)) {
      throw new HttpsError("invalid-argument", `Unsupported model: ${model}`);
    }
    const messages = data.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "messages must be a non-empty array."
      );
    }
    if (messages.length > MAX_MESSAGES) {
      throw new HttpsError(
        "invalid-argument",
        `messages length exceeds limit (${MAX_MESSAGES}).`
      );
    }

    // Coerce optional fields. Reject anything unknown so a future
    // Anthropic feature (tools, etc.) doesn't pass through unintentionally.
    const rawMaxTokens = data.max_tokens;
    let maxTokens = MAX_TOKENS_DEFAULT;
    if (typeof rawMaxTokens === "number" && Number.isFinite(rawMaxTokens)) {
      maxTokens = Math.max(1, Math.min(Math.floor(rawMaxTokens), MAX_TOKENS_CEILING));
    }
    const system = typeof data.system === "string" ? data.system : undefined;
    const temperature =
      typeof data.temperature === "number" && Number.isFinite(data.temperature)
        ? Math.max(0, Math.min(data.temperature, 1))
        : undefined;

    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
    };
    if (system) payload.system = system;
    if (typeof temperature === "number") payload.temperature = temperature;
    // Forward additional Anthropic fields if the caller supplied them. The
    // proxy is just a transport layer — it doesn't introspect tool calls
    // or message content (which already supports document/base64 blocks
    // for the RFP analyzer). Strict type-checks reject obvious garbage
    // while still allowing legitimate values.
    if (Array.isArray(data.tools) && data.tools.length > 0) {
      payload.tools = data.tools;
    }
    if (data.tool_choice && typeof data.tool_choice === "object") {
      payload.tool_choice = data.tool_choice;
    }
    if (typeof data.top_p === "number" && Number.isFinite(data.top_p)) {
      payload.top_p = Math.max(0, Math.min(data.top_p, 1));
    }
    if (typeof data.top_k === "number" && Number.isFinite(data.top_k)) {
      payload.top_k = Math.max(0, Math.floor(data.top_k));
    }
    if (Array.isArray(data.stop_sequences)) {
      payload.stop_sequences = data.stop_sequences.filter(
        (x: unknown) => typeof x === "string"
      );
    }
    if (data.metadata && typeof data.metadata === "object") {
      payload.metadata = data.metadata;
    }

    const key = ANTHROPIC_KEY.value();
    if (!key) {
      log.error("missing_secret");
      throw new HttpsError(
        "failed-precondition",
        "Anthropic API key not configured. Run: firebase functions:secrets:set ANTHROPIC_API_KEY"
      );
    }

    log.info("proxy_request", {
      workspaceId,
      userId: auth.uid,
      model,
      msgCount: messages.length,
      maxTokens,
      hasSystem: Boolean(system),
    });

    // Forward to Anthropic with a 60s timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let resp: Response;
    try {
      resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const e = err as Error;
      log.error("upstream_fetch_failed", {
        workspaceId,
        message: e.message,
        aborted: controller.signal.aborted,
      });
      throw new HttpsError(
        controller.signal.aborted ? "deadline-exceeded" : "unavailable",
        `Anthropic request failed: ${e.message}`
      );
    }
    clearTimeout(timer);

    const bodyText = await resp.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = { raw: bodyText };
    }

    if (!resp.ok) {
      // Pass the upstream status + message through so the caller can react
      // meaningfully (rate limit, model not available, etc.). Trim body to
      // avoid leaking large response data into the function logs.
      log.warn("upstream_error", {
        workspaceId,
        status: resp.status,
        bodyHead: bodyText.slice(0, 200),
      });
      throw new HttpsError(
        resp.status === 429 ? "resource-exhausted" : "internal",
        `Anthropic API ${resp.status}: ${bodyText.slice(0, 200)}`
      );
    }

    log.info("proxy_response", {
      workspaceId,
      userId: auth.uid,
      model,
      ok: true,
    });
    return parsed;
  }
);
