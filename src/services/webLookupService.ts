// ============================================================
//  webLookupService — gives the on-device Companion two web tools:
//   1. DuckDuckGo Instant Answers (api.duckduckgo.com) for quick facts.
//   2. Readable page extraction — fetch a URL and return the MAIN
//      article TEXT (not raw HTML), so the small local model gets clean,
//      token-cheap content instead of markup/scripts/nav.
//
//  All network goes through public CORS proxies (the app has no server),
//  trying a direct fetch first. Fetched content is screened by the same
//  safety blocklist as everything else, and everything fails soft —
//  a lookup that errors just yields no context, never an exception.
// ============================================================
import { decodeEntities } from "@/lib/htmlEntities";
import { isBlockedText } from "@/lib/authorBlock";

const PROXIES: ((u: string) => string)[] = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

/** Fetch text, trying the origin directly first, then CORS proxies. "" on failure. */
async function fetchText(url: string): Promise<string> {
  for (const wrap of [(u: string) => u, ...PROXIES]) {
    try {
      const r = await fetch(wrap(url), { cache: "no-store" });
      if (r.ok) { const t = await r.text(); if (t) return t; }
    } catch { /* try the next proxy */ }
  }
  return "";
}

export interface DdgResult {
  heading?: string;
  answer?: string;
  abstract?: string;
  source?: string;
  related: { text: string; url: string }[];
}

/** DuckDuckGo Instant Answer API → a compact, no-HTML answer object. */
export async function ddgAnswer(query: string): Promise<DdgResult | null> {
  const api = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const txt = await fetchText(api);
  if (!txt) return null;
  let j: any;
  try { j = JSON.parse(txt); } catch { return null; }
  const related: { text: string; url: string }[] = [];
  for (const t of j.RelatedTopics ?? []) {
    if (t?.Text && t?.FirstURL) related.push({ text: t.Text, url: t.FirstURL });
    else if (Array.isArray(t?.Topics)) for (const s of t.Topics) if (s?.Text && s?.FirstURL) related.push({ text: s.Text, url: s.FirstURL });
  }
  return {
    heading: j.Heading || undefined,
    answer: j.Answer || undefined,
    abstract: j.AbstractText || j.Definition || undefined,
    source: j.AbstractURL || j.DefinitionURL || undefined,
    related,
  };
}

export interface PageContent { title: string; text: string; url: string; }

// The content element with the most paragraph text — a cheap readability
// heuristic when there's no <article>/<main>.
function densest(doc: Document): Element | null {
  let best: Element | null = null;
  let score = 0;
  for (const el of Array.from(doc.querySelectorAll("article, main, section, div"))) {
    const ps = el.querySelectorAll("p");
    if (ps.length < 3) continue;
    const len = Array.from(ps).reduce((s, p) => s + (p.textContent || "").length, 0);
    if (len > score) { score = len; best = el; }
  }
  return best;
}

function extractReadable(html: string, url: string): PageContent | null {
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, "text/html"); } catch { return null; }
  // Drop everything that isn't article content before reading text.
  doc.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, figure")
    .forEach((el) => el.remove());
  const title = (doc.querySelector("title")?.textContent || doc.querySelector("h1")?.textContent || "").trim();
  const root = doc.querySelector("article") || doc.querySelector("main") || densest(doc) || doc.body;
  let text = (root?.textContent || "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n")
    .trim();
  text = decodeEntities(text).slice(0, 4000);   // cap: plenty of context for a small local model
  if (!text || text.length < 40) return null;
  return { title: decodeEntities(title).slice(0, 200), text, url };
}

/** Fetch a URL and return its main readable TEXT (never raw HTML). */
export async function readPage(url: string): Promise<PageContent | null> {
  if (!/^https?:\/\//i.test(url) || isBlockedText(url)) return null;
  const html = await fetchText(url);
  if (!html) return null;
  const page = extractReadable(html, url);
  if (!page) return null;
  if (isBlockedText(page.title + " " + page.text)) return null;   // don't feed blocked content to the model
  return page;
}

/** One-shot web research for a query: DDG answer + (if thin) scrape the top result.
 *  Returns a compact context string + the source URLs, or null. */
export async function lookup(query: string): Promise<{ context: string; sources: string[] } | null> {
  if (!query || isBlockedText(query)) return null;
  const ddg = await ddgAnswer(query).catch(() => null);
  const parts: string[] = [];
  const sources: string[] = [];
  if (ddg) {
    if (ddg.answer) parts.push(`Answer: ${ddg.answer}`);
    if (ddg.abstract) { parts.push(ddg.abstract); if (ddg.source) sources.push(ddg.source); }
    if (ddg.related.length) parts.push("Related:\n" + ddg.related.slice(0, 5).map((r) => `- ${r.text}`).join("\n"));
  }
  // If DuckDuckGo gave little, scrape the most relevant link for fuller content.
  const topUrl = ddg?.source || ddg?.related[0]?.url;
  if (topUrl && parts.join(" ").length < 400) {
    const page = await readPage(topUrl).catch(() => null);
    if (page) { parts.push(`From ${page.url}:\n${page.text}`); sources.push(page.url); }
  }
  if (!parts.length) return null;
  const context = `DuckDuckGo results for "${query}":\n${parts.join("\n\n")}`.slice(0, 5000);
  return { context, sources: [...new Set(sources)] };
}

export const webLookupService = { ddgAnswer, readPage, lookup };
