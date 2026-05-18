// Phase 8.5.8 v1.1 — Brief Synthesis relevance scoring
//
// Per corsair-osint-brief-synthesis-v1.md Part Two §2:
//   relevance = pursuit*4.0 + adversary*3.0 + customer*2.5 + capability*1.5
//             + recency*1.0 + magnitude*1.0
//
// Each component is 0.0-1.0; total is the weighted sum (range ~0-13). The
// per-component values + the human-readable whySurfaced[] strings are
// attached to each Brief item so the client can render a "Why this
// surfaced" popover per Doctrine §IV (every score interrogable).

import type { Signal } from "../framework/types/signals";
import type { Award } from "../framework/types/awards";
import type { Opportunity } from "../framework/types/entities";

export const SCORING_WEIGHTS = {
  pursuit: 4.0,
  adversary: 3.0,
  customer: 2.5,
  capability: 1.5,
  recency: 1.0,
  magnitude: 1.0,
} as const;

export interface RelevanceComponents {
  pursuit: number;
  adversary: number;
  customer: number;
  capability: number;
  recency: number;
  magnitude: number;
  total: number;
  whySurfaced: string[];
}

export interface BriefScoringContext {
  trackedOppIds: Set<string>;
  trackedAwardIds: Set<string>;
  /** Org IDs that appear as prime/adversary on a tracked Opp */
  pursuitOrgIds: Set<string>;
  /** Currently active adversary Org IDs (across non-terminal pursuits) */
  activeAdversaryOrgIds: Set<string>;
  /** Adversary Org IDs from won/lost/archived pursuits */
  archivedAdversaryOrgIds: Set<string>;
  /** Customer agency Org IDs the operator is actively pursuing */
  customerOrgIds: Set<string>;
  /** Looser customer set — agencies on any past pursuit */
  customerHistoryOrgIds: Set<string>;
  /** NAICS codes from operator watchlists + tracked entities */
  watchlistNaics: Set<string>;
  /** PSC codes from operator watchlists */
  watchlistPsc: Set<string>;
  /** Tracked Opportunity record map — used by dedupe */
  opportunities: Map<string, Opportunity>;
  /** Tracked Award record map — used by dedupe */
  awards: Map<string, Award>;
  /** Map from PIID → awardId for fast 8-K↔Award dedupe */
  awardByPiid: Map<string, string>;
  /** v1.15: node ids with operator-authored Posture path 'Adversary'.
   *  Workspace-scoped (set by the operator on a Person record). */
  posturePathAdversaryIds?: Set<string>;
  /** v1.15: node ids with operator-authored Posture path 'Liberator' —
   *  ethically out-of-bounds operators per the doctrine. Bumped because
   *  the operator wants visibility into their activity. */
  posturePathLiberatorIds?: Set<string>;
  /** v1.15: node ids with operator-authored Posture trajectory 'Rising'. */
  postureRisingIds?: Set<string>;
  /** v1.15: node ids with operator-authored Posture trajectory 'Falling'. */
  postureFallingIds?: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard-program mention check — quick keyword scan for marquee defense
 * programs/systems. Used by analysis_publication / service_news
 * magnitude scoring (v1.10) to bump items that name a specific program
 * over generic capability commentary.
 *
 * Intentionally narrow — these are the programs operators most
 * frequently care about, not the exhaustive list. False negatives are
 * fine (falls through to default scoring); false positives are not.
 */
const HARD_PROGRAM_RE = /\b(F-?35|F-?22|F-?15EX|B-?21|KC-?46|CCA\b|NGAD\b|Sentinel|GBSD|Columbia(?:-class)?|Virginia(?:-class)?|Ford(?:-class)?|Constellation|FFG\(?X\)?|DDG\s?51|DDG\(?X\)?|SSN\(?X\)?|M1\s+Abrams|Stryker|Bradley|AMPV|OMFV|FLRAA|FARA|JLTV|Patriot|THAAD|JADC2|ABMS|Replicator|Hypersonic|LRHW|SBIRS|GPS\s+III|Next\s+Generation\s+OPIR|Trident\s+II|Tomahawk|AEGIS|F-?47)\b/i;

function mentionsHardProgram(text: string): boolean {
  if (!text) return false;
  return HARD_PROGRAM_RE.test(text);
}

function recencyFactor(occurredAtMs: number, nowMs: number): number {
  const hours = (nowMs - occurredAtMs) / 3600000;
  if (hours < 0) return 1.0;
  if (hours <= 6) return 1.0;
  if (hours <= 12) return 0.8;
  if (hours <= 24) return 0.5;
  if (hours <= 48) return 0.25;
  return 0.1;
}

function naicsAdjacent(a: string | undefined, watchlist: Set<string>): {
  match: "exact" | "adjacent" | "broader" | null;
} {
  if (!a) return { match: null };
  if (watchlist.has(a)) return { match: "exact" };
  // 4-digit group adjacency
  const grp = a.slice(0, 4);
  for (const w of watchlist) {
    if (w.slice(0, 4) === grp) return { match: "adjacent" };
  }
  // 2-digit sector broader
  const sec = a.slice(0, 2);
  for (const w of watchlist) {
    if (w.slice(0, 2) === sec) return { match: "broader" };
  }
  return { match: null };
}

function collectIds(item: {
  subjectIds?: string[];
  relatedIds?: string[];
  primeOrgId?: string;
  customerOrgId?: string;
  customerToptierOrgId?: string;
}): Set<string> {
  const ids = new Set<string>();
  (item.subjectIds ?? []).forEach((i) => i && ids.add(i));
  (item.relatedIds ?? []).forEach((i) => i && ids.add(i));
  if (item.primeOrgId) ids.add(item.primeOrgId);
  if (item.customerOrgId) ids.add(item.customerOrgId);
  if (item.customerToptierOrgId) ids.add(item.customerToptierOrgId);
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind scoring
// ─────────────────────────────────────────────────────────────────────────────

function magnitudeForAward(obligated: number): { score: number; why: string } {
  if (obligated >= 50_000_000) return { score: 1.0, why: `$${(obligated / 1e6).toFixed(0)}M obligated; above $50M threshold` };
  if (obligated >= 10_000_000) return { score: 0.7, why: `$${(obligated / 1e6).toFixed(1)}M obligated; mid-tier value` };
  if (obligated >= 1_000_000) return { score: 0.4, why: `$${(obligated / 1e6).toFixed(2)}M obligated` };
  return { score: 0.2, why: `$${obligated.toLocaleString()} obligated` };
}

function magnitudeForSignal(signal: Signal): { score: number; why: string } {
  const attrs = signal.attrs as Record<string, unknown>;
  switch (signal.type) {
    case "material_event": {
      const items = (attrs.items as string[]) ?? [];
      if (items.includes("1.01")) return { score: 0.8, why: "8-K item 1.01 (material definitive contract)" };
      if (items.includes("5.02")) return { score: 0.8, why: "8-K item 5.02 (executive transition)" };
      return { score: 0.5, why: `8-K filing (items: ${items.join(",") || "n/a"})` };
    }
    case "periodic_report": {
      // v1.5 — leverages SEC EDGAR v1.2.1 deep-parsed 10-K/Q attrs.
      // Defense-tagged backlog is the strongest BD signal (size of book at
      // a competing prime), then total backlog, then MD&A presence.
      const form = (attrs.formType as string) || "10-K/Q";
      const extracted = (attrs.extractedSections as Record<string, unknown>) || {};
      const backlogDefense = Number(extracted.backlogDefense ?? 0);
      const backlogTotal = Number(extracted.backlogTotal ?? 0);
      const segCount = Array.isArray(attrs.defenseSegmentMentions)
        ? (attrs.defenseSegmentMentions as unknown[]).length
        : 0;
      if (backlogDefense >= 50_000_000_000) {
        return { score: 1.0, why: `${form} disclosed defense backlog $${(backlogDefense / 1e9).toFixed(0)}B — size-of-book signal` };
      }
      if (backlogDefense >= 10_000_000_000) {
        return { score: 0.85, why: `${form} disclosed defense backlog $${(backlogDefense / 1e9).toFixed(1)}B` };
      }
      if (backlogDefense >= 1_000_000_000) {
        return { score: 0.7, why: `${form} disclosed defense backlog $${(backlogDefense / 1e9).toFixed(2)}B` };
      }
      if (backlogTotal >= 50_000_000_000) {
        return { score: 0.7, why: `${form} disclosed total backlog $${(backlogTotal / 1e9).toFixed(0)}B` };
      }
      if (backlogTotal >= 10_000_000_000) {
        return { score: 0.6, why: `${form} disclosed total backlog $${(backlogTotal / 1e9).toFixed(1)}B` };
      }
      if (segCount > 0) {
        return { score: 0.55, why: `${form} with ${segCount} defense segment(s) named` };
      }
      // Falls back when only metadata or parse-failed
      return { score: 0.6, why: `${form} periodic report` };
    }
    case "insider_transaction": {
      // v1.4 — leverages SEC EDGAR v1.2 deep-parsed Form 4 attrs.
      // Codes: P (open-market purchase) is the strongest posture signal —
      // insiders rarely buy with their own money. S (open-market sale)
      // matters more when the insider is an officer + value is large.
      // A (grant) and F/G (mechanical) are low signal regardless of size.
      const total = Number(attrs.aggregateValue ?? attrs.totalValue ?? 0);
      const code = (attrs.transactionCode as string | undefined) || "";
      const isOfficer = !!attrs.insiderIsOfficer;
      const isDirector = !!attrs.insiderIsDirector;
      const isTenPercent = !!attrs.insiderIsTenPercentOwner;
      const officerTier = isOfficer || isTenPercent;
      const title = (attrs.insiderTitle as string | undefined) || "";
      const titleText = title ? ` (${title})` : "";

      // Mechanical codes — irrelevant for posture
      if (code === "F" || code === "G") {
        return { score: 0.15, why: `Form 4 mechanical ${code === "F" ? "tax withholding" : "gift"} — low signal` };
      }
      // Open-market purchase — the strongest signal
      if (code === "P") {
        if (officerTier && total >= 1_000_000) return { score: 1.0, why: `Officer P open-market purchase $${(total/1e6).toFixed(1)}M${titleText} — strong posture signal` };
        if (officerTier && total >= 100_000) return { score: 0.85, why: `Officer P open-market purchase $${(total/1e3).toFixed(0)}K${titleText}` };
        if (isDirector && total >= 250_000) return { score: 0.7, why: `Director P open-market purchase $${(total/1e3).toFixed(0)}K` };
        if (total >= 250_000) return { score: 0.6, why: `Insider P open-market purchase $${(total/1e3).toFixed(0)}K` };
        return { score: 0.45, why: `Form 4 P (insider purchase)` };
      }
      // Open-market sale — magnitude scales with role + size
      if (code === "S") {
        if (officerTier && total >= 5_000_000) return { score: 0.75, why: `Officer S open-market sale $${(total/1e6).toFixed(1)}M${titleText}` };
        if (officerTier && total >= 1_000_000) return { score: 0.55, why: `Officer S open-market sale $${(total/1e6).toFixed(1)}M${titleText}` };
        if (total >= 1_000_000) return { score: 0.4, why: `Insider S sale $${(total/1e6).toFixed(1)}M` };
        return { score: 0.25, why: `Form 4 S (sale)` };
      }
      // Derivative exercise / conversion — moderate when significant size
      if (code === "M" || code === "X" || code === "C") {
        if (total >= 1_000_000) return { score: 0.4, why: `Form 4 ${code} (derivative exercise) $${(total/1e6).toFixed(1)}M` };
        return { score: 0.25, why: `Form 4 ${code} (derivative exercise)` };
      }
      // Grant / award — compensation event, lower signal
      if (code === "A") {
        if (total >= 5_000_000) return { score: 0.4, why: `Form 4 A (large grant) $${(total/1e6).toFixed(1)}M` };
        return { score: 0.25, why: `Form 4 A (grant)` };
      }
      // Fallback (J, D, etc., or v1.1 metadata-only)
      if (total >= 1_000_000) return { score: 0.5, why: `Form 4 insider transaction >$1M` };
      return { score: 0.3, why: `Form 4 insider transaction` };
    }
    case "protest": {
      // v1.4 — leverages GAO Protest v1.1 decision-PDF-parsed attrs.
      const outcome = attrs.outcome as string | undefined;
      const status = attrs.status as string | undefined;
      const hasCorrective = !!attrs.correctiveAction;
      if (outcome === "sustained") {
        return { score: hasCorrective ? 1.0 : 0.9, why: `GAO protest sustained${hasCorrective ? " with corrective action" : ""} — competitive opening` };
      }
      if (outcome === "settled" || hasCorrective) {
        return { score: 0.75, why: `GAO protest settled / corrective action — procurement reset` };
      }
      if (outcome === "withdrawn") {
        return { score: 0.35, why: `GAO protest withdrawn` };
      }
      if (outcome === "dismissed_partial") {
        return { score: 0.55, why: `GAO protest dismissed in part` };
      }
      if (outcome === "dismissed_full") {
        return { score: 0.4, why: `GAO protest dismissed` };
      }
      if (outcome === "denied") return { score: 0.4, why: `GAO protest denied` };
      if (status === "pending") return { score: 0.5, why: `GAO protest pending decision` };
      return { score: 0.4, why: `GAO protest (${status || "unknown status"})` };
    }
    case "congressional_hearing":
      return { score: 0.7, why: "Congressional hearing on tracked topic" };
    case "nomination": {
      const status = attrs.status as string | undefined;
      if (status === "confirmed") return { score: 0.7, why: "Senate confirmation" };
      return { score: 0.3, why: `Nomination introduced (${status || "pending"})` };
    }
    case "committee_meeting":
      return { score: 0.5, why: "FACA committee meeting" };
    case "proxy_statement": {
      // v1.5 — leverages SEC EDGAR v1.2.2 deep-parsed DEF 14A attrs.
      // Annual proxy statements; the recurring CEO compensation snapshot
      // is moderate-signal context (sized as posture intensity). Material
      // shareholder activity (proposals, board declassification, multiple
      // SH proposals) bumps the signal — those events are operator-
      // actionable governance shifts.
      const ceoComp = Number(attrs.ceoTotalComp ?? 0);
      const top5 = Number(attrs.top5TotalComp ?? 0);
      const shProps = Number(attrs.shareholderProposalCount ?? 0);
      const hasDeclass = !!attrs.hasBoardDeclassification;

      if (hasDeclass) {
        return { score: 0.7, why: `DEF 14A board-declassification proposal — governance shift` };
      }
      if (shProps >= 5) {
        return { score: 0.65, why: `DEF 14A with ${shProps} shareholder proposals — heavy SH activity` };
      }
      if (shProps >= 2) {
        return { score: 0.5, why: `DEF 14A with ${shProps} shareholder proposals` };
      }
      if (ceoComp >= 50_000_000) {
        return { score: 0.55, why: `DEF 14A CEO total comp $${(ceoComp / 1e6).toFixed(0)}M — outlier compensation` };
      }
      if (ceoComp >= 20_000_000) {
        return { score: 0.45, why: `DEF 14A CEO total comp $${(ceoComp / 1e6).toFixed(1)}M` };
      }
      if (top5 >= 50_000_000) {
        return { score: 0.45, why: `DEF 14A top-5 NEO comp $${(top5 / 1e6).toFixed(1)}M aggregate` };
      }
      return { score: 0.3, why: `DEF 14A proxy statement` };
    }
    case "budget_change": {
      // v1.9 — DoD Comptroller v1.1 lifts best-effort FY funding tables
      // (latestFyAmountMillions, fyFundingTotalMillions). Magnitude
      // now ranks on dollar amount when present, narrative length when
      // funding parse missed.
      const pe = (attrs.pe as string | undefined) || "";
      const narrative = (attrs.narrative as string | undefined) || "";
      const narrativeLen = narrative.length;
      const baseline = !!attrs.baseline;
      const bookType = (attrs.bookType as string | undefined) || "";
      const service = (attrs.serviceLabel as string | undefined) || (attrs.service as string | undefined) || "";
      const latestFy = (attrs.latestFy as string | undefined) || "";
      const latestFyAmount = Number(attrs.latestFyAmountMillions ?? 0);
      const fyTotal = Number(attrs.fyFundingTotalMillions ?? 0);

      // R-2 (RDT&E) is more forward-looking than P-1 (procurement) for
      // BD operators — new programs and capability bets show up here
      // before they hit procurement. Bias R-2 up across all tiers.
      const isRdte = /^R-?2/.test(bookType);

      // Dollar-based scoring takes precedence when v1.1 funding parse
      // succeeded. Budget books use millions natively.
      if (latestFyAmount > 0) {
        const $M = latestFyAmount.toFixed(1);
        const fyLabel = latestFy ? `FY${latestFy} ` : "";
        if (latestFyAmount >= 1000) {
          return {
            score: 1.0,
            why: `${service} ${bookType} PE ${pe} ${fyLabel}$${$M}M — major program line`,
          };
        }
        if (latestFyAmount >= 250) {
          return {
            score: isRdte ? 0.9 : 0.85,
            why: `${service} ${bookType} PE ${pe} ${fyLabel}$${$M}M`,
          };
        }
        if (latestFyAmount >= 50) {
          return {
            score: isRdte ? 0.75 : 0.7,
            why: `${service} ${bookType} PE ${pe} ${fyLabel}$${$M}M`,
          };
        }
        if (latestFyAmount >= 10) {
          return {
            score: isRdte ? 0.6 : 0.55,
            why: `${service} ${bookType} PE ${pe} ${fyLabel}$${$M}M`,
          };
        }
        return {
          score: isRdte ? 0.5 : 0.45,
          why: `${service} ${bookType} PE ${pe} ${fyLabel}$${$M}M`,
        };
      }

      // Fallback to v1.8 narrative-length tiers when no FY funding parsed
      if (narrativeLen >= 1500) {
        return {
          score: isRdte ? 0.7 : 0.6,
          why: `${service ? service + " " : ""}${bookType || "budget"} PE ${pe} — substantive narrative (${narrativeLen} chars)`,
        };
      }
      if (narrativeLen >= 400) {
        return {
          score: isRdte ? 0.55 : 0.5,
          why: `${service ? service + " " : ""}${bookType || "budget"} PE ${pe}`,
        };
      }
      if (fyTotal > 0) {
        // Has total but no latest — middle tier
        return {
          score: 0.45,
          why: `${service ? service + " " : ""}${bookType || "budget"} PE ${pe} total $${fyTotal.toFixed(1)}M`,
        };
      }
      if (baseline) {
        return {
          score: 0.4,
          why: `${service ? service + " " : ""}${bookType || "budget"} PE ${pe} baseline catalog entry`,
        };
      }
      return {
        score: 0.35,
        why: `Budget PE ${pe || "(unknown)"}`,
      };
    }
    case "lobbying_disclosure": {
      // v1.7 — Senate LDA v1.0 lobbying_disclosure Signals. BD-operator
      // magnitude is driven by (1) dollar amount (intensity of spend),
      // (2) revolving-door lobbyist count (former Hill/agency staff
      // lobbying on the same issue they used to oversee — strong posture
      // signal), and (3) defense-specific issue codes mentioned.
      const amount = Number(attrs.income ?? attrs.expenses ?? attrs.reportedDollarAmount ?? 0);
      const revolvingDoor = Number(attrs.revolvingDoorCount ?? 0);
      const issueCodes = Array.isArray(attrs.issueCodes)
        ? (attrs.issueCodes as string[])
        : [];
      const isDefenseIssue = issueCodes.indexOf("DEF") >= 0;
      const govEntitiesCount = Array.isArray(attrs.governmentEntities)
        ? (attrs.governmentEntities as unknown[]).length
        : 0;

      // Revolving-door lobbyists are the strongest qualitative posture
      // signal — a former HASC staffer lobbying for a defense prime on
      // an NDAA section is operator-actionable intelligence.
      if (revolvingDoor >= 5 && isDefenseIssue) {
        return {
          score: 0.95,
          why: `LDA filing — ${revolvingDoor} revolving-door lobbyists on defense issues`,
        };
      }
      if (revolvingDoor >= 3) {
        return {
          score: 0.85,
          why: `LDA filing — ${revolvingDoor} revolving-door lobbyists`,
        };
      }
      // Heavy spend is the quantitative signal
      if (amount >= 1_000_000 && isDefenseIssue) {
        return {
          score: 0.8,
          why: `LDA filing $${(amount / 1e6).toFixed(2)}M on defense issues`,
        };
      }
      if (amount >= 1_000_000) {
        return {
          score: 0.65,
          why: `LDA filing $${(amount / 1e6).toFixed(2)}M`,
        };
      }
      if (revolvingDoor >= 1 && isDefenseIssue) {
        return {
          score: 0.7,
          why: `LDA filing — ${revolvingDoor} revolving-door lobbyist(s) on defense`,
        };
      }
      if (amount >= 250_000 && isDefenseIssue) {
        return {
          score: 0.6,
          why: `LDA filing $${Math.round(amount / 1e3)}K on defense issues`,
        };
      }
      if (amount >= 250_000) {
        return {
          score: 0.45,
          why: `LDA filing $${Math.round(amount / 1e3)}K`,
        };
      }
      if (govEntitiesCount >= 5) {
        return {
          score: 0.5,
          why: `LDA filing touching ${govEntitiesCount} government entities`,
        };
      }
      if (isDefenseIssue) {
        return { score: 0.5, why: `LDA filing on defense issues` };
      }
      return { score: 0.3, why: `LDA filing` };
    }
    case "advisory_body_report": {
      // v1.6 — leverages Advisory Boards (DSB/DBB/DIB) v1.0 deep-parsed
      // report attrs. These bodies advise OSD on capability, business, and
      // innovation policy; their recommendations often anticipate 12-24-
      // month budget direction. BD-operator-actionable magnitude is driven
      // by (1) presence of contractor + program mentions (concrete vs.
      // abstract), (2) recommendations count (concrete vs. survey), and
      // (3) report kind — memos and letters tend to be more urgent than
      // annual reports or surveys.
      const board = (attrs.board as string | undefined) || "";
      const boardLabel = (attrs.boardLabel as string | undefined) || board.toUpperCase() || "Advisory";
      const kind = (attrs.reportKind as string | undefined) || "";
      const recCount = Array.isArray(attrs.recommendations)
        ? (attrs.recommendations as unknown[]).length
        : 0;
      const findingsCount = Array.isArray(attrs.findings)
        ? (attrs.findings as unknown[]).length
        : 0;
      const contractorsCount = Array.isArray(attrs.contractors)
        ? (attrs.contractors as unknown[]).length
        : 0;
      const programsCount = Array.isArray(attrs.programs)
        ? (attrs.programs as unknown[]).length
        : 0;

      // Concrete + actionable: contractors named + recommendations made
      if (recCount >= 3 && contractorsCount >= 3) {
        return {
          score: 0.85,
          why: `${boardLabel} ${kind || "report"} — ${recCount} recommendations touching ${contractorsCount} contractor(s)`,
        };
      }
      // Memos and letters: short-form by definition → operator-relevant
      // bias toward urgent. Bump when they carry recommendations.
      if (kind === "memo" || kind === "letter") {
        if (recCount >= 1) {
          return {
            score: 0.7,
            why: `${boardLabel} ${kind} with ${recCount} recommendation(s) — short-form urgent`,
          };
        }
        return { score: kind === "memo" ? 0.6 : 0.5, why: `${boardLabel} ${kind}` };
      }
      // Substantive recommendations or substantive findings with program scope
      if (recCount >= 3) {
        return {
          score: 0.7,
          why: `${boardLabel} ${kind || "report"} with ${recCount} recommendations`,
        };
      }
      if (findingsCount >= 3 && programsCount >= 1) {
        return {
          score: 0.65,
          why: `${boardLabel} ${kind || "report"} — ${findingsCount} findings touching ${programsCount} program(s)`,
        };
      }
      if (findingsCount >= 1 && contractorsCount >= 1) {
        return {
          score: 0.55,
          why: `${boardLabel} ${kind || "report"} — ${findingsCount} findings, ${contractorsCount} contractor(s) named`,
        };
      }
      // Studies: substantive by their nature even when our parser missed
      // the structured bullets — bias up vs. annual reports.
      if (kind === "study") {
        return { score: 0.55, why: `${boardLabel} study` };
      }
      // Annual reports: institutional ceremony unless specifically
      // mentioning programs/contractors.
      if (kind === "annual_report") {
        if (programsCount >= 2 || contractorsCount >= 2) {
          return {
            score: 0.5,
            why: `${boardLabel} annual report mentions ${programsCount} program(s) / ${contractorsCount} contractor(s)`,
          };
        }
        return { score: 0.35, why: `${boardLabel} annual report` };
      }
      // Fallback — generic advisory body report
      return { score: 0.4, why: `${boardLabel} ${kind || "advisory body report"}` };
    }
    case "oversight_finding": {
      // v1.4 — leverages GAO Reports v1.1 deep-parsed report attrs.
      // Non-concurrence by the agency is the highest-signal posture event:
      // the auditee is publicly disputing GAO's findings — leading
      // indicator of procurement risk + contractor trouble.
      const response = (attrs.agencyResponse as string | undefined) || "";
      const kind = (attrs.reportKind as string | undefined) || "";
      const findingsCount = Array.isArray(attrs.findings) ? (attrs.findings as unknown[]).length : 0;
      const contractorsCount = Array.isArray(attrs.contractors) ? (attrs.contractors as unknown[]).length : 0;

      if (response === "non_concur") {
        return { score: 0.9, why: `GAO ${kind || "report"} — agency disputes findings (non-concur)` };
      }
      if (response === "partial_concur") {
        return { score: 0.65, why: `GAO ${kind || "report"} — agency partially concurs` };
      }
      if (kind === "testimony") {
        return { score: 0.6, why: `GAO testimony before Congress` };
      }
      if (findingsCount > 0 && contractorsCount > 0) {
        return { score: 0.55, why: `GAO ${kind || "report"} — ${findingsCount} findings touching ${contractorsCount} contractor(s)` };
      }
      if (findingsCount > 0) {
        return { score: 0.45, why: `GAO ${kind || "report"} — ${findingsCount} findings` };
      }
      return { score: 0.35, why: `GAO ${kind || "oversight"} finding` };
    }
    case "opportunity_amendment": {
      const changes = (attrs.changes as Array<{ field: string }>) ?? [];
      const hasDeadline = changes.some((c) => /deadline|due|response/i.test(c.field || ""));
      if (hasDeadline) return { score: 0.6, why: "SAM.gov amendment changed response deadline" };
      return { score: 0.3, why: "SAM.gov amendment (non-deadline change)" };
    }
    case "award_modification":
      return { score: 0.5, why: "Award modification" };
    case "award_terminated":
      return { score: 0.85, why: "Award terminated (T4D/T4C) — competitive opening" };
    case "analysis_publication": {
      // v1.10 — think_tank publication. Magnitude is shaped by:
      //   (1) hard-program mention in title (concrete topic, not survey),
      //   (2) author presence (named expert > aggregated commentary),
      //   (3) tank tier (CSIS / RAND / CNAS are higher-signal than smaller
      //   shops — but tier weighting is per-workspace operator preference,
      //   so v1.10 stays tank-agnostic; the cross-source touches popover
      //   shows the tank already).
      const title = (attrs.title as string | undefined) || "";
      const author = (attrs.author as string | undefined) || "";
      const tankName = (attrs.tankName as string | undefined) || "Think tank";
      if (mentionsHardProgram(title)) {
        return {
          score: 0.65,
          why: `${tankName} analysis names a hard program: "${title.slice(0, 80)}"`,
        };
      }
      if (author && title.length > 100) {
        return {
          score: 0.55,
          why: `${tankName} authored analysis by ${author}`,
        };
      }
      if (author) {
        return { score: 0.5, why: `${tankName} analysis by ${author}` };
      }
      return { score: 0.4, why: `${tankName} publication` };
    }
    case "service_news": {
      // v1.10 — service-branch news. Leadership transitions are the
      // strongest BD signal in this stream — new SES / GO/FO assignment
      // resets the customer landscape on every pursuit touching that
      // command. Hard-program mentions in service-branch press releases
      // also tend to be substantive (rather than recruiting / PA filler).
      const isLeadership = !!attrs.isLeadershipAnnouncement;
      const title = (attrs.title as string | undefined) || "";
      const serviceName = (attrs.serviceName as string | undefined) || "Service";
      if (isLeadership) {
        return {
          score: 0.75,
          why: `${serviceName} leadership announcement: "${title.slice(0, 100)}"`,
        };
      }
      if (mentionsHardProgram(title)) {
        return {
          score: 0.6,
          why: `${serviceName} news names a hard program: "${title.slice(0, 100)}"`,
        };
      }
      return { score: 0.4, why: `${serviceName} news` };
    }
    case "fms_notification": {
      // v1.10 — DSCA Foreign Military Sales notification. Dollar value is
      // the dominant magnitude axis. isMde (Major Defense Equipment) flags
      // the high-end qualitative tier per DSCA classification.
      const dv = Number(attrs.dollarValue ?? 0);
      const country = (attrs.country as string | undefined) || "buyer";
      const platform = (attrs.platform as string | undefined) || "platform";
      const isMde = !!attrs.isMde;
      if (dv >= 5_000_000_000) {
        return { score: 1.0, why: `FMS to ${country}: ${platform} $${(dv / 1e9).toFixed(1)}B — top-tier sale` };
      }
      if (dv >= 1_000_000_000) {
        return { score: 0.85, why: `FMS to ${country}: ${platform} $${(dv / 1e9).toFixed(2)}B` };
      }
      if (dv >= 250_000_000) {
        return { score: 0.7, why: `FMS to ${country}: ${platform} $${(dv / 1e6).toFixed(0)}M` };
      }
      if (dv >= 50_000_000) {
        return { score: 0.55, why: `FMS to ${country}: ${platform} $${(dv / 1e6).toFixed(0)}M` };
      }
      if (isMde) {
        return { score: 0.6, why: `FMS to ${country}: MDE ${platform}` };
      }
      if (dv > 0) {
        return { score: 0.45, why: `FMS to ${country}: ${platform} $${(dv / 1e6).toFixed(1)}M` };
      }
      return { score: 0.4, why: `FMS notification: ${platform} to ${country}` };
    }
    case "committee_recommendation":
      // v1.10 — FACA committee recommendation. By definition an action
      // signal (recommendations vs. meeting minutes). Bumped above the
      // committee_meeting baseline (0.5) without being noise-level.
      return { score: 0.6, why: "FACA committee recommendation issued" };
    default:
      return { score: 0.3, why: `${signal.type.replace(/_/g, " ")} signal` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public scorers
// ─────────────────────────────────────────────────────────────────────────────

export function scoreSignal(
  signal: Signal,
  ctx: BriefScoringContext,
  nowMs: number = Date.now()
): RelevanceComponents {
  const ids = collectIds({ subjectIds: signal.subjectIds, relatedIds: signal.relatedIds });
  const why: string[] = [];

  // Pursuit
  let pursuit = 0;
  for (const id of ids) {
    if (ctx.trackedOppIds.has(id) || ctx.trackedAwardIds.has(id)) {
      pursuit = 1.0;
      why.push(`Direct touch on tracked entity ${id}`);
      break;
    }
  }
  if (pursuit < 1.0) {
    for (const id of ids) {
      if (ctx.pursuitOrgIds.has(id)) {
        pursuit = Math.max(pursuit, 0.6);
        why.push(`Touches Organization linked to a tracked pursuit`);
        break;
      }
    }
  }

  // Adversary
  let adversary = 0;
  for (const id of ids) {
    if (ctx.activeAdversaryOrgIds.has(id)) {
      adversary = 1.0;
      why.push(`Touches an active adversary on a tracked pursuit`);
      break;
    }
  }
  if (adversary === 0) {
    for (const id of ids) {
      if (ctx.archivedAdversaryOrgIds.has(id)) {
        adversary = 0.3;
        why.push(`Adversary on an archived/lost pursuit`);
        break;
      }
    }
  }

  // Customer
  let customer = 0;
  for (const id of ids) {
    if (ctx.customerOrgIds.has(id)) {
      customer = 1.0;
      why.push(`Customer agency in your active watchlist`);
      break;
    }
  }
  if (customer === 0) {
    for (const id of ids) {
      if (ctx.customerHistoryOrgIds.has(id)) {
        customer = 0.5;
        why.push(`Customer agency from prior pursuit history`);
        break;
      }
    }
  }

  // Capability — pull NAICS/PSC from signal attrs if present
  const attrs = signal.attrs as Record<string, unknown>;
  const naics = (attrs.naics as string) || (attrs.naicsCode as string) || undefined;
  let capability = 0;
  if (naics) {
    const m = naicsAdjacent(naics, ctx.watchlistNaics);
    if (m.match === "exact") {
      capability = 1.0;
      why.push(`NAICS ${naics} in your watchlist (exact)`);
    } else if (m.match === "adjacent") {
      capability = 0.6;
      why.push(`NAICS ${naics} adjacent to your watchlist (same 4-digit group)`);
    } else if (m.match === "broader") {
      capability = 0.3;
      why.push(`NAICS ${naics} in your broader sector`);
    }
  }

  // Recency
  const recency = recencyFactor(signal.occurredAt, nowMs);
  if (recency >= 0.8) why.push(`Less than 12 hours old`);
  else if (recency >= 0.5) why.push(`Posted within last day`);

  // Magnitude
  const mag = magnitudeForSignal(signal);
  why.push(mag.why);

  const total =
    pursuit * SCORING_WEIGHTS.pursuit +
    adversary * SCORING_WEIGHTS.adversary +
    customer * SCORING_WEIGHTS.customer +
    capability * SCORING_WEIGHTS.capability +
    recency * SCORING_WEIGHTS.recency +
    mag.score * SCORING_WEIGHTS.magnitude;

  return { pursuit, adversary, customer, capability, recency, magnitude: mag.score, total, whySurfaced: why };
}

export function scoreAward(
  award: Award,
  ctx: BriefScoringContext,
  nowMs: number = Date.now()
): RelevanceComponents {
  const ids = collectIds({
    subjectIds: [award.id],
    primeOrgId: award.primeOrgId,
    customerOrgId: award.customerOrgId,
    customerToptierOrgId: award.customerToptierOrgId,
  });
  const why: string[] = [];

  // Pursuit — Award is itself a tracked entity if in workspace
  let pursuit = ctx.trackedAwardIds.has(award.id) ? 1.0 : 0;
  if (pursuit === 0) {
    for (const id of ids) {
      if (ctx.trackedOppIds.has(id) || ctx.pursuitOrgIds.has(id)) {
        pursuit = 0.6;
        why.push(`Award's parties touch a tracked pursuit`);
        break;
      }
    }
  } else {
    why.push(`Award is itself a tracked entity in your workspace`);
  }

  // Adversary — is the prime an adversary?
  let adversary = 0;
  if (award.primeOrgId && ctx.activeAdversaryOrgIds.has(award.primeOrgId)) {
    adversary = 1.0;
    why.push(`Award won by an active adversary`);
  } else if (award.primeOrgId && ctx.archivedAdversaryOrgIds.has(award.primeOrgId)) {
    adversary = 0.3;
    why.push(`Award won by an adversary from archived pursuit`);
  }

  // Customer
  let customer = 0;
  if (award.customerOrgId && ctx.customerOrgIds.has(award.customerOrgId)) {
    customer = 1.0;
    why.push(`Customer agency in your active watchlist`);
  } else if (award.customerToptierOrgId && ctx.customerOrgIds.has(award.customerToptierOrgId)) {
    customer = 1.0;
    why.push(`Toptier agency in your active watchlist`);
  } else if (
    (award.customerOrgId && ctx.customerHistoryOrgIds.has(award.customerOrgId)) ||
    (award.customerToptierOrgId && ctx.customerHistoryOrgIds.has(award.customerToptierOrgId))
  ) {
    customer = 0.5;
    why.push(`Customer agency from prior pursuit history`);
  }

  // Capability
  let capability = 0;
  if (award.naics) {
    const m = naicsAdjacent(award.naics, ctx.watchlistNaics);
    if (m.match === "exact") {
      capability = 1.0;
      why.push(`NAICS ${award.naics} in your watchlist (exact)`);
    } else if (m.match === "adjacent") {
      capability = 0.6;
      why.push(`NAICS ${award.naics} adjacent`);
    } else if (m.match === "broader") {
      capability = 0.3;
      why.push(`NAICS ${award.naics} in your broader sector`);
    }
  }

  // Recency — use lastModifiedAt or awardedAt
  const ts = award.lastModifiedAt || award.awardedAt || nowMs;
  const recency = recencyFactor(ts, nowMs);
  if (recency >= 0.8) why.push(`Less than 12 hours old`);

  // Magnitude
  const mag = magnitudeForAward(award.obligated || 0);
  why.push(mag.why);

  // Expiring/recompete bonus: nudge urgency by adding magnitude weight
  let magScore = mag.score;
  if (award.lifecycleState === "expiring") {
    magScore = Math.min(1.0, mag.score + 0.1);
    why.push(`Expiring — recompete candidate`);
  } else if (award.lifecycleState === "terminated") {
    magScore = Math.min(1.0, mag.score + 0.2);
    why.push(`Terminated — competitive opening`);
  }

  const total =
    pursuit * SCORING_WEIGHTS.pursuit +
    adversary * SCORING_WEIGHTS.adversary +
    customer * SCORING_WEIGHTS.customer +
    capability * SCORING_WEIGHTS.capability +
    recency * SCORING_WEIGHTS.recency +
    magScore * SCORING_WEIGHTS.magnitude;

  return { pursuit, adversary, customer, capability, recency, magnitude: magScore, total, whySurfaced: why };
}

export function scoreOpportunity(
  opp: Opportunity,
  ctx: BriefScoringContext,
  nowMs: number = Date.now()
): RelevanceComponents {
  const why: string[] = [];
  // Pursuit — tracked Opp = direct touch
  const pursuit = ctx.trackedOppIds.has(opp.id) ? 1.0 : 0;
  if (pursuit) why.push(`Opportunity is in your tracked pipeline`);

  // Adversary — none directly; Opps don't ship with adversaries from sources
  const adversary = 0;

  // Customer
  let customer = 0;
  if (opp.customerOrgId && ctx.customerOrgIds.has(opp.customerOrgId)) {
    customer = 1.0;
    why.push(`Customer agency in your active watchlist`);
  } else if (opp.customerOrgId && ctx.customerHistoryOrgIds.has(opp.customerOrgId)) {
    customer = 0.5;
    why.push(`Customer agency from prior pursuit history`);
  }

  // Capability
  let capability = 0;
  const naicsList = opp.naicsCodes ?? [];
  for (const n of naicsList) {
    const m = naicsAdjacent(n, ctx.watchlistNaics);
    if (m.match === "exact") {
      capability = 1.0;
      why.push(`NAICS ${n} in your watchlist (exact)`);
      break;
    }
    if (m.match === "adjacent" && capability < 0.6) {
      capability = 0.6;
      why.push(`NAICS ${n} adjacent to your watchlist`);
    }
    if (m.match === "broader" && capability < 0.3) {
      capability = 0.3;
      why.push(`NAICS ${n} in your broader sector`);
    }
  }

  // Recency
  const ts = opp.samgovPostedDate || (typeof opp.stageEnteredAt === "number" ? opp.stageEnteredAt : nowMs);
  const recency = recencyFactor(ts, nowMs);
  if (recency >= 0.8) why.push(`Posted within last 12 hours`);

  // Magnitude — Opportunity dollar value tends to be free-text; only use
  // estimatedValueNumeric if present
  let magnitude = 0.4;
  const v = opp.estimatedValueNumeric;
  if (v) {
    if (v >= 50_000_000) {
      magnitude = 1.0;
      why.push(`Est. $${(v / 1e6).toFixed(0)}M ceiling`);
    } else if (v >= 10_000_000) {
      magnitude = 0.7;
      why.push(`Est. $${(v / 1e6).toFixed(1)}M ceiling`);
    } else {
      magnitude = 0.4;
      why.push(`Est. $${(v / 1e3).toFixed(0)}K ceiling`);
    }
  } else {
    why.push(`Opportunity posted to SAM.gov`);
  }

  // Notice-type bonus
  const baseType = (opp.samgovBaseType || "").toLowerCase();
  if (/solicitation|rfp/.test(baseType)) {
    magnitude = Math.min(1.0, magnitude + 0.2);
    why.push(`Solicitation/RFP — active opportunity`);
  }

  const total =
    pursuit * SCORING_WEIGHTS.pursuit +
    adversary * SCORING_WEIGHTS.adversary +
    customer * SCORING_WEIGHTS.customer +
    capability * SCORING_WEIGHTS.capability +
    recency * SCORING_WEIGHTS.recency +
    magnitude * SCORING_WEIGHTS.magnitude;

  return { pursuit, adversary, customer, capability, recency, magnitude, total, whySurfaced: why };
}

/**
 * Category assignment per Part Two §3 threshold rules.
 */
export function categoryFromRelevance(r: RelevanceComponents): "pursuit" | "adversary" | "customer" | "capability" | "context" {
  if (r.pursuit >= 0.6) return "pursuit";
  if (r.adversary >= 0.6) return "adversary";
  if (r.customer >= 0.6) return "customer";
  if (r.capability >= 0.6) return "capability";
  return "context";
}
