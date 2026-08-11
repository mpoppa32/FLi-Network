# corsair-staleness-inventory-v1.md — WHAT "STALE" ALREADY MEANS IN CORSAIR

*Answer to relay 010/011's blocking question: "the app already prints `stale=15` and `aged=330` — find out what computes those and what rule they use. If there's already a staleness notion, we do NOT want a second one sitting beside it."*

**Read-only audit, 2026-08-11. Nothing was archived, mutated, or deployed.** Workspace ID deliberately absent — the repo is public; paths below use `{wsId}`. The item-level list (real paths + task text) is session-local and was reported to Mike in chat, not committed.

---

## 1. THE ANSWER TO THE TELEMETRY QUESTION

`stale=15` and `aged=330` are **not about commitments or action items at all.** They are two different opportunity-pipeline metrics, printed by one `console.log` in the front-end brief renderer:

`js/corsair/brief.js:794` — `[Brief] 7.1/7.3 rendered: decay=… stale=… upcoming=… commits=… coverage=… aged=…`

Six numbers, six different rules. The two in question:

| Metric | Subject | Rule | Source |
|---|---|---|---|
| `stale` | **Opportunities** | in an active stage (`proposal, negotiation, submitted, award, engaged, rfp`) **and** no linked meeting for **≥14 days** (never-met counts as stale) | `js/corsair/brief.js:261-335` |
| `aged` | **Opportunities** | `daysInStage(opp) > ageLimit(stage)`, where `daysInStage` reads `opp.stageEnteredAt` | `js/corsair/pipeline.js:155-165` + `js/corsair/brief.js:647-687` |

`aged`'s per-stage limits (`js/corsair/pipeline.js` `STAGE_SPEC`): awareness 30 · tracking 60 · engaged 90 · rfp 14 · proposal 30 · negotiation 14 · submitted 45 · award 14 · won `null` (never ages) · lost 14. `daysInStage` returns **0** when `stageEnteredAt` is absent, so an opp with no stage history is never `aged` — the 330 are opps that genuinely carry a stage-entry timestamp past its limit.

For completeness, the sibling metric in the same log line: `decay` = **people** not contacted in ≥30 days (`brief.js:194-258`).

## 2. THE FULL INVENTORY — FOUR STALENESS NOTIONS EXIST

They do not overlap. Each answers a different question about a different entity.

| # | Name | Entity | Rule | Where | Writes? |
|---|---|---|---|---|---|
| 1 | `isStale(item, now)` | **commitment** | `status==='open'` **and** `created` >30d ago **and** (no `deadline` **or** overdue >7d) | `functions/src/jobs/commitmentsAutoArchive.ts:50-88` | **yes** — nightly 04:30 UTC, sets `status:'archived'` |
| 2 | `stale` column | **opportunity** | active stage **and** no meeting ≥14d | `js/corsair/brief.js:261-335` | no (render only) |
| 3 | `aged` column / `isStageStuck` | **opportunity** | `daysInStage > stage ageLimit` | `js/corsair/pipeline.js:160-165` | no (render only) |
| 4 | `decay` column | **person** | no contact ≥30d | `js/corsair/brief.js:194-258` | no (render only) |

**There is no staleness rule anywhere for meeting action items** (`meetings/*/intel/actionItems[]`). That is the genuine gap, and it is the only gap.

## 3. RECOMMENDATION — DO NOT ADD A FIFTH RULE

The ledger-(9) duplication risk is real but it points at #1, not at `stale`/`aged`. A new 21-day commitment rule would sit directly beside `isStale`'s 30-day rule and the two would disagree about the same records — that is the duplication to refuse.

- **Commitments already have an owner:** `isStale` in `commitmentsAutoArchive.ts`. If 21 days is now the desired policy, **change that function's constant and its tests** — do not write a second selector.
- **Action items have no owner and need one.** If a rule is built here, it is genuinely new machinery, not a duplicate. But see §5 — it would be inert against 79% of the data as it stands today.
- `stale`/`aged`/`decay` are front-end render columns over opportunities and people. They are untouched by any of this.

## 4. MEASURED RESULT — 21-DAY OVERDUE FILTER, BOTH PATHS

Live Atlas, pulled 2026-08-11 via `firebase database:get`. Filter: **overdue by more than 21 days**, on `deadline` falling back to `due`. Dates are accepted **only** in ISO `YYYY-MM-DD` form (see §5 for why).

```
COUNT PER SOURCE
  workspaces/{wsId}/commitments ................  0   (of 51 open)
  workspaces/{wsId}/meetings/*/intel/actionItems  43  (of 359, across 7 meetings)
  TOTAL ........................................ 43
```

- **Commitments: zero, and that is a real zero.** All 51 open commitments carry an ISO `deadline`; none is undated. Overdue range spans **max +5d** to **-35d** (i.e. the most overdue open commitment is 5 days past due; the furthest-out is due in 35 days). Nothing is within 21 days of qualifying. This matches the 2026-08-06 measurement recorded in the truth doc and confirms the tail has stayed clean.
- **Action items: 43,** oldest 105 days overdue (2026-04-28), newest 42 days (2026-06-30). Priority split **28 high / 15 medium**. They cluster in 7 meetings — 3 meetings account for the majority — so this is a handful of un-swept meetings, not a diffuse backlog.
- **`due` is dead everywhere.** The field does not exist on a single commitment or action item in Atlas; the union of keys is `deadline` only. This independently re-confirms the queued bug that three front-end filters gate on `c.due` and are therefore inert on real data.
- **No `done` flag exists on action items either.** All 359 carry exactly `context, deadline, owner, priority, task`. So `isOpenActionItem()`'s `done` test — correct as written and correct to share — currently excludes nothing in this workspace: **completion of an action item is not recorded anywhere in the data.** An action-item staleness rule would therefore have no way to tell finished work from abandoned work.

## 5. DEFECT FOUND WHILE MEASURING — 79% OF ACTION-ITEM DEADLINES ARE FREE TEXT

Of 359 action items:

```
  ISO-dated (YYYY-MM-DD) ......  74   21%
  free text .................... 282   79%
  empty / unparseable ..........   3
```

The free-text values are what Claude extracted verbatim from transcripts: `"Ongoing"`, `"TBD"`, `"Phase 1"`, `"Phase 2 / concurrent with first shipments"`, `"Before agreements are signed"`, `"Upon contract signing"`, `"Near-term, before raise launch"`, `"Immediate — Day 1 priority"`, `"Tonight (2026-04-20)"`. **Every date-based filter in the app is blind to all 282 of them** — they can never be overdue, never due-this-week, never stale, and never archived.

**The sharp part: `Date.parse()` does not reject them, it invents dates.** A first pass of this audit used `Date.parse` on the raw value and reported `"Phase 1"` as **9,352 days overdue** (V8 resolves it to year 0001) and `"Friday April 25"` as 9,238 days overdue (year 2001). Eleven of the 54 apparent matches were fabrications of the parser. The audit was tightened to require an ISO prefix; the corrected count is 43.

Consequence for any future work: **a staleness rule for action items cannot use `Date.parse` on this field.** It must require an ISO shape and treat everything else as *undated* — which, under `isStale`'s existing fail-safe philosophy ("anything not positively established as stale is left alone"), means 282 items are permanently exempt. Extraction would have to start emitting ISO dates before an action-item staleness rule could do useful work.

*(Four of the 43 carry an ISO date with a human annotation appended — `2026-05-01 (same day, in car)`, `2026-06-04 (tomorrow per Rick)`. Those parse correctly to the leading date and were verified by eye, not assumed.)*

## 6. TRUTH-DOC CORRECTION (Rule 14)

`corsair-ops-truth-v1.md` states, of `selectHighPriorityActions`' deliberate statelessness: *"Anti-squat already exists at the right cadence in the WEEKLY digest's staleness sentinel (flags a list unchanged week-over-week…)."* The same claim is in `functions/src/jobs/dailyBriefDigest.ts:286`.

**There is no weekly digest.** `functions/src/index.ts` exports `dailyBriefDigest` and `triggerBriefDigestTest` and nothing else digest-shaped; the `*Weekly.ts` files in `jobs/` are all OSINT source connectors (advisoryBoards, dscaFms, faca, senateLda, usaSpendingSubawards). The phrase "staleness sentinel" appears in exactly two places in the repo, both of them comments asserting it. The anti-squat layer the daily digest's statelessness was justified against **does not exist** — so the 43 overdue action items above have no cadence flagging them at all, which is consistent with the fact that they have sat there for up to 105 days.

The statelessness decision may still be right; the stated reason for it is not currently true.

## 7. FOUR OF THE 43 ARE SYNTHETIC TEST DATA — DELETE, DO NOT ARCHIVE

The suspect meeting flagged during the sweep is confirmed synthetic. Its `meta.title` is literally **`AUDIT TEST — DARPA TTO Capabilities Brief`**, dated 2026-05-27, logged by Mike. Every person in it is fabricated (a DARPA TTO PM, an AFRL colonel, an "Atlas BD" rep who shares a first name with the real Bryce but not a surname, an AFRL contracts officer). It holds **5 action items, 4 of which are in the 43.**

It is the **only** synthetic record carrying action items. A title scan of all 592 meetings for test/demo/fixture markers returns exactly three other hits: two auto-captured Gmail/Calendar records titled `test` and `test test` (2026-06-01, **0 action items each**, out of scope for any sweep), and one false positive — a real 2026-07-28 customer meeting that matched only on the word "samples."

**Disposition: this is demo data and should be deleted as demo data, not archived as stale.** Archiving it would file fabricated commitments alongside real ones and leave the fictitious people in the graph. Note the sweep count drops to **39 real overdue action items** once it is removed.

## 8. STATE

- **Nothing archived. Nothing written. Nothing deployed.** Both pulls were `firebase database:get`; all analysis ran offline against the pulled JSON.
- The ranked 43 with full record paths, owners, and task text is session-local (scratchpad `stale21.txt`, generated by `stale21.js` which takes the workspace ID as `argv[2]` and never stores it). Reported to Mike in chat for the archive/no-archive decision.
- **Owed from Mike before anything else happens:** (a) is 21 days now the commitment policy, superseding `isStale`'s 30 — or is 21 days only meant for action items? (b) do any of the 43 get archived, and to where, given action items have no `status` field to archive *into*?

---
*Staleness inventory v1 — 2026-08-11. Every rule above cited to file:line and read from source, not inferred.*
