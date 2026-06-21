// ============================================================
//  companionService — the local AI companion. Inference is local.
//
//  Two providers behind one interface:
//   • "heuristic"  — a fast, deterministic, fully-offline assistant
//                    (always available; no model download).
//   • "webllm"     — real on-device LLM via WebGPU, lazy-loaded from
//                    the @mlc-ai/web-llm ESM only when the user opts
//                    in (Settings → "Use on-device LLM"). Falls back
//                    gracefully to heuristic if WebGPU/model fails.
//
//  Capabilities: summarize feed, explain trends, suggest communities,
//  draft replies, flag likely misinformation. All on the user's machine.
// ============================================================
import type { CompanionPersona, CompanionMessage, Post, Community } from "@/types";
import { storage } from "./storage";
import { bus } from "@/lib/events";
import { newId } from "@/lib/id";
import { topTerms } from "@/lib/embeddings";

const PERSONA_VOICE: Record<CompanionPersona, string> = {
  coach: "encouraging, action-oriented",
  comedian: "playful and witty",
  critic: "sharp and analytical",
  researcher: "precise and citation-minded",
  friend: "warm and casual",
};

// Optional WebGPU LLM engine (typed loosely to avoid a hard dependency).
let engine: any = null;
let engineLoading: Promise<any> | null = null;

async function loadWebLLM(): Promise<any | null> {
  if (engine) return engine;
  if (engineLoading) return engineLoading;
  if (!(navigator as any).gpu) return null; // no WebGPU → caller falls back
  engineLoading = (async () => {
    try {
      // Lazy ESM import — only fetched when the user enables on-device LLM.
      // Non-literal specifier so the type-checker doesn't try to resolve a URL.
      const spec = "https://esm.run/@mlc-ai/web-llm";
      const webllm: any = await import(/* @vite-ignore */ spec);
      engine = await webllm.CreateMLCEngine("Llama-3.2-1B-Instruct-q4f16_1-MLC", {
        initProgressCallback: (p: any) => bus.emit("toast", { kind: "info", message: `Loading local model… ${(p.progress * 100 | 0)}%` }),
      });
      return engine;
    } catch (e) {
      console.warn("[companion] WebLLM unavailable, using heuristic provider", e);
      return null;
    } finally { engineLoading = null; }
  })();
  return engineLoading;
}

class CompanionService {
  persona: CompanionPersona = "friend";
  useLLM = false;

  configure(persona: CompanionPersona, useLLM: boolean) {
    this.persona = persona;
    this.useLLM = useLLM;
    if (useLLM) loadWebLLM(); // warm up in the background
  }

  history() { return storage.companionHistory(); }

  async ask(prompt: string, context?: { posts?: Post[]; communities?: Community[] }): Promise<CompanionMessage> {
    const userMsg: CompanionMessage = { id: newId("cm"), role: "user", text: prompt, at: Date.now() };
    await storage.addCompanionMsg(userMsg);
    bus.emit("companion:thinking", true);
    let text: string;
    try {
      text = this.useLLM ? await this.llmAnswer(prompt, context) : this.heuristicAnswer(prompt, context);
    } catch {
      text = this.heuristicAnswer(prompt, context);
    }
    bus.emit("companion:thinking", false);
    const reply: CompanionMessage = { id: newId("cm"), role: "companion", text, at: Date.now() };
    await storage.addCompanionMsg(reply);
    return reply;
  }

  /* ---------- high-level helpers the UI calls directly ---------- */
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
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .map((x) => x.c)
      .slice(0, 3);
  }

  draftReply(post: Post): string {
    const v = PERSONA_VOICE[this.persona];
    const t = (post.text ?? "").slice(0, 60);
    const openers: Record<CompanionPersona, string> = {
      coach: `Love this. One step you could take from "${t}"…`,
      comedian: `Hot take on "${t}": `,
      critic: `Strong claim in "${t}". The evidence I'd want: `,
      researcher: `Re: "${t}" — a relevant data point is `,
      friend: `Totally feel this — "${t}". `,
    };
    return openers[this.persona] + `(${v} draft — edit before sending)`;
  }

  flagMisinformation(text: string): { risk: "low" | "medium" | "high"; note: string } {
    const t = text.toLowerCase();
    const redFlags = ["100% proven", "they don't want you to know", "miracle cure", "do your own research", "wake up"];
    const hits = redFlags.filter((f) => t.includes(f));
    if (hits.length >= 2) return { risk: "high", note: `Rhetoric often tied to misinformation: ${hits.join(", ")}` };
    if (hits.length === 1) return { risk: "medium", note: `Watch phrase: "${hits[0]}". Look for primary sources.` };
    return { risk: "low", note: "No obvious misinformation markers — still verify surprising claims." };
  }

  /* ---------- providers ---------- */
  private heuristicAnswer(prompt: string, ctx?: { posts?: Post[]; communities?: Community[] }): string {
    const p = prompt.toLowerCase();
    const posts = ctx?.posts ?? [];
    if (/summar/i.test(p)) return this.summarizeFeed(posts);
    if (/trend/i.test(p)) return this.explainTrends(posts);
    if (/communit|group|server/i.test(p)) {
      const s = this.suggestCommunities(posts, ctx?.communities ?? []);
      return s.length ? "You might like: " + s.map((c) => c.name).join(", ") : "No matching communities yet — create one!";
    }
    if (/misinfo|true|fake|real\?/i.test(p)) { const r = this.flagMisinformation(prompt); return `Misinformation risk: ${r.risk}. ${r.note}`; }
    const voice = PERSONA_VOICE[this.persona];
    return `(${this.persona} · ${voice}) I'm your on-device companion — everything I do runs locally. Try: "summarize my feed", "what's trending", or "suggest communities". You said: "${prompt}".`;
  }

  private async llmAnswer(prompt: string, ctx?: { posts?: Post[] }): Promise<string> {
    const eng = await loadWebLLM();
    if (!eng) return this.heuristicAnswer(prompt, ctx);
    const sys = `You are Nebula's on-device AI companion. Persona: ${this.persona} (${PERSONA_VOICE[this.persona]}). Be concise. All processing is local and private.`;
    const feed = (ctx?.posts ?? []).slice(0, 8).map((p) => `- ${p.authorName}: ${p.text ?? ""}`).join("\n");
    const reply = await eng.chat.completions.create({
      messages: [
        { role: "system", content: sys },
        ...(feed ? [{ role: "user", content: `Context (recent feed):\n${feed}` } as const] : []),
        { role: "user", content: prompt },
      ],
    });
    return reply.choices?.[0]?.message?.content ?? this.heuristicAnswer(prompt, ctx);
  }
}

const react = (p: Post) => Object.values(p.reactions).reduce((s, a) => s + a.length, 0);
export const companionService = new CompanionService();
