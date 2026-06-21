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
      const spec = "https://esm.run/@mlc-ai/web-llm";
      const webllm: any = await import(/* @vite-ignore */ spec);
      bus.emit("companion:model", { state: "loading", id, progress: 0, text: "starting" });
      const eng = await webllm.CreateMLCEngine(id, {
        initProgressCallback: (p: any) => bus.emit("companion:model", { state: "loading", id, progress: p.progress ?? 0, text: p.text }),
      });
      engine = eng; loadedId = id;
      bus.emit("companion:model", { state: "ready", id });
      return eng;
    } catch (e) {
      console.warn("[companion] model load failed", e);
      failed.add(id);                  // don't keep retrying a model that crashes this GPU
      engine = null; loadedId = null;
      bus.emit("companion:model", { state: "error", id });
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

  history() { return storage.companionHistory(); }

  async ask(prompt: string, context?: { posts?: Post[]; communities?: Community[] }): Promise<CompanionMessage> {
    const userMsg: CompanionMessage = { id: newId("cm"), role: "user", text: prompt, at: Date.now() };
    await storage.addCompanionMsg(userMsg);
    bus.emit("companion:thinking", true);
    let text: string;
    try {
      if (this.useLLM && isWebGPU()) {
        const eng = await loadModel(this.model);
        text = eng ? await this.llmAnswer(eng, prompt, context) : this.heuristicAnswer(prompt, context);
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

  private async llmAnswer(eng: any, prompt: string, ctx?: { posts?: Post[] }): Promise<string> {
    const sys = `You are ZuccBook's on-device AI companion, running fully locally and privately in the user's browser. Be concise, friendly and helpful.`;
    const feed = (ctx?.posts ?? []).slice(0, 8).map((p) => `- ${p.authorName}: ${p.text ?? ""}`).join("\n");
    const reply = await eng.chat.completions.create({
      messages: [
        { role: "system", content: sys },
        ...(feed ? [{ role: "user", content: `Context (recent feed):\n${feed}` } as const] : []),
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });
    return reply.choices?.[0]?.message?.content ?? this.heuristicAnswer(prompt, ctx);
  }

  /* ---------- fast offline tools (no model download needed) ---------- */
  summarizeFeed(posts: Post[]): string {
    if (!posts.length) return "Your feed is quiet right now — be the first to post something ✦";
    const terms = topTerms(posts.map((p) => p.text ?? "").join(" "), 6);
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
