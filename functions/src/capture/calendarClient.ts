// Corsair P2.14 — Google Calendar API thin wrapper
//
// Lists events in a date window. Used for both the initial backfill (last
// 7 days) and incremental polls (since lastSyncAt).

import { google, calendar_v3 } from "googleapis";
import { clientForAccessToken } from "./oauth";

export interface FetchCalendarOptions {
  /** ISO timestamp lower bound — events ending before this are skipped. */
  sinceIso: string;
  /** ISO timestamp upper bound. Default: 14 days from now. */
  untilIso?: string;
  /** Max events to fetch per run. */
  maxResults?: number;
  /** Calendar ID. Default 'primary'. */
  calendarId?: string;
}

export interface FetchedCalendarEvent {
  id: string;
  raw: calendar_v3.Schema$Event;
}

/**
 * Fetch calendar events in [sinceIso, untilIso). Includes events the user is
 * attending OR organizing. Cancelled events are filtered out — the API still
 * returns them with status: "cancelled" so we drop them here.
 */
export async function fetchCalendarEvents(
  accessToken: string,
  opts: FetchCalendarOptions
): Promise<FetchedCalendarEvent[]> {
  const auth = clientForAccessToken(accessToken);
  const calendar = google.calendar({ version: "v3", auth });

  const untilIso =
    opts.untilIso ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const list = await calendar.events.list({
    calendarId: opts.calendarId ?? "primary",
    timeMin: opts.sinceIso,
    timeMax: untilIso,
    maxResults: opts.maxResults ?? 100,
    singleEvents: true, // expand recurring meetings into instances
    orderBy: "startTime",
  });
  const events = list.data.items ?? [];
  return events
    .filter((ev) => ev.id && ev.status !== "cancelled")
    .map((ev) => ({ id: ev.id as string, raw: ev }));
}
