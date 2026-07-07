// Corsair — Slack intake config (build C, 2026-07-07).
//
// V1 = CAPTURE + SURFACE only: pull recent messages from the Atlas channels and
// surface them (morning brief + a stored feed). It NEVER auto-writes Truth Hub
// facts — Slack chatter must not silently change pricing/specs. Smart, review-
// gated fact extraction is a later pass.
//
// Auth: a Slack bot token (SLACK_BOT_TOKEN secret, xoxb-…). The bot must be
// invited into each channel below (/invite @Corsair Intake). Read-only scopes:
// channels:history/read, groups:history/read, files:read, users:read.

import { ATLAS_MASTER_CONFIG } from "../atlasMaster/config";

export const SLACK_CONFIG = {
  // Same Atlas workspace as the rest of Corsair (RTDB path root). Sourced from
  // the gitignored atlasMaster config so the workspace id stays out of the repo.
  workspaceId: ATLAS_MASTER_CONFIG.workspaceId,

  // Channels to intake, by name (no leading #). IDs are resolved at runtime via
  // conversations.list so we don't hardcode volatile channel IDs. "source-first"
  // priority order per Mike — these often carry new info before anywhere else.
  channels: ["customer", "engineering", "general", "atlas-philippines"],

  // How far back each pull looks. The job runs hourly; a wider window than the
  // cadence tolerates a missed run without dropping messages (dedupe by ts).
  lookbackHours: 6,

  // Cap stored messages (ring buffer at workspaces/{ws}/slackFeed).
  feedCap: 300,

  // Skip bot/system noise (joins, the intake bot's own posts, channel_join, etc.).
  skipSubtypes: ["channel_join", "channel_leave", "bot_message", "channel_topic", "channel_purpose"],
} as const;
