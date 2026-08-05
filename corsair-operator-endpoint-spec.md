# BUILD SPEC — Corsair Operator-Data Endpoint (the "linchpin")

*For a local Claude Code session working in this repo. Goal: give Corsair's headless operator layer (the Cowork morning-brief + meeting-prep tasks) an authenticated, server-readable path to the real relationship graph / commitments / signals — so they stop relying on Gmail + the digest email as a proxy. Grounded in the existing function patterns (`http/anthropicProxy.ts`, `http/triggerBriefDigestTest.ts`, `jobs/dailyBriefDigest.ts`). Written 2026-08-02 by the remote (Cowork) session.*

---

## ⚠️ DO THIS FIRST — git pull
This local repo is BEHIND `origin/main`. `main` already has tonight's shipped fixes (P13.391 auto-link fix + CT-1/CT-2 pipeline health in `FLiIntel.html`, plus the four governance docs `CLAUDE.md` + `corsair-ops-truth/log/context`). Your local `FLiIntel.html` is the OLD pre-fix version.
**Run `git pull origin main` before any work** — otherwise a local commit will overwrite the live fixes and revert the deployed app. Then read `CLAUDE.md` + the three ops docs (Rule 0) before building.

---

## WHY
The morning brief and meeting-prep run headless (Cowork scheduled tasks, no browser, no Firebase token). Today they read Corsair only indirectly (the daily digest email carries OSINT signals + high-priority actions; commitments come out empty because they're deadline-filtered and none have deadlines). The deep data — open commitments, ranked signals, and per-attendee dossiers (stance evolution, action items owed, meeting history) — lives behind Firebase auth and is only reachable interactively. This endpoint exposes it to the headless tasks over one authenticated HTTP call. It's also the first concrete step of the Tier-2 "server-queryable graph."

## TWO PIECES — do the quick win first

### Piece A (quick win, ~20 min): fix the digest to carry ALL open commitments
`jobs/dailyBriefDigest.ts` → the "Commitments due soon" block filters `c.status==="open" && c.deadline && within 7 days`. Since every open commitment is currently undated, the section is always empty.
- Change: keep the DUE-THIS-WEEK block, but ADD an "OPEN COMMITMENTS" block that lists the top ~8 open commitments regardless of deadline (task text; note "(no deadline)"), plus the total count. Gate it behind a new `incCommitments !== false` flag (defaults on).
- Effect: the headless brief immediately gains real commitments via the digest it already reads. No new endpoint needed for this half.
- Deploy: `cd functions && firebase deploy --only functions:dailyBriefDigest`
- Acceptance: `triggerBriefDigestTest` (or wait for 11 UTC) → the digest email now shows the open-commitments list.

### Piece B (the endpoint): `operatorData`

**Type & auth.** New file `functions/src/http/operatorData.ts`, exported from `index.ts`. Use `onRequest` (raw HTTP, NOT `onCall`) because the caller is a headless machine with no Firebase user token. Authenticate with a shared bearer token held in Secret Manager:
- `const OPERATOR_API_TOKEN = defineSecret("OPERATOR_API_TOKEN");`
- Require header `Authorization: Bearer <token>`; constant-time compare to the secret; 401 on mismatch/missing.
- Read-only. No writes. Reuse the per-workspace hourly-quota pattern from `anthropicProxy` if you want a ceiling (optional).
- Config: `region: "us-central1", memory: "512MiB", timeoutSeconds: 60, secrets: [OPERATOR_API_TOKEN]`.

**Request.** `GET /operatorData?ws={workspaceId}[&entities=Name%20One,Name%20Two][&signals=7&commitments=15]`
- `ws` required — the workspace id (e.g. Atlas `1777435779676`).
- `entities` optional, comma-separated attendee names/emails → returns a dossier per match.

**Response (JSON).**
```
{
  "workspace": { "id": "...", "name": "Atlas" },
  "generatedAt": <epoch ms>,
  "commitments": {
    "openCount": <int>,
    "top": [ { "task": "...", "owner": "...", "deadline": "" , "priority": "med", "sourceMtgTitle": "..." }, ... ]   // open only, deadline-sorted then newest, cap ~15
  },
  "signals": [ { "title": "...", "subtitle": "...", "source": "...", "link": "...", "total": <relevance>, "why": ["..."] }, ... ],  // from derivedViews/dailyBrief/latest itemsByCategory, sorted by relevance.total desc, cap ~7
  "entities": [ { "name": "...", "type": "person|company", "org": "...", "priority": <tier>, "meetings": <count>, "lastMeeting": {title,date}, "stance": "...", "openActionItems": ["..."], "notes": "..." }, ... ]  // only when ?entities= given
}
```

**Implementation notes (reuse existing reads).**
- `admin.database()`; read `workspaces/${ws}/commitments` (filter `status==="open"`), `workspaces/${ws}/derivedViews/dailyBrief/latest` (`itemsByCategory` → flatten → sort by `relevance.total`), `workspaces/${ws}/nodes` + `workspaces/${ws}/meetings` for entity dossiers.
- Entity match: mirror the app's `findEntityMatch` idea — exact name (case-insensitive) first, then contains; resolve `entities` params to node(s). For each matched node, summarize its `meetings[]` (pull titles/dates from `/meetings`), most-recent stance, and any open action items attributed to that person.
- Keep the whole handler read-only and defensive (missing nodes → skip; never throw on one bad entity).

**Register + deploy.**
- `index.ts`: `export { operatorData } from "./http/operatorData";`
- `firebase functions:secrets:set OPERATOR_API_TOKEN`  (paste a strong random 40+ char token)
- `cd functions && firebase deploy --only functions:operatorData`
- URL will be `https://us-central1-fli-network.cloudfunctions.net/operatorData`

**Acceptance test.**
- `curl -s -H "Authorization: Bearer <token>" "https://us-central1-fli-network.cloudfunctions.net/operatorData?ws=1777435779676" | jq '.commitments.openCount, (.signals|length)'` → returns the open count (~65) and a signal count (3–7).
- Same call with NO/bad token → HTTP 401.
- `...&entities=Ikeuchi` → returns an ACSL/Ikeuchi dossier with meeting count + last meeting.

---

## WIRING THE COWORK TASKS (after B deploys)
Give the token to the remote (Cowork) session so it can update the two scheduled tasks (`Morning brief`, `Meeting prep`) to call the endpoint instead of parsing the digest. The task will `curl` with the bearer token. **Security tradeoff to decide:** the token will live in the scheduled-task prompt (private to the account, but plaintext). Mitigations: the endpoint is read-only + workspace-scoped + rate-limited, and the token is easily rotated (`functions:secrets:set` again + redeploy). If that tradeoff is unacceptable, keep Piece A (digest) as the headless path and use the endpoint only for interactive/on-demand dossiers.

## NOTES
- Follow CLAUDE.md: smallest change that works, update `corsair-ops-truth-v1.md` in the same commit (new endpoint + new digest section are new realities), log anything that fails.
- Do NOT weaken `database.rules.json`. The endpoint reads via the admin SDK server-side; rules are unaffected.
- When done, tell the remote session the endpoint URL + hand over the token, and it will wire the brief + prep to the real graph and re-render both.
