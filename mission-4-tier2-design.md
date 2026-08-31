# MISSION 4 — Tier-2 Data Architecture: DESIGN (Plan Mode session; no implementation)

*Roadmap item #4: "index entities at write time so queries stay fast at 500+ meetings; relationship
graph as first-class queryable data; decision versioning so reprocessed meetings preserve history."
This session produces a DESIGN — a reviewed document plus a mission breakdown — not code. Run it in
Plan Mode / extended thinking. Implementation happens in later missions under the CI machinery.*

ORIENT
Read CLAUDE.md + corsair-ops truth/log/context, confirm read, `git pull origin main`, state HEAD.
Relevant LOG lessons: P13.391 (in-browser sync fragility), CT-2 invariants pattern, 2026-08-05
"measure before accepting a spec's premise" — it governs this whole mission.

MISSION (one outcome)
A design doc (`corsair-tier2-design-v1.md`, committed) that a future session can implement without
re-litigating: write-time entity indexing, a server-queryable graph, and decision/stance versioning —
with a measured baseline, explicit decision records, a zero-downtime migration plan, and a mission
breakdown. The operator (Mike) reviews and ratifies it before any implementation mission runs.

PHASE 1 — MEASURE THE BASELINE (no design until this is done)
Numbers, not vibes — from the real workspaces (read-only; workspace isolation sacred):
- Per workspace: meetings count, nodes, links, signals, commitments; total bytes of /nodes + /links +
  /meetings; largest single meeting record.
- Front-end load path: what onValue listeners pull at workspace open (from FLiIntel.html — the
  P13.248/334 listener-starvation and REST-backup paths are prior art on this pain), and roughly how
  many bytes hit the browser before first render.
- Read-time work: where findEntityMatch / fuzzy matching runs, per what triggers; where dossier
  assembly walks meetings (operatorData's entity path — note its red-team caveat: node.meetings
  reports ids, not resolved meetings; dangling ids possible).
- Write paths inventory: every writer to /nodes and /links (app saveEntity/saveLink/autoSync*,
  import, merge jobs, capture functions) — the index design must cover ALL of them or drift.
- What already exists toward versioning: m.intelHistory on reprocess (seen in reprocessMeeting) —
  characterize exactly what it preserves and what it loses (stance evolution? decisions? diffs?).

PHASE 2 — DESIGN, as decision records (each: options considered → choice → why → cost)
Required decisions, minimum set:
D1. Store: stay on RTDB with additive index nodes vs. migrate graph to Firestore. Bias per CLAUDE.md
    is smallest-change (RTDB + indexes); make the case honestly either way, with rule/cost impact.
D2. Index shapes: e.g. workspaces/{ws}/idx/entityByName (normalized exact-match first, kill read-time
    fuzzy scans), idx/entityMeetings/{entityId}, idx/adjacency/{nodeId}, idx/stanceTimeline/{entityId}
    (append-only), idx/commitmentsByEntity. Define exact schemas, key normalization, size bounds.
D3. Write-time maintenance: RTDB onWrite trigger functions vs. transactional dual-write from the app
    vs. both. Cover EVERY writer from Phase 1. Idempotency, ordering, and the offline/REST-backup
    write path (fbSet's wedge-resilience) must be addressed.
D4. Versioning model: build on m.intelHistory or supersede it; append-only stance/decision events;
    reprocess = new version + computed diff, never overwrite; what the 360 View / position-delta
    reads switch to.
D5. Query surface: extend operatorData (it is the seed) into a small read API — dossier, neighbors,
    entity timeline, name-resolve — backed by indexes, no full scans. Auth model unchanged (bearer,
    read-only). Note the consumer reality: Cowork tasks read via digest email; the API serves the
    app, local agent, and CI.
D6. Integrity: an index-vs-source invariant checker (CT-2 pattern, scheduled job + pipelineHealth
    events) so index drift is loud, never silent. Define its assertions.
D7. Migration/backfill: idempotent backfill job over existing meetings/nodes/links per workspace
    (jobs/ + migrations/ patterns exist); dual-read or index-first-with-fallback during transition;
    front-end adopts indexes incrementally (NO front-end rewrite in this program); JSON backup/
    restore compatibility; rollback story per step.
D8. Cost/quota: added function invocations per meeting-process and per node/link write; RTDB
    download deltas; stay inside current plan comfortably or say what changes.

PHASE 3 — MISSION BREAKDOWN
Slice into implementation missions (4a, 4b, …), each independently shippable and CI-verified, each
with acceptance criteria, ordered so value lands early (likely: indexes+backfill → checker → query
surface → versioning → view adoption). State what each mission does NOT touch.

CONSTRAINTS
Design only — no code, no writes to any workspace beyond read-only measurement. Workspace isolation
in every schema (everything under workspaces/{ws}/). No PII in the public repo's design doc (schema
examples use placeholder names). database.rules.json changes go through CI now — design the rules
diff explicitly. Respect the known accepted risks in the truth doc; don't silently expand them.

ACCEPTANCE (for a DESIGN)
- Phase 1 baseline is numeric and committed in the doc.
- Every D1–D8 is a decision record with at least two real options and a chosen one.
- The reviewer subagent reviews the design doc adversarially (scope: drift holes, silent-failure
  paths, workspace-isolation breaks, migration rollback gaps) and its findings are addressed inline.
- A cold session could implement mission 4a from the doc alone without asking questions.
- Committed in lockstep (truth doc: "Tier-2 design ratified, implementation not started").

REPORT
The design doc path + commit SHA, the baseline numbers table, the D1–D8 choices in one line each,
the reviewer's findings and dispositions, and the proposed mission 4a scope — then STOP for Mike's
ratification. Do not begin implementation.
