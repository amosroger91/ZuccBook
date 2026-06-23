// ============================================================
//  feedService — the local feed engine. Creates/signs posts,
//  persists them, and generates ranked feeds entirely on-device
//  using the local embedding model + an interest profile. No
//  recommendation server, and every ranking is explainable.
// ============================================================
import type {
  Post, PostKind, FeedAlgorithm, RecommendationReason, MediaRef, ModerationVerdict, CommunityValues,
} from "@/types";
import { storage } from "./storage";
import { identityService } from "./identityService";
import { moderationService } from "./moderationService";
import { reputationService } from "./reputationService";
import { profileService } from "./profileService";
import { trustService } from "./trustService";
import { embed, cosine, topTerms, InterestProfile } from "@/lib/embeddings";
import { signPost, postIsAuthentic } from "@/lib/records";
import { bus } from "@/lib/events";
import { diag } from "@/lib/diag";
import { newId } from "@/lib/id";
import type { ModerationProfile } from "@/types";

// Positive reactions double as a soft "vouch" for the author (web of trust),
// so genuine positive interactions raise contextual trust. 👀 is neutral.
const POSITIVE_REACTIONS = new Set(["⭐", "🔥", "🚀", "💜", "😂", "❤️", "👍", "🙂", "😄", "🙌", "💯", "😮", "💀", "🏳️‍🌈"]);
// Nostr only has "like" (a kind-7 reaction). Any react on OUR side maps to a Nostr
// like EXCEPT these negative ones — an angry/thumbs-down reaction stays local only
// and must never like the post upstream.
const NEGATIVE_REACTIONS = new Set(["👎", "😠", "😡", "🤬", "💩", "🤮", "👿", "🖕", "💔"]);

class FeedService {
  private profile = new InterestProfile();
  // Per-device "hide this post" set — ids you've hidden, kept out of your feed.
  private hidden = new Set<string>();

  async init() {
    const saved = await storage.kvGet<{ centroid: number[]; count: number }>("interest");
    this.profile = InterestProfile.from(saved);
    this.hidden = new Set((await storage.kvGet<string[]>("hiddenPosts")) ?? []);
  }

  /* ---------- per-device hidden posts ---------- */
  isHidden(id: string): boolean { return this.hidden.has(id); }
  hiddenCount(): number { return this.hidden.size; }
  private async persistHidden() { await storage.kvSet("hiddenPosts", [...this.hidden]); }
  // `silent` skips the feed re-rank — the caller collapses just the one card in
  // place, so the rest of the timeline (and your scroll position) doesn't move.
  async hidePost(id: string, silent = false) { this.hidden.add(id); await this.persistHidden(); if (!silent) bus.emit("feed:updated", undefined); }
  async unhidePost(id: string, silent = false) { this.hidden.delete(id); await this.persistHidden(); if (!silent) bus.emit("feed:updated", undefined); }
  async clearHidden() { this.hidden.clear(); await this.persistHidden(); bus.emit("feed:updated", undefined); }

  /* ---------- authoring ---------- */
  async createPost(input: {
    kind?: PostKind; text?: string; html?: string; media?: MediaRef[]; tags?: string[];
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
      kind: input.kind ?? (input.html ? "html" : input.poll ? "poll" : "text"),
      text,
      html: input.html,
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
    // Sign the authored content and attach the detached signature to the post
    // itself, so it travels with it over Gun/PeerJS and every recipient can
    // verify it came from this public key (see lib/records.ts).
    await signPost(post, me.privateKeyJwk);
    await storage.putPost(post);
    await reputationService.award("participation", 2, "created a post");
    bus.emit("feed:post", post);
    bus.emit("feed:updated", undefined);
    bus.emit("post:publish", post);   // persist to the durable graph (Gun)
    // If this is a reply to an external Nostr note, publish the reply to Nostr too.
    if (input.replyTo) {
      storage.getPost(input.replyTo).then((parent) => {
        if (parent?.source === "nostr") import("./nostrService").then((m) => m.nostrService.replyToNote(parent, text)).catch(() => {});
      }).catch(() => {});
    }
    return post;
  }

  /** Post a comment as the shared on-device AI bot — a reply to `parentId`,
   *  authored by the "ai-bot" account every AI shares. The model label is
   *  stamped into the body for later troubleshooting. The id is derived from the
   *  parent so there's at most one shared AI comment per post across the network
   *  (re-runs overwrite rather than spam). */
  async commentAsAi(parentId: string, text: string, modelLabel: string): Promise<Post> {
    const post: Post = {
      id: "aic_" + parentId,
      author: "ai-bot",
      authorName: "Ledger AI 🤖",
      kind: "text",
      text: `${text}\n\n— 🤖 Ledger AI · on-device (${modelLabel})`,
      tags: ["ai"],
      createdAt: Date.now(),
      reactions: {},
      replyTo: parentId,
      embedding: embed(text),
      source: "self",
    };
    await storage.putPost(post);
    bus.emit("feed:post", post);
    bus.emit("feed:updated", undefined);
    bus.emit("post:publish", post);   // share via the durable graph (Gun)
    return post;
  }

  /** Ingest a post received from a peer/relay. Verifies the signature first —
   *  a forged or tampered post (wrong/missing signature for a real author) is
   *  dropped here, before it can reach storage or the feed. Bot authors
   *  (rss-bot/system) carry no keypair and are exempt. */
  async ingest(post: Post) {
    if (!(await postIsAuthentic(post))) return;
    if (await storage.getPost(post.id)) return;
    post.embedding ??= embed([post.text ?? "", ...post.tags].join(" "));
    await storage.putPost(post);
    await this.maybeReplyAlert(post);
    bus.emit("feed:updated", undefined);
  }

  /** Raise an alert when someone replies to one of my posts. */
  private async maybeReplyAlert(post: Post) {
    if (!post.replyTo || post.author === identityService.pk) return;
    const parent = await storage.getPost(post.replyTo);
    if (parent && parent.author === identityService.pk) {
      bus.emit("alert", { kind: "reply", text: `${post.authorName} replied to your post`, route: "/", postId: parent.id });
    }
  }

  /** Absorb a post from durable storage (Gun): insert if new, else merge in
   *  any reactions we don't have yet. Never re-publishes (avoids sync loops). */
  async absorb(post: Post) {
    if (!post || !post.id) return;
    if (!(await postIsAuthentic(post))) return;   // never trust an unsigned/forged copy
    const existing = await storage.getPost(post.id);
    if (!existing) {
      post.embedding ??= embed([post.text ?? "", ...(post.tags ?? [])].join(" "));
      await storage.putPost(post);
      await this.maybeReplyAlert(post);
      bus.emit("feed:updated", undefined);
      return;
    }
    const mine = existing.author === identityService.pk;
    let changed = false;
    for (const [emoji, voters] of Object.entries(post.reactions ?? {})) {
      const cur = existing.reactions[emoji] ?? [];
      const fresh = voters.filter((v) => !cur.includes(v) && v !== identityService.pk);
      const union = [...new Set([...cur, ...voters])];
      if (union.length !== cur.length) { existing.reactions[emoji] = union; changed = true; }
      // someone (not me) reacted to my post → alert that deep-links to it
      if (mine && fresh.length) bus.emit("alert", { kind: "reaction", text: `Someone reacted ${emoji} to your post`, route: "/", postId: existing.id });
    }
    // Recover media: if a richer copy arrives and ours lost it, adopt it. We
    // never clear existing media from an incoming copy that's missing it.
    if (post.media?.length && !existing.media?.length) { existing.media = post.media; changed = true; }
    if (changed) { await storage.putPost(existing); bus.emit("feed:updated", undefined); }
  }

  /** Bulk-absorb a batch of posts from a peer's history sync: insert anything
   *  new, merge reactions/media into what we already have — never delete, never
   *  duplicate — and fire a single feed update (no per-post events/alerts). */
  async absorbMany(posts: Post[]) {
    let changed = 0;
    for (const post of posts) {
      if (!post?.id) continue;
      if (!(await postIsAuthentic(post))) continue;   // drop forged/unsigned history
      const existing = await storage.getPost(post.id);
      if (!existing) {
        post.embedding ??= embed([post.text ?? "", ...(post.tags ?? [])].join(" "));
        await storage.putPost(post); changed++;
        continue;
      }
      let upd = false;
      for (const [emoji, voters] of Object.entries(post.reactions ?? {})) {
        const cur = existing.reactions[emoji] ?? [];
        const union = [...new Set([...cur, ...voters])];
        if (union.length !== cur.length) { existing.reactions[emoji] = union; upd = true; }
      }
      if (post.media?.length && !existing.media?.length) { existing.media = post.media; upd = true; }
      if (upd) { await storage.putPost(existing); changed++; }
    }
    if (changed) bus.emit("feed:updated", undefined);
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
    // a positive reaction from you = a soft vouch for the author (web of trust)
    if (i < 0 && fromPk === identityService.pk && POSITIVE_REACTIONS.has(emoji)) {
      const a = post.author;
      if (a && a !== identityService.pk && a !== "rss-bot" && a !== "system" && !a.startsWith("demo_")) {
        trustService.vouch(a, post.community).catch?.(() => {});
      }
    }
    bus.emit("feed:updated", undefined);
  }

  /** Local reaction → apply, broadcast live (peer relay), and persist (Gun).
   *  Reactions on a Nostr note are also published back to Nostr (kind 7). */
  async react(postId: string, emoji: string) {
    await this.applyReaction(postId, emoji, identityService.pk);
    bus.emit("feed:react-out", { postId, emoji });
    const updated = await storage.getPost(postId);
    if (!updated) return;
    if (updated.source === "nostr") {
      // Any NON-negative reaction = a "like" on Nostr (kind 7). A negative one
      // (angry, thumbs-down) stays local — it must NOT like the post. And only on
      // ADD (applyReaction toggles), never when you un-react.
      const added = (updated.reactions[emoji] ?? []).includes(identityService.pk);
      if (added && !NEGATIVE_REACTIONS.has(emoji)) {
        import("./nostrService").then((m) => m.nostrService.reactToNote(updated, emoji)).catch(() => {});
      }
    } else {
      bus.emit("post:publish", updated);   // Ledger posts persist/sync over Gun (Nostr ones don't)
    }
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
    opts: { moderation: ModerationProfile; friends?: string[]; community?: string; subscribedTopics?: string[]; mutedTopics?: string[]; mutedFeeds?: string[]; includeNostr?: boolean; limit?: number; values?: CommunityValues } = { moderation: "discovery" },
  ): Promise<{ posts: Post[]; reasons: Map<string, RecommendationReason>; verdicts: Map<string, ModerationVerdict>; replies: Map<string, Post[]> }> {
    const _t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    // Bounded working set: rank only the newest window (storage.recentPosts keeps
    // it O(1) regardless of total corpus size — the key to staying fast at scale).
    const recent = await storage.recentPosts(opts.limit ?? 800, opts.community);
    diag("generate: recentPosts returned", recent.length);
    // Build the reply tree from the SAME bounded read (a reply is recent when its
    // parent is), so refresh() never has to scan the whole store a second time.
    const replies = new Map<string, Post[]>();
    for (const p of recent) if (p.replyTo) { const a = replies.get(p.replyTo) ?? []; a.push(p); replies.set(p.replyTo, a); }
    for (const a of replies.values()) a.sort((x, y) => x.createdAt - y.createdAt);
    let posts = recent.filter((p) => !p.replyTo && !this.hidden.has(p.id)); // top-level, minus posts you hid
    if (opts.includeNostr === false) posts = posts.filter((p) => p.source !== "nostr");   // Nostr unsubscribed
    const meId = identityService.pk;

    // Dedup RSS-Bot posts that point to the same link — the same story often
    // arrives from multiple feeds/refreshes, and bots are basically just a URL.
    // Keep the earliest, prune later duplicates.
    {
      const seenLinks = new Set<string>();
      const dropIds = new Set<string>();
      for (const p of [...posts].sort((a, b) => a.createdAt - b.createdAt)) {
        if (p.author !== "rss-bot") continue;
        const link = (p.text?.match(/https?:\/\/[^\s]+/)?.[0] ?? "").replace(/[)\].,]+$/, "").toLowerCase();
        if (!link) continue;
        if (seenLinks.has(link)) dropIds.add(p.id); else seenLinks.add(link);
      }
      if (dropIds.size) posts = posts.filter((p) => !dropIds.has(p.id));
    }

    // Layered moderation → graded verdicts. We only drop "hide" (you muted them);
    // everything else stays, with the verdict surfaced in the UI.
    const verdicts = new Map<string, ModerationVerdict>();
    posts = posts.filter((p) => {
      const bot = p.author === "rss-bot" || p.author === "system" || p.author === "ai-bot";
      const v = moderationService.evaluate([p.text, p.poll?.question].filter(Boolean).join(" "), {
        profile: opts.moderation,
        authorPk: bot ? undefined : p.author,
        authorName: p.authorName,
        authorReputation: profileService.get(p.author)?.reputation ?? (p.author === meId ? 999 : 0),
        knownAuthor: bot || p.author === meId || !!profileService.get(p.author) || p.author.startsWith("nostr:"),
        community: p.community,
        values: opts.values,
      });
      verdicts.set(p.id, v);
      return v.action !== "hide";
    });

    // Personal opt-out: hide RSS-Bot / network-feed stories from topics you've
    // muted in Topics. Applies to EVERY algorithm — it's your "show/hide" over
    // the global relay feeds (and curated RSS), keyed on the post's topic tag.
    if (opts.mutedTopics?.length) {
      const muted = new Set(opts.mutedTopics);
      posts = posts.filter((p) => p.author !== "rss-bot" || !(p.tags[0] && muted.has(p.tags[0])));
    }
    // Per-feed opt-out: hide individual network feeds you've toggled off (by feed id).
    if (opts.mutedFeeds?.length) {
      const mutedF = new Set(opts.mutedFeeds);
      posts = posts.filter((p) => !(p.feedId && mutedF.has(p.feedId)));
    }

    // "For You" = real human activity + RSS Bot posts only from topics you
    // subscribed to. No LLM / interest-embedding curation involved.
    if (algorithm === "ai-curated") {
      const subTags = new Set((opts.subscribedTopics ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "")));
      posts = posts.filter((p) => p.author !== "rss-bot" || (p.tags[0] && subTags.has(p.tags[0])));
    }

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
          // For You: people + your subscribed topics, newest first (no LLM/embeddings).
          score = recency * 6 + engagement * 0.5;
          factors.push({ label: p.author === "rss-bot" ? "From a topic you follow" : "Human activity", weight: 6 });
          factors.push({ label: "Recency", weight: recency * 6 });
          factors.push({ label: "Engagement", weight: engagement * 0.5, detail: `${engagement} reactions` });
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
    // Balance the two timelines ~50/50. Trending/Discovery keep their ranked order
    // (a plain 1:1 source interleave). The timeline feeds — For You / Newest / Circle —
    // use a TIME-COHERENT mix: 30-minute windows, 50/50 within each, with the busier
    // source's surplus dropped in as a group, so a Ledger post is never shown next to a
    // Nostr post from hours away.
    const ranked = (algorithm === "trending" || algorithm === "discovery")
      ? balanceSources(scored.map((s) => s.p))
      : balanceByTime(scored.map((s) => s.p));
    diag(`generate: done (ranked ${ranked.length}, scored ${scored.length})`, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - _t) + "ms");
    return { posts: ranked, reasons, verdicts, replies };
  }

  interestVector() { return this.profile.vector(); }
}

function extractTags(text: string): string[] {
  return [...new Set((text.match(/#[a-z0-9_]+/gi) ?? []).map((t) => t.slice(1).toLowerCase()))];
}

/** Interleave Ledger and Nostr posts 1:1 (each keeping its ranked order) so the
 *  feed is an even mix and neither source ever exceeds ~50% — you can't scroll
 *  through more than half of one. Capped at 2×min, so the larger firehose's
 *  surplus is trimmed rather than dominating; if only one source is present, it's
 *  returned untouched (nothing to balance). */
function balanceSources(posts: Post[]): Post[] {
  const nostr = posts.filter((p) => p.source === "nostr");
  const ledger = posts.filter((p) => p.source !== "nostr");
  if (!nostr.length || !ledger.length) return posts;
  const n = Math.min(nostr.length, ledger.length);
  const out: Post[] = [];
  for (let i = 0; i < n; i++) { out.push(ledger[i], nostr[i]); }
  // Keep the surplus of the larger source instead of DROPPING it — otherwise a feed
  // that's mostly one source (a fresh node's RSS mesh with only a handful of Nostr
  // notes) gets capped to 2×the smaller source and looks nearly empty.
  out.push(...ledger.slice(n), ...nostr.slice(n));
  return out;
}

const SOURCE_WINDOW_MS = 30 * 60 * 1000; // keep mixed Ledger/Nostr posts within ~30 min of each other

/** Time-coherent 50/50 mix. Walk both timelines newest-first in ~30-minute windows;
 *  within each window interleave Ledger and Nostr 1:1, then drop the busier source's
 *  surplus in as a GROUP — everything in a window is within 30 min, so a Ledger post is
 *  never placed next to a Nostr post from hours away. When one source is sparse you get
 *  balanced pairs where it exists and tidy groups of the other where it doesn't. Posts
 *  move only in time, none are dropped; one source only → returned untouched. */
function balanceByTime(posts: Post[]): Post[] {
  const nostr = posts.filter((p) => p.source === "nostr").sort((a, b) => b.createdAt - a.createdAt);
  const ledger = posts.filter((p) => p.source !== "nostr").sort((a, b) => b.createdAt - a.createdAt);
  if (!nostr.length || !ledger.length) return posts;
  const out: Post[] = [];
  let li = 0, ni = 0;
  while (li < ledger.length || ni < nostr.length) {
    // The window spans 30 min back from the newest post left in either source.
    const head = Math.max(li < ledger.length ? ledger[li].createdAt : -Infinity, ni < nostr.length ? nostr[ni].createdAt : -Infinity);
    const floor = head - SOURCE_WINDOW_MS;
    const lWin: Post[] = []; while (li < ledger.length && ledger[li].createdAt >= floor) lWin.push(ledger[li++]);
    const nWin: Post[] = []; while (ni < nostr.length && nostr[ni].createdAt >= floor) nWin.push(nostr[ni++]);
    const k = Math.min(lWin.length, nWin.length);
    for (let i = 0; i < k; i++) out.push(lWin[i], nWin[i]);   // 50/50 within the window
    out.push(...lWin.slice(k), ...nWin.slice(k));             // surplus of the busier source, grouped, still in-window
  }
  return out;
}

export const feedService = new FeedService();
