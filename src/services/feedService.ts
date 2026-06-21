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

  async react(postId: string, emoji: string) {
    const post = await storage.getPost(postId);
    if (!post) return;
    const me = identityService.pk;
    const arr = post.reactions[emoji] ?? [];
    const i = arr.indexOf(me);
    if (i >= 0) arr.splice(i, 1); else arr.push(me);
    post.reactions[emoji] = arr;
    await storage.putPost(post);
    // engaging teaches the interest profile
    if (i < 0 && post.embedding) { this.profile.learn(post.embedding, 1.5); this.persistProfile(); }
    bus.emit("feed:updated", undefined);
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
          factors.push({ label: "Freshness", weight: recency * 2 });
          factors.push({ label: "Community engagement", weight: engagement * 0.5, detail: `${engagement} reactions` });
          break;
      }
      reasons.set(p.id, { postId: p.id, algorithm, score, factors: factors.sort((a, b) => b.weight - a.weight) });
      return { p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return { posts: scored.map((s) => s.p), reasons };
  }

  interestVector() { return this.profile.vector(); }
}

function extractTags(text: string): string[] {
  return [...new Set((text.match(/#[a-z0-9_]+/gi) ?? []).map((t) => t.slice(1).toLowerCase()))];
}

export const feedService = new FeedService();
