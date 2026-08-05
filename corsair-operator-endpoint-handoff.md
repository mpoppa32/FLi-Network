# HANDOFF — `operatorData` endpoint (for the Cowork / headless operator session)

*Built and verified live 2026-08-05 from `corsair-operator-endpoint-spec.md`. This is the durable handoff doc (CLAUDE.md Rule 13): the remote session needs these facts to wire the morning brief + meeting prep, and a session file would die with the session.*

> **The token is NOT in this file and must never be committed.** This repo is public (it serves GitHub Pages). The token lives only in Secret Manager as `OPERATOR_API_TOKEN`. Mike holds a copy and hands it to the Cowork session directly.
> Retrieve it any time:
> ```
> firebase functions:secrets:access OPERATOR_API_TOKEN --project fli-network
> ```
> Rotate it: `firebase functions:secrets:set OPERATOR_API_TOKEN` then `firebase deploy --only functions:operatorData`.

---

## URL

Primary: `https://us-central1-fli-network.cloudfunctions.net/operatorData`
Direct Cloud Run: `https://operatordata-fcxd64equq-uc.a.run.app`

Both work and serve identical data. Prefer the primary. Keep the second on hand: on a freshly-deployed function the `cloudfunctions.net` front end can briefly reject `Authorization: Bearer` with an HTML 401 while the `allUsers` IAM binding propagates (logged 2026-08-05), and the Cloud Run URL is unaffected.

## Auth

```
Authorization: Bearer <OPERATOR_API_TOKEN>
```
`X-Operator-Token: <OPERATOR_API_TOKEN>` is accepted as an equivalent fallback on either URL — use it if a bearer ever comes back as an HTML 401 from `Google Frontend` rather than JSON from the function.

Bad or missing token → `401 {"error":"Unauthorized."}`. The endpoint is **read-only**; any non-GET/HEAD → `405`.

## Request

```
GET /operatorData?ws={workspaceId}[&entities=Name%20One,Name%20Two][&signals=7][&commitments=15]
```

| param | required | default | notes |
|---|---|---|---|
| `ws` | yes | — | workspace id. Atlas is `1777435779676`. |
| `entities` | no | — | comma-separated names. Exact name match wins; otherwise substring over name **and** org. Max 10 terms. Omit it and `entities` comes back `[]` — dossiers are only built when asked for. |
| `signals` | no | 7 | cap, max 50 |
| `commitments` | no | 15 | cap on `top[]`, max 100. `openCount` is always the true total. |

## Response

```jsonc
{
  "workspace":   { "id": "1777435779676", "name": "Atlas" },
  "generatedAt": 1785900000000,
  "commitments": {
    "openCount": 65,                       // true total of status==="open"
    "top": [ { "task", "owner", "deadline", "priority", "sourceMtgTitle" } ]
  },
  "signals": [ { "title", "subtitle", "source", "link", "total", "why": ["..."] } ],
  "entities": [ {
      "name", "type", "org", "priority",
      "meetings": 11,
      "lastMeeting": { "title", "date" },
      "stance": "...",                     // most recent, from meeting intel.keyPeople
      "openActionItems": ["..."],          // max 12
      "notes": "..."
  } ]
}
```

Ordering: commitments dated-soonest-first (overdue at the top) then undated newest-first — the same `sortOpenCommitments()` the daily digest uses, so the email and the endpoint never disagree. Signals are ranked by `relevance.total` descending.

## Verified acceptance (2026-08-05, live)

```bash
TOKEN=...   # from Secret Manager, see above
URL=https://us-central1-fli-network.cloudfunctions.net/operatorData

# 1. valid token -> data
curl -s -H "Authorization: Bearer $TOKEN" "$URL?ws=1777435779676" \
  | jq '.commitments.openCount, (.signals|length)'
#    -> 65, 5

# 2. bad / missing token -> 401
curl -s -o /dev/null -w '%{http_code}\n' "$URL?ws=1777435779676"          # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer nope" "$URL?ws=1777435779676"   # 401

# 3. dossier
curl -s -H "Authorization: Bearer $TOKEN" "$URL?ws=1777435779676&entities=Rick,Tom%20Baron" \
  | jq '.entities[] | {name, meetings, lastMeeting, openActionItems: (.openActionItems|length)}'
```

## Caveats the remote session should know

- **`entities=Ikeuchi` returns nothing, and that is correct.** The build spec's acceptance test named an ACSL/Ikeuchi dossier; no node matching "Ikeuchi" or "ACSL" exists in any of the three workspaces. Use real Atlas entities (Rick, Tom Baron, Bill Allen, Cameron Chell, Mountain Horse Solutions).
- **Action-item attribution is conservative by design.** A bare first name matches ("Rick", "Tom"), but a different full name sharing a first name does not — Atlas contains both a "Bill Allen" and a "Bill Akman". Expect some genuinely-owed items to be missing rather than mis-assigned; a dossier that lies is worse than one that under-reports.
- **Commitment `owner` is usually an email** (`mpoppa32@gmail.com`) while meeting action-item `owner` is usually a first name. `openActionItems` therefore draws mostly from meeting action items. `commitments.top[]` is the authoritative commitment list — read it directly rather than inferring ownership.
- **`signals` reflects the 05:00 UTC nightly synthesis** (`derivedViews/dailyBrief/latest`). If it looks thin or stale, brief synthesis is the thing to check, not this endpoint. It returned 5 items on 2026-08-05.
- **Security posture / accepted tradeoff:** the token will live in plaintext in the scheduled-task prompt. Mitigations already in place: read-only, workspace-scoped, no writes, rotatable in two commands. If that becomes unacceptable, fall back to the daily digest (which now carries all open commitments — see `dailyBriefDigest.ts`) and use this endpoint only for interactive dossiers.

---
*Companion: `corsair-operator-endpoint-spec.md` (the build spec). Reality of record: `corsair-ops-truth-v1.md`.*
