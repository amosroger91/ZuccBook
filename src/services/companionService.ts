// ============================================================
//  companionService — the local AI companion. The companion IS a
//  real on-device LLM (WebLLM / WebGPU, WASM runtime). Inference is
//  100% local: nothing leaves your device.
//
//  • The model is loaded lazily and CACHED by WebLLM in the browser
//    (Cache Storage), so it downloads once and afterwards just loads
//    into memory on refresh — unless you clear site data.
//  • If WebGPU isn't available, or while the model is still
//    downloading, fast offline heuristic tools answer instead.
//  • Pick which model to load (see MODELS) — tiny to capable.
// ============================================================
import type { CompanionPersona, CompanionMessage, Post, Community } from "@/types";
import { storage } from "./storage";
import { identityService } from "./identityService";
import { webLookupService } from "./webLookupService";
import { bus } from "@/lib/events";
import { newId } from "@/lib/id";
import { topTerms } from "@/lib/embeddings";

export interface LlmModel { id: string; label: string; size: string; }

// A curated set of WebLLM models, smallest → most capable.
export const MODELS: LlmModel[] = [
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 0.5B — tiny & fast", size: "~350 MB" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B — balanced", size: "~880 MB" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B", size: "~1.4 GB" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B — smarter", size: "~1.8 GB" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi-3.5 mini — capable", size: "~2.2 GB" },
];

const PERSONA_VOICE: Record<CompanionPersona, string> = {
  coach: "encouraging", comedian: "playful", critic: "analytical", researcher: "precise", friend: "warm and casual",
};

export function isWebGPU(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).gpu;
}

// Inspect the actual hardware (RAM + the WebGPU adapter's buffer limits) and
// pick the most capable model this device can comfortably run. deviceMemory is
// capped at 8 by browsers, so 8 means "8 GB or more"; we stay one tier below the
// theoretical max so the model + browser + page all fit in memory.
export async function bestModelForHardware(): Promise<{ id: string; reason: string }> {
  if (!isWebGPU()) return { id: MODELS[0].id, reason: "No WebGPU — smallest model for the offline fallback." };
  const gb: number = (navigator as any).deviceMemory || 4;        // GB, capped at 8
  let maxBuffer = 0;
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (adapter) maxBuffer = adapter.limits?.maxBufferSize || adapter.limits?.maxStorageBufferBindingSize || 0;
  } catch { /* adapter probe failed — fall back to RAM heuristic */ }
  // Be GPU-buffer aware and conservative: picking a model bigger than the GPU's
  // single-buffer limit causes a "device lost" crash. Default to the tiny model
  // unless the GPU clearly has room; users can always pick a bigger one manually.
  const huge = maxBuffer >= 3_000_000_000;   // ~3 GB+ single-buffer
  const big = maxBuffer >= 1_500_000_000;    // ~1.5 GB+ single-buffer
  let pick: LlmModel, why: string;
  if (huge && gb >= 8) { pick = byId("Llama-3.2-3B-Instruct-q4f16_1-MLC"); why = `${gb}GB RAM + roomy GPU`; }
  else if (big && gb >= 8) { pick = byId("Llama-3.2-1B-Instruct-q4f16_1-MLC"); why = `${gb}GB RAM`; }
  else { pick = MODELS[0]; why = maxBuffer ? "modest GPU — keeping it light" : "GPU limits unknown — playing it safe"; }
  return { id: pick.id, reason: `Auto-selected ${pick.label} (${pick.size}) for your hardware: ${why}.` };
}
function byId(id: string): LlmModel { return MODELS.find((m) => m.id === id) ?? MODELS[0]; }

// --- WebLLM engine (lazy, cached) ---
let engine: any = null;
let loadedId: string | null = null;
let loadingId: string | null = null;
let loadingPromise: Promise<any> | null = null;
const failed = new Set<string>(); // models that crashed (e.g. GPU device lost) — don't retry

export function modelReady(id: string): boolean { return !!engine && loadedId === id; }

async function loadModel(id: string): Promise<any | null> {
  if (engine && loadedId === id) return engine;
  if (loadingPromise && loadingId === id) return loadingPromise;
  if (!isWebGPU() || failed.has(id)) return null;   // don't re-attempt a model that crashed
  loadingId = id;
  loadingPromise = (async () => {
    try {
      // Bundled (lazy chunk), NOT a runtime CDN import. The old esm.run import failed
      // silently under CSP / offline / CDN hiccups — which left the companion stuck on
      // the heuristic fallback forever. Bundling makes it same-origin and reliable.
      const webllm: any = await import("@mlc-ai/web-llm");
      bus.emit("companion:model", { state: "loading", id, progress: 0, text: "starting" });
      // Run the engine in a Web Worker so the heavy model load/compile + inference
      // never block the UI thread (that was the "page unresponsive" freeze on boot).
      // The worker hosts WebWorkerMLCEngineHandler — see llm.worker.ts.
      const worker = new Worker(new URL("./llm.worker.ts", import.meta.url), { type: "module" });
      // If the worker fails to import web-llm it CATCHES the error and posts a
      // "led-worker-fatal" message — so worker.onerror never fires and
      // CreateWebWorkerMLCEngine would hang forever (companion stuck "loading").
      // Race the engine handshake against that fatal signal so we reject instead.
      let fatalCleanup = () => {};
      const fatal = new Promise<never>((_, reject) => {
        const onMsg = (e: MessageEvent) => { if ((e.data as any)?.kind === "led-worker-fatal") reject(new Error("web-llm worker failed to load: " + (e.data as any).error)); };
        const onErr = (e: any) => reject(new Error("web-llm worker error: " + (e?.message ?? "unknown")));
        worker.addEventListener("message", onMsg);
        worker.addEventListener("error", onErr);
        fatalCleanup = () => { worker.removeEventListener("message", onMsg); worker.removeEventListener("error", onErr); };
      });
      let eng: any;
      try {
        eng = await Promise.race([
          webllm.CreateWebWorkerMLCEngine(worker, id, {
            // Cache model weights in IndexedDB, not CacheStorage. CacheStorage.open
            // throws "Unexpected internal error" in some Chrome profiles/contexts (and
            // is blocked in others) — IndexedDB is available everywhere the rest of the
            // app already uses it, so the model actually caches + loads reliably.
            appConfig: { ...webllm.prebuiltAppConfig, cacheBackend: "indexeddb" },
            initProgressCallback: (p: any) => bus.emit("companion:model", { state: "loading", id, progress: p.progress ?? 0, text: p.text }),
          }),
          fatal,
        ]);
      } catch (err) {
        try { worker.terminate(); } catch { /* ignore */ }   // don't leak the dead worker
        throw err;
      } finally {
        fatalCleanup();
      }
      engine = eng; loadedId = id;
      bus.emit("companion:model", { state: "ready", id });
      return eng;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.error("[companion] model load failed:", msg, e);
      // Only blacklist the model on a real GPU/device crash (retrying would re-crash).
      // Transient load errors (network, CDN) stay retryable on the next attempt.
      if (/device lost|out of memory|maxBufferSize|createBuffer|adapter/i.test(msg)) failed.add(id);
      engine = null; loadedId = null;
      bus.emit("companion:model", { state: "error", id, text: msg.slice(0, 200) });
      return null;
    } finally { loadingPromise = null; loadingId = null; }
  })();
  return loadingPromise;
}

class CompanionService {
  persona: CompanionPersona = "friend";
  useLLM = true;
  model = MODELS[0].id;

  configure(useLLM: boolean, model?: string) {
    this.useLLM = useLLM;
    if (model) this.model = model;
  }
  isSupported() { return isWebGPU(); }
  modelReady() { return modelReady(this.model); }
  /** Explicitly start downloading/loading the selected model. */
  preload() { return loadModel(this.model); }

  /** Run the LLM only if a model is already loaded (never triggers a download).
   *  Returns null if no model is in memory — callers fall back to heuristics. */
  async quickLLM(prompt: string): Promise<string | null> {
    if (!engine || loadedId !== this.model) return null;
    try {
      const r = await engine.chat.completions.create({ messages: [{ role: "user", content: prompt }], temperature: 0.8 });
      return r.choices?.[0]?.message?.content ?? null;
    } catch { return null; }
  }

  /** Derive search keywords from a headline using the on-device LLM (the user's
   *  own compute). Falls back to local term extraction if no model is loaded.
   *  Returns { keywords, usedLLM } so the UI can credit the contribution. */
  async keywords(text: string, n = 6): Promise<{ keywords: string[]; usedLLM: boolean }> {
    if (engine && loadedId === this.model) {
      try {
        const r = await engine.chat.completions.create({
          messages: [{ role: "user", content: `From this news headline, list up to ${n} short search keywords (names, places, claims, topics). Reply ONLY with a comma-separated list, nothing else.\n\nHeadline: "${text.slice(0, 240)}"` }],
          temperature: 0.2,
        });
        const out: string = r.choices?.[0]?.message?.content ?? "";
        const kws = out.replace(/^[^a-z0-9"]*keywords?[:\-\s]*/i, "")
          .split(/[,\n;]/).map((s: string) => s.replace(/^[\s\-*\d."']+|["']+$/g, "").trim().toLowerCase())
          .filter((s: string) => s.length > 2 && s.length < 34 && !/^(the|and|that|this|with|from|for)$/.test(s));
        if (kws.length) return { keywords: [...new Set(kws)].slice(0, n), usedLLM: true };
      } catch { /* fall through to local */ }
    }
    return { keywords: topTerms(text, n), usedLLM: false };
  }

  /** Generate the shared AI bot's OWN independent public comment on a post —
   *  written as if it came across the post in the feed, never referencing whoever
   *  triggered it. Returns the text + the model label used (for provenance). */
  async commentOnPost(post: Post): Promise<{ text: string; modelLabel: string; usedLLM: boolean }> {
    const body = (post.text ?? "").slice(0, 700);
    const prompt = [
      "You are Ledger AI, an autonomous commenter that browses the public feed and leaves a short comment on posts you find interesting.",
      "Write ONE genuine, on-topic public comment (1–2 sentences) reacting to the post below, as if you came across it yourself while scrolling.",
      "Rules: do NOT address anyone, do NOT mention being asked/prompted, never say \"the user\". No greeting, no quotation marks, no hashtags. Just your own take.",
      "",
      `Post by ${post.authorName}: "${body}"`,
    ].join("\n");
    let text: string | null = null, usedLLM = false;
    try {
      if (this.useLLM && isWebGPU()) {
        const eng = await loadModel(this.model);
        if (eng) {
          const r = await eng.chat.completions.create({ messages: [{ role: "user", content: prompt }], temperature: 0.85, max_tokens: 160 });
          text = r.choices?.[0]?.message?.content ?? null;
          usedLLM = !!(text && text.trim());
        }
      }
    } catch { /* fall through to heuristic */ }
    if (!text || !text.trim()) text = this.heuristicComment(body);
    text = text.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^comment[:\-\s]+/i, "").trim().slice(0, 600);
    const modelLabel = usedLLM ? (MODELS.find((m) => m.id === this.model)?.label ?? this.model) : "fast offline engine";
    return { text, modelLabel, usedLLM };
  }

  private heuristicComment(text: string): string {
    const t = topTerms(text, 2).join(" / ") || "this";
    const opts = [
      `Interesting angle on ${t} — worth a closer look.`,
      `This take on ${t} stands out; curious where it leads.`,
      `Solid food for thought on ${t}.`,
      `${t}: not the framing I expected, but it lands.`,
    ];
    return opts[text.length % opts.length];
  }

  history() { return storage.companionHistory(); }

  /** Ask with feed + community context gathered automatically (so callers like the
   *  mini-dock don't have to assemble it). Keeps every surface equally grounded. */
  async askWithContext(prompt: string): Promise<CompanionMessage> {
    const [posts, communities] = await Promise.all([
      storage.recentPosts(40).catch(() => [] as Post[]),
      storage.communities().catch(() => [] as Community[]),
    ]);
    return this.ask(prompt, { posts, communities });
  }

  async ask(prompt: string, context?: { posts?: Post[]; communities?: Community[] }): Promise<CompanionMessage> {
    // Capture prior turns BEFORE recording this one so the model sees the
    // conversation so far (multi-turn coherence) without echoing the new message.
    const prior = await storage.companionHistory().catch(() => [] as CompanionMessage[]);
    const userMsg: CompanionMessage = { id: newId("cm"), role: "user", text: prompt, at: Date.now() };
    await storage.addCompanionMsg(userMsg);
    bus.emit("companion:thinking", true);
    let text: string;
    try {
      if (this.useLLM && isWebGPU()) {
        const eng = await loadModel(this.model);
        if (eng) {
          // Tool use: let the model pull in live web info (DuckDuckGo + page text)
          // when the question needs it, before it composes the answer.
          const web = await this.gatherWeb(eng, prompt);
          text = await this.llmAnswer(eng, prompt, context, prior, web.context);
          if (web.sources.length) text += `\n\nSources:\n${web.sources.map((s) => `• ${s}`).join("\n")}`;
        } else {
          text = this.heuristicAnswer(prompt, context);
        }
      } else {
        text = this.heuristicAnswer(prompt, context);
      }
    } catch {
      text = this.heuristicAnswer(prompt, context);
    }
    bus.emit("companion:thinking", false);
    const reply: CompanionMessage = { id: newId("cm"), role: "companion", text, at: Date.now() };
    await storage.addCompanionMsg(reply);
    return reply;
  }

  /** System prompt — gives the model its identity, the user's name, what it can
   *  (and can't) do, and how to behave. This is what makes answers coherent and
   *  on-brand instead of generic. */
  private systemPrompt(): string {
    const name = identityService.current?.username?.trim() || "there";
    return [
      "You are the Companion on Ledger — a decentralized, local-first social app that runs entirely in the user's web browser.",
      "On Ledger: the user OWNS their identity (a cryptographic keypair, not an account on a server); the feed is ranked on-device; posts and messages travel peer-to-peer (Gun + Nostr); there are no central servers.",
      "You run 100% locally on this device via WebGPU — nothing the user types ever leaves their machine. You can state this truthfully if asked about privacy.",
      `You're chatting with ${name}.`,
      "Be genuinely helpful, specific and concise — a few sentences unless they ask for depth. Friendly and direct, never corporate or sycophantic.",
      "Use the feed context provided below when it's relevant. If something isn't in the context and you don't know it, say so plainly rather than inventing facts, names, or events.",
      "You CAN look things up on the web: when web results or a fetched page's text are provided below, treat them as your current source of truth and cite the source URL(s) you used. (The app fetches them for you.)",
      "You CAN help with: looking up current facts, making sense of the feed and what's trending, suggesting communities/people, drafting or sharpening posts, explaining how Ledger works, and thinking problems through.",
      "You CANNOT take actions for them (post, follow, mute, change settings) — if they want one of those, briefly tell them how to do it instead of pretending you did.",
    ].join("\n");
  }

  /** Tool step: decide whether to hit the web, then fetch DuckDuckGo answers and/or
   *  scrape a page, returning compact context text + the source URLs used. A pasted
   *  URL is scraped directly; otherwise the model itself decides if a search helps. */
  private async gatherWeb(eng: any, prompt: string): Promise<{ context: string; sources: string[] }> {
    try {
      const url = prompt.match(/https?:\/\/[^\s)]+/)?.[0];
      if (url) {
        const page = await webLookupService.readPage(url);
        if (page) return { context: `Fetched page (${page.url}):\n${page.title ? page.title + "\n" : ""}${page.text}`, sources: [page.url] };
      }
      const query = await this.routeSearch(eng, prompt);
      if (query) {
        const res = await webLookupService.lookup(query);
        if (res) return res;
      }
    } catch { /* web tools are best-effort */ }
    return { context: "", sources: [] };
  }

  /** Ask the model whether the question needs a web search; parse a one-line
   *  "SEARCH: <query>" directive. Returns the query, or null to answer offline. */
  private async routeSearch(eng: any, prompt: string): Promise<string | null> {
    try {
      const r = await eng.chat.completions.create({
        messages: [
          { role: "system", content: "Decide if answering the user needs a live web search (current events, specific facts, definitions, prices, or anything you can't reliably know). If yes, reply EXACTLY one line: SEARCH: <a concise query>. If you can answer from general knowledge, or it's about the user's own feed/app, reply EXACTLY: NONE. Output only that one line." },
          { role: "user", content: prompt.slice(0, 500) },
        ],
        temperature: 0,
        max_tokens: 40,
      });
      const out: string = (r.choices?.[0]?.message?.content ?? "").trim();
      const m = out.match(/SEARCH:\s*(.+)/i);
      if (!m) return null;
      return m[1].split("\n")[0].replace(/^["']|["']$/g, "").trim().slice(0, 120) || null;
    } catch { return null; }
  }

  private async llmAnswer(eng: any, prompt: string, ctx?: { posts?: Post[]; communities?: Community[] }, prior: CompanionMessage[] = [], webContext = ""): Promise<string> {
    const posts = ctx?.posts ?? [];
    const feedLines = posts.slice(0, 6).map((p) => `- ${p.authorName}: ${(p.text ?? "").slice(0, 180)}`).join("\n");
    const digest = posts.length ? this.feedDigest(posts) : null;
    const contextBlock = feedLines
      ? `The user's current feed (recent posts):\n${feedLines}${digest?.themes.length ? `\nThemes right now: ${digest.themes.join(", ")}.` : ""}`
      : "";
    // Replay recent conversation turns so follow-ups ("expand on that", "why?")
    // make sense. Cap to keep the prompt small on the smaller on-device models.
    const history = prior.slice(-8).map((m) => ({ role: m.role === "companion" ? "assistant" : "user", content: m.text } as const));
    const messages = [
      { role: "system", content: this.systemPrompt() } as const,
      ...(webContext ? [{ role: "system", content: `Live web results (use as your source of truth; cite the source URLs):\n${webContext}` } as const] : []),
      ...(contextBlock ? [{ role: "system", content: contextBlock } as const] : []),
      ...history,
      { role: "user", content: prompt } as const,
    ];
    const reply = await eng.chat.completions.create({ messages, temperature: 0.7, max_tokens: 512 });
    return reply.choices?.[0]?.message?.content ?? this.heuristicAnswer(prompt, ctx);
  }

  /** Structured, on-device snapshot of the current feed for the digest widget. */
  feedDigest(posts: Post[]): { count: number; people: number; reactions: number; themes: string[]; top: Post | null } {
    const real = posts.filter((p) => p.author !== "rss-bot" && p.author !== "system");
    const reactions = posts.reduce((s, p) => s + Object.values(p.reactions).reduce((a, v) => a + v.length, 0), 0);
    return {
      count: posts.length,
      people: new Set(real.map((p) => p.authorName)).size,
      reactions,
      // Cap each post's text contribution. This runs on EVERY feed change; without the
      // cap, a feed full of long Nostr notes (20–80KB each) joins into multiple MB and
      // topTerms' regex/split chokes the main thread for seconds — re-fired through the
      // relay flood, that froze the feed. A short excerpt is plenty for theme keywords.
      themes: topTerms(posts.map((p) => (p.text ?? "").slice(0, 240)).join(" "), 5),
      top: posts.length ? [...posts].sort((a, b) => react(b) - react(a))[0] : null,
    };
  }

  /* ---------- fast offline tools (no model download needed) ---------- */
  summarizeFeed(posts: Post[]): string {
    if (!posts.length) return "Your feed is quiet right now — be the first to post something ✦";
    const terms = topTerms(posts.map((p) => (p.text ?? "").slice(0, 240)).join(" "), 6);
    const authors = new Set(posts.map((p) => p.authorName)).size;
    const top = [...posts].sort((a, b) => react(b) - react(a))[0];
    return [
      `${posts.length} posts from ${authors} ${authors === 1 ? "person" : "people"}.`,
      terms.length ? `Themes: ${terms.join(", ")}.` : "",
      top ? `Most-reacted: "${(top.text ?? "").slice(0, 80)}" by ${top.authorName}.` : "",
    ].filter(Boolean).join(" ");
  }
  explainTrends(posts: Post[]): string {
    const tags = new Map<string, number>();
    for (const p of posts) for (const t of p.tags) tags.set(t, (tags.get(t) || 0) + 1 + react(p));
    const ranked = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!ranked.length) return "No clear trends yet. Add some #tags to your posts to seed them.";
    return "Trending: " + ranked.map(([t, n]) => `#${t} (${n})`).join("  ·  ");
  }
  suggestCommunities(posts: Post[], communities: Community[]): Community[] {
    const terms = new Set(topTerms(posts.map((p) => p.text ?? "").join(" "), 12));
    return communities
      .map((c) => ({ c, hits: [...terms].filter((t) => (c.name + " " + c.description).toLowerCase().includes(t)).length }))
      .filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).map((x) => x.c).slice(0, 3);
  }
  flagMisinformation(text: string): { risk: "low" | "medium" | "high"; note: string } {
    const t = text.toLowerCase();
    const redFlags = ["100% proven", "they don't want you to know", "miracle cure", "do your own research", "wake up"];
    const hits = redFlags.filter((f) => t.includes(f));
    if (hits.length >= 2) return { risk: "high", note: `Rhetoric often tied to misinformation: ${hits.join(", ")}` };
    if (hits.length === 1) return { risk: "medium", note: `Watch phrase: "${hits[0]}". Look for primary sources.` };
    return { risk: "low", note: "No obvious misinformation markers — still verify surprising claims." };
  }

  /** A fresh, varied post draft each call (offline; no model needed). */
  draftPost(posts: Post[] = []): string {
    const tags = posts.flatMap((p) => p.tags);
    const tag = tags.length ? "#" + tags[Math.floor(Math.random() * tags.length)] : "#decentralization";
    const openers = [
      `Hot take: your social feed should run on *your* device, not a server farm. ${tag}`,
      `TIL the browser can run a whole AI model locally — no cloud, no tracking. wild. ${tag}`,
      `what's everyone building today? drop it below 👇 ${tag}`,
      `reminder: you own your identity here. it's literally a file you can carry anywhere. ${tag}`,
      `unpopular opinion: reactions > follower counts. reputation should be earned. ${tag}`,
      `peer-to-peer everything. no servers, ~$0 to run, still real-time. the future is weird and good. ${tag}`,
      `just set my status to "in the zone" and put on some synthwave. who's listening together? ${tag}`,
    ];
    return openers[Math.floor(Math.random() * openers.length)];
  }

  private heuristicAnswer(prompt: string, ctx?: { posts?: Post[]; communities?: Community[] }): string {
    const p = prompt.toLowerCase();
    const posts = ctx?.posts ?? [];
    if (/summar/i.test(p)) return this.summarizeFeed(posts);
    if (/trend/i.test(p)) return this.explainTrends(posts);
    if (/communit|group|server/i.test(p)) {
      const s = this.suggestCommunities(posts, ctx?.communities ?? []);
      return s.length ? "You might like: " + s.map((c) => c.name).join(", ") : "No matching communities yet — create one!";
    }
    if (/misinfo|fake|true\?|real\?/i.test(p)) { const r = this.flagMisinformation(prompt); return `Misinformation risk: ${r.risk}. ${r.note}`; }
    const tip = isWebGPU()
      ? "Enable the on-device model (it's loading or off) for full conversational answers."
      : "This browser has no WebGPU, so I'm running the fast offline engine.";
    return `(${PERSONA_VOICE[this.persona]} · local) ${tip} Meanwhile I can "summarize my feed", show "what's trending", or "suggest communities". You said: "${prompt}".`;
  }
}

const react = (p: Post) => Object.values(p.reactions).reduce((s, a) => s + a.length, 0);
export const companionService = new CompanionService();
