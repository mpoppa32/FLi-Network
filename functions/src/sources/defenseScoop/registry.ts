// Defense BD news source — RSS publication registry
//
// Multi-outlet aggregator covering the defense-BD news ecosystem.
// Each publication is RSS-based; we tier them by signal-to-noise
// for the default-on selection. Breaking Defense + DefenseScoop +
// Defense News default on (highest contractor/program signal);
// FedScoop + NextGov default off (broader federal IT, opt-in).

export interface DefenseScoopPublication {
  /** Stable key persisted in Signal.attrs.publicationKey. */
  key: string;
  /** Operator-visible label. */
  name: string;
  /** RSS / Atom URL. */
  rssUrl: string;
  /** Where the publication sits in the defense ecosystem. */
  category: "core_defense" | "federal_it" | "policy";
  /** Default-on when operator first enables defense_scoop. */
  defaultOn: boolean;
  /** Tags applied to every Signal for downstream filtering. */
  topicTags: string[];
}

export const DEFENSE_SCOOP_REGISTRY: DefenseScoopPublication[] = [
  {
    key: "breaking_defense",
    name: "Breaking Defense",
    rssUrl: "https://breakingdefense.com/feed/",
    category: "core_defense",
    defaultOn: true,
    topicTags: ["contractor", "program", "procurement"],
  },
  {
    key: "defense_scoop",
    name: "DefenseScoop",
    rssUrl: "https://defensescoop.com/feed/",
    category: "core_defense",
    defaultOn: true,
    topicTags: ["program", "procurement", "tech"],
  },
  {
    key: "defense_news",
    name: "Defense News",
    rssUrl: "https://www.defensenews.com/arc/outboundfeeds/rss/",
    category: "core_defense",
    defaultOn: true,
    topicTags: ["contractor", "program", "international"],
  },
  {
    key: "fedscoop",
    name: "FedScoop",
    rssUrl: "https://fedscoop.com/feed/",
    category: "federal_it",
    defaultOn: false,
    topicTags: ["federal-it", "modernization"],
  },
  {
    key: "nextgov",
    name: "Nextgov / FCW",
    rssUrl: "https://www.nextgov.com/rss/all/",
    category: "federal_it",
    defaultOn: false,
    topicTags: ["federal-it", "operations"],
  },
];

export function getPublicationByKey(
  key: string
): DefenseScoopPublication | undefined {
  return DEFENSE_SCOOP_REGISTRY.find((p) => p.key === key);
}
