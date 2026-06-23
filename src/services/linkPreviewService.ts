// ============================================================
//  linkPreviewService — social-media style link unfurling. Fetches a
//  URL's HTML (via public CORS proxies), scrapes Open Graph / Twitter
//  meta tags, and returns a {title, description, image, site} preview.
//  Cached in memory + IndexedDB so each link is only fetched once.
// ============================================================
import { storage } from "./storage";
import { decodeEntities } from "@/lib/htmlEntities";

const PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

export interface Preview { url: string; title?: string; description?: string; image?: string; site?: string; }

const mem = new Map<string, Preview>();
// Decode HTML entities in scraped meta tags. The shared helper covers numeric +
// hex entities (e.g. &#225; → á, common in non-English RSS/OG titles), not just
// the handful of named ones.
const decode = decodeEntities;

function meta(html: string, prop: string): string | undefined {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  const m = a || b;
  return m ? decode(m[1]) : undefined;
}

class LinkPreviewService {
  async preview(url: string): Promise<Preview> {
    if (mem.has(url)) return mem.get(url)!;
    const cached = await storage.kvGet<Preview>("lp:" + url);
    if (cached) { mem.set(url, cached); return cached; }

    let host = ""; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    let html = "";
    for (const p of PROXIES) {
      try { const r = await fetch(p(url), { cache: "no-store" }); if (r.ok) { html = await r.text(); if (html) break; } } catch {}
    }
    const title = meta(html, "og:title") || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] && decode(html.match(/<title[^>]*>([^<]+)<\/title>/i)![1]));
    let image = meta(html, "og:image") || meta(html, "twitter:image");
    if (image && image.startsWith("//")) image = "https:" + image;
    const preview: Preview = { url, title: title || undefined, description: meta(html, "og:description") || meta(html, "description"), image: image && /^https?:\/\//.test(image) ? image : undefined, site: meta(html, "og:site_name") || host };
    mem.set(url, preview);
    storage.kvSet("lp:" + url, preview);
    return preview;
  }

  /** TikTok unfurl via the official oEmbed endpoint — reliably returns a cover
   *  thumbnail, title, and author even though TikTok pages don't scrape well.
   *  Tries the endpoint directly, then falls back through the CORS proxies. */
  async tiktok(url: string): Promise<Preview> {
    const key = "tt:" + url;
    if (mem.has(key)) return mem.get(key)!;
    const cached = await storage.kvGet<Preview>(key);
    if (cached) { mem.set(key, cached); return cached; }

    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    let j: any = null;
    for (const f of [endpoint, ...PROXIES.map((p) => p(endpoint))]) {
      try { const r = await fetch(f, { cache: "no-store" }); if (r.ok) { j = JSON.parse(await r.text()); if (j) break; } } catch {}
    }
    let image: string | undefined = j?.thumbnail_url;
    if (image && image.startsWith("//")) image = "https:" + image;
    const handle = (j?.author_url || "").match(/@([\w.-]+)/)?.[1] || j?.author_name;
    const preview: Preview = {
      url,
      title: j?.title ? decode(j.title) : undefined,
      description: handle ? `@${handle}` : undefined,
      image: image && /^https?:\/\//.test(image) ? image : undefined,
      site: "TikTok",
    };
    mem.set(key, preview);
    storage.kvSet(key, preview);
    return preview;
  }
}

export const linkPreviewService = new LinkPreviewService();
