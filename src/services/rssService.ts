// ============================================================
//  rssService — topic subscriptions that keep the feed alive even
//  with no human traffic. For each subscribed topic we pull the top
//  items from its most relevant RSS feeds, have the on-device LLM
//  write a short take (if a model is loaded; otherwise a templated
//  blurb), and post them as "RSS Bot" into the local feed.
//
//  RSS feeds rarely send CORS headers, so we fetch through public
//  CORS proxies (which also dodge mixed-content for http feeds).
//  Users can enable/disable feeds, grouped by topic, and add custom
//  feed URLs.
// ============================================================
import type { Post } from "@/types";
import { storage } from "./storage";
import { feedService } from "./feedService";
import { embed } from "@/lib/embeddings";

export interface Feed { url: string; name: string; }
export interface RssConfig {
  topics: string[];                 // subscribed topic names
  custom: { topic: string; url: string; name: string }[];
  disabled: string[];               // feed urls turned off
  seen: string[];                   // item links already posted (capped)
  lastRun: number;
}

// Curated feeds grouped by topic (the first two enabled feeds are used per run).
export const TOPIC_FEEDS: Record<string, Feed[]> = {
  "World & Breaking News": [
    { url: "https://feeds.bbci.co.uk/news/rss.xml", name: "BBC News" },
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", name: "New York Times" },
    { url: "https://feeds.npr.org/1001/rss.xml", name: "NPR News" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera" },
    { url: "http://rss.cnn.com/rss/edition_world.rss", name: "CNN World" },
  ],
  Technology: [
    { url: "https://www.theverge.com/rss/index.xml", name: "The Verge" },
    { url: "https://feeds.arstechnica.com/arstechnica/index", name: "Ars Technica" },
    { url: "https://www.wired.com/feed/rss", name: "WIRED" },
    { url: "https://techcrunch.com/feed/", name: "TechCrunch" },
    { url: "https://www.engadget.com/rss.xml", name: "Engadget" },
    { url: "https://www.technologyreview.com/feed/", name: "MIT Tech Review" },
  ],
  "AI & Machine Learning": [
    { url: "https://huggingface.co/blog/feed.xml", name: "Hugging Face Blog" },
    { url: "http://export.arxiv.org/rss/cs.AI", name: "arXiv cs.AI" },
    { url: "https://www.marktechpost.com/feed/", name: "MarkTechPost" },
  ],
  "Business & Finance": [
    { url: "https://www.forbes.com/business/feed/", name: "Forbes Business" },
    { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business" },
    { url: "https://feeds.businessinsider.com/custom/all", name: "Business Insider" },
    { url: "https://feeds.bloomberg.com/technology/news.rss", name: "Bloomberg Tech" },
    { url: "https://www.inc.com/rss", name: "Inc." },
  ],
  "Science & Space": [
    { url: "https://www.nasa.gov/news-release/feed/", name: "NASA" },
    { url: "https://www.sciencedaily.com/rss/all.xml", name: "ScienceDaily" },
    { url: "https://www.newscientist.com/feed/home/", name: "New Scientist" },
    { url: "https://www.space.com/feeds/all", name: "Space.com" },
    { url: "https://feeds.npr.org/1007/rss.xml", name: "NPR Science" },
  ],
  Sports: [
    { url: "https://www.espn.com/espn/rss/news", name: "ESPN" },
    { url: "https://www.espn.com/espn/rss/nfl/news", name: "ESPN NFL" },
    { url: "https://www.espn.com/espn/rss/nba/news", name: "ESPN NBA" },
    { url: "https://feeds.bbci.co.uk/sport/rss.xml", name: "BBC Sport" },
  ],
  Gaming: [
    { url: "https://www.polygon.com/rss/index.xml", name: "Polygon" },
    { url: "https://www.gamespot.com/feeds/news/", name: "GameSpot" },
    { url: "https://www.engadget.com/gaming/rss.xml", name: "Engadget Gaming" },
    { url: "https://www.rockpapershotgun.com/feed", name: "Rock Paper Shotgun" },
    { url: "https://kotaku.com/rss", name: "Kotaku" },
  ],
  "Entertainment & Pop Culture": [
    { url: "https://variety.com/feed/", name: "Variety" },
    { url: "https://www.hollywoodreporter.com/feed/", name: "Hollywood Reporter" },
    { url: "https://www.tmz.com/rss.xml", name: "TMZ" },
    { url: "https://feeds.npr.org/1008/rss.xml", name: "NPR Culture" },
  ],
  "Health & Wellness": [
    { url: "https://www.statnews.com/feed/", name: "STAT News" },
    { url: "https://newsinhealth.nih.gov/syndication/rss", name: "NIH News in Health" },
    { url: "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC", name: "WebMD" },
    { url: "https://kffhealthnews.org/feed/", name: "KFF Health News" },
  ],
  "Programming & Developer": [
    { url: "https://news.ycombinator.com/rss", name: "Hacker News" },
    { url: "https://dev.to/feed", name: "Dev.to" },
    { url: "https://github.blog/feed/", name: "GitHub Blog" },
    { url: "https://stackoverflow.blog/feed/", name: "Stack Overflow Blog" },
  ],
};

const PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];
const THROTTLE_MS = 10 * 60 * 1000;
const PER_FEED = 6;          // how many recent stories to pull per feed (backfill)
const GENERIC = ["Check this out 👀", "This may be interesting", "Worth a look", "Saw this come through", "Thought I'd share this", "ICYMI"];
const DEFAULT: RssConfig = { topics: [], custom: [], disabled: [], seen: [], lastRun: 0 };

function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
function stripHtml(s: string): string { return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

export interface RssItem { title: string; link: string; summary: string; image?: string; published: number; }

class RssService {
  async config(): Promise<RssConfig> { return { ...DEFAULT, ...(await storage.kvGet<RssConfig>("rss")) }; }
  private async save(c: RssConfig) { await storage.kvSet("rss", c); }

  async subscribe(topic: string, on: boolean) {
    const c = await this.config();
    c.topics = on ? [...new Set([...c.topics, topic])] : c.topics.filter((t) => t !== topic);
    await this.save(c);
    if (on) this.refresh(true);
  }
  async toggleFeed(url: string, enabled: boolean) {
    const c = await this.config();
    c.disabled = enabled ? c.disabled.filter((u) => u !== url) : [...new Set([...c.disabled, url])];
    await this.save(c);
  }
  async addCustomFeed(topic: string, url: string, name: string) {
    const c = await this.config();
    if (!c.custom.some((f) => f.url === url)) c.custom.push({ topic, url, name: name || url });
    if (!c.topics.includes(topic)) c.topics.push(topic);
    await this.save(c);
    this.refresh(true);
  }
  async removeCustomFeed(url: string) {
    const c = await this.config();
    c.custom = c.custom.filter((f) => f.url !== url);
    await this.save(c);
  }

  /** Feeds for a topic = curated + custom, minus disabled. */
  async feedsForTopic(topic: string): Promise<Feed[]> {
    const c = await this.config();
    const curated = TOPIC_FEEDS[topic] ?? [];
    const custom = c.custom.filter((f) => f.topic === topic);
    return [...curated, ...custom].filter((f) => !c.disabled.includes(f.url));
  }

  async fetchFeed(url: string): Promise<RssItem[]> {
    for (const proxy of PROXIES) {
      try {
        const r = await fetch(proxy(url), { cache: "no-store" });
        if (!r.ok) continue;
        const xml = await r.text();
        const items = this.parse(xml);
        if (items.length) return items;
      } catch {}
    }
    return [];
  }

  private parse(xml: string): RssItem[] {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
    const items: RssItem[] = [];
    for (const n of nodes.slice(0, 10)) {
      const get = (sel: string) => n.querySelector(sel)?.textContent?.trim() || "";
      const title = get("title");
      let link = get("link");
      if (!link) link = n.querySelector("link")?.getAttribute("href") || "";
      const descRaw = get("description") || get("summary") || get("content");
      // image: enclosure / media:content / media:thumbnail / first <img> in body
      let image =
        n.querySelector("enclosure[url]")?.getAttribute("url") ||
        n.querySelector("[url]")?.getAttribute("url") ||
        (descRaw.match(/<img[^>]+src="([^"]+)"/i)?.[1]) ||
        undefined;
      if (image && !/^https?:\/\//.test(image)) image = undefined;
      const published = Date.parse(get("pubDate") || get("published") || get("updated")) || Date.now();
      if (title && link) items.push({ title, link, summary: stripHtml(descRaw).slice(0, 220), image, published });
    }
    return items;
  }

  /** Pull recent items for all subscribed topics and post them as RSS Bot.
   *  Each story keeps its real publish time, so when you return you see the
   *  ones published while you were away, slotted into the timeline at the time
   *  they actually went out — emulating a feed that posts continuously. */
  async refresh(force = false): Promise<number> {
    const c = await this.config();
    if (!c.topics.length) return 0;
    if (!force && Date.now() - c.lastRun < THROTTLE_MS) return 0;
    c.lastRun = Date.now();
    await this.save(c);

    const seen = new Set(c.seen);
    let posted = 0;
    for (const topic of c.topics) {
      const feeds = (await this.feedsForTopic(topic)).slice(0, 2); // two most relevant
      for (const feed of feeds) {
        const items = await this.fetchFeed(feed.url);
        for (const item of items.slice(0, PER_FEED)) {
          if (seen.has(item.link)) continue;
          seen.add(item.link);
          const line = GENERIC[Math.floor(Math.random() * GENERIC.length)];
          const post: Post = {
            id: "rss_" + hash(item.link),
            author: "rss-bot",
            authorName: `RSS Bot · ${feed.name}`,
            kind: "text",
            // generic intro, then title / description / link; the post time IS
            // the story's publish time (shown by the card).
            text: `${line}\n\n${item.title}\n\n${item.summary}\n\n${item.link}`,
            media: item.image ? [{ type: "image", url: item.image, mime: "image/*", alt: item.title }] : undefined,
            tags: [topic.toLowerCase().replace(/\s+/g, "")],
            createdAt: item.published || Date.now(),  // real publish time → "missed" stories land in order
            reactions: {},
            embedding: embed(item.title + " " + item.summary + " " + topic),
            source: "relay",
          };
          await feedService.ingest(post);
          posted++;
        }
      }
    }
    c.seen = [...seen].slice(-600);
    await this.save(c);
    return posted;
  }
}

export const rssService = new RssService();
