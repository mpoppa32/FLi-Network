// Corsair P2.14 — Gmail/Calendar → pendingCapture shape
//
// The exact target schema is verified against the live renderCaptureView
// (FLiIntel.html:35244) and _approveCapture (FLiIntel.html:35304). See
// docs/p2.14-gmail-calendar-plan.md Phase 2 for the full shape contract.
//
// Critical invariants:
//  - `source` MUST be the literal 'gmail-auto' or 'gcal-auto'. The UI
//    switches on these strings for icon + color.
//  - The RTDB key under workspaces/{wsId}/pendingCapture/{itemId} MUST
//    equal entry.id (because _approveCapture does
//    `pendingCapture.find(p => p.id === itemId)`).
//  - meta.{title, date, attendees} are the fields the UI reads first;
//    fromName is the fallback if meta is missing.

import { FetchedGmailMessage } from "./gmailClient";
import { FetchedCalendarEvent } from "./calendarClient";

export interface PendingCaptureAttendee {
  name: string;
  email: string;
}

export interface PendingCaptureEntry {
  id: string;
  source: "gmail-auto" | "gcal-auto";
  ts: number;
  fromName: string;
  meta: {
    title: string;
    date: string; // YYYY-MM-DD
    type: string;
    att: string; // attendees CSV — UI uses this OR meta.attendees
    attendees: PendingCaptureAttendee[];
    dur?: string;
  };
  intel: {
    summary: string;
    keyPeople: unknown[];
    actionItems: unknown[];
    risks: unknown[];
    commitments: unknown[];
  };
  matchedNodeId: string | null;
  oppId: string | null;
  oppName: string | null;
}

const EMAIL_NAME_RE = /^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/;

/**
 * Parse a single RFC 5322 address into { name, email }. Falls back to using
 * the address as both name and email when no display-name component exists.
 */
function parseAddress(s: string): PendingCaptureAttendee {
  const m = s.match(EMAIL_NAME_RE);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const email = s.trim().toLowerCase();
  return { name: email, email };
}

function parseAddressList(s: string): PendingCaptureAttendee[] {
  if (!s) return [];
  return s
    .split(/,(?![^<]*>)/) // split on commas not inside angle brackets
    .map((x) => x.trim())
    .filter(Boolean)
    .map(parseAddress);
}

function isoDateYMD(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
}

export function gmailToPendingCapture(msg: FetchedGmailMessage): PendingCaptureEntry {
  const subject = msg.headers["Subject"] ?? "";
  const from = msg.headers["From"] ?? "";
  const to = msg.headers["To"] ?? "";
  const cc = msg.headers["Cc"] ?? "";
  const dateHdr = msg.headers["Date"] ?? "";
  const ts = dateHdr ? Date.parse(dateHdr) : Date.now();
  const fromAddr = from ? parseAddress(from) : { name: "", email: "" };
  const attendees = [
    ...parseAddressList(from),
    ...parseAddressList(to),
    ...parseAddressList(cc),
  ];
  // Dedup by lowercased email
  const seen = new Set<string>();
  const dedupedAttendees: PendingCaptureAttendee[] = [];
  for (const a of attendees) {
    if (!a.email || seen.has(a.email)) continue;
    seen.add(a.email);
    dedupedAttendees.push(a);
  }
  return {
    id: "gmail-auto-" + msg.id,
    source: "gmail-auto",
    ts,
    fromName: fromAddr.name,
    meta: {
      title: subject || "(no subject)",
      date: isoDateYMD(ts),
      type: "Auto-Capture",
      att: dedupedAttendees.map((a) => a.name || a.email).join(", "),
      attendees: dedupedAttendees,
    },
    intel: {
      summary: msg.body.slice(0, 4000),
      keyPeople: [],
      actionItems: [],
      risks: [],
      commitments: [],
    },
    matchedNodeId: null,
    oppId: null,
    oppName: null,
  };
}

export function calendarEventToPendingCapture(
  ev: FetchedCalendarEvent
): PendingCaptureEntry {
  const e = ev.raw;
  const start = e.start?.dateTime ?? e.start?.date ?? null;
  const end = e.end?.dateTime ?? e.end?.date ?? null;
  const ts = start ? Date.parse(start) : Date.now();
  let dur = "";
  if (start && end) {
    const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60000);
    if (minutes > 0) dur = `${minutes} min`;
  }
  const attendees: PendingCaptureAttendee[] = (e.attendees ?? []).map((a) => ({
    name: a.displayName || a.email || "",
    email: (a.email ?? "").toLowerCase(),
  }));
  const organizer = e.organizer?.displayName || e.organizer?.email || "";
  return {
    id: "gcal-auto-" + ev.id,
    source: "gcal-auto",
    ts,
    fromName: organizer,
    meta: {
      title: e.summary ?? "(no title)",
      date: isoDateYMD(ts),
      type: "Auto-Capture",
      att: attendees.map((a) => a.name || a.email).join(", "),
      attendees,
      dur,
    },
    intel: {
      summary: e.description ?? "",
      keyPeople: [],
      actionItems: [],
      risks: [],
      commitments: [],
    },
    matchedNodeId: null,
    oppId: null,
    oppName: null,
  };
}
