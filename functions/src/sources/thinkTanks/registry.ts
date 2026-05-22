// Think tank registry — known defense-relevant publishers
//
// Per tier2-previews-v1 T2-6: bundled aggregator for major defense think
// tanks. Add a tank by appending a registry entry; no code change needed
// to ingest a new feed.

export interface ThinkTankSource {
  key: string;
  name: string;
  /** RSS feed URL (preferred ingestion path) */
  rssUrl: string;
  /** Public website (for operator drill-through) */
  websiteUrl: string;
  /** Topic tags this tank focuses on — used for capability scoring */
  topicTags: string[];
  /** Two-letter category for filtering — defense / policy / tech / strategy */
  category: "defense" | "policy" | "tech" | "strategy";
  /** Default-on for new workspaces in Step 4 onboarding */
  defaultOn: boolean;
}

export const THINK_TANK_REGISTRY: ThinkTankSource[] = [
  {
    key: "csis",
    name: "Center for Strategic and International Studies (CSIS)",
    rssUrl: "https://www.csis.org/analysis/feed",
    websiteUrl: "https://www.csis.org",
    topicTags: ["defense", "international_security", "great_power_competition"],
    category: "defense",
    defaultOn: true,
  },
  {
    key: "rand",
    name: "RAND Corporation",
    rssUrl: "https://www.rand.org/rss.xml",
    websiteUrl: "https://www.rand.org",
    topicTags: ["defense", "operations_research", "policy"],
    category: "defense",
    defaultOn: true,
  },
  {
    key: "cnas",
    name: "Center for a New American Security (CNAS)",
    rssUrl: "https://www.cnas.org/publications/feed",
    websiteUrl: "https://www.cnas.org",
    topicTags: ["defense", "strategy", "technology"],
    category: "strategy",
    defaultOn: true,
  },
  {
    key: "hudson",
    name: "Hudson Institute",
    rssUrl: "https://www.hudson.org/rss/research",
    websiteUrl: "https://www.hudson.org",
    topicTags: ["defense", "policy", "strategy"],
    category: "policy",
    defaultOn: true,
  },
  {
    key: "aei",
    name: "American Enterprise Institute (AEI)",
    rssUrl: "https://www.aei.org/feed/",
    websiteUrl: "https://www.aei.org",
    topicTags: ["defense", "policy"],
    category: "policy",
    defaultOn: false,
  },
  {
    key: "brookings",
    name: "Brookings Institution",
    rssUrl: "https://www.brookings.edu/feed/",
    websiteUrl: "https://www.brookings.edu",
    topicTags: ["policy", "international"],
    category: "policy",
    defaultOn: false,
  },
  {
    key: "heritage",
    name: "Heritage Foundation",
    rssUrl: "https://www.heritage.org/rss/commentary",
    websiteUrl: "https://www.heritage.org",
    topicTags: ["defense", "policy"],
    category: "policy",
    defaultOn: false,
  },
  {
    key: "atlantic_council",
    name: "Atlantic Council",
    rssUrl: "https://www.atlanticcouncil.org/feed/",
    websiteUrl: "https://www.atlanticcouncil.org",
    topicTags: ["international_security", "transatlantic"],
    category: "strategy",
    defaultOn: false,
  },
  {
    key: "stimson",
    name: "Stimson Center",
    rssUrl: "https://www.stimson.org/feed/",
    websiteUrl: "https://www.stimson.org",
    topicTags: ["defense", "arms_control", "policy"],
    category: "policy",
    defaultOn: false,
  },
  // 2026-05-22: defense-analysis publication additions. Reuse the
  // think_tank infrastructure rather than splitting into a new
  // source plugin — these are think-tank-adjacent (analysis/opinion
  // rather than wire news, which defense_scoop covers).
  {
    key: "defense_one",
    name: "Defense One",
    rssUrl: "https://www.defenseone.com/rss/all/",
    websiteUrl: "https://www.defenseone.com",
    topicTags: ["defense", "policy", "technology"],
    category: "defense",
    defaultOn: true,
  },
  {
    key: "war_on_the_rocks",
    name: "War on the Rocks",
    rssUrl: "https://warontherocks.com/feed/",
    websiteUrl: "https://warontherocks.com",
    topicTags: ["defense", "strategy", "national_security"],
    category: "strategy",
    defaultOn: true,
  },
  {
    key: "aviation_week",
    name: "Aviation Week (Defense)",
    rssUrl: "https://aviationweek.com/rss/defense",
    websiteUrl: "https://aviationweek.com/defense",
    topicTags: ["defense", "aviation", "aerospace"],
    category: "defense",
    defaultOn: false,
  },
];

export function getRegistry(): ThinkTankSource[] {
  return THINK_TANK_REGISTRY;
}

export function findTankByKey(key: string): ThinkTankSource | undefined {
  return THINK_TANK_REGISTRY.find((t) => t.key === key);
}
