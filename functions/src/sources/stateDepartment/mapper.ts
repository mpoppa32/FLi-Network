// State Department — RSS item → Signal mapper
//
// Each State publication becomes a Signal with type 'analysis_publication'
// (same shape as think_tank publications; downstream consumers don't
// distinguish, but attrs.feedKey + attrs.feedCategory carry the
// state-specific provenance for filtering).
//
// Subject: every Signal is anchored to the Department of State Org via
// resolveAgencyOrg so the Brief Synthesis Customer side picks it up
// when State is on the operator's watchlist.
//
// v1.1 (2026-05-22): body-text Org resolution. Scans title +
// description for known defense-contractor names + foreign government
// mentions and adds resolved IDs to relatedIds (secondary signal,
// weaker than the DoS anchor in subjectIds). Static pattern lists
// kept modest; v1.2 will move them to per-workspace config.

import { hashFields } from "../../framework/hashing";
import { externalProvenance } from "../../framework/provenance";
import { db, wsPath } from "../../framework/rtdb";
import {
  resolveAgencyOrg,
  resolveRecipientOrg,
} from "../usaSpending/orgResolver";
import { resolvePersonByName } from "../../framework/personResolver";
import type { Logger } from "../../framework/logger";
import type { Signal } from "../../framework/types/signals";
import type { StateRssItem } from "./client";
import type { StateDepartmentFeed } from "./registry";

// v1.2: pattern lists + per-signal cap moved into per-workspace
// config (StateDepartmentConfig.defenseContractorPatterns +
// .foreignGovernmentPatterns + .maxRelatedPerSignal). Defaults live
// in config.ts as DEFAULT_DEFENSE_CONTRACTOR_PATTERNS +
// DEFAULT_FOREIGN_GOVERNMENT_PATTERNS so cold-start operators get
// sensible coverage without configuration. The mapper receives the
// resolved lists via the patterns argument below.

function signalId(feedKey: string, guid: string): string {
  const safe =
    (guid || "").replace(/[^A-Za-z0-9]/g, "_").slice(0, 60) ||
    String(Date.now());
  return "sig_st_" + feedKey + "_" + safe;
}

/**
 * Map one RSS item to a Signal. Idempotent — same item produces same
 * hash; subsequent runs bump refreshedAt but don't rewrite.
 */
/** v1.2: mapper accepts the resolved pattern lists + cap from the
 *  caller (index.ts pulls them from config). Keeping the static
 *  defaults in config.ts means a mapper unit-test or one-off caller
 *  who skips this argument still gets a sane default behavior. */
export interface UpsertSignalPatterns {
  defenseContractors: string[];
  foreignGovernments: string[];
  /** v1.3: key-official name / title patterns. Each match resolves to
   *  a Person node via framework/personResolver. */
  keyOfficials: string[];
  maxRelatedPerSignal: number;
}

export async function upsertStatePublicationSignal(
  workspaceId: string,
  feed: StateDepartmentFeed,
  item: StateRssItem,
  patterns: UpsertSignalPatterns,
  log?: Logger
): Promise<{
  signalId: string;
  action: "created" | "updated" | "unchanged";
  agencyOrgResolved: boolean;
  bodyOrgsResolved: number;
  bodyPersonsResolved: number;
  /** v1.4: count of Persons resolved specifically from diplomatic-
   *  meeting pattern matches (subset of bodyPersonsResolved). */
  diplomaticMatchesResolved: number;
}> {
  const id = signalId(feed.key, item.guid);
  const occurredAt = item.pubDateMs || Date.now();
  const title = (item.title || "Untitled").slice(0, 500);
  const summary = (item.description || "").slice(0, 1000);
  const author = item.author || undefined;
  const categories = item.categories || [];

  // Resolve Department of State as the anchor Org. Same name every run
  // → resolves to a stable Org id after first sync.
  let stateOrgId: string | null = null;
  let agencyOrgResolved = false;
  try {
    const r = await resolveAgencyOrg(workspaceId, "Department of State");
    stateOrgId = r.orgId;
    agencyOrgResolved = true;
  } catch (err) {
    log?.warn?.("state_department_agency_resolve_failed", {
      message: (err as Error).message,
    });
  }

  // v1.1: scan title + description for known defense-contractor and
  // foreign-government mentions. Resolve to Org IDs via the standard
  // resolvers and accumulate in relatedIds (secondary signal — body
  // mentions are weaker than the DoS anchor in subjectIds).
  //
  // Suppress fuzzy candidate emission on these auto-resolves because
  // every State Dept item mentions multiple Orgs in passing; emitting
  // dedupe candidates on each weak mention would flood the queue.
  // Operator gets fuzzy candidates only when an Org is first created
  // by another (higher-confidence) source.
  // Hash + provenance computed up front so body-resolution loops
  // (Persons in particular — personResolver requires provenance for
  // auto-create) can reference them. Hash is deterministic over the
  // signal's stable fields.
  const hash = hashFields(
    {
      title,
      occurredAt,
      author: author || "",
      link: item.link || "",
      feedKey: feed.key,
    } as Record<string, unknown>,
    ["title", "occurredAt", "author", "link", "feedKey"]
  );
  const provenance = externalProvenance(
    "state_department",
    item.guid || item.link,
    item.link || feed.rssUrl,
    hash,
    Date.now()
  );

  const relatedIds: string[] = [];
  const seenRelated = new Set<string>();
  const haystack = (title + " " + summary).toLowerCase();
  const maxRelated = Math.max(1, patterns.maxRelatedPerSignal || 8);
  let bodyOrgsResolved = 0;
  for (const name of patterns.defenseContractors) {
    if (relatedIds.length >= maxRelated) break;
    if (!name || haystack.indexOf(name.toLowerCase()) < 0) continue;
    try {
      const r = await resolveRecipientOrg(workspaceId, name, null, {
        autoCreate: true,
        type: "company",
        emitFuzzyCandidates: false,
      });
      if (r.orgId && !seenRelated.has(r.orgId)) {
        seenRelated.add(r.orgId);
        relatedIds.push(r.orgId);
        bodyOrgsResolved++;
      }
    } catch (err) {
      // best-effort; skip
    }
  }
  for (const country of patterns.foreignGovernments) {
    if (relatedIds.length >= maxRelated) break;
    if (!country || haystack.indexOf(country.toLowerCase()) < 0) continue;
    try {
      const r = await resolveRecipientOrg(workspaceId, country, null, {
        autoCreate: true,
        type: "government",
        alternateNames: ["Government of " + country],
        emitFuzzyCandidates: false,
      });
      if (r.orgId && !seenRelated.has(r.orgId)) {
        seenRelated.add(r.orgId);
        relatedIds.push(r.orgId);
        bodyOrgsResolved++;
      }
    } catch (err) {
      // best-effort; skip
    }
  }

  // v1.3: key-official name patterns → Person resolution. Same shape
  // as the Org loops above. Persons land in relatedIds alongside Orgs;
  // Brief Synthesis touched-entity intersection treats both
  // identically. Provenance carries state_department as the system so
  // newly-created Persons trace back to the State item that surfaced
  // them. emitFuzzyCandidates: false to suppress dedupe noise from
  // weak body mentions — same rationale as the Org side.
  let bodyPersonsResolved = 0;
  for (const personName of patterns.keyOfficials) {
    if (relatedIds.length >= maxRelated) break;
    if (!personName || haystack.indexOf(personName.toLowerCase()) < 0) continue;
    try {
      const r = await resolvePersonByName(workspaceId, personName, {
        autoCreate: true,
        provenance: provenance,
        emitFuzzyCandidates: false,
      });
      if (r.personId && !seenRelated.has(r.personId)) {
        seenRelated.add(r.personId);
        relatedIds.push(r.personId);
        bodyPersonsResolved++;
      }
    } catch (err) {
      // best-effort; skip
    }
  }

  // v1.4 (2026-05-22): diplomatic-meeting pattern extraction.
  // State Dept press releases follow predictable language patterns
  // describing official meetings. v1.3 static keyOfficialPatterns
  // catch ROLES; v1.4 catches the dynamic NAMES paired with those
  // roles via a regex over "(Title) (Name) (verb) (Title) (Name)".
  //
  // Captures U.S.-side + foreign-side officials by name, not just
  // by title — so an operator with named individuals in their
  // pursuit context picks up the actual mentions even when those
  // individuals aren't in keyOfficialPatterns.
  //
  // Conservative: matches only on strong title prefixes + diplomatic
  // verbs to avoid resolving random capitalized phrases as Persons.
  // De-dupes within seenRelated.
  const DIPLO_TITLE_GROUP =
    "Secretary|Deputy Secretary|Under Secretary|Assistant Secretary|Special Envoy|Ambassador|Foreign Minister|Defense Minister|Prime Minister|President|Foreign Secretary|National Security Advisor|Chief of Staff";
  const DIPLO_VERB_GROUP =
    "met with|welcomed|convened with|spoke with|called on|received|hosted|joined|consulted with|conferred with|traveled to meet";
  // Two-to-four capitalized words for names. Allows apostrophes, hyphens, periods.
  const NAME_RE = "[A-Z][a-zA-Z'.\\-]+(?:\\s+[A-Z][a-zA-Z'.\\-]+){1,3}";
  const DIPLO_PATTERN = new RegExp(
    "(" + DIPLO_TITLE_GROUP + ")\\s+(" + NAME_RE + ")\\s+(?:" + DIPLO_VERB_GROUP + ")\\s+(" + DIPLO_TITLE_GROUP + ")\\s+(" + NAME_RE + ")",
    "g"
  );
  // Scan ORIGINAL title + summary (not the lowercased haystack) so the
  // capitalized name detection works.
  const fullText = (title || "") + ". " + (summary || "");
  let diploMatch: RegExpExecArray | null;
  let diplomaticMatchesResolved = 0;
  // Reset regex lastIndex before exec loop
  DIPLO_PATTERN.lastIndex = 0;
  while ((diploMatch = DIPLO_PATTERN.exec(fullText)) !== null) {
    if (relatedIds.length >= maxRelated) break;
    // diploMatch[2] = U.S.-side name; diploMatch[4] = foreign-side name
    const usSideName = diploMatch[2];
    const foreignSideName = diploMatch[4];
    for (const candidateName of [usSideName, foreignSideName]) {
      if (relatedIds.length >= maxRelated) break;
      if (!candidateName) continue;
      // Skip if the name is just a single word (probably caught a noun)
      if (!candidateName.includes(" ")) continue;
      try {
        const r = await resolvePersonByName(workspaceId, candidateName, {
          autoCreate: true,
          provenance: provenance,
          emitFuzzyCandidates: false,
        });
        if (r.personId && !seenRelated.has(r.personId)) {
          seenRelated.add(r.personId);
          relatedIds.push(r.personId);
          bodyPersonsResolved++;
          diplomaticMatchesResolved++;
        }
      } catch (err) {
        // best-effort; skip
      }
    }
  }

  const signal: Signal = {
    id,
    type: "analysis_publication",
    subjectIds: stateOrgId ? [stateOrgId] : [],
    relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
    occurredAt,
    attrs: {
      feedKey: feed.key,
      feedName: feed.name,
      feedCategory: feed.category,
      title,
      summary,
      author,
      categories,
      topicTags: feed.topicTags,
      url: item.link,
    },
    source: provenance,
  };

  const path = wsPath(workspaceId, "signals", id);
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) {
    await db.ref(path).set(signal);
    log?.debug("state_department_signal_created", {
      id,
      feed: feed.key,
      title: title.slice(0, 80),
      bodyOrgsResolved,
      bodyPersonsResolved,
      diplomaticMatchesResolved,
    });
    return {
      signalId: id,
      action: "created",
      agencyOrgResolved,
      bodyOrgsResolved,
      bodyPersonsResolved,
      diplomaticMatchesResolved,
    };
  }
  const existing = snap.val() as Signal;
  if (existing.source?.hash === hash) {
    await db.ref(`${path}/source/refreshedAt`).set(Date.now());
    return {
      signalId: id,
      action: "unchanged",
      agencyOrgResolved,
      bodyOrgsResolved,
      bodyPersonsResolved,
      diplomaticMatchesResolved,
    };
  }
  await db.ref(path).set(signal);
  return {
    signalId: id,
    action: "updated",
    agencyOrgResolved,
    bodyOrgsResolved,
    bodyPersonsResolved,
    diplomaticMatchesResolved,
  };
}

/** Case-insensitive substring match against title + description. Empty
 *  keyword list = no filter (every item passes). */
export function matchesKeywords(item: StateRssItem, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack =
    ((item.title || "") + " " + (item.description || "")).toLowerCase();
  for (const k of keywords) {
    if (k && haystack.indexOf(k.toLowerCase()) >= 0) return true;
  }
  return false;
}

/** Sanctions feed gate: when feed.category === 'sanctions', only items
 *  with sanctions / designation language pass. Avoids the press_releases
 *  alias feed (which shares the same RSS URL) emitting non-sanctions
 *  items twice. */
export function matchesSanctionsGate(
  feed: StateDepartmentFeed,
  item: StateRssItem
): boolean {
  if (feed.category !== "sanctions") return true;
  const haystack =
    ((item.title || "") + " " + (item.description || "")).toLowerCase();
  const triggers = [
    "sanction",
    "designat",
    "ofac",
    "sdgt",
    "fto",
    "export control",
    "entity list",
    "denied party",
  ];
  for (const t of triggers) {
    if (haystack.indexOf(t) >= 0) return true;
  }
  return false;
}
