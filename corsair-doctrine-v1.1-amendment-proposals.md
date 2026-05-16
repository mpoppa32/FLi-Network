# CORSAIR DOCTRINE v1.1 — AMENDMENT PROPOSALS

**Scope:** Proposed amendments to Corsair Doctrine v1.0 based on edge cases surfaced across the Phase 8.5 design body of work
**Prepared by:** OSINT Research Analyst — Corsair
**Date:** 2026-05-16
**Doctrine version referenced:** 1.0
**Status:** **PROPOSAL ONLY.** Operator authors and signs off on Doctrine. This document surfaces specific amendments that the Phase 8.5 design work suggests would clarify or extend Doctrine v1.0. The operator decides whether to adopt, modify, or reject each proposal.

---

## Document Purpose

Corsair Doctrine v1.0 was authored by the operator and signed off at platform inception. The Phase 8.5 design work (twenty artifacts, ~225k words) surfaced edge cases that Doctrine v1.0 does not fully address:

- Multi-operator workspace governance
- Cross-workspace intelligence aggregation considerations
- The boundary between automated source integration and manual operator import
- New source categories not anticipated by v1.0's §VI exclusion criteria
- Pass-down dynamics across multi-operator transitions
- Workspace transfer legitimacy and consent

These edge cases don't render Doctrine v1.0 wrong; they reveal places where v1.0 is silent or ambiguous. Doctrine v1.1 would extend v1.0 to cover them without contradicting any v1.0 principle.

This document proposes nine specific amendments. Each is presented as:
- **The gap:** what Doctrine v1.0 does not address
- **Why it matters:** which Phase 8.5 design decisions depend on this clarification
- **Proposed amendment text:** specific language for Doctrine v1.1
- **Implementation impact:** how Phase 8.5 design changes if this amendment is adopted (or doesn't, if rejected)

The operator decides each independently. Adopting some and rejecting others is fine. Modifying the proposed text is fine. Rejecting all and leaving v1.0 unchanged is also fine — the design body of work survives without amendments.

---

# AMENDMENT PROPOSAL 1 — MULTI-OPERATOR WORKSPACE GOVERNANCE

## The gap
Doctrine v1.0 implicitly assumes single-operator workspaces. The phrase "the operator" appears throughout in singular form, and §IX ("the pass-down is the soul of the platform") describes operator-to-operator transitions but not concurrent multi-operator workspaces.

Phase 8.5 design doesn't require multi-operator support, but Phase 9 (Design Partner Engagement) may surface partner teams (e.g., capture lead + analyst sharing a workspace). Without doctrine guidance, the platform either denies multi-operator workspaces or implements them ad-hoc.

## Why it matters
- Pass-down spec PIQ-3 (LOCKED): concurrent multi-operator handled via last-write-wins with attribution. This is a technical decision; the doctrine framing is silent.
- Phase 9 plan D-1: explicitly flags this as Doctrine amendment territory.
- Future workspaces with multiple operators need governance: who admin's, how disputes resolve, how the Sovereign archetype applies when there are multiple Sovereigns sharing terrain.

## Proposed amendment text

Add to Doctrine §VII (The Four Surfaces) or as a new §X (Multi-Operator Workspaces):

> **Multi-operator workspaces.** A workspace may host one operator or several. When a workspace hosts several operators, they share a common terrain: same Theater, same Table, same Brief, same Posture. They may disagree about the terrain; they may not disagree about the platform's representation of facts (entity provenance is sacred regardless of operator).
>
> Each operator's contributions are attributed. Tells, byPursuit notes, and influence reads carry the observing operator's identity. Edits to operator-input fields show the editing operator. No anonymous observations within a multi-operator workspace.
>
> Operator-flagged-private observations remain private to the observing operator. Doctrine §V's sacredness of private observations applies per-operator, not per-workspace.
>
> Workspace administrative rights belong to the workspace owner. Owner may transfer rights but cannot revoke another operator's attribution on prior contributions — the institutional record is durable.

## Implementation impact
- Pass-down spec PIQ-3 framing aligned with doctrine.
- Phase 9 partner cohorts can include multi-operator partner workspaces.
- Phase 8.5 implementation needs minor adjustment: edit attribution surfaced in Inspector. Negligible additional effort.

## Recommendation
Adopt. Multi-operator workspaces will arise; pre-empting governance ambiguity is cleaner than addressing post-hoc.

---

# AMENDMENT PROPOSAL 2 — CROSS-WORKSPACE INTELLIGENCE BOUNDARY

## The gap
Doctrine v1.0 doesn't address whether one operator's workspace can read another operator's workspace data. Phase 8.5 design assumes hard workspace isolation (no cross-workspace flows). Phase 9 plan D-3 reaffirms this. But the principle isn't explicitly stated in Doctrine.

Future pressure: a design partner says "I want to know what other partners are seeing on Air Force AI pursuits." Cross-workspace aggregation would be valuable but conflicts with workspace isolation.

## Why it matters
- Phase 8.5 architecture is workspace-isolated throughout.
- Phase 9 plan explicitly maintains workspace isolation.
- Future commercialization may pressure for "industry benchmark" cross-workspace features.

## Proposed amendment text

Add to Doctrine §V (Product Design Principles) or §VI (What We Will Never Build):

> **Workspace isolation is sacrosanct.** Each operator's workspace contains her institutional memory, her observations, her relationships, her pursuits. Corsair does not share this data across workspaces without explicit per-workspace consent.
>
> "Industry benchmark" features that infer patterns from aggregated cross-workspace data require explicit opt-in per workspace. Default is no aggregation.
>
> Cohort gatherings, partner forums, or other community contexts where operators share insights occur outside the platform's data layer. The platform does not act as a backchannel between operators' private workspaces.

## Implementation impact
- Confirms Phase 8.5 architecture as is. No changes needed.
- Future commercialization features in this space need explicit operator-driven opt-in flows.

## Recommendation
Adopt. Sets clear expectations early; protects future operators against subtle data-mixing.

---

# AMENDMENT PROPOSAL 3 — MANUAL IMPORT vs. AUTOMATED INTEGRATION BOUNDARY

## The gap
Doctrine v1.0 §VI excludes "data scraped from private accounts without consent" and other clearly out-of-doctrine patterns. Phase 8.5 D-1 (LOCKED) operationalizes this as default-exclude third-party scrapers + manual operator import.

But the boundary is fuzzy: when does "manual operator import" tip into "automated import operator triggers." Examples:
- Operator pastes a LinkedIn export CSV — clearly manual.
- Operator clicks a browser extension button that submits the page to Corsair — is this manual or automated?
- Operator runs a personal script that exports their LinkedIn data to JSON, then uploads — manual or automated?

The Doctrine intent (no platform-side ToS violation) is clear. The mechanics need definition.

## Why it matters
- Watchlist UX v1 supports manual import for LinkedIn-derived data.
- Phase 9 partners may want various import patterns.
- Tier 2 / Tier 3 source candidates include sources where the manual / automated boundary is unclear.

## Proposed amendment text

Add to Doctrine §VI (What We Will Never Build) as clarification:

> **The manual import boundary.** "Manual operator import" means the operator personally takes the action that retrieves the data from its source. The platform may accept, normalize, store, and present the imported data — but the platform itself does not perform the retrieval action.
>
> Operator-triggered automation (browser extensions, scripts, third-party tools) is the operator's responsibility, not the platform's. Operators may use any tool they like to acquire data they have lawful access to; what they choose to import into Corsair is their decision.
>
> The platform's role is to be a good steward of imported data: respect provenance, preserve operator-input as authoritative, never re-export to third parties without explicit consent. The platform's role is not to police the import method.
>
> Corsair will not ship features whose primary purpose is to facilitate platform-side ToS violations. Corsair will not ship features that operate without the operator's explicit, single-action consent on the importing action.

## Implementation impact
- D-1 operationalization remains as-is.
- Operator-uploaded LinkedIn exports continue to work via existing manual import UI.
- Browser extensions (if developed in future phases) are operator-side tools, not platform components. Treated as separate from Corsair core.

## Recommendation
Adopt. Clarifies operational boundary; aligns with operator's autonomy framing.

---

# AMENDMENT PROPOSAL 4 — NEW SOURCE CATEGORIES AND GRAY-ZONE PROCESS

## The gap
Doctrine v1.0 §VI lists specific exclusions and inclusions. Phase 8.5 design surfaced gray-zone sources (Appendix A in research v1) that aren't cleanly covered: ZoomInfo-class aggregators, people-search products, dark-web monitoring, mobile location brokers, etc.

The body of work treats each gray-zone source via operator review. But the *process* for evaluating new gray-zone sources isn't documented in Doctrine — only the case-by-case outcomes.

## Why it matters
- Tier 2 / Tier 3 source consideration will surface new sources not in research v1's Appendix A.
- Phase 9 partners may suggest sources Corsair hasn't evaluated.
- Future Doctrine maintenance requires a process for incorporating new evaluations.

## Proposed amendment text

Add to Doctrine §VI or as separate §VIa:

> **Gray-zone source evaluation process.** When a source's Doctrine alignment is unclear, the process is:
>
> 1. The source is classified as gray-zone until evaluation completes. Not included; not excluded; queued for review.
> 2. The operator (or designated Doctrine reviewer) evaluates the source against §VI exclusion criteria. Specific questions:
>    - Does the source's primary value depend on data acquired in violation of access controls?
>    - Does the source require deanonymization of individuals?
>    - Does the source require surveillance without subject knowledge?
>    - Does the source aggregate personal information beyond what reasonable consent permits?
> 3. If any question answers yes, the source is excluded.
> 4. If all questions answer no, the source is allowed — but with provenance and audit attention proportional to gray-zone nature.
> 5. Source classification recorded in the research catalog with reasoning.
>
> Re-evaluation occurs when source's terms of service, business model, or data practices change materially.

## Implementation impact
- Research v1 Appendix A formalized as the canonical gray-zone source record.
- Tier 2 previews Part Five (Doctrine considerations) aligns with formal process.
- Operational impact: minimal (the process is already operationally followed; this codifies it).

## Recommendation
Adopt. Codifies practice; supports Doctrine longevity.

---

# AMENDMENT PROPOSAL 5 — OPERATOR-PRIVATE VS. INSTITUTIONAL RECORD

## The gap
Doctrine §V states "the operator's private observations are sacred." Doctrine §IX states "everything the operator learns about the political terrain survives her departure." These tension in multi-operator and pass-down contexts.

Pass-down spec D-5 introduces an explicit `passDownVisible: false` flag, defaulting to `true` (Doctrine §IX wins by default). This is a reasonable operational reconciliation but not explicitly addressed in Doctrine v1.0.

## Why it matters
- Pass-down spec D-5 is operational policy; doctrine framing strengthens it.
- Phase 9 partners may have heightened concerns about post-engagement data fate.
- Future operators inheriting workspaces deserve clear expectations.

## Proposed amendment text

Add to Doctrine §V (Product Design Principles) or §IX (Pass-Down Principle):

> **Private and institutional observations.** Per §V, the operator's private observations are sacred. Per §IX, what the operator learns about the terrain survives her departure. The reconciliation: observations are presumed institutional (pass down to successors) unless the operator explicitly marks them as private to herself.
>
> The default favors institutional memory (§IX wins by default), recognizing that most observations are operationally valuable to successors.
>
> The exception is operator-flagged. Observations the operator deliberately marks private (e.g., made under conditions of trust that don't transfer, or about persons whose context is fragile) remain with the operator only. Marking is explicit; the platform never infers "this should be private."
>
> Multi-operator workspaces: privacy is per-operator. An observation private to Operator A is hidden from Operator B in the same workspace.

## Implementation impact
- Pass-down spec D-5 operationalization aligns with doctrine.
- UI for private-flagging needs to exist (currently in pass-down spec scope).
- No changes to existing Phase 8.5 schema or sub-phases.

## Recommendation
Adopt. Makes doctrine consistent with operational policy.

---

# AMENDMENT PROPOSAL 6 — WORKSPACE TRANSFER CONSENT

## The gap
Doctrine v1.0 doesn't address legitimate vs. illegitimate workspace transfers. Pass-down spec assumes transfers occur via Firebase Auth ownership change and treats them as legitimate. But Corsair-side validation of transfer legitimacy is absent.

If an operator is fired and their workspace is transferred to a replacement without their consent, is that a doctrine concern? Doctrine v1.0 is silent.

## Why it matters
- Phase 9 design partner engagement letters need to set expectations about workspace fate after engagement ends.
- Multi-operator workspaces with operator turnover need clear consent model.
- Future commercialization may involve workspace transfers as part of subscription terminations.

## Proposed amendment text

Add to Doctrine §IX (Pass-Down Principle) or §V (Product Design Principles):

> **Workspace transfer.** A workspace's accumulated institutional memory belongs to the workspace's purpose, not to any specific operator. When an operator transitions out of a role and a successor takes over, the workspace transfers with the role.
>
> The platform validates transfers via standard authentication ownership changes. It does not adjudicate the legitimacy of the transfer — that is an out-of-platform decision between the parties involved.
>
> However: the departing operator may retain a personal export of their accumulated work (Posture observations, pass-down notes they authored, observations they marked private). This export does not include other operators' contributions in shared workspaces. Operators carry their personal observational record with them; they do not strip the workspace.
>
> Workspace ownership and operator attribution are distinct. An operator who leaves loses workspace access but does not lose attribution on their contributions. The institutional record names them as the contributor of specific observations indefinitely.

## Implementation impact
- Phase 9 engagement letters cite this principle for end-of-engagement workspace status.
- Phase 8.5 implementation needs: personal export feature (Settings → "Export my personal observational record"). Modest implementation effort.

## Recommendation
Adopt. Sets clear expectations for partner engagements and future operator transitions.

---

# AMENDMENT PROPOSAL 7 — OPERATOR EXPRESSED IDENTITY ACROSS WORKSPACES

## The gap
Pre-Phase-8.5, operators are bound to single workspaces. Phase 9 may surface operators with multiple workspaces (e.g., personal workspace + team workspace). Doctrine v1.0 doesn't address the identity surface here.

The same operator in two workspaces: do they have one identity or two? If they leave one workspace, do they still own observations they made in the other?

## Why it matters
- Multi-workspace operators are increasingly likely as Phase 9 cohort matures.
- Personal observations follow the operator (per AP-6); but identity surface needs clarity.

## Proposed amendment text

Add to Doctrine §VII (The Four Surfaces) or §V (Product Design Principles):

> **Operator identity is unitary.** An operator has one identity across Corsair regardless of how many workspaces they participate in. Their contributions in any workspace carry the same authorial identity.
>
> A workspace is the working surface; the operator is the working agent. When the operator participates in multiple workspaces, the platform recognizes them as the same identity across all.
>
> Workspace-specific privileges (admin, editor, viewer) are workspace-scoped. Identity is global.

## Implementation impact
- Phase 8.5 implementation: workspace membership keyed to operator identity (already true via Firebase Auth UID).
- Phase 9 implementation: cohort tracking can reference operator identity across multiple workspaces if needed.

## Recommendation
Adopt. Codifies what's already operationally true.

---

# AMENDMENT PROPOSAL 8 — DOCTRINE AMENDMENT PROCESS

## The gap
Doctrine v1.0 doesn't specify how Doctrine itself is amended. Phase 9 plan SQ-7 proposes a structured process (founder evaluates, writes proposal, posts in partner cohort, considers input, makes final decision, publishes Doctrine v1.x with rationale). But this isn't yet in Doctrine.

## Why it matters
- This document itself is an amendment proposal. The process by which it gets adopted or rejected is undefined in v1.0.
- Future Doctrine maintenance benefits from explicit process.

## Proposed amendment text

Add to Doctrine as new §XI (Doctrine Maintenance):

> **Doctrine maintenance.** Doctrine evolves as the platform evolves. New edge cases, new operator contexts, and new ethical considerations may warrant Doctrine amendments. The process:
>
> 1. Anyone (operator, design partner, contributor) may propose a Doctrine amendment. Proposals are written as specific text additions or modifications, with rationale.
> 2. The operator (or, post-Phase-9, the designated Doctrine custodian) evaluates the proposal. Evaluation considers: alignment with existing Doctrine, operational implications, impact on platform shape, alignment with the Sovereign archetype.
> 3. If amendment is significant, the operator may consult with design partners or contributors for input.
> 4. The operator makes the final decision. Adopted amendments produce a new Doctrine version (v1.1, v1.2, etc.) with changelog at top noting what changed.
> 5. Rejected amendments are documented as rejected, with reasoning, in a Doctrine amendment record. This preserves the consideration for future readers.
>
> Doctrine versions are durable. v1.0 is the foundation; subsequent versions extend without contradicting earlier principles unless the operator deliberately retires a principle.

## Implementation impact
- This document (the amendment proposal) is the first application of the process.
- Future Doctrine maintenance follows the process.
- No technical implementation impact.

## Recommendation
Adopt. Makes the process explicit and sustainable.

---

# AMENDMENT PROPOSAL 9 — THE PLATFORM'S RELATIONSHIP TO ITS OWN STATE

## The gap
Doctrine v1.0 §IV (Confidence Principle) operates on the operator's relationship to her work. It says the operator should leave more certain of her judgment. But it's silent on the platform's relationship to its own state.

Phase 8.5 introduces source health, observability, and operational metrics. The platform now has its own state worth monitoring. Doctrine framing helps: should the platform be transparent about its own uncertainty? Should the operator trust the platform's self-report?

## Why it matters
- Source Health UI design explicitly invokes Doctrine §IV.
- Observability spec depends on the platform's honest self-reporting.
- Future automation might tempt the platform to hide internal issues to avoid alarming the operator — Doctrine clarity prevents this.

## Proposed amendment text

Add to Doctrine §IV (Confidence Principle) as a sub-principle:

> **The platform is honest about itself.** The Confidence Principle applies not only to the operator's work but to the platform's representation of its own state. When the platform doesn't know something with confidence (a sync failed, a source is stale, a data quality check produced ambiguity), it surfaces that state to the operator rather than papering over it.
>
> The platform's honesty about itself is foundational to the operator's trust in it. A platform that hides its own uncertainty cannot honor the operator's confidence.
>
> Operational implication: source health, sync state, data freshness, and failure modes are first-class visible state. Not hidden behind "everything is fine" defaults.

## Implementation impact
- Source Health UI design already operationalizes this.
- Observability spec aligns.
- Future temptations to "smooth over" issues for operator psychological comfort are explicitly out-of-doctrine.

## Recommendation
Adopt. Strengthens existing Phase 8.5 design decisions with doctrine foundation.

---

# RECOMMENDED AMENDMENT BUNDLE

If the operator adopts all nine proposals, Doctrine v1.1 changelog reads approximately:

```
Doctrine v1.1 — 2026-MM-DD

Changes:
- §V extended: private/institutional observation reconciliation (per AP-5)
- §V extended: workspace isolation as sacrosanct (per AP-2)
- §V extended: unitary operator identity (per AP-7)
- §IV extended: platform honesty about own state (per AP-9)
- §VI clarified: manual import boundary (per AP-3)
- §VI clarified: gray-zone source evaluation process (per AP-4)
- §IX extended: workspace transfer principles (per AP-6)
- New §X: multi-operator workspaces (per AP-1)
- New §XI: doctrine maintenance process (per AP-8)
```

If the operator adopts a subset, the changelog reflects only adopted amendments.

If the operator rejects all, Doctrine remains at v1.0 and this document is preserved as the rejected-proposals record (per AP-8 process step 5).

---

# OPERATOR REVIEW FORMAT

To make this efficient: each proposal can be reviewed as Accept / Reject / Modify.

```
AP-1 Multi-operator workspaces:        [ ] Accept  [ ] Reject  [ ] Modify
AP-2 Workspace isolation:              [ ] Accept  [ ] Reject  [ ] Modify
AP-3 Manual import boundary:           [ ] Accept  [ ] Reject  [ ] Modify
AP-4 Gray-zone process:                [ ] Accept  [ ] Reject  [ ] Modify
AP-5 Private/institutional reconciliation: [ ] Accept  [ ] Reject  [ ] Modify
AP-6 Workspace transfer:               [ ] Accept  [ ] Reject  [ ] Modify
AP-7 Operator identity:                [ ] Accept  [ ] Reject  [ ] Modify
AP-8 Doctrine amendment process:       [ ] Accept  [ ] Reject  [ ] Modify
AP-9 Platform honesty:                 [ ] Accept  [ ] Reject  [ ] Modify
```

For Modify selections, the operator indicates which text to change.

---

# CLOSING NOTES

## Why these proposals exist

The Phase 8.5 design body of work hit nine specific places where Doctrine v1.0 was silent. Operating under Doctrine v1.0 with silence in these places means each operational decision implicitly extends Doctrine without explicit acknowledgment. That's fragile.

Explicit amendments make the doctrine durable. Future readers see what's been considered and decided. Future Doctrine custodians have a clear precedent.

## What the proposals are not

- Not radical changes. None contradict any v1.0 principle.
- Not new principles outside the existing structure. Most extend or clarify existing §sections.
- Not technical specifications. They are doctrine; technical specs live elsewhere.
- Not urgent. Phase 8.5 design can ship without these amendments. They are improvements, not blockers.

## What happens if rejected

If the operator rejects all proposals, the Phase 8.5 design body of work still functions. The amendments make doctrine framing cleaner; they don't enable or disable features.

The rejected proposals are preserved here as a record of consideration. Future Doctrine maintenance may revisit them.

## What happens if adopted

Each adopted amendment becomes part of Doctrine v1.1. The Phase 8.5 design body of work continues to reference Doctrine v1.0 unless explicitly updated to v1.1 references. Future design work references v1.1.

## Maintenance principle

This document is v1.0 of the amendment proposals. If the operator modifies specific proposals, the modifications are tracked here as v1.1 of the amendment proposals (separate from Doctrine v1.1 itself).

---

*End of Doctrine v1.1 amendment proposals v1.0. Awaiting operator review.*
