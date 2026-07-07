// Corsair — Slack Web API reader (build C). Read-only: never posts.
// Uses the bot token (SLACK_BOT_TOKEN). The bot must be a member of each channel.

const API = "https://slack.com/api/";

interface SlackResp {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
  [k: string]: unknown;
}

async function slackGet(token: string, method: string, params: Record<string, string>): Promise<SlackResp> {
  const url = API + method + "?" + new URLSearchParams(params).toString();
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const body = (await res.json()) as SlackResp;
  if (!body.ok) throw new Error(`slack ${method}: ${body.error || res.status}`);
  return body;
}

export interface SlackMessage {
  channel: string; // channel name (no #)
  ts: string;      // slack timestamp — also the stable id + sort key
  atMs: number;    // ts as epoch ms
  user: string;    // resolved display name (or raw id / "bot")
  text: string;
  subtype: string;
  fileNames: string[];
}

/** All channels the bot can see, name(lowercased) -> id. Paginates. */
export async function listChannels(token: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let cursor = "";
  do {
    const params: Record<string, string> = {
      types: "public_channel,private_channel",
      limit: "1000",
      exclude_archived: "true",
    };
    if (cursor) params.cursor = cursor;
    const r = await slackGet(token, "conversations.list", params);
    for (const c of (r.channels as Array<Record<string, unknown>>) || []) {
      if (c && c.name) out[String(c.name).toLowerCase()] = String(c.id);
    }
    cursor = r.response_metadata?.next_cursor || "";
  } while (cursor);
  return out;
}

/** Slack user id -> display name, for message authors. Paginates. */
export async function listUsers(token: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let cursor = "";
  do {
    const params: Record<string, string> = { limit: "500" };
    if (cursor) params.cursor = cursor;
    const r = await slackGet(token, "users.list", params);
    for (const u of (r.members as Array<Record<string, any>>) || []) {
      if (!u || !u.id) continue;
      out[u.id] =
        (u.profile && (u.profile.display_name || u.profile.real_name)) ||
        u.real_name || u.name || u.id;
    }
    cursor = r.response_metadata?.next_cursor || "";
  } while (cursor);
  return out;
}

/** Recent raw messages in a channel since `oldestUnix` (epoch seconds). */
export async function channelHistory(token: string, channelId: string, oldestUnix: number): Promise<Array<Record<string, any>>> {
  const r = await slackGet(token, "conversations.history", {
    channel: channelId,
    oldest: String(oldestUnix),
    limit: "100",
  });
  return (r.messages as Array<Record<string, any>>) || [];
}

/** Normalize a raw Slack message into our stored shape. */
export function normalizeMessage(
  raw: Record<string, any>,
  channelName: string,
  users: Record<string, string>
): SlackMessage {
  const ts = String(raw.ts || "");
  const files = Array.isArray(raw.files) ? raw.files : [];
  return {
    channel: channelName,
    ts,
    atMs: Math.round(parseFloat(ts) * 1000) || 0,
    user: users[raw.user] || raw.username || (raw.bot_id ? "bot" : String(raw.user || "unknown")),
    text: String(raw.text || ""),
    subtype: String(raw.subtype || ""),
    fileNames: files.map((f: Record<string, unknown>) => String(f.name || f.title || "file")),
  };
}
