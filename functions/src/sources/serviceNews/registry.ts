// Service-branch news registry — per tier2-previews-v1 T2-5
//
// RSS feeds for each US military service branch's official news site.
// Leadership change announcements (3- and 4-star transitions) and below-
// the-fold service-internal stories drive posture intelligence.

export interface ServiceNewsSource {
  key: string;
  name: string;
  rssUrl: string;
  websiteUrl: string;
  /** Short tag used in Signal attrs for filtering / display */
  service: "army" | "navy" | "air_force" | "marines" | "space_force" | "coast_guard";
  defaultOn: boolean;
}

export const SERVICE_NEWS_REGISTRY: ServiceNewsSource[] = [
  {
    key: "army",
    name: "U.S. Army",
    rssUrl: "https://www.army.mil/rss/static/4.xml",
    websiteUrl: "https://www.army.mil",
    service: "army",
    defaultOn: true,
  },
  {
    key: "navy",
    name: "U.S. Navy",
    rssUrl: "https://www.navy.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=445",
    websiteUrl: "https://www.navy.mil",
    service: "navy",
    defaultOn: true,
  },
  {
    key: "air_force",
    name: "U.S. Air Force",
    rssUrl: "https://www.af.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1",
    websiteUrl: "https://www.af.mil",
    service: "air_force",
    defaultOn: true,
  },
  {
    key: "marines",
    name: "U.S. Marine Corps",
    rssUrl: "https://www.marines.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1",
    websiteUrl: "https://www.marines.mil",
    service: "marines",
    defaultOn: true,
  },
  {
    key: "space_force",
    name: "U.S. Space Force",
    rssUrl: "https://www.spaceforce.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1",
    websiteUrl: "https://www.spaceforce.mil",
    service: "space_force",
    defaultOn: true,
  },
  {
    key: "coast_guard",
    name: "U.S. Coast Guard",
    rssUrl: "https://www.news.uscg.mil/rss",
    websiteUrl: "https://www.news.uscg.mil",
    service: "coast_guard",
    defaultOn: false,
  },
];

export function getRegistry(): ServiceNewsSource[] {
  return SERVICE_NEWS_REGISTRY;
}

export function findServiceByKey(key: string): ServiceNewsSource | undefined {
  return SERVICE_NEWS_REGISTRY.find((s) => s.key === key);
}

// Leadership-keyword patterns that suggest a position_held transition.
// Per spec T2-5: leadership announcements drive posture.trajectory + tells[]
// updates. v1 just flags the Signal with `isLeadershipAnnouncement:true`;
// v2 would actually create position_held Edge transitions.
export const LEADERSHIP_PATTERNS = [
  /\b(?:assumes?|assumed) command\b/i,
  /\bchange of command\b/i,
  /\brelinquishes? command\b/i,
  /\bsworn in as\b/i,
  /\bappointed as\b/i,
  /\bnominated (?:to|for|as)\b/i,
  /\bconfirmed (?:to|for|as)\b/i,
  /\bretires? (?:from|as|after)\b/i,
  /\b(?:promoted|promotion) (?:to|of)\b/i,
  /\b(?:director|commander|chief|secretary|administrator) (?:of|for)\b/i,
];

export function isLeadershipAnnouncement(text: string): boolean {
  const t = String(text || "");
  return LEADERSHIP_PATTERNS.some((p) => p.test(t));
}
