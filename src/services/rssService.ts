// ============================================================
//  rssService — topic subscriptions that keep the feed alive. Pulls
//  the top stories from each topic's feeds, posts them as "RSS Bot",
//  and persists via Gun. Supports several keyless feed "kinds":
//   • rss      — any RSS/Atom URL (incl. Reddit .rss, GitHub .atom,
//                Google News search feeds)
//   • youtube  — a channel handle/URL, resolved to its videos.xml feed
//   • podcast  — a show name, resolved to its RSS via Apple's free
//                iTunes Search API (no key) — so search works
//   • cve      — an app keyword, via the NVD CVE API
//  All fetched through public CORS proxies (feeds rarely send CORS).
// ============================================================
import type { Post } from "@/types";
import { storage } from "./storage";
import { feedService } from "./feedService";
import { embed } from "@/lib/embeddings";
import { decodeEntities } from "@/lib/htmlEntities";
import { bus } from "@/lib/events";

export type FeedKind = "rss" | "youtube" | "podcast" | "cve";
export interface Feed { url: string; name: string; kind?: FeedKind; }
export interface RssConfig {
  topics: string[];
  custom: { topic: string; url: string; name: string; kind?: FeedKind }[];
  disabled: string[];
  seen: string[];
  lastRun: number;
}

const gnews = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const reddit = (sub: string, name: string): Feed => ({ url: `https://www.reddit.com/r/${sub}/.rss`, name });
const github = (repo: string): Feed => ({ url: `https://github.com/${repo}/releases.atom`, name: repo });
const yt = (handle: string, name: string): Feed => ({ kind: "youtube", url: handle, name });
const pod = (term: string, name: string): Feed => ({ kind: "podcast", url: term, name });
const cve = (app: string, name: string): Feed => ({ kind: "cve", url: app, name });
const tiktok = (id: string, name: string): Feed => ({ url: `https://rss.app/feeds/${id}.xml`, name, kind: "rss" });

// Curated feeds grouped by topic.
export const TOPIC_FEEDS: Record<string, Feed[]> = {
  "World & Breaking News": [
    { url: "https://feeds.bbci.co.uk/news/rss.xml", name: "BBC News" },
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", name: "New York Times" },
    { url: "https://feeds.npr.org/1001/rss.xml", name: "NPR News" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera" },
  ],
  Technology: [
    { url: "https://www.theverge.com/rss/index.xml", name: "The Verge" },
    { url: "https://feeds.arstechnica.com/arstechnica/index", name: "Ars Technica" },
    { url: "https://www.wired.com/feed/rss", name: "WIRED" },
    { url: "https://techcrunch.com/feed/", name: "TechCrunch" },
  ],
  "AI & Machine Learning": [
    { url: "https://huggingface.co/blog/feed.xml", name: "Hugging Face Blog" },
    { url: "http://export.arxiv.org/rss/cs.AI", name: "arXiv cs.AI" },
    { url: "https://www.marktechpost.com/feed/", name: "MarkTechPost" },
  ],
  "Business & Finance": [
    { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business" },
    { url: "https://feeds.businessinsider.com/custom/all", name: "Business Insider" },
    { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", name: "CNBC" },
  ],
  "Science & Space": [
    { url: "https://www.nasa.gov/news-release/feed/", name: "NASA" },
    { url: "https://www.sciencedaily.com/rss/all.xml", name: "ScienceDaily" },
    { url: "https://www.space.com/feeds/all", name: "Space.com" },
  ],
  Sports: [
    { url: "https://www.espn.com/espn/rss/news", name: "ESPN" },
    { url: "https://feeds.bbci.co.uk/sport/rss.xml", name: "BBC Sport" },
  ],
  Gaming: [
    { url: "https://www.polygon.com/rss/index.xml", name: "Polygon" },
    { url: "https://kotaku.com/rss", name: "Kotaku" },
  ],

  // ---- YouTube channels (resolved to each channel's videos.xml feed) ----
  "YouTube · Finance": [yt("@CalebHammer", "Caleb Hammer")],
  "YouTube · News": [yt("@PhilipDeFranco", "Philip DeFranco")],
  "YouTube · History": [yt("@TheHistoryGuyChannel", "The History Guy"), yt("@DarkDocs", "Dark Docs"), yt("@TheArmchairHistorian", "The Armchair Historian")],
  "YouTube · Guns & Freedom": [yt("@TheAKGuy", "Brandon Herrera"), yt("@DonutOperator", "Donut Operator"), yt("@themodernrogue", "The Modern Rogue")],
  "YouTube · Comedy": [yt("@TheoVon", "Theo Von"), yt("@SamMorril", "Sam Morril"), yt("@jpsearsreacts", "JP Sears"), yt("@YMHStudios", "YMH Studios")],
  "YouTube · Gaming": [yt("@ZackRawrr", "Asmongold TV"), yt("@SomeOrdinaryGamers", "SomeOrdinaryGamers")],
  "YouTube · Tech": [yt("@TechnologyConnections", "Technology Connections"), yt("@NetworkChuck", "NetworkChuck"), yt("@ThePrimeTimeagen", "ThePrimeTime"), yt("https://www.youtube.com/coldfusion", "ColdFusion")],
  "YouTube · Faith & Kindness": [yt("@voiceofkindness-p7t", "Voice of Kindness"), yt("@jaramillocynthia906", "Cynthia Jaramillo")],
  "YouTube · AI": [yt("@HouseofEl-AI", "House of El (AI)")],
  "YouTube · More": [yt("@GEN", "GEN"), yt("@Moon-Real", "Moon-Real"), yt("https://www.youtube.com/watch?v=iWuFBZw9Olk", "Featured Channel")],

  // ---- TikTok (via rss.app feeds) ----
  "TikTok · News & Politics": [tiktok("8ij5l1XVCISffJkW", "Candace (TikTok)"), tiktok("btLstflN27YpkwS2", "Tucker Carlson Network (TikTok)")],
  "TikTok · Guns & Coffee": [tiktok("FSMRlQoT7fMqNWDl", "UNDERDAWG (TikTok)"), tiktok("RcAehastMj38bbrg", "Black Rifle Coffee (TikTok)")],
  "TikTok · Faith": [tiktok("KpaeeqmPiB6EKPAa", "houstondprays (TikTok)")],
  "TikTok · Creators": [tiktok("WN7Xtyd0YymjU9RO", "ericplaytwomuch (TikTok)"), tiktok("ci7fY49yIDeqpdZq", "readchoi (TikTok)"), tiktok("FPgsr8i3PgZLs1wm", "Ci James (TikTok)"), tiktok("y8yCRjsEZMvuSSDO", "Joe Rauth (TikTok)")],

  // ---- Podcasts (resolved by name via iTunes Search) ----
  Podcasts: [
    pod("Bad Friends", "Bad Friends"),
    pod("This Past Weekend Theo Von", "Theo Von — This Past Weekend"),
    pod("The Joe Rogan Experience", "Joe Rogan Experience"),
    pod("Two Bears One Cave", "Two Bears, One Cave"),
    pod("Matt and Shane's Secret Podcast", "Matt & Shane's Secret Podcast"),
    pod("Kill Tony", "Kill Tony"),
  ],

  // ---- Reddit (native .rss) ----
  "Reddit · Dude Bros": [reddit("JoeRogan", "r/JoeRogan"), reddit("Theovon", "r/Theovon"), reddit("barstoolsports", "r/barstoolsports")],
  "Reddit · Tech Bros": [reddit("programming", "r/programming"), reddit("homelab", "r/homelab"), reddit("selfhosted", "r/selfhosted")],
  "Reddit · Gun Bros": [reddit("guns", "r/guns"), reddit("Firearms", "r/Firearms"), reddit("CCW", "r/CCW")],
  "Reddit · Outdoor Bros": [reddit("overlanding", "r/overlanding"), reddit("camping", "r/camping"), reddit("EDC", "r/EDC")],

  // ---- GitHub releases (native .atom) ----
  "GitHub Releases": [github("ollama/ollama"), github("microsoft/vscode"), github("facebook/react"), github("vercel/next.js"), github("denoland/deno")],

  // ---- Faith ----
  "Daily Verse": [
    { url: "https://www.biblegateway.com/votd/get/?format=atom&version=9", name: "Bible Gateway — Verse of the Day" },
  ],

  // ---- 3D printing ----
  "3D Printing": [
    { url: "https://cults3d.com/en/creations/feed", name: "Cults3D — latest creations" },
    { url: "https://all3dp.com/feed/", name: "All3DP" },
  ],

  // ---- Local: Fort Smith, AR (via Google News RSS + the station feed) ----
  "Fort Smith, AR": [
    { url: "https://www.5newsonline.com/feeds/syndication/rss/news", name: "5NEWS (KFSM)" },
    { url: gnews('"5NEWS" OR KFSM Fort Smith Arkansas'), name: "5NEWS — Google News" },
    { url: gnews("Fort Smith Arkansas"), name: "Fort Smith — Google News" },
    { url: gnews('"Times Record" Fort Smith Arkansas'), name: "Times Record (Fort Smith)" },
  ],

  // ---- Security: CVEs for an app (NVD) ----
  "Security · CVEs": [cve("google chrome", "CVEs · Chrome (example)")],
};

const PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];
const THROTTLE_MS = 10 * 60 * 1000;
const PER_FEED = 4;
const FEEDS_PER_TOPIC = 5;
// Topics enabled out of the box (and merged into existing users once, via the
// seed migration below) — the channels/creators/subreddits requested as defaults.
export const DEFAULT_TOPICS = [
  "Gaming",
  "YouTube · Finance", "YouTube · News", "YouTube · History", "YouTube · Guns & Freedom",
  "YouTube · Comedy", "YouTube · Tech", "YouTube · Faith & Kindness", "YouTube · AI", "YouTube · More",
  "Podcasts",
  "Reddit · Gun Bros", "Reddit · Outdoor Bros",
  "Daily Verse",
  "TikTok · News & Politics", "TikTok · Guns & Coffee", "TikTok · Faith", "TikTok · Creators",
];
const DEFAULT: RssConfig = { topics: [...DEFAULT_TOPICS], custom: [], disabled: [], seen: [], lastRun: 0 };

function hash(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }
function stripHtml(s: string): string { return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }

export interface RssItem { title: string; link: string; summary: string; image?: string; published: number; }

async function proxiedText(url: string, timeoutMs = 8000): Promise<string> {
  for (const proxy of PROXIES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);   // never hang on a slow/dead proxy
    try { const r = await fetch(proxy(url), { cache: "no-store", signal: ctrl.signal }); if (r.ok) { const t = await r.text(); if (t) return t; } }
    catch {}
    finally { clearTimeout(timer); }
  }
  throw new Error("unreachable");
}

// --- resolvers (cached) ---
let resolveCache: Record<string, string> | null = null;
async function getResolve(): Promise<Record<string, string>> { if (!resolveCache) resolveCache = (await storage.kvGet<Record<string, string>>("rss:resolve")) ?? {}; return resolveCache; }
async function setResolve(key: string, val: string) { const c = await getResolve(); c[key] = val; await storage.kvSet("rss:resolve", c); }

async function resolveYouTube(ref: string): Promise<string> {
  if (/^UC[\w-]{22}$/.test(ref)) return `https://www.youtube.com/feeds/videos.xml?channel_id=${ref}`;
  const cache = await getResolve(); if (cache["yt:" + ref]) return cache["yt:" + ref];
  const page = ref.startsWith("http") ? ref : `https://www.youtube.com/${ref.startsWith("@") ? ref : "@" + ref}`;
  const html = await proxiedText(page);
  const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/) || html.match(/(UC[\w-]{22})/);
  if (!m) throw new Error("no channelId");
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
  await setResolve("yt:" + ref, feedUrl);
  return feedUrl;
}
async function resolvePodcast(term: string): Promise<string> {
  const cache = await getResolve(); if (cache["pod:" + term]) return cache["pod:" + term];
  // iTunes Search API is keyless and CORS-enabled.
  const r = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=1&term=${encodeURIComponent(term)}`);
  const j = await r.json();
  const feedUrl = j.results?.[0]?.feedUrl;
  if (!feedUrl) throw new Error("podcast not found");
  await setResolve("pod:" + term, feedUrl);
  return feedUrl;
}
async function fetchCVE(app: string): Promise<RssItem[]> {
  const api = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(app)}&resultsPerPage=8`;
  const txt = await proxiedText(api);
  const j = JSON.parse(txt);
  return (j.vulnerabilities ?? []).map((v: any) => {
    const c = v.cve; const desc = (c.descriptions ?? []).find((d: any) => d.lang === "en")?.value ?? "";
    return { title: `${c.id} — ${app}`, link: `https://nvd.nist.gov/vuln/detail/${c.id}`, summary: stripHtml(desc).slice(0, 220), published: Date.parse(c.published) || Date.now() } as RssItem;
  });
}

class RssService {
  async config(): Promise<RssConfig> { return { ...DEFAULT, ...(await storage.kvGet<RssConfig>("rss")) }; }
  private async save(c: RssConfig) { await storage.kvSet("rss", c); }

  /** One-time: merge the default topics into an existing user's subscriptions so
   *  the requested channels light up by default without clobbering their picks. */
  async seedDefaults() {
    if (await storage.kvGet<boolean>("rss:seeded-v2")) return;
    const c = await this.config();
    c.topics = [...new Set([...c.topics, ...DEFAULT_TOPICS])];
    await this.save(c);
    await storage.kvSet("rss:seeded-v2", true);
  }

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
  async addCustomFeed(topic: string, url: string, name: string, kind: FeedKind = "rss") {
    const c = await this.config();
    if (!c.custom.some((f) => f.url === url && f.topic === topic)) c.custom.push({ topic, url, name: name || url, kind });
    if (!c.topics.includes(topic)) c.topics.push(topic);
    await this.save(c);
    this.refresh(true);
  }
  async removeCustomFeed(url: string) {
    const c = await this.config();
    c.custom = c.custom.filter((f) => f.url !== url);
    await this.save(c);
  }
  async feedsForTopic(topic: string): Promise<Feed[]> {
    const c = await this.config();
    const curated = TOPIC_FEEDS[topic] ?? [];
    const custom = c.custom.filter((f) => f.topic === topic).map((f) => ({ url: f.url, name: f.name, kind: f.kind }));
    return [...curated, ...custom].filter((f) => !c.disabled.includes(f.url));
  }

  async fetchFeed(feed: Feed): Promise<RssItem[]> {
    try {
      if (feed.kind === "cve") return await fetchCVE(feed.url);
      let xmlUrl = feed.url;
      if (feed.kind === "youtube") xmlUrl = await resolveYouTube(feed.url);
      else if (feed.kind === "podcast") xmlUrl = await resolvePodcast(feed.url);
      const text = await proxiedText(xmlUrl);
      return this.parse(text);
    } catch { return []; }
  }

  private parse(xml: string): RssItem[] {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
    const items: RssItem[] = [];
    for (const n of nodes.slice(0, 12)) {
      const get = (sel: string) => n.querySelector(sel)?.textContent?.trim() || "";
      const title = decodeEntities(get("title"));
      let link = get("link");
      if (!link) link = n.querySelector("link")?.getAttribute("href") || "";
      const descRaw = get("description") || get("summary") || get("content");
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

  async refresh(force = false): Promise<number> {
    const c = await this.config();
    if (!c.topics.length) return 0;
    if (!force && Date.now() - c.lastRun < THROTTLE_MS) return 0;
    c.lastRun = Date.now();
    await this.save(c);

    // Flatten to a work-list so we can show progress and process with bounded
    // concurrency — one slow feed can't stall the whole refresh (each fetch also
    // has its own timeout). This is what fixes the "refresh times out and never
    // finishes" hang on mobile when you've subscribed to many topics.
    const jobs: { topic: string; feed: Feed }[] = [];
    for (const topic of c.topics) {
      const feeds = (await this.feedsForTopic(topic)).slice(0, FEEDS_PER_TOPIC);
      for (const feed of feeds) jobs.push({ topic, feed });
    }
    const total = jobs.length;
    const seen = new Set(c.seen);   // dedupe against everything we've already pulled
    let posted = 0, done = 0;
    bus.emit("rss:refreshing", true);
    bus.emit("rss:progress", { done: 0, total, posted: 0 });

    const runOne = async ({ topic, feed }: { topic: string; feed: Feed }) => {
      try {
        const items = await this.fetchFeed(feed);
        for (const item of items.slice(0, PER_FEED)) {
          if (seen.has(item.link)) continue;     // already on the timeline — don't double
          seen.add(item.link);
          const blurb = item.summary && item.summary.length > 40 ? item.summary.slice(0, 200).replace(/\s+\S*$/, "") + "…" : item.summary;
          const post: Post = {
            id: "rss_" + hash(item.link),
            author: "rss-bot",
            authorName: `RSS Bot · ${feed.name}`,
            kind: "text",
            text: [item.title, blurb, item.link].filter(Boolean).join("\n\n"),
            media: item.image ? [{ type: "image", url: item.image, mime: "image/*", alt: item.title }] : undefined,
            tags: [topic.toLowerCase().replace(/[^a-z0-9]+/g, "")],
            createdAt: item.published || Date.now(),
            reactions: {},
            embedding: embed(item.title + " " + item.summary + " " + topic),
            source: "relay",
          };
          await feedService.ingest(post);
          bus.emit("post:publish", post);
          posted++;
        }
      } catch { /* skip this feed */ }
      finally { done++; bus.emit("rss:progress", { done, total, posted }); }
    };

    try {
      const CONC = 4;
      for (let i = 0; i < jobs.length; i += CONC) {
        await Promise.all(jobs.slice(i, i + CONC).map(runOne));
      }
    } finally {
      bus.emit("rss:refreshing", false);
      bus.emit("rss:progress", { done: total, total, posted });
    }
    c.seen = [...seen].slice(-1500);
    await this.save(c);
    return posted;
  }
}

export const rssService = new RssService();
