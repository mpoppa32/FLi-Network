# corsair-ops-truth-v1.md — CORSAIR TRUTH DOC

*What is actually built and true in the Corsair codebase today, and the reasoning behind it. TRUTH doc in the four-document AI Operating System (rules: `CLAUDE.md`). Source of reality — not the roadmap. Update in the SAME COMMIT as any code change that alters what's real (CLAUDE.md Rule 6). Seeded 2026-07-30 from the verified `corsair-current-state.md` (last verified against the live codebase 2026-07-08) plus a direct repo inspection at commit `56573fb` / P13.390.*

---

## WHAT IT IS
Corsair — "Defense Capture OS" (V1.0). A defense-BD operating system: meeting intelligence + relationship graph + an automated OSINT pipeline that ingests government/defense-industry data and fuses it into a daily brief and a governed entity graph. Product name is "Corsair"; legacy infra name is "FLi" (Firebase project `fli-network`, live file `FLiIntel.html`, storage keys prefixed `fli-`). **The name does not tell you the path** — verify.

**Live:** `https://mpoppa32.github.io/FLi-Network/FLiIntel.html`

## ARCHITECTURE (verified)
- **Front end:** single file `FLiIntel.html` (~4.4MB) + `FLiIntel.css` + ES modules in `js/corsair/` — verified modules: `main, state, util, brief, pipeline, table, theater, cop, poc, posture, rhythm, nudge, inspector`.
- **Backend:** `functions/` — TypeScript, Node 20, Firebase Functions 2nd gen, package `corsair-functions`. Source tree under `functions/src/`: `capture, factsSync, framework(/types), http, jobs, migrations, sources/*`. Verified `sources/` connectors: samGov, usaSpending, dodNews, gaoProtest, gaoReports, secEdgar, congressGov, dscaFms, senateLda, dodComptroller, plumBook, facaDatabase, thinkTanks, serviceNews, darpaNews, nasaOig, dodOig, industryAssoc, advisoryBoards, stateDepartment, defenseScoop, uasPatterns, uasPatternsPie, slack.
- **Hosting:** GitHub Pages (front end) + Firebase (data, functions). The old "no server needed" claim is FALSE — there is a substantial backend.

## THE CLAUDE INTEGRATION (the single most important architecture fact)
Claude is the engine — ~14 call sites, all on `claude-sonnet-4-6`. **All calls route server-side through the `anthropicProxy` Firebase Function.** Anthropic key in Firebase Secret Manager (`ANTHROPIC_API_KEY`), never in the browser. Proxy verifies workspace membership, enforces a per-workspace hourly quota (default 30/hr, ceiling 200), enforces a model allow-list (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`, legacy 3.x), timeout 120s / upstream abort 110s. **Single point of failure:** if `ANTHROPIC_API_KEY` is unset/invalid, all AI features break across all workspaces. (History: browser-side `x-api-key` was security finding P13.124 — closed, do not reintroduce. See LOG.)

## APP SURFACE (verified as ~28 views)
Top nav: Today, Inbox, Pipeline, Accounts, Outreach, Drone, Reckoning, Graph ("Theater"), Table, Posture, Atlas (generic team chamber — NOT a hardcoded workspace), + More (Coverage Matrix, Unbound Domains, Intel Center, RFI Engine, Competitive, Teaming, Timeline, Win/Loss, Trends). Intel Station tabs: Log, Intel, Brief, History, Actions, ⚡Ask.

## OSINT LAYER
Automated external-intelligence pipeline (~40 deployed functions), manual trigger + scheduled cron per source, ingesting a ~142-source catalog tiered by operator impact. Supporting entities: Award, Signal; per-workspace Watchlist (NAICS, agencies, CIKs, committees); Source Health monitoring UI; nightly Brief Synthesis → Intel Center (`pulse`) daily feed.

## OTHER INTEGRATIONS LIVE
Deepgram (multi-speaker HD transcription, per-user key `fli-dgkey-{uid}`), Gmail + Google Calendar auto-capture (~30 min, `gmail.readonly` + `calendar.readonly`), Microsoft Graph (Outlook/O365), EmailJS (browser-side brief send), Slack (incoming webhook + `slackIntake`), SendGrid (server-side digests + reminders), Firebase/Google Auth/D3/Google Fonts.

## OPERATOR / HEADLESS LAYER
The Cowork scheduled tasks (morning brief, meeting prep) run headless — no browser, no Firebase user token — so they cannot reach the graph interactively.

- **Daily digest — OPEN COMMITMENTS section** (`jobs/dailyBriefDigest.ts`, 2026-08-05). The digest's DUE-THIS-WEEK block only ever showed the 7-day window capped at 10. A new OPEN COMMITMENTS block lists the top 8 open commitments regardless of deadline plus the total open count, gated behind `incCommitments !== false` (defaults on). Ordering is shared with the endpoint below via the exported `sortOpenCommitments()` (dated soonest-first, then undated newest-first).
  - **Correction to a prior assumption:** it was believed every open commitment was undated, making DUE-THIS-WEEK always empty. Measured on Atlas 2026-08-05: **65 open, 49 dated, 16 undated, 33 inside the 7-day window.** DUE-THIS-WEEK was NOT empty — it was showing 10 of 33. The real gap was the 65-vs-10 visibility ceiling.

- **`operatorData` endpoint** (`http/operatorData.ts`, LIVE 2026-08-05). `onRequest` (raw HTTP, not `onCall` — the caller has no Firebase user), region us-central1, 512MiB, 60s. Auth: shared bearer token in Secret Manager (`OPERATOR_API_TOKEN`), SHA-256'd then `timingSafeEqual` (constant time, length-independent). **Read-only** — never writes; non-GET/HEAD returns 405. Reads through the admin SDK, so `database.rules.json` is untouched and unweakened.
  - `GET ?ws={workspaceId}[&entities=A,B][&signals=7][&commitments=15]` → `{workspace, generatedAt, commitments:{openCount, top[]}, signals[], entities[]}`.
  - Sources: `workspaces/{ws}/commitments` (open only), `derivedViews/dailyBrief/latest.itemsByCategory` (flattened, ranked by `relevance.total`), `nodes` + `meetings` for dossiers.
  - Dossiers resolve entity terms exact-name-first then substring over name/org; stance comes from the most recent `meetings/*/intel/keyPeople[].stance`; action items are attributed conservatively (a bare first name matches, a *different* full name sharing a first name does not — "Bill Akman" must not inherit "Bill Allen"'s items; both exist in Atlas).
  - **Two working URLs.** `https://us-central1-fli-network.cloudfunctions.net/operatorData` and the direct Cloud Run URL `https://operatordata-fcxd64equq-uc.a.run.app`. Both accept `Authorization: Bearer <token>`; `X-Operator-Token: <token>` is accepted as a fallback on either (see LOG 2026-08-05 for why the fallback exists).
  - Verified live 2026-08-05: valid token → 200 with `openCount` 65 / 5 signals; bad or missing token → 401; POST → 405; `entities=Rick,Tom Baron` → dossiers with meeting counts, last meeting, stance, and open action items.

## WORKSPACES
Fully dynamic (`workspaces/{wsId}`). No hardcoded FLi/Atlas IDs. FLi and Atlas are the two operational workspaces in practice. Firebase paths: `workspaces/{wsId}/{meetings,nodes,links,entities,cal,commitments}`.

## KEY FACTS
- Repo: `github.com/mpoppa32/FLi-Network` · anchor commit `56573fb` (P13.390)
- Firebase project `fli-network` · DB `https://fli-network-default-rtdb.firebaseio.com`
- Model in use: `claude-sonnet-4-6` via `anthropicProxy`
- Owners: Mike (mpoppa32@gmail.com), Bryce (Bryceamcdonald@gmail.com)

---
*Truth doc v1 — seeded 2026-07-30. Anything not verified against code or a cited source is "unverified" (CLAUDE.md Rule 3).*
