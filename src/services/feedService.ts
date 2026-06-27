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
import { spamService } from "./spamService";
import { reputationService } from "./reputationService";
import { profileService } from "./profileService";
import { trustService } from "./trustService";
import { embed, InterestProfile } from "@/lib/embeddings";
import { rankFeed, type RankOpts, type RankResult } from "@/lib/feedRank";
import { signPost, postIsAuthentic } from "@/lib/records";
import { isBlockedAuthorName, isBlockedText } from "@/lib/authorBlock";
import { bus } from "@/lib/events";
import { diag } from "@/lib/diag";
import { newId } from "@/lib/id";
import type { ModerationProfile } from "@/types";

// Content-safety gate at INGESTION: inbound peer/relay/Nostr posts that hit the
// blocklist (spam brands in name/body/links, or child-exploitation signals) are
// never stored — so this node won't persist or rebroadcast them. The feed render
// also screens (lib/feedRank), but dropping here is defense in depth.
function blockedPost(post: Post): boolean {
  if (isBlockedAuthorName(post.authorName)) return true;
  const hay = [post.text, post.authorName, post.poll?.question, ...(post.tags ?? []), ...((post.media ?? []).map((m) => m.url))].filter(Boolean).join(" ");
  return isBlockedText(hay);
}

// Positive reactions double as a soft "vouch" for the author (web of trust),
// so genuine positive interactions raise contextual trust. 👀 is neutral.
const POSITIVE_REACTIONS = new Set(["⭐", "🔥", "🚀", "💜", "😂", "❤️", "👍", "🙂", "😄", "🙌", "💯", "😮", "💀", "🏳️‍🌈"]);
// Nostr only has "like" (a kind-7 reaction). Any react on OUR side maps to a Nostr
// like EXCEPT these negative ones — an angry/thumbs-down reaction stays local only
// and must never like the post upstream.
const NEGATIVE_REACTIONS = new Set(["👎", "😠", "😡", "🤬", "💩", "🤮", "👿", "🖕", "💔"]);

// ---- feed ranking worker ----
// The read+rank runs in a Web Worker (services/feedWorker.ts) so it never blocks the
// UI. One worker, request/response by id. If the worker is unavailable or hangs, the
// promise rejects and generate() ranks on the main thread instead (never a hard fail).
let feedWorker: Worker | null = null;
let workerSeq = 1;
const workerPending = new Map<number, { resolve: (r: RankResult) => void; reject: (e: unknown) => void }>();
function getFeedWorker(): Worker {
  if (feedWorker) return feedWorker;
  const w = new Worker(new URL("../workers/feedWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<{ id: number; result?: RankResult; error?: string }>) => {
    const { id, result, error } = e.data;
    const p = workerPending.get(id); if (!p) return; workerPending.delete(id);
    if (error || !result) p.reject(new Error(error ?? "feed worker: empty result")); else p.resolve(result);
  };
  w.onerror = () => { for (const p of workerPending.values()) p.reject(new Error("feed worker crashed")); workerPending.clear(); try { w.terminate(); } catch {} feedWorker = null; };
  feedWorker = w;
  return w;
}
function rankInWorker(msg: Record<string, unknown>): Promise<RankResult> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("no Worker"));
  const w = getFeedWorker();
  const id = workerSeq++;
  return new Promise<RankResult>((resolve, reject) => {
    workerPending.set(id, { resolve, reject });
    w.postMessage({ id, ...msg });
    setTimeout(() => { if (workerPending.has(id)) { workerPending.delete(id); reject(new Error("feed worker timeout")); } }, 8000);
  });
}

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
    if (blockedPost(post)) return;   // content-safety: never store/rebroadcast blocked content
    if (await storage.getPost(post.id)) return;
    post.embedding ??= embed([post.text ?? "", ...(post.tags ?? [])].join(" "));
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
    if (blockedPost(post)) return;                // content-safety: don't store/rebroadcast
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
      if (blockedPost(post)) continue;                // content-safety: don't store/rebroadcast
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
    return (await storage.repliesTo(postId)).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Full parent→children reply map — for thread / detail / profile views. Reads
   *  only replies (byReplyTo index), not the whole store. */
  async replyMap(): Promise<Map<string, Post[]>> {
    const replies = await storage.allReplies();
    const m = new Map<string, Post[]>();
    for (const p of replies) if (p.replyTo) { const a = m.get(p.replyTo) ?? []; a.push(p); m.set(p.replyTo, a); }
    for (const a of m.values()) a.sort((x, y) => x.createdAt - y.createdAt);
    return m;
  }
  /** A person's top-level posts, newest first (for their profile page). */
  async authorFeed(pk: string): Promise<Post[]> {
    return (await storage.postsByAuthor(pk)).filter((p) => !p.replyTo).sort((a, b) => b.createdAt - a.createdAt);
  }

  async open(post: Post) {
    if (post.embedding) { this.profile.learn(post.embedding, 0.5); this.persistProfile(); }
  }

  private persistProfile() { storage.kvSet("interest", this.profile.serialize()); }

  /* ---------- feed generation ---------- */
  // The read + ranking run in a Web Worker (services/feedWorker.ts) so a full re-rank
  // of the post window no longer blocks the UI (it was ~0.5–1.1s on the main thread,
  // re-running every ~1.2s during a firehose). We hand the worker serializable snapshots
  // of the in-memory state it can't reach; it reads recentPosts from IndexedDB itself and
  // returns the ranked feed. Falls back to ranking on the main thread if no worker.
  async generate(algorithm: FeedAlgorithm, opts: RankOpts = { moderation: "discovery" }): Promise<RankResult> {
    const _t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const snap = {
      algorithm, opts,
      meId: identityService.pk,
      interestVector: this.profile.vector(),
      hidden: [...this.hidden],
      trustEdges: trustService.edgesSnapshot(),
      profiles: profileService.reputationSnapshot(),
      junkIds: spamService.junkSnapshot(),
    };
    let result: RankResult;
    try {
      result = await rankInWorker(snap);
    } catch (e) {
      diag("generate: worker unavailable — ranking on main", String(e));
      const recent = await storage.recentPosts(opts.limit ?? 800, opts.community);
      result = rankFeed(recent, { algorithm, opts, meId: snap.meId, interestVector: snap.interestVector, hidden: new Set(snap.hidden), trustEdges: snap.trustEdges, profiles: snap.profiles, isJunk: (id, text) => spamService.isJunk(id, text) });
    }
    // Queue background ML spam classification of the shown external posts (runs on the
    // main thread, idle; a new junk verdict re-fires feed:updated → next rank filters it).
    if (opts.hideJunk) {
      const ours = (p: Post) => p.author === identityService.pk || p.author === "rss-bot" || p.author === "system" || p.author === "ai-bot";
      spamService.classify(result.posts.filter((p) => !ours(p)));
    }
    diag(`generate: done (ranked ${result.posts.length})`, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - _t) + "ms");
    return result;
  }

  interestVector() { return this.profile.vector(); }
}

function extractTags(text: string): string[] {
  return [...new Set((text.match(/#[a-z0-9_]+/gi) ?? []).map((t) => t.slice(1).toLowerCase()))];
}

export const feedService = new FeedService();
