// Corsair — triggerExtractionEval: run the fidelity grader over a sample of the
// corpus and write the scores back.
//
// This is the IO half. All scoring logic lives in `jobs/extractionEval.ts`,
// which is pure and has 23 tests, two of which were mutation-checked to prove
// they fail against the naive implementation. This file does the parts that
// cannot be unit-tested — reading Firebase, calling the model, writing results.
//
// WHAT IT DOES
//   1. Selects meetings that have never been graded (then oldest-graded first),
//      so repeated runs walk the corpus instead of re-grading the same head.
//   2. For each, hands the RAW NOTES and the STRUCTURED EXTRACTION to a
//      DIFFERENT model than the one that produced the extraction, and asks it to
//      find everything the extraction asserts that the source does not support.
//   3. Scores in code, not in the model. Writes per-meeting results and a rollup.
//
// COST CEILING — an integer, not a hope.
//   meetings per run: default 10, hard cap 40 (EVAL_LIMITS)
//   notes per call:   24,000 chars, truncation DISCLOSED to the grader
//   max_tokens:       4,000
//   Worst case at the cap is 40 grader calls. Nothing here loops or retries more
//   than once. If a call fails, that meeting is recorded as ERRORED and the run
//   continues — one bad record must not void a batch, and a batch that silently
//   dropped it would misreport the corpus.
//
// MODEL POLICY. The grader model is checked against anthropicProxy's
// ALLOWED_MODELS — imported, never re-listed. CLAUDE.md Rule 4 says respect the
// allow-list; a second copy of it is how the two drift apart.
//
// This job calls the Anthropic API directly with the server-side secret rather
// than through the proxy's callable interface, because the proxy is `onCall` and
// requires a Firebase user — there isn't one here. The finding Rule 4 closed
// (P13.124) was a BROWSER-SIDE key; this is server-side, the key never leaves
// Secret Manager, and the allow-list is still enforced.
//
// READ/WRITE SCOPE. Reads `workspaces/{ws}/meetings`. Writes ONLY under
// `workspaces/{ws}/extractionScores` — it never touches a meeting record. The
// grader's opinion is stored beside the corpus, never merged into it.
//
// Setup:
//   firebase deploy --only functions:triggerExtractionEval
//
// Usage:
//   POST /triggerExtractionEval
//   Authorization: Bearer <OPERATOR_API_TOKEN>
//   {"workspace":"<id>","limit":10}
//
// ACCEPTANCE:
//   1. No token → 401. Wrong workspace → 400 naming the workspace.
//   2. limit=2 on Atlas → 2 scored records under extractionScores, a rollup, and
//      a response whose counts match what is in the database.
//   3. Re-run → picks 2 DIFFERENT meetings (never-scored first).
//   4. At least one result must carry findings with quoted evidence, or the
//      grader is rubber-stamping and the rubric needs sharpening. A corpus that
//      scores 100 everywhere on the first run is a finding about the grader, not
//      a finding about the corpus.

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db } from "../framework/rtdb";
import { createLogger } from "../framework/logger";
import { tokenMatches } from "./operatorData";
import { ALLOWED_MODELS } from "./anthropicProxy";
import {
  GRADER_MODEL,
  GRADER_SYSTEM,
  EVAL_LIMITS,
  selectMeetingsToScore,
  buildGraderUserMessage,
  gradeFromResponse,
  rollup,
  clip,
  type ScoredExtraction,
} from "../jobs/extractionEval";

const OPERATOR_API_TOKEN = defineSecret("OPERATOR_API_TOKEN");
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_API_KEY");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const triggerExtractionEval = onRequest(
  { region: "us-central1", memory: "1GiB", timeoutSeconds: 540, secrets: [OPERATOR_API_TOKEN, ANTHROPIC_KEY] },
  async (req, res) => {
    const log = createLogger({ source: "http_triggerExtractionEval" });

    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only." });
      return;
    }
    const expected = OPERATOR_API_TOKEN.value();
    if (!expected) {
      log.error("missing_secret", { which: "OPERATOR_API_TOKEN" });
      res.status(500).json({ error: "OPERATOR_API_TOKEN not configured." });
      return;
    }
    const header = String(req.headers.authorization ?? "");
    if (!tokenMatches(header.replace(/^Bearer\s+/i, "").trim(), expected)) {
      log.warn("unauthorized");
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    const apiKey = ANTHROPIC_KEY.value();
    if (!apiKey) {
      log.error("missing_secret", { which: "ANTHROPIC_API_KEY" });
      res.status(500).json({ error: "ANTHROPIC_API_KEY not configured." });
      return;
    }

    // The allow-list is the proxy's, imported. Belt and braces: if someone edits
    // GRADER_MODEL to something the proxy would refuse, this refuses too.
    if (!ALLOWED_MODELS.has(GRADER_MODEL)) {
      log.error("model_not_allowed", { model: GRADER_MODEL });
      res.status(500).json({ error: `Grader model ${GRADER_MODEL} is not in the proxy allow-list.` });
      return;
    }

    const body: any = req.body ?? {};
    const ws = String(body.workspace ?? "").trim();
    if (!ws || ws.includes("/") || ws.includes(".")) {
      res.status(400).json({ error: "workspace is required. Workspaces are dynamic; this job will not guess one." });
      return;
    }
    const rawLimit = Number(body.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), EVAL_LIMITS.meetingsCap)
      : EVAL_LIMITS.meetingsDefault;

    try {
      const nameSnap = await db.ref(`workspaces/${ws}/info/name`).get();
      if (!nameSnap.exists()) {
        res.status(400).json({ error: `Workspace ${ws} not found.` });
        return;
      }
      const wsName = String(nameSnap.val());

      const [meetingsSnap, scoresSnap] = await Promise.all([
        db.ref(`workspaces/${ws}/meetings`).get(),
        db.ref(`workspaces/${ws}/extractionScores`).get(),
      ]);
      const meetings: Record<string, any> = meetingsSnap.exists() ? meetingsSnap.val() : {};
      const scored: Record<string, any> = scoresSnap.exists() ? scoresSnap.val() : {};

      if (Object.keys(meetings).length === 0) {
        res.status(200).json({ error: "Zero meetings read. That is a broken read, not an empty corpus.", workspace: ws, workspaceName: wsName });
        return;
      }

      const ids = selectMeetingsToScore(meetings, scored, limit);
      if (ids.length === 0) {
        res.status(200).json({ workspace: ws, workspaceName: wsName, scored: 0, note: "No meeting carries enough source notes to grade. Fidelity cannot be measured against an absent source." });
        return;
      }

      const results: ScoredExtraction[] = [];
      const errored: Array<{ id: string; message: string }> = [];
      const startedAt = new Date();

      for (const id of ids) {
        const m = meetings[id] || {};
        // Top-level `notes`, verified against the live schema — NOT `intel.notes`,
        // which does not exist on any record (see extractionEval.ts).
        const notes = clip(m?.notes, EVAL_LIMITS.notesChars);
        // The extraction as the grader sees it. `notes` is stripped defensively
        // in case a future record nests it, so the grader can never end up
        // comparing the source against itself and scoring a free 100.
        const { notes: _drop, ...intelNoNotes } = (m?.intel ?? {}) as Record<string, unknown>;
        const intel = clip(JSON.stringify(intelNoNotes, null, 1), EVAL_LIMITS.intelChars);

        try {
          const resp = await fetch(ANTHROPIC_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify({
              model: GRADER_MODEL,
              max_tokens: EVAL_LIMITS.maxTokens,
              system: GRADER_SYSTEM,
              messages: [{
                role: "user",
                content: buildGraderUserMessage({
                  notes: notes.text,
                  notesTruncated: notes.truncated,
                  intelJson: intel.text,
                  intelTruncated: intel.truncated,
                  title: String(m?.meta?.title ?? ""),
                }),
              }],
            }),
          });
          if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
          const json: any = await resp.json();
          const text = (json?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");

          // Throws loudly on a malformed reply rather than recording a clean 100.
          const graded = gradeFromResponse(text);
          results.push(graded);

          await db.ref(`workspaces/${ws}/extractionScores/${id}`).set({
            scoredAt: new Date().toISOString(),
            graderModel: GRADER_MODEL,
            score: graded.score,
            verdict: graded.verdict,
            counts: graded.counts,
            note: graded.note,
            findings: graded.checks,
            sourceTruncated: notes.truncated,
          });
        } catch (e: any) {
          // Loud, recorded, and the batch continues. A dropped record would make
          // the rollup describe a corpus that was never graded.
          log.warn("grade_failed", { meetingId: id, message: e?.message });
          errored.push({ id, message: String(e?.message ?? "unknown").slice(0, 300) });
          await db.ref(`workspaces/${ws}/extractionScores/${id}`).set({
            scoredAt: new Date().toISOString(),
            graderModel: GRADER_MODEL,
            error: String(e?.message ?? "unknown").slice(0, 500),
          });
        }
      }

      const summary = rollup(results);
      const finishedAt = new Date();
      await db.ref(`workspaces/${ws}/extractionScoreRollups/${finishedAt.toISOString().slice(0, 10)}`).set({
        generatedAt: finishedAt.toISOString(),
        graderModel: GRADER_MODEL,
        attempted: ids.length,
        graded: results.length,
        errored: errored.length,
        ...summary,
      });

      log.info("eval_complete", { workspace: ws, attempted: ids.length, graded: results.length, errored: errored.length, mean: summary.meanScore });

      res.status(200).json({
        workspace: ws,
        workspaceName: wsName,
        graderModel: GRADER_MODEL,
        elapsedMs: finishedAt.getTime() - startedAt.getTime(),
        attempted: ids.length,
        graded: results.length,
        errored,
        ...summary,
        caution:
          "Findings are the grader's, not ground truth. A finding without quoted evidence is discarded before scoring. " +
          "If the whole first batch scores 100 with no findings anywhere, suspect the grader before believing the corpus.",
      });
    } catch (e: any) {
      log.error("threw", { workspace: ws, message: e?.message });
      res.status(500).json({ error: "Internal error." });
    }
  }
);
