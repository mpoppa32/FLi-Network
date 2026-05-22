// State Department — RSS feed registry
//
// Department of State publishes multiple structured RSS feeds. The
// defense-BD-relevant ones are press releases (sanctions actions,
// designations), daily briefings (policy positions), fact sheets
// (FMS context + bilateral relationships), and on-the-record press
// briefings.
//
// Each feed maps to analysis_publication Signals with attrs.feedKey
// distinguishing the kind for downstream filtering.

export interface StateDepartmentFeed {
  /** Stable key persisted in Signal.attrs.feedKey. */
  key: string;
  /** Operator-visible label. */
  name: string;
  /** RSS / Atom URL. */
  rssUrl: string;
  /** Operator-facing summary of why this feed matters for BD. */
  category: "sanctions" | "policy" | "fms" | "factsheet" | "briefing";
  /** Default-on when operator first enables state_department. */
  defaultOn: boolean;
  /** Tags applied to every Signal from this feed for downstream
   *  filtering / Brief Synthesis weight. */
  topicTags: string[];
}

export const STATE_DEPARTMENT_REGISTRY: StateDepartmentFeed[] = [
  {
    key: "press_releases",
    name: "State Department Press Releases",
    rssUrl: "https://www.state.gov/press-releases/feed/",
    category: "policy",
    defaultOn: true,
    topicTags: ["policy", "diplomacy", "international"],
  },
  {
    key: "press_briefings",
    name: "Press Briefings",
    rssUrl: "https://www.state.gov/press-briefings/feed/",
    category: "briefing",
    defaultOn: true,
    topicTags: ["policy", "diplomacy", "briefing"],
  },
  {
    key: "sanctions",
    name: "Sanctions & Designations",
    // OFAC sanctions actions are at Treasury; State publishes designations
    // (FTOs, SDGTs, etc.) via the Office of Counterterrorism + Office of
    // Sanctions Coordination, mostly in the press releases feed. This
    // alias feed routes the same RSS through a category filter downstream
    // — kept separate so an operator can disable other feeds and keep
    // sanctions-only.
    rssUrl: "https://www.state.gov/press-releases/feed/",
    category: "sanctions",
    defaultOn: false,
    topicTags: ["sanctions", "designations", "export-control"],
  },
  {
    key: "fact_sheets",
    name: "Fact Sheets (bilateral + multilateral)",
    rssUrl: "https://www.state.gov/fact-sheets/feed/",
    category: "factsheet",
    defaultOn: true,
    topicTags: ["factsheet", "bilateral", "multilateral"],
  },
];

/** Lookup by key. Returns undefined for unknown keys. */
export function getFeedByKey(key: string): StateDepartmentFeed | undefined {
  return STATE_DEPARTMENT_REGISTRY.find((f) => f.key === key);
}
