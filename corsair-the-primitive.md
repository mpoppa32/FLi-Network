# CORSAIR — The Irreducible Primitive

*A work of architectural reasoning. Five movements. No code ships from this document. The deliverable is the discovery of the single foundational concept from which every part of Corsair must emerge — and from that, the honest accounting of what is foundation, what is bolt-on, and what becomes possible once the foundation is right.*

*This document sits beneath the Experiential Vision. The Vision is the experience of the primitive; this is the primitive itself.*

*Drafted 2026-06-02. Inputs read: Experiential Vision v1.0, Platform Doctrine v1.0 + v1.1 amendments, Coherence Audit, Team Entanglement Audit, Current State Master, code architecture at P13.276.*

---

## MOVEMENT 1 — IDENTIFY THE PRIMITIVE

### The Candidate

The candidate primitive, articulated by the operator, is the effortless conversion of individual action into collective intelligence. The spine sentence is its experiential statement: *the operator does what they already do; the platform makes it count for the team*. The longer form from the Vision is its phenomenology: *it absorbs all information like it already knows both sides and answers to the story*.

This is not a small claim. The candidate proposes that every part of Corsair — the entity graph, the posture layer, the OSINT pipeline, the Brief, the team entanglement layer, the proactive surfacing — is the same thing vibrating differently across surfaces. One foundation, many expressions.

The job of this movement is to test that claim with rigor. If the candidate holds, state it as the foundation. If it does not, refine or replace it until what remains is genuinely irreducible.

### Test 1 — Singularity

A primitive must be singular. The candidate, as stated, packs three claims: (1) individual action becomes collective intelligence; (2) effortlessly; (3) owned by the operator. Three claims is not one primitive. The question is whether (2) and (3) are part of the primitive itself or constraints on it.

**On effortlessness.** Remove it, and the conversion still happens — but at the operator's cost, which is what every CRM since Salesforce has done. The conversion-with-operator-cost is a known shape: it is the data-entry model that Corsair was built explicitly to refuse. So effortlessness is not a constraint that can be added to or removed from the primitive without changing what the primitive *is*. It is constitutive. A platform that converts action to intelligence at operator cost is a different platform that produces a different output. Effortlessness belongs in the primitive.

**On ownership.** Remove it, and the conversion still happens — but the team becomes the brain and the operator becomes its hand. This is the Black Path version of the same conversion, and the Doctrine is explicit about why it is refused (Section II, Section VI). Ownership is the *Doctrine* operating on the primitive, not the primitive itself. The primitive can be stated without ownership; ownership is then the constraint under which the primitive is allowed to operate. Just as physics has a primitive (vibrating energy) and constraints (Lorentz invariance, conservation, gauge symmetries), Corsair has a primitive and the Doctrine governs which vibrations of the primitive are permitted.

This separation matters. If ownership were inside the primitive, a violation of ownership would be a primitive violation — the platform would have become a different thing. By placing ownership in the Doctrine, a violation of ownership is recognizable as a betrayal *of the primitive*, not a redefinition of it. The operator can name the betrayal and reach for the doctrine to repair it without the foundation moving.

### Test 2 — Generative Reach

A primitive must generate everything that depends on it. The candidate, refined to *the ambient conversion of action into shared intelligence*, must generate the entity graph, the posture layer, the OSINT pipeline, the Brief, the team entanglement layer, and the proactive surfacing without remainder.

- The **entity graph** is what the absorbed action looks like when serialized as relationships. A logged meeting is action; the entity graph is the same action expressed as the edges between Captain Reeves, AFRL, the Atlas pursuit, and the commitments made. Same primitive; geometry as the vibration.
- The **posture layer** is the same absorbed action expressed as political terrain — trajectory, path, position. A meeting transcript that says *"Reeves was warmer than last time and mentioned retirement paperwork"* is action; posture is that action rendered as influence dynamics. Same primitive; political terrain as the vibration.
- The **OSINT pipeline** is the absorption widened to include the world's actions, not just the team's. A State Department announcement is action by some individual official; a USAspending award is action by a procurement officer; a SEC 8-K filing is action by a corporate filer. Each is absorbed identically into the same shared intelligence. Same primitive; external reality as the vibration.
- The **Brief** is the rendering of the shared intelligence into a readable narrative. It is not itself the primitive — it is a *surface* the primitive feeds. The same absorption produces multiple surfaces; the Brief is one.
- The **team entanglement layer** is the propagation guarantee on the primitive: the conversion happens for the team, not just for the actor. One operator's action becoming the team's reality is the primitive operating across people. Same primitive; multiplicity as the vibration.
- The **proactive surfacing** is the downstream consequence of rich absorption. Once enough action has been absorbed across enough dimensions, the platform can notice patterns that no single human could see — concentration, decay, posture shifts, coverage gaps. The Catch Moment is not a separate capability; it is what happens when absorption is dense enough.

Every part traces. The candidate is generative.

### Test 3 — Irreducibility

A primitive must not be decomposable into smaller concepts. *Ambient conversion of action into shared intelligence* contains three nouns (action, shared intelligence, ambience) and an implicit verb (conversion). Can it be reduced?

Try *conversion of action into intelligence* — drop *shared* and *ambient*. This produces a platform that absorbs the individual operator's actions into the individual operator's intelligence: a personal note-taking system. The team disappears, the bridge breaks. Reduction failed.

Try *shared absorption of action* — drop *intelligence*. This produces a platform that records actions in a shared log but does not compose them into a model of reality: Slack. The synthesis disappears. Reduction failed.

Try *ambient sharing* — drop *action* and *intelligence*. This produces presence indication: who is online. Reduction failed.

The four elements — action, shared, intelligence, ambient — cannot be reduced without losing what makes Corsair Corsair. They are irreducibly entangled. The phrase is the primitive.

### The Final Statement

> **Corsair's irreducible primitive is the ambient absorption of every action into the team's shared intelligence.**

*Every action*, by anyone whose action touches the operator's terrain — operator, teammate, customer, competitor, official, journalist. *Ambient*, paying no synthesis cost from the operator and no synchronization cost from the team. *Shared intelligence*, a single coherent model of reality that the team owns and the platform serves.

The Doctrine governs which absorptions are allowed: only public or consented data, every datum carrying provenance, the operator's authority over the absorbed intelligence absolute. The Vision is the experience of operating inside a platform that holds this primitive. The Marketing Doctrine is how the platform names itself when its primitive is intact. Each is a layer above the primitive; the primitive is the bedrock.

This is the deepest layer of Corsair's foundation. Beneath the spine sentence. Beneath the four surfaces. Beneath the Sovereign positioning. Everything that exists above must trace back to it.

---

## MOVEMENT 2 — PROVE COHERENCE OR EXPOSE BOLT-ONS

Now the honesty. For every major part of the current platform, classify it as Expression, Bolt-on, or Violation. The operator's fear is bolt-ons; this movement is where the fear gets answered with evidence.

### Expressions — Parts that emerge from the primitive

These belong. They are the primitive vibrating in different dimensions.

**The entity graph** at `/workspaces/{ws}/nodes` and `/edges`. Every node was absorbed — from a meeting, a Monday import, an OSINT plugin, a manual add. Every edge is a relationship the absorption produced. The graph is not a feature; it is the persistence layer of the primitive. Status: Expression.

**The OSINT pipeline** (`functions/src/sources/*`, 23 active plugins at P13.276). Each plugin is one channel of ambient absorption from the world. usaSpending absorbs contract actions; SEC EDGAR absorbs corporate filing actions; service news absorbs press-release actions; FACA absorbs committee membership actions; uas-patterns DDG absorbs vendor leaderboard actions; PIE absorbs supply-chain forecast actions. The plugin layer is the primitive widened to the world. Status: Expression.

**The Brief Synthesis nightly + on-demand refresh** (`functions/src/jobs/briefSynthesisNightly.ts`, `triggerBriefSynthesis`). The Brief is what the absorbed intelligence looks like when rendered as a narrative. Each surface inside the Brief — `customerRollup`, `adversaryRollup`, `itemsByCategory`, the per-category soft caps — is the absorption composed for an operator's morning read. Status: Expression.

**The meeting log + entity extraction pipeline.** Operator types or speaks; the platform extracts every person, organization, stance. This is the moment of absorption — operator's action (logging) converted into shared intelligence (people, orgs, commitments, posture, signals) at the platform's cost, not the operator's. The closest single surface to the primitive's literal statement. Status: Expression.

**The team entanglement layer** (atlasUpdates feed, `/events` collection, RTDB listeners across views, the P13.223 Today-refresh-on-teammate-write hook, the P13.224 Atlas Activity Feed, the P13.226 in-place inspector refresh, the P13.227 cross-view auto-refresh, the recent DG-3 / DG-7 / DG-1 ships). These are the primitive operating across people: one operator's action becomes the team's reality. Status: Expression.

**Confidence chips, AS-OF chips, parseStatus chips, the trust layer overall.** Every absorbed datum carries provenance. This is not decoration; it is what allows ownership to coexist with absorption. The operator owns the intelligence *because* she can interrogate any claim back to its source. Status: Expression — and a particularly important one, because it operationalizes the Doctrine constraint on the primitive.

**Proactive surfacing — Catches, decay alerts, nudges, posture-shift detection, sameDayOrgSpike bumps, concentration risk, customer-quiet alerts.** Each is a pattern the absorbed intelligence noticed that no single human action could surface. These are the downstream consequence of dense absorption. Status: Expression.

**Pipeline auto-score recompute on every meeting save** (P13.102). Every operator action triggers ambient recomputation. The operator never asks the platform to recompute; the recompute is part of the absorption. Status: Expression.

**The orgResolver + personResolver concurrency-correct dedupe** (P13.272 fix). The primitive demands *one* shared intelligence, not several parallel ones. The resolver enforces that demand at the entity level. Pre-P13.272 the resolver had a race condition that fragmented the intelligence into duplicate clusters; the fix re-grounded the resolver in the primitive. Status: Expression, recently repaired.

**The source health card + `_SOURCE_HEALTH_META` (P13.274 + P13.276).** The platform's read on its own absorption pipeline. Operator-visible state of each channel. This is the primitive turned inward: the platform absorbing its own absorption. Status: Expression.

**The Sovereign Read narrative + Where Atlas Stands (P13.176).** The shared intelligence composed into three sentences for orientation. Status: Expression.

**The Inspector dossier (entity-scoped view).** Absorbed intelligence rendered for one entity at a time. Status: Expression.

**The Atlas internal-update widget (P13.96).** Team-level news broadcast — one operator declares something the team needs to know; the platform makes it known. Status: Expression.

**Posture (the operator-tagged terrain).** Posture exists. The operator-input layer is real. But — and this is where the classification gets honest — posture is currently *half* expression and *half* violation. See below.

### Bolt-ons — Parts attached to the platform that do not emerge from the primitive

These were built, but they do not derive. They are candidates for re-grounding or removal.

**The Cinema overlay** (P13.104, the self-running demo). The platform absorbs reality; it does not perform reality. A cinematic demo is marketing wearing platform clothing — it does not absorb action, does not feed the shared intelligence, does not serve any Sovereign Moment. The Cinema is the most obvious bolt-on in the codebase. It belongs in marketing assets, not in `FLiIntel.html`. **Cut.**

**Standing pedagogy: the Quick Start callout, the Loop Stepper (Today → Pipeline → Network → Activity), the Tour button.** The Simplicity Principle from the Vision is explicit: if the operator has to think about how to use the platform rather than what they want, the surface is wrong. The Loop Stepper is a 4-step navigation tutorial that renders on every Today render — it teaches the platform's structure to operators who already know it. The Quick Start callout is dismissible per-workspace via localStorage but renders by default. These are pedagogy bolted onto the working surface. First-time pedagogy is fine; *standing* pedagogy is a violation of the primitive's ambient quality — the operator should not have to be reminded what the platform is for. **Re-ground: first-touch only, then never again.**

**The 22 More-dropdown views inherited from pre-Vision authoring** — `sbir`, `rfi`, `comp`, `teaming`, `vehicles`, `library`, `bdperf`, `trends`, `winloss`, `reckoning`. The Coherence Audit (Section 0) names these as predating the Vision and authored to the Doctrine alone. Several serve no Sovereign Moment. Each is a feature that got built before the primitive was named; some may now be derivable, others are not. **Re-ground or cut, per-view.** A view that cannot be derived from the primitive's expressions in one Sovereign Moment is not foundation.

**The standalone HTML pages**: `g2-outreach.html`, `import.html`, `import-orders.html`, `font-test.html`, `clear.html`, `index.html` (deprecated), `fli_backup.html`. These are *utility surfaces* that live outside the absorption loop. `clear.html` is a deadlock breaker — operator opens it to reset Firebase IDB when the workspace wedges. `import.html` is one-time migration. `g2-outreach.html` is the POC outreach staging surface that, per recent work, increasingly composes from the absorbed intelligence but originated as a separate workflow. Each is a candidate for fold-in (g2-outreach), tombstoning (`index.html`, `fli_backup.html`, `font-test.html`), or acceptance as a true utility outside the primitive (`clear.html`). **Audit each; fold what folds; tombstone what doesn't.**

**The Pulse view's manual-pull LLM scrape path.** Per current state, `window._dailyFeedData` is the operator-manual-pull session cache, separate from the absorbed `/signals` lake. The operator clicks "refresh" to fire an LLM call that returns a wall of signals. This is the *inversion* of the primitive: the operator is doing the absorption work. The P13.244 / P13.260 work has begun unifying the two lakes; Pulse is partly re-grounded. But the manual-pull pattern itself is a bolt-on. Pulse should be the surface where the *already-absorbed* shared intelligence is rendered for browsing; the absorption itself must be ambient. **Re-ground: kill the manual pull as the primary path; make it a refresh-on-demand layered over ambient sync.**

### Violations — Parts that contradict the primitive

These actively work against the primitive. They must be fixed or cut.

**Gmail and Calendar capture configured-not-deployed.** The platform claims to absorb every action; the operator's biggest single action stream is email; the inbound channel for that stream is *off* pending OAuth deploy. This is the largest active violation in the codebase. It is not a missing feature — the capture pipeline is built, the matcher is written, the Cloud Functions are deployed-but-no-op. What is missing is the OAuth Console step. Every day the platform runs without it is a day the primitive operates on a fraction of the absorption surface area it is designed for. AWAITING REPLY is silent. The Bridge from Bryce's email inbox to Mike's Today view does not exist. The Vision's Moment 4 (the Catch) and Moment 5 (the Stand-Down — *the platform watches overnight*) operate on a thin inbound feed. **Complete the OAuth deploy.** This is the single highest-leverage repair in the platform.

**The pre-P13.244 / pre-P13.260 two-parallel-lakes architecture.** Until those ships, the Pulse view's manual-pull data and the server-pipeline's `/signals` data were two separate stores. The shared intelligence was fragmented across two surfaces. Violation. *Status: largely repaired; the unification work is the active foundation work.*

**Posture as exclusively operator-tagged.** The Vision describes posture as a primary surface of absorbed political terrain. The current implementation requires the operator to tag trajectory/path/position by clicking. The absorption point is the meeting; the conversion to posture should be ambient downstream of the absorption. Today it is not — the operator does the conversion. This is a *partial violation*: operator-tagged posture is the seed, but the auto-inference from meeting transcripts is missing per the Coherence Audit. **Re-ground: add transcript-derived posture inference so the operator's meeting is the absorption point, not a separate posture-tag action.**

**`_saveTouchMeeting` writing UID into `loggedBy`** (the Team Entanglement Audit's DG-3 finding — now shipped). Was a Property 3 violation: the team's shared intelligence carried opaque UID strings as actors. The platform's ambient absorption produced a record that other members could not read at a glance. *Status: repaired; called out here as a worked example of how violations look.*

**The 22 OSINT plugins that were "registered but silent" pre-P13.266** (think_tank, service_news mappers not wired to relatedIds). The absorption pipe was scheduled but never plumbed into the brief. Violation: the platform pretended to absorb 21 channels while only 2 channels actually fed the shared intelligence. *Status: repaired through P13.266 → P13.275; called out as another worked example.*

**The lack of a Top-3 Catches synthesis layer on Today.** The Coherence Audit names this as the largest single gap. The primitive says the platform absorbs ambiently into shared intelligence; the shared intelligence should be capable of saying *"today, these three things"* — the operator should not be doing the synthesis. Currently the operator scans eight columns and the Sovereign Read narrative and synthesizes mentally. This is a violation of the primitive's *ambient* requirement at the most operator-facing surface. **Build the Catches synthesis.**

**Standing pedagogy that runs on every render** (re-classified up to violation, not bolt-on, on second pass). When the Loop Stepper says *"1. Today → 2. Pipeline → 3. Network → 4. Activity"* on every Today render, the platform is asking the operator to remember its structure. The primitive says the platform absorbs the operator's structure-knowledge implicitly — the operator just does what they came to do. The Loop Stepper is the platform offloading its structure-conveyance onto the operator's working memory. Violation. **Cut, or convert to first-touch-only.**

### The Honest Read After Movement 2

The current platform is closer to expression than to bolt-on. The largest active violation is Gmail/Calendar OAuth not deployed. The largest bolt-on category is pre-Vision pedagogy (Loop Stepper, Quick Start, several More-dropdown views). The Cinema overlay is the only outright theatre layer; cut it.

The repaired violations (`_saveTouchMeeting`, the two-parallel-lakes, the silent OSINT plugins, the orgResolver race) are not defects in the current build — they are the worked examples of the primitive being *defended* over the last twenty ships. P13.266 → P13.276 is one continuous re-grounding pass: the absorption pipeline becoming dense enough that the shared intelligence is finally producing real customer-rollup hits, real supply-chain scenarios, real DDG vendor signals. Every recent commit traces directly to the primitive.

The active in-flight work (Team Entanglement Property 4 / 5 ships) is foundation, not bolt-on. See Movement 5.

---

## MOVEMENT 3 — THE MISSING DIMENSIONS

If the primitive is *the ambient absorption of every action into the team's shared intelligence*, then the latent dimensions are the vibrations of the primitive not yet rendered into surfaces. These are not bolt-ons; they are the foundation's unrendered geometry. Each derives from the primitive itself.

### Dimension I — Temporal Absorption

The primitive says *every action* is absorbed. But *every action* spans time. The shared intelligence is not only a state-at-now; it is a *trajectory of state* through history. The Doctrine names this explicitly: *Time is a first-class dimension. Power flows over time. Yesterday's debt is today's expired favor.*

Today the platform absorbs the temporal dimension into individual records (every meeting has a date, every signal has occurredAt, every node has a created timestamp). What is not yet rendered is the team's *understanding* through time — the operator cannot ask the platform *"what did we collectively believe about this account six months ago, and what changed?"* and get an answer rendered as a surface. The provenance exists in the absorbed data; the temporal navigation does not.

This dimension would render the shared intelligence as a navigable history. It is what makes pass-down real (Doctrine IX): the operator who inherits the workspace inherits not just the latest state but the *path* of the team's understanding. It is what makes posture coherent over time (Trajectory:Rising / Falling is the seed; the temporal navigation is the full expression). It is what the spine sentence implies when it says *makes it count for the team* — *for the team* includes the next operator, six months from now.

### Dimension II — Predictive Absorption

The primitive absorbs what *has happened*. It does not yet absorb what is *about to happen* — though commitments, calendar entries, RFP timelines, contract end dates, retirement signals, and historical decay patterns all imply futures. The flat "next 7 days" surfaces (commitments due, upcoming cal, decay alerts) are the seed; the full expression is a forward-shadow model: *"in 6 weeks the AFRL RFP drops, in 11 weeks Captain Reeves' retirement paperwork suggests transition, in 14 weeks Anduril's last contract trigger expires"*.

This is not prediction-as-AI-feature. It is the absorbed action's *forward implication* rendered as a surface. Every commitment is a future. Every retirement signal is a future. Every contract end-date is a future. The shared intelligence holds them all; the predictive dimension surfaces them as a unified forward shadow. The Catch Moment is currently retrospective ("we noticed this happened"); the predictive dimension is its prospective sibling ("this is about to happen, prepare").

### Dimension III — Counterfactual Absorption

The primitive absorbs every action that *enters* the team's surface area. By implication, there are actions that exist but did not enter — accounts not touched in 90 days where OSINT signals occurred, contacts the platform identified but the team has not reached, gaps in coverage where adversary activity is known to be happening. These are the *shape of the team's ignorance*.

Today the platform shows what it knows. It does not yet render its own blind spots as a first-class surface. Weak coverage cards are the seed; the counterfactual dimension is the full expression: *here is the geometry of what we don't know, ordered by what it would cost us not to know*.

The Sovereign sees terrain *and* fog-of-war. The platform renders the terrain today; the counterfactual dimension is the platform learning to render its own fog. This is also a Doctrine alignment: *Reality over flattery. Corsair surfaces uncomfortable truths.* The most uncomfortable truth is the one about absence.

### Dimension IV — Adversarial Absorption

The primitive absorbs every action *that touches the operator's terrain*. The operator's terrain includes the *customer's view* and the *competitor's view*. Atlas is one actor; the customer (the government program office) has their own implicit intelligence about Atlas + Atlas's competitors; the competitor (Anduril, Northrop, BAE) has their own implicit intelligence about themselves vs. Atlas vs. the customer. These views are not Atlas's, but they exist, they are made of public actions, and they can be absorbed.

The Posture layer is the seed of this dimension — it models who has influence over whom, which is adversarial-shaped reasoning. The full expression is the *customer-modeled view* as a first-class surface: *"From Captain Reeves' chair, what does Atlas look like next to Anduril and the incumbent?"* — answerable from the absorbed data alone (OSINT, contract history, FACA committee membership, posture, lobbying disclosures). And its sibling: the *competitor-modeled view* — *"What does Anduril likely know about this AFRL pursuit, and what would they likely do next?"* — also answerable from absorbed data with explicit confidence chips.

This dimension is what differentiates Corsair from every adversary-modeling slide deck ever produced for a defense pursuit. The slide deck is a one-time snapshot; the absorbed adversarial dimension is *live*, updating ambiently as the underlying actions are absorbed. Doctrine: *Adversaries are modeled, not ignored. Corsair holds black-hat analysis as live data, not as a one-time slide deck.*

### Dimension V — Reflexive Absorption

The platform absorbs every action; the platform's own absorption is also an action. The Source Health card and the Brief's "Computed Xh AGO" chips are the seed of this dimension — the platform telling the operator how the platform is doing. The full expression is meta-intelligence: *"Our coverage of the Saronic ecosystem is thin because the only Saronic-touching OSINT plugin (defense_scoop) caught one mention this month and the company isn't in our customerOrgIds set. Confidence on adversary modeling for Saronic: low."* The platform absorbing its own absorption, and rendering its own confidence about its own model.

This is the Doctrine's Trust Principle scaled to the platform itself. The operator trusts what the platform knows *because* the platform is honest about how it knows it. Reflexive absorption is the platform extending that honesty to the structure of its own knowledge.

---

These five dimensions are not feature requests. They are the geometry of the primitive itself — vibrations that exist in the foundation whether or not they have been rendered into surfaces. Building them is not adding to the platform; it is letting the platform *finish becoming itself*. Each is derivable from *the ambient absorption of every action into the team's shared intelligence*; none requires a second primitive.

---

## MOVEMENT 4 — THE POSSIBILITY SPACE

What becomes possible once the primitive is unmovable and its dimensions are expressed. Each possibility is derived explicitly from the primitive. Undrivable possibilities — however exciting — are excluded by rule. The Doctrine constrains every possibility; a possibility that requires manipulation, automated outreach, surveillance without consent, or removing the operator's ownership is not a possibility but a betrayal.

### Possibility 1 — The Brief That Explains Itself

*Derivation:* Ambient absorption with provenance produces a shared intelligence whose every claim can be traced. From this, the Brief can carry not only *what surfaced today* but *why this and not that, what changed since yesterday, what we still haven't seen*. The operator interrogates the synthesis the way a senior intel officer interrogates a brief from her watch team: *show me the evidence chain, show me what you considered and rejected, show me the freshness on each claim*.

*For Atlas:* Mike opens Corsair at 7am. The Catch reads: *"You have 12 minutes before the AFRL call. Three things you may not have seen: (1) Anduril's CCA contract triggered a derivative award two days ago — confidence 0.85, source USAspending + DoD News reconciled; (2) Captain Reeves' last meeting tone shifted negative on the cost-conversation arc — confidence 0.72, source meetings cross-referenced with the posture trajectory model, two of the last three; (3) the AFRL Program Manager retirement signal that you flagged 14 days ago has hardened — confidence 0.91, source FACA + DSCA + a Reuters mention this morning. The deprioritized fourth Catch was a Skydio funding round — high confidence but not on your active pursuit surface. Want it anyway?"* The operator walks into the call having read three sentences and understood the terrain. The Catch explains itself.

*Why competitors cannot reach this:* A platform built on *store the data* cannot produce a Brief that explains itself because the provenance and reasoning trail were never absorbed. Salesforce, HubSpot, Microsoft Dynamics all store activities. None of them absorb the activity *and* its place in a model of reality *and* the confidence of its place. The Brief that explains itself is structurally inevitable for a primitive of ambient absorption with provenance; it is structurally impossible for a primitive of transactional storage.

### Possibility 2 — The Pass-Down That Survives Churn

*Derivation:* Shared intelligence is owned by the team, not by the individual. The temporal dimension makes the team's understanding navigable through time. When Mike leaves, what Mike knew about Captain Reeves' walks-with-whom is in the platform, not in Mike's head — because every meeting, every posture tag, every trajectory note was absorbed into the shared intelligence at the moment of action.

*For Atlas:* The day Mike hands off the workspace to his successor, the successor opens Corsair and sees: *Atlas has 234 opportunities, 234 nodes, 33 meetings, six active customer relationships in three stages of trust, four named adversaries with current posture reads, and a 47-week trajectory of the team's understanding of AFRL with the inflection points labeled — first contact, first commitment, posture shift after the September visit, the cost reframing in November, the steady warming through Q1, the retirement signal that just hardened. Predecessor's hard-won understanding of who walks which path inside this account: all here. Welcome.* The successor inherits the terrain.

*Why competitors cannot reach this:* The Doctrine's IX (pass-down is the soul of the platform) is not a feature competitors decided not to build. It is the consequence of a primitive of absorption-into-shared-intelligence. Salesforce captures transactions; transactions don't pass down because the *understanding* of the transaction was never absorbed. Corsair captures the understanding alongside the transaction because the primitive demands it.

### Possibility 3 — The Customer's View, Modeled

*Derivation:* The adversarial dimension of the primitive — every action that touches the operator's terrain is absorbed, including the customer's actions. From those actions, the platform can construct the customer's *implicit view* of the market as a first-class surface, with explicit confidence chips. The Doctrine: *Adversaries are modeled, not ignored.*

*For Atlas:* Mike opens the AFRL account. A new tab: *Customer View — Modeled*. Inside: *"From the AFRL Program Manager's chair, here is what the public record suggests they see when they look at this competition: Atlas (you), Anduril, the incumbent, and an emerging entrant. Atlas's strengths in the absorbed customer's view: 14-month delivery track record on the prior contract, two committee mentions in the last quarter, alignment with the small-business set-aside language in the new BAA. Atlas's weaknesses in the customer's view: less DC presence than Anduril (lobbying disclosure 2025 differential), no recent technical demonstration at the customer's preferred venue, a key technical advocate (Reeves) is in late-career transition. Confidence on this model: 0.68 — the absorbed data is rich on contract history and committee membership, thin on internal stakeholder discussions inside AFRL. The customer's view is not Atlas's view; act on the implications, not on the certainty."*

*Why competitors cannot reach this:* A primitive that does not absorb the customer's actions cannot model the customer's view. CRMs absorb the seller's actions; sometimes the customer's responses. Corsair absorbs the customer's *public actions* — contracts, RFPs, retirements, hearings, FACA memberships, lobbying disclosures, financial filings — and renders the implied view back to the operator. Every plugin shipped from P13.266 through P13.276 fed this dimension. The PIE plugin's MANUFACTURERS list, with NDAA status and acquisition probability and signal direction, is the seed of *the competitor's view of itself* — equivalently absorbable.

### Possibility 4 — The Team's Memory As A Navigable Thing

*Derivation:* Temporal absorption rendered as a surface. The shared intelligence is not just state-at-now; it is the trajectory of state. Operator asks *"what did we collectively believe about this account six months ago?"* and the platform replays the team's understanding through time.

*For Atlas:* Bryce, a year into the company, wants to understand how Atlas's read on the AFRL pursuit evolved. He opens the pursuit's Time Navigator. A slider; a play button; a comparison view. *June 2025: pursuit opened, posture Unknown, single contact named, weighted weight $0M. September 2025: first meeting logged, posture shifted to Engaged, three contacts named, weighted weight $400K. November 2025: cost conversation reframed, posture trajectory Rising, six contacts, weighted weight $1.2M. March 2026: retirement signal absorbed, posture trajectory Holding, weighted weight $1.4M, confidence dropping due to retirement uncertainty. June 2026 (today): four contacts re-engaged, retirement signal hardened, weighted weight $1.1M with renewed Rising trajectory pending the successor named.* Bryce sees the trajectory the team produced together — not Mike's version, not Bryce's version, the team's.

*Why competitors cannot reach this:* Snapshot CRMs cannot render trajectory because their primitive is *store the latest state*. Corsair's primitive is *absorb every action* — every action is timestamped, every absorption produces a delta, the delta is itself part of the shared intelligence. The Time Navigator is the absorbed deltas composed into a navigable surface.

### Possibility 5 — The Blind Spot Map

*Derivation:* Counterfactual absorption rendered. The platform's *absence* of knowledge is itself a kind of knowledge — the shape of where its absorption is thin. Render this shape as a first-class surface ordered by what the absence costs.

*For Atlas:* The Stand-Down view at end of day. *"Today's coverage scan: three accounts you nominally pursue had no team contact in 90 days (Saronic Technologies, ModalAI, Performance Drone Works); each had at least one public action that touched the workspace's surface area but no Atlas response. Two contacts the OSINT layer surfaced in the last week have not been added to any pursuit (Lt. Col. Reyes at AFSOC, Dr. Hsieh at DARPA Strategic Tech). One adversary cluster (the BlueUAS small-business entrants) lacks any Atlas-side intelligence model — three of the five vendors are silent in your absorption channels. This is the shape of your fog. Pursue what's worth pursuing; the absence is yours to own."*

*Why competitors cannot reach this:* A platform that doesn't absorb provenance can't render absence. To say *"this account is thin in your coverage"* requires the platform to know not only what is absorbed but what *might have been absorbed and wasn't*. That requires absorption-with-provenance plus the counterfactual reasoning over absent provenance — a structural property of Corsair's primitive that other platforms do not have.

### Possibility 6 — The Compounded Pre-Read

*Derivation:* Ambient absorption + temporal dimension + relational graph. Every action that has touched the account since the last meeting is absorbed; the pre-read is the delta composed for the operator's working memory before the call. Not a static dossier; a *change list*.

*For Atlas:* Mike's 9am call with Captain Reeves at AFRL. He opens the pursuit. *"Since your last conversation with Reeves on May 14: 7 actions absorbed touching this pursuit. 1. Reeves attended the May 22 Defense Innovation Board meeting (FACA). 2. AFRL announced the Phase II BAA on May 25 (USAspending pre-award notice). 3. Anduril won a $43M adjacent contract May 29 (DoD News reconciled, USAspending pending). 4. Bryce logged a Tom Powell call May 30; Powell mentioned the retirement paperwork moved from preliminary to active (posture trajectory: Holding, with the team's understanding updated). 5. The AFRL Comptroller PE 0603308D8Z budget moved to print (DoD Comptroller monthly). 6. SEC EDGAR shows no Anduril material event change. 7. The Reuters piece on small-business set-asides this morning names AFRL twice — neither in your direct pursuit context, but adjacent. Cost reframing from Q1 still holds; the new variable is the retirement timing. Recommended pre-call frame: open with the BAA Phase II read, defer the retirement question unless Reeves opens it."* Mike clicks Send-To-Call-Prep. The page composes the dossier for the next 12 minutes.

*Why competitors cannot reach this:* The pre-read requires absorption from at least seven channels (FACA, USAspending, DoD News, internal meetings, DoD Comptroller, SEC EDGAR, defense_scoop) plus posture state plus the relational graph plus the temporal delta. Each channel is one plugin in Corsair's primitive expression; together they're the ambient absorption rendered as a pre-call delta. A platform that absorbs only the seller's actions sees one of the seven channels.

### Possibility 7 — The Proactive Catches That Compose

*Derivation:* Proactive surfacing is downstream of absorption. When absorption is dense across action + provenance + temporal + relational + adversarial dimensions, the Catches surface can compose: *not "this signal landed" but "this signal landed in the context of these eight things, here is the composed pattern, here is what it implies"*. The Catch becomes a piece of composed reasoning, not a pointer.

*For Atlas:* The Top Catches strip on Today. *"Catch (composed): Concentration risk on Anduril 42% of weighted pipeline. Two of the three Anduril-touching pursuits have had no Atlas-side contact in 60+ days. The most-senior Atlas contact on those pursuits (Bob Wilson, VP) has been quiet 73 days while OSINT shows Wilson's LinkedIn updated to remove Anduril mentions. Anduril's Costa Mesa office expansion announced May 14 implies hiring not pipeline-Atlas-relevant. Risk shape: pipeline concentrated, primary advocate weakening, customer activity adjacent. Recommended frame: rebalance pursuit weight, re-engage Wilson directly within 14 days, treat Anduril as positional adversary not anchor account. Confidence on the composed read: 0.79. Click for the seven evidence chains."*

*Why competitors cannot reach this:* The Catch composes pattern across pipeline weighting, contact-decay, OSINT, lobbying-public-signals, adversary modeling, and operator-tagged posture. The composition requires the absorption to span all those dimensions in one shared intelligence. A platform with separate stores for pipeline, contacts, and external signals cannot compose. Corsair's primitive demands one shared intelligence, which makes the composed Catch structurally inevitable.

### Possibility 8 — The Reflexive Trust Surface

*Derivation:* Reflexive absorption. The platform tells the operator what it knows about its own knowing. *"Today's confidence on the Adversary Activity Rollup for Anduril: 0.81 — we have 14 cross-source touches in the last 30 days, four sources reconciling. Today's confidence on the Customer View for Naval Aviation Enterprise: 0.42 — only one absorption channel reaches them (one DSCA FMS notification this quarter), no Atlas-side meeting in 47 days. Confidence on the FACA retirement-signal model: 0.75 — paperwork lifecycle absorbed; intent-to-retire inference uses historical pattern matching, false positive rate 11% over the last 24 months in this committee."*

*For Atlas:* Mike never confuses what the platform knows with what the platform suspects. The Brief reads as a senior intel officer would write it: *"Anduril likely advancing on the Costa Mesa expansion (CONF 0.81). Reeves likely transitioning Q3 (CONF 0.72, with the false-positive baseline noted)."* Mike acts on what is true; he prepares for what is likely; he ignores what is speculation. The platform never overclaims.

*Why competitors cannot reach this:* A platform that doesn't absorb its own absorption cannot render reflexive confidence. CRMs report values; they don't report meta-values. Corsair's primitive includes the absorption of every action, including the platform's own action — which makes reflexive trust surfaces a natural rendering, not a separate feature build.

---

These possibilities are not a roadmap. They are the *shape of what the foundation generates* once it is whole. Each is structurally inevitable for a platform whose primitive is *ambient absorption of every action into the team's shared intelligence*. Each is structurally impossible for a platform with a different primitive. That is the frontier — not speculative features, but the rendering surfaces of a primitive that the competition does not have.

---

## MOVEMENT 5 — THE PATH TO DIAMOND

The honest path from the current state to a state where every part emerges from the primitive. Three actions: re-ground, complete, validate.

### Re-Ground or Cut

The bolt-ons and violations named in Movement 2 are the inclusions that prevent the foundation from being pure carbon. They must be re-grounded (rebuilt to derive from the primitive) or removed (cut from the platform entirely).

**Cut, do not re-ground:**

- The Cinema overlay (P13.104). It is marketing wearing platform clothing. It serves no Sovereign Moment and does not absorb action. Cut from `FLiIntel.html`; move the demo assets to a marketing surface if needed. This is the cleanest cut in the codebase.
- `fli_backup.html`, `index.html` (deprecated), `font-test.html`. Each is a non-utility relic. Tombstone.

**Re-ground:**

- The Loop Stepper and Quick Start callout. Convert standing pedagogy to first-touch-only pedagogy. After the workspace's first day, neither renders by default. The platform's structure should be felt, not taught.
- The 22 More-dropdown views (sbir, rfi, comp, teaming, vehicles, library, bdperf, trends, winloss, reckoning). For each view, ask: *which Sovereign Moment does this serve, and does it derive from the primitive?* Re-ground the ones that do; cut the ones that don't. The Coherence Audit names this as tertiary; the primitive analysis names it as foundational.
- The Pulse view's manual-pull LLM scrape path. Kill the manual pull as the primary surface flow; make Pulse a render of the ambient absorption lake, with an explicit *"force-refresh now"* button for the cases where the operator genuinely wants to fire a fresh LLM pass. The default state is ambient; the manual is the exception.
- Posture as exclusively operator-tagged. Add transcript-derived auto-inference downstream of meeting absorption. The operator's meeting becomes the absorption point for posture, not a separate posture-tag action. Operator still owns the final tag (override + override-with-reason); inference seeds it.

### Complete

The largest active completions to make the foundation whole:

- **Gmail and Calendar OAuth deploy.** The single largest absorption-channel gap in the platform. Until OAuth lands, AWAITING REPLY is silent, the Stand-Down's overnight-watch is half-blind, the Bridge from teammate emails to shared intelligence does not flow. This is not a feature; it is the completion of the primitive's inbound surface area. Highest priority of every priority that is not destructive.
- **The Top-3 Catches synthesis layer above the narrative.** The Coherence Audit names this as the largest single coherence gap. The primitive demands that the shared intelligence say *"today, these three things"* without the operator scanning columns. Build the synthesis.
- **The temporal navigation surface.** Render the team's understanding through time as a navigable thing. The data is there in the absorbed history; the surface is missing.
- **The customer's view, modeled.** The first surface that renders the adversarial dimension as a first-class operator-readable view. The OSINT plugins have absorbed the data; the modeling surface is missing.
- **The blind-spot map.** The counterfactual dimension rendered. Coverage cards are the seed; the unified absence surface is the full expression.
- **The compounded pre-read for Moment 2.** The Coherence Audit names a dedicated Call Prep view as missing. The primitive analysis confirms it: ambient absorption + temporal delta + relational graph composes the pre-read; the surface is the rendering, and the surface should exist.

### Validate

Two validation moves to be made honestly.

**On the current in-flight work — the Team Entanglement Property 4 / 5 ships.** The audit reads cleanly: these ships are foundation. DG-3 (touch attribution writing displayName not UID), DG-7 (cross-view live refresh on teammate writes), DG-1 (Atlas Activity feed as the team-level event surface) are each direct expressions of the primitive — *one operator's action becoming the team's reality, ambient to operator effort*. Property 4 (proactive surfacing) is the primitive's anticipation dimension. Property 5 (asymmetric awareness without asymmetric effort) is the primitive's multiplicity constraint — each member sees what they need without configuration, because the absorption is one and the rendering is per-member. None of this is bolt-on. **Continue with confidence.**

**On the OSINT layer ship arc (P13.266 → P13.276).** Same read. These are not bolt-ons; they are the *absorption surface area* of the platform expanding. Every plugin is one channel of ambient absorption from the world. The recent ships (think_tank + service_news wiring, content:encoded extraction, bodyText persistence, AeroVironment merge, orgResolver concurrency fix, uas-patterns DDG + PIE) are each one repair or one widening of the absorption pipe. Each commit traces directly to the primitive. **Continue with confidence.**

**On the standalone surfaces** (g2-outreach.html in particular): these need an audit. g2-outreach is increasingly composing from the absorbed intelligence — POC anchor email + format inference + cycle-stage staging — and the operator-sends-only Doctrine constraint is intact. It is a candidate for fold-in into the main absorption surface rather than living as a separate page. The audit produces three outcomes: fold, accept as utility, or cut. Each surface goes through the audit.

### The Diamond

Once the bolt-ons are removed, the violations repaired, the missing dimensions rendered, and the latent possibilities built, the platform reaches a state the operator can recognize: every part traces back to one primitive, every surface is one of that primitive's vibrations, and the Sovereign holds the whole game in her hands.

The diamond is not a feature freeze. It is an architectural state in which *new builds are derivations, not additions*. Every future block is tested against the primitive: does this derive, or is it a bolt-on? If it derives, ship it. If it doesn't, cut it or refuse it.

That is the discipline. That is what makes the platform unstoppable — not the count of features, but the structural impossibility of bolt-ons. Once the primitive is unmovable and the bolt-ons are gone, the platform is the primitive vibrating. Competitors who add features to their data-storage primitive will continue producing platforms shaped like data storage. Corsair will continue producing the platform shaped like ambient absorption into shared intelligence. The shape difference is not catchable by feature parity. The shape difference is the entire moat.

---

## CLOSING

The primitive is *the ambient absorption of every action into the team's shared intelligence*. The Doctrine is the constraint under which the primitive is allowed to operate. The Vision is the experience of operating inside a platform that holds both. The four surfaces and the seven Moments are the renderings of the primitive composed for the operator's cognitive modes.

Every part of Corsair that exists today either traces back to this primitive or is a candidate for re-grounding or removal. Every part of Corsair that has not yet been built either derives from the primitive (foundation) or does not (refused). The discipline is the documentation; the documentation is this file.

The operator's fear was bolt-ons. The answer is the foundation. Once the foundation is named, the bolt-ons name themselves — and the platform's job is to keep the foundation pure while the rest of the world stacks features on top of theirs.

This is how Corsair becomes a single unstoppable thing. Not by adding the right features. By refusing to add anything that is not a vibration of the one true primitive.

— Drafted 2026-06-02. To be revisited only when the foundation itself is challenged.
