// ============================================================
//  feedService — the local feed engine. Creates/signs posts,
//  persists them, and generates ranked feeds entirely on-device
//  using the local embedding model + an interest profile. No
//  recommendation server, and every ranking is explainable.
// ============================================================
import type {
  Post, PostKind, FeedAlgorithm, RecommendationReason, MediaRef,
} from "@/types";
import { storage } from "./storage";
import { identityService } from "./identityService";
import { moderationService } from "./moderationService";
import { reputationService } from "./reputationService";
import { embed, cosine, topTerms, InterestProfile } from "@/lib/embeddings";
import { bus } from "@/lib/events";
import { newId } from "@/lib/id";
import type { ModerationProfile } from "@/types";

class FeedService {
  private profile = new InterestProfile();

  async init() {
    const saved = await storage.kvGet<{ centroid: number[]; count: number }>("interest");
    this.profile = InterestProfile.from(saved);
  }

  /* ---------- authoring ---------- */
  async createPost(input: {
    kind?: PostKind; text?: string; media?: MediaRef[]; tags?: string[];
    community?: string; replyTo?: string;
    poll?: { question: string; options: string[] };
  }): Promise<Post> {
    const me = identityService.current!;
    const text = input.text ?? "";
    const post: Post = {
      id: newId("post"),
      author: me.publicKey,
      authorName: me.username,
      authorAvatar: me.avatar || undefined,
      kind: input.kind ?? (input.poll ? "poll" : "text"),
      text,
      media: input.media,
      poll: input.poll
        ? { question: input.poll.question, options: input.poll.options.map((l) => ({ id: newId("opt"), label: l, votes: [] })) }
        : undefined,
      community: input.community,
      tags: input.tags ?? extractTags(text),
      createdAt: Date.now(),
      reactions: {},
      replyTo: input.replyTo,
      embedding: embed([text, ...(input.tags ?? [])].join(" ")),
      source: "self",
    };
    // sign (envelope kept for relay/verify; we store the plain post locally)
    await identityService.sign(post);
    await storage.putPost(post);
    await reputationService.award("participation", 2, "created a post");
    bus.emit("feed:post", post);
    bus.emit("feed:updated", undefined);
    return post;
  }

  /** Ingest a post received from a peer/relay (verified upstream). */
  async ingest(post: Post) {
    if (await storage.getPost(post.id)) return;
    post.embedding ??= embed([post.text ?? "", ...post.tags].join(" "));
    await storage.putPost(post);
    bus.emit("feed:updated", undefined);
  }

  /** Toggle a reaction by a specific person (used for both local and remote).
   *  Idempotent per (person, emoji), so every peer converges to the same state. */
  async applyReaction(postId: string, emoji: string, fromPk: string) {
    const post = await storage.getPost(postId);
    if (!post) return;
    const arr = post.reactions[emoji] ?? [];
    const i = arr.indexOf(fromPk);
    if (i >= 0) arr.splice(i, 1); else arr.push(fromPk);
    if (arr.length) post.reactions[emoji] = arr; else delete post.reactions[emoji];
    await storage.putPost(post);
    // your own reactions teach the local interest profile
    if (i < 0 && fromPk === identityService.pk && post.embedding) { this.profile.learn(post.embedding, 1.5); this.persistProfile(); }
    bus.emit("feed:updated", undefined);
  }

  /** Local reaction → apply + broadcast to the swarm (bus, to avoid an import cycle). */
  async react(postId: string, emoji: string) {
    await this.applyReaction(postId, emoji, identityService.pk);
    bus.emit("feed:react-out", { postId, emoji });
  }

  async repliesFor(postId: string): Promise<Post[]> {
    return (await storage.allPosts()).filter((p) => p.replyTo === postId).sort((a, b) => a.createdAt - b.createdAt);
  }

  async open(post: Post) {
    if (post.embedding) { this.profile.learn(post.embedding, 0.5); this.persistProfile(); }
  }

  private persistProfile() { storage.kvSet("interest", this.profile.serialize()); }

  /* ---------- feed generation ---------- */
  async generate(
    algorithm: FeedAlgorithm,
    opts: { moderation: ModerationProfile; friends?: string[]; community?: string } = { moderation: "discovery" },
  ): Promise<{ posts: Post[]; reasons: Map<string, RecommendationReason> }> {
    let posts = (await storage.allPosts()).filter((p) => !p.replyTo); // top-level only
    // Layer 1/3 moderation
    posts = posts.filter((p) => moderationService.filterPost(p, opts.moderation).allowed);

    const reasons = new Map<string, RecommendationReason>();
    const now = Date.now();
    const me = identityService.pk;
    const friends = new Set(opts.friends ?? []);
    const myVec = this.profile.vector();

    const scored = posts.map((p) => {
      const ageH = (now - p.createdAt) / 3.6e6;
      const recency = Math.exp(-ageH / 24);                       // 1d half-ish life
      // Freshness: a strong, fast-fading boost so the newest posts (and your
      // own just-published one) sit at the very top, then hands off to curation.
      const freshness = Math.exp(-((now - p.createdAt) / 60000) / 45); // ~45-min scale
      const engagement = Object.values(p.reactions).reduce((s, a) => s + a.length, 0);
      const affinity = p.embedding ? cosine(myVec, p.embedding) : 0;
      const factors: RecommendationReason["factors"] = [];
      let score = 0;

      switch (algorithm) {
        case "chronological":
          score = p.createdAt;
          factors.push({ label: "Newest first", weight: 1, detail: new Date(p.createdAt).toLocaleString() });
          break;
        case "trending":
          score = engagement * 2 + recency * 5;
          factors.push({ label: "Engagement", weight: engagement * 2, detail: `${engagement} reactions` });
          factors.push({ label: "Recency", weight: recency * 5 });
          break;
        case "friends":
          score = (friends.has(p.author) ? 10 : 0) + recency;
          factors.push({ label: friends.has(p.author) ? "From someone you follow" : "Not from your circle", weight: friends.has(p.author) ? 10 : 0 });
          break;
        case "community":
          score = (p.community === opts.community ? 10 : -100) + recency + engagement;
          factors.push({ label: "In this community", weight: p.community === opts.community ? 10 : -100 });
          break;
        case "discovery":
          // surface things slightly outside your bubble but still quality
          score = (1 - affinity) * 3 + engagement + recency * 2 + (p.author !== me ? 1 : -5);
          factors.push({ label: "New to you", weight: (1 - affinity) * 3, detail: `${(affinity * 100).toFixed(0)}% similar to your usual` });
          factors.push({ label: "Quality signal", weight: engagement });
          break;
        case "ai-curated":
        default:
          score = affinity * 6 + recency * 2 + engagement * 0.5;
          factors.push({ label: "Matches your interests", weight: affinity * 6, detail: `${(affinity * 100).toFixed(0)}% match · terms: ${topTerms(p.text ?? "").join(", ") || "—"}` });
          factors.push({ label: "Community engagement", weight: engagement * 0.5, detail: `${engagement} reactions` });
          break;
      }

      // Newest-first boost across all ranked feeds (chronological is already
      // time-ordered). Guarantees a just-published post lands at the top.
      if (algorithm !== "chronological") {
        score += freshness * 40;
        factors.push({ label: "Freshness (newest first)", weight: freshness * 40, detail: "just posted" });
      }

      reasons.set(p.id, { postId: p.id, algorithm, score, factors: factors.sort((a, b) => b.weight - a.weight) });
      return { p, score };
    });

    // Sort by score, then newest-first as the tiebreaker.
    scored.sort((a, b) => b.score - a.score || b.p.createdAt - a.p.createdAt);
    return { posts: scored.map((s) => s.p), reasons };
  }

  interestVector() { return this.profile.vector(); }
}

function extractTags(text: string): string[] {
  return [...new Set((text.match(/#[a-z0-9_]+/gi) ?? []).map((t) => t.slice(1).toLowerCase()))];
}

export const feedService = new FeedService();
