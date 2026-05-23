// Corsair P2.14 — Gmail API thin wrapper
//
// Fetches messages matching a user-defined query, filtering to messages newer
// than the last sync (incremental). Returns fully-hydrated messages with
// payload (headers + body parts).

import { google, gmail_v1 } from "googleapis";
import { clientForAccessToken } from "./oauth";

export interface FetchGmailOptions {
  /** Gmail search query, e.g. "has:attachment" or "label:capture". */
  query: string;
  /** ISO timestamp of the most recent message captured last sync. */
  sinceIso: string | null;
  /** Max messages to fetch per run. Default 50 — Gmail's free quota is generous. */
  maxResults?: number;
}

export interface FetchedGmailMessage {
  id: string;
  threadId: string;
  headers: Record<string, string>;
  body: string;
  raw: gmail_v1.Schema$Message;
}

/**
 * Fetch Gmail messages. Uses `after:<unixSeconds>` if sinceIso is provided so
 * subsequent runs only pull new mail. Bodies are extracted to plain text via
 * a recursive payload walker.
 */
export async function fetchGmailMessages(
  accessToken: string,
  opts: FetchGmailOptions
): Promise<FetchedGmailMessage[]> {
  const auth = clientForAccessToken(accessToken);
  const gmail = google.gmail({ version: "v1", auth });

  const q = opts.sinceIso
    ? `${opts.query} after:${Math.floor(new Date(opts.sinceIso).getTime() / 1000)}`
    : opts.query;

  const list = await gmail.users.messages.list({
    userId: "me",
    q,
    maxResults: opts.maxResults ?? 50,
  });
  const stubs = list.data.messages ?? [];

  // Fetch full bodies sequentially to stay polite under Gmail's per-user quota.
  // For larger sweeps the caller can chunk and parallelize externally.
  const out: FetchedGmailMessage[] = [];
  for (const stub of stubs) {
    if (!stub.id) continue;
    const full = await gmail.users.messages.get({
      userId: "me",
      id: stub.id,
      format: "full",
    });
    const msg = full.data;
    const headers: Record<string, string> = {};
    for (const h of msg.payload?.headers ?? []) {
      if (h.name && h.value) headers[h.name] = h.value;
    }
    out.push({
      id: msg.id ?? stub.id,
      threadId: msg.threadId ?? "",
      headers,
      body: extractPlainText(msg.payload),
      raw: msg,
    });
  }
  return out;
}

/**
 * Recursive payload walker. Gmail message bodies live under
 * payload.body.data (base64url) or, for multipart, payload.parts[].body.data.
 * We prefer text/plain; fall back to text/html stripped of tags.
 */
function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const collected: string[] = [];
  walk(payload, collected);
  return collected.join("\n\n").trim();
}

function walk(part: gmail_v1.Schema$MessagePart, out: string[]): void {
  if (part.mimeType === "text/plain" && part.body?.data) {
    out.push(decodeB64Url(part.body.data));
  } else if (part.mimeType === "text/html" && part.body?.data) {
    out.push(stripHtml(decodeB64Url(part.body.data)));
  }
  for (const sub of part.parts ?? []) {
    walk(sub, out);
  }
}

function decodeB64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
