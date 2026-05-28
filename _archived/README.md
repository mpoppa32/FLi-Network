# Archived

Files in this directory are NOT loaded by the deployed Corsair app.
They are preserved only because they may contain historical context useful
for archaeology — function signatures, prior architectures, deprecated flows.

**Do not edit anything here expecting it to take effect.**
**Do not copy logic FROM here into the live tree without re-verifying.**

## Inventory

### `FLiIntel.legacy.js` (formerly `FLiIntel.js`)

Archived in P13.112 (audit Finding 6.1).

This was 20,510 lines of parallel implementation: a near-duplicate of the
inline JS in `FLiIntel.html` from a prior architecture phase. It was never
referenced by `<script src="...">` in the live HTML — `grep "FLiIntel\.js"`
across the repo confirmed zero imports. The risk was that a future engineer
would find it via the file tree, assume it's active, edit it, and ship a
no-op "fix" — or worse, copy stale patterns from this file back into the
live tree.

Notable parallels (for archaeology):

- `function wsPath()` — duplicate of FLiIntel.html:12182
- Firebase config + imports at top — duplicate of FLiIntel.html:11959+
- A meeting → opp link block at line 5818 that the LIVE saveMeeting was
  missing until P13.107 brought equivalent logic into the inline tree

If you need to pull a pattern out of here, **verify it against the live
inline tree in FLiIntel.html before relying on it.** Anything here may
be stale by months.
