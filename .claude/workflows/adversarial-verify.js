export const meta = {
  name: 'adversarial-verify',
  description: 'Self-feeding refute-by-default verification — reads the fact store, picks what is most at risk, kills what cannot survive three diverse lenses',
  whenToUse: 'Run before load-bearing claims are relied on, and on a schedule against the fact store. Takes no arguments by default: it selects its own targets. Pass {limit, focus, ids} to steer it.',
  phases: [
    { title: 'Triage', detail: 'read the fact store and select the claims most at risk' },
    { title: 'Refute', detail: 'three independent lenses per claim, each prompted to kill it' },
    { title: 'Adjudicate', detail: 'majority verdict, disagreement treated as the finding' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// This script contains NO names, addresses, or operator detail — deliberately.
// It is installable in a PUBLIC repo. Everything specific is read at runtime
// from the private project doc named below. Keep it that way.
// ─────────────────────────────────────────────────────────────────────────────
const FACT_STORE = 'claude/pappas-facts-v1.md'

const OPTS   = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {}
const LIMIT  = OPTS.limit || 4
const FOCUS  = OPTS.focus || ''
const IDS    = OPTS.ids || null

const TRIAGE = {
  type: 'object',
  required: ['claims', 'selection_rule', 'store_health'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'tag', 'claim', 'source', 'provenance', 'why_at_risk'],
        properties: {
          id: { type: 'string' }, tag: { type: 'string' }, claim: { type: 'string' },
          source: { type: 'string' }, provenance: { type: 'string' },
          why_at_risk: { type: 'string', description: 'why THIS one, ahead of the others' },
        },
      },
    },
    selection_rule: { type: 'string', description: 'the rule you actually applied, stated so it can be argued with' },
    store_health: {
      type: 'object',
      required: ['total', 'unsourced_V', 'U_without_containers', 'stale'],
      properties: {
        total: { type: 'number' },
        unsourced_V: { type: 'array', items: { type: 'string' }, description: 'ids tagged V whose SOURCE cell is empty or non-specific' },
        U_without_containers: { type: 'array', items: { type: 'string' }, description: 'ids tagged U that do not list which containers were searched' },
        stale: { type: 'array', items: { type: 'string' }, description: 'ids whose CHK date is well behind the rest of the store' },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['refuted', 'confidence', 'finding', 'evidence', 'containers_checked'],
  properties: {
    refuted:    { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    finding:    { type: 'string' },
    evidence:   { type: 'string', description: 'what you actually found — quote it. Never assert without this.' },
    containers_checked: { type: 'array', items: { type: 'string' } },
    correction: { type: 'string' },
  },
}

const SYNTH = {
  type: 'object',
  required: ['verdict', 'rewritten_claim', 'tag', 'reasoning', 'residual_risk'],
  properties: {
    verdict:         { type: 'string', enum: ['STANDS', 'REWRITE', 'KILL'] },
    rewritten_claim: { type: 'string' },
    tag:             { type: 'string', enum: ['V', 'C', 'U', 'SS'] },
    reasoning:       { type: 'string' },
    residual_risk:   { type: 'string' },
  },
}

const GROUND = `
Read the project document \`${FACT_STORE}\` first, using the Projects tool (project_read). Its header defines the confidence tags and the full list of information containers this operation can reach, including which are unreachable. Treat that header as your ground truth for method — do not invent tags or containers.

THE FAILURE THIS MECHANISM EXISTS TO STOP: concluding something is absent, or true, after consulting a single container. It has happened repeatedly and expensively. Absence of evidence in one place is not evidence of absence anywhere.
`

const LENSES = [
  { key: 'source-fidelity', brief: `LENS: SOURCE FIDELITY. Open the cited primary source and read it. Does it say what the claim says — exactly? Hunt for: hedges present in the source but dropped from the claim; a speaker misattributed; a paraphrase presented as a quotation; a number, name or date that drifted. If no source is cited at all, that alone refutes any [V] tag. Quote what the source actually says.` },
  { key: 'overreach',       brief: `LENS: OVERREACH. Grant that the evidence is real; ask only whether the CLAIM outruns it. Hunt for: a best case promoted to a precondition; one instance generalised; an inference stated as an observation; a correlation stated as a mechanism; "cannot" where the evidence supports only "probably does not"; a confidence tag one level too strong. The most dangerous case is directionally right and overstated — name it if you see it.` },
  { key: 'out-of-corpus',   brief: `LENS: OUT OF CORPUS — MANDATORY AND MOST IMPORTANT. You are FORBIDDEN from settling this with meeting transcripts. Go outside them: the live web, public filings and registrations, published material, the repo working tree, official documentation, the live system itself. Find something in the outside world that contradicts or completes the claim. If the claim asserts that something is unknown, name a container that could answer it and report whether it was actually searched. This lens exists because a large refutation panel once ran entirely inside one corpus and unanimously missed a document sitting in the operator's own repository. Name every container you actually opened.` },
]

// ── TRIAGE ───────────────────────────────────────────────────────────────────
phase('Triage')
const t = await agent(
  `${GROUND}

Read \`${FACT_STORE}\` in full.

${IDS ? `Return exactly the rows with these ids: ${JSON.stringify(IDS)}.`
      : `Select the ${LIMIT} claims MOST AT RISK of being wrong and most costly if they are. Rank by:
  1. Consequence — would acting on this cost money, credibility, or a relationship? A claim about to be used in outbound correspondence, a filing, a deploy or a commitment outranks a claim nobody will act on.
  2. Thin evidence under a strong tag — [V] with a vague or missing source; [SS] resting on one uncorroborated file; [C] presented with more certainty than a citation supports.
  3. Never independently challenged — no sign in its provenance that anyone tried to break it.
  4. Staleness — a fact whose CHK date is well behind the rest of the store, about something that changes.
Explicitly DEPRIORITISE rows already marked struck or superseded; their history is intentional and is not under test.`}
${FOCUS ? `\nAdditional operator steer, apply it: ${FOCUS}` : ''}

Also report store health: total rows, any [V] whose SOURCE cell is empty or non-specific, any [U] that fails to list the containers searched, and any conspicuously stale rows. Those are defects in the store itself and the operator needs them named even though they are not what you were asked to verify.

State the selection rule you actually applied, plainly enough that the operator can disagree with it.`,
  { label: 'triage:fact-store', phase: 'Triage', schema: TRIAGE }
)

if (!t || !t.claims || !t.claims.length) {
  log('Triage returned no claims — nothing to verify. This is itself worth reporting.')
  return { error: 'triage empty', store_health: t ? t.store_health : null }
}

log(`Selected ${t.claims.length} claims. Rule: ${t.selection_rule}`)
log(`Store health — ${t.store_health.total} rows · ${t.store_health.unsourced_V.length} unsourced [V] · ${t.store_health.U_without_containers.length} [U] with no container list · ${t.store_health.stale.length} stale`)
log(`Spawning ${t.claims.length * LENSES.length} independent verifiers.`)

// ── REFUTE → ADJUDICATE (pipelined; no barrier) ──────────────────────────────
const results = await pipeline(
  t.claims,

  (claim) => parallel(LENSES.map(L => () =>
    agent(
      `${GROUND}

${L.brief}

CLAIM UNDER TEST (id ${claim.id}, tagged [${claim.tag}]):
"${claim.claim}"

STATED SOURCE: ${claim.source || '(none given)'}
STATED PROVENANCE: ${claim.provenance || '(none given)'}
SELECTED BECAUSE: ${claim.why_at_risk}

YOUR STANCE IS REFUTATION. Default to refuted:true when uncertain. A claim survives you only because you went and checked and could not break it — never because it seemed plausible. Plausibility is not evidence.
Do the real research. Load whatever tools you need via ToolSearch.
'evidence' must contain what you actually found or read. If you checked nothing, say exactly that and set confidence low — a verifier that returns an opinion instead of a finding is worse than no verifier.`,
      { label: `${L.key}:${claim.id}`, phase: 'Refute', schema: VERDICT }
    )
  )),

  (votes, claim) => {
    const v = (votes || []).filter(Boolean)
    if (!v.length) return null
    const kills = v.filter(x => x.refuted).length
    return agent(
      `${GROUND}

Three independent skeptics were each instructed to REFUTE this claim. Adjudicate.

CLAIM (id ${claim.id}, tagged [${claim.tag}]): "${claim.claim}"
SOURCE: ${claim.source || '(none)'}

VERDICTS:
${v.map((x, i) => `--- ${LENSES[i] ? LENSES[i].key : 'lens ' + i} --- refuted=${x.refuted} confidence=${x.confidence}
finding: ${x.finding}
evidence: ${x.evidence}
containers checked: ${(x.containers_checked || []).join(', ') || 'none stated'}
correction: ${x.correction || '(none)'}`).join('\n\n')}

${v.length < LENSES.length ? `WARNING: only ${v.length} of ${LENSES.length} lenses returned. Coverage is incomplete — say so in residual_risk.\n` : ''}
Tally: ${kills} of ${v.length} refuted.

ADJUDICATION RULES:
- Majority refutes → the claim does not stand as written. KILL if simply false; REWRITE if something true survives inside it.
- WHERE THE LENSES DISAGREE, THE DISAGREEMENT IS THE FINDING. Do not average it. Name which lens was right and why.
- The out-of-corpus lens carries extra weight on any question of whether something exists in the world. That is this operation's actual failure mode.
- NEVER upgrade a tag. [V] requires a quotable source named in the source field. If none is named it cannot be [V], however likely it is.
- rewritten_claim states what IS true with its limit attached — a claim, not a pile of hedges.
- residual_risk names what remains unchecked after all of this. Do not write "none" unless you can defend it.`,
      { label: `adjudicate:${claim.id}`, phase: 'Adjudicate', schema: SYNTH, effort: 'high' }
    ).then(s => s && ({ id: claim.id, original: claim.claim, originalTag: claim.tag, why_at_risk: claim.why_at_risk, kills, of: v.length, ...s }))
  }
)

const out = results.filter(Boolean)
log(`${out.filter(r => r.verdict === 'STANDS').length} stand · ${out.filter(r => r.verdict === 'REWRITE').length} rewrite · ${out.filter(r => r.verdict === 'KILL').length} killed`)

return {
  store_health: t.store_health,
  selection_rule: t.selection_rule,
  verdicts: out,
  note: 'Verdicts are NOT written back automatically. The operator applies them — a mechanism that both judges and rewrites the record unsupervised is the failure this one exists to prevent.',
}
