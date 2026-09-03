# METRICS — evidence stream A

*Append-only. One row per run per workspace, written by `scripts/metrics-baseline.mjs`.
Numbers only — no names, no task text; this repo is PUBLIC. Per-item detail lives in
gitignored `sweep-manifests/`. Never merge workspaces into one series.*

**Reading it:** `dated%` is the gate — slippage is measured only over dated items, so a
slippage figure quoted without it describes a minority of reality. `completion` is
deliberately blank until something other than the archive sweep writes a completion field.

| date | ws | label | meetings | stale-days | live items | dated% | overdue | slip%(dated) | med od | max od | med age | oldest | completion |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

*Row for workspace `1785637811753` ("TEST") removed 2026-08-31 before any commit: it is a
scratch tenant with one meeting, written by v1 of the script before the live `info/name`
confirmation existed. v2 refuses it. Documented here rather than silently dropped.*
