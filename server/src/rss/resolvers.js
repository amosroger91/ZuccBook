// ============================================================
//  rss/resolvers.js — turn the catalog's "soft" references into real
//  feed URLs / items, server-side (so clients never have to):
//   • youtube — a @handle/URL → that channel's videos.xml
//   • podcast — a show name → its RSS via Apple's keyless iTunes Search
//   • cve     — an app keyword → recent CVE items via the NVD API
//  Resolutions are cached in-memory for the process lifetime.
// ============================================================
import { fetchText } from "../lib/http.js";
import { config } from "../config.js";

const cache = new Map(); // ref -> resolved feed url
const TO = () => config.rss.fetchTimeoutMs;

/** YouTube @handle / channel URL → videos.xml feed URL. */
export async function resolveYouTube(ref) {
  if (/^UC[\w-]{22}$/.test(ref)) return `https://www.youtube.com/feeds/videos.xml?channel_id=${ref}`;
  if (ref.includes("videos.xml")) return ref;
  const ck = "yt:" + ref;
  if (cache.has(ck)) return cache.get(ck);
  const page = ref.startsWith("http") ? ref : `https://www.youtube.com/${ref.startsWith("@") ? ref : "@" + ref}`;
  // From a datacenter IP YouTube serves a consent interstitial instead of the
  // channel page (no channelId in the HTML). A consent cookie skips it so the
  // regex below finds the UC… id; the videos.xml feed itself fetches fine.
  const html = await fetchText(page, {
    timeoutMs: TO(),
    headers: { cookie: "CONSENT=YES+1; SOCS=CAI", "accept-language": "en-US,en;q=0.9" },
  });
  if (!html) throw new Error("youtube page unreachable");
  const m =
    html.match(/"channelId":"(UC[\w-]{22})"/) ||
    html.match(/channel_id=(UC[\w-]{22})/) ||
    html.match(/(UC[\w-]{22})/);
  if (!m) throw new Error("no channelId");
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
  cache.set(ck, feedUrl);
  return feedUrl;
}

/** Podcast show name → its RSS feed URL (Apple iTunes Search, keyless + CORS-ok). */
export async function resolvePodcast(term) {
  const ck = "pod:" + term;
  if (cache.has(ck)) return cache.get(ck);
  const txt = await fetchText(
    `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=1&term=${encodeURIComponent(term)}`,
    { timeoutMs: TO(), proxy: false },
  );
  if (!txt) throw new Error("itunes unreachable");
  const feedUrl = JSON.parse(txt).results?.[0]?.feedUrl;
  if (!feedUrl) throw new Error("podcast not found");
  cache.set(ck, feedUrl);
  return feedUrl;
}

/** App keyword → recent CVE items (shaped like rss-parser items for itemToPost). */
export async function fetchCVE(app) {
  const txt = await fetchText(
    `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(app)}&resultsPerPage=8`,
    { timeoutMs: TO() },
  );
  if (!txt) return [];
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    return [];
  }
  return (j.vulnerabilities ?? []).map((v) => {
    const c = v.cve;
    const desc = (c.descriptions ?? []).find((d) => d.lang === "en")?.value ?? "";
    return {
      title: `${c.id} — ${app}`,
      link: `https://nvd.nist.gov/vuln/detail/${c.id}`,
      contentSnippet: desc.slice(0, 220),
      isoDate: c.published,
    };
  });
}
