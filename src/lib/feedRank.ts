// ============================================================
//  feedRank — the PURE feed ranking pipeline (dedup → moderation →
//  spam/NSFW filter → score → sort → source-balance). It takes a
//  bounded post window plus serializable SNAPSHOTS of the in-memory
//  state it needs (interest vector, hidden ids, trust edges, profile
//  reputations, spam verdicts) — no service/storage/DOM imports — so
//  it runs identically on the main thread (fallback) and inside the
//  feed Web Worker (services/feedWorker.ts), off the UI thread.
//
//  Moved out of feedService.generate() to get the ~0.5–1.1s rank off
//  the main thread. Moderation/trust math is the SAME code the live
//  composer/UI uses (lib/moderationCore, lib/trustMath).
// ============================================================
import type { Post, FeedAlgorithm, RecommendationReason, ModerationVerdict, CommunityValues, ModerationProfile, TrustEdge } from "@/types";
import { cosine } from "@/lib/embeddings";
import { evaluateModeration } from "@/lib/moderationCore";
import * as trust from "@/lib/trustMath";
import { isAdultText } from "@/lib/textModeration";
import { isBlockedAuthorName, isBlockedText } from "@/lib/authorBlock";

export interface RankOpts {
  moderation: ModerationProfile;
  friends?: string[];
  community?: string;
  subscribedTopics?: string[];
  mutedTopics?: string[];
  mutedFeeds?: string[];
  includeNostr?: boolean;
  limit?: number;
  values?: CommunityValues;
  hideJunk?: boolean;
  hideFlaggedText?: boolean;
}

/** Everything the pure ranker needs that normally lives in services. The caller
 *  (main fallback OR the worker) assembles this from snapshots; `isJunk` is a
 *  function so it can't cross postMessage — the worker rebuilds it from junk ids. */
export interface RankContext {
  algorithm: FeedAlgorithm;
  opts: RankOpts;
  meId: string;
  interestVector: number[];
  hidden: Set<string>;
  trustEdges: TrustEdge[];
  profiles: Record<string, number>;   // pk → reputation; key present = known author
  isJunk: (id: string, text: string) => boolean;
}

export interface RankResult {
  posts: Post[];
  reasons: Map<string, RecommendationReason>;
  verdicts: Map<string, ModerationVerdict>;
  replies: Map<string, Post[]>;
}

export function rankFeed(recent: Post[], ctx: RankContext): RankResult {
  const { algorithm, opts, meId } = ctx;
  // Content safety screen — runs first, dropping posts outright (top-level AND
  // replies), regardless of source. Catches: spam brands (e.g. "aéPiot") in the
  // display name OR anywhere in the body/links/tags, and child-exploitation
  // signals (coded terms + minor-indicator × explicit co-occurrence). The
  // haystack folds in the text, poll question, tags and media URLs so a blocked
  // term in a shared link can't slip through.
  recent = recent.filter((p) => {
    if (isBlockedAuthorName(p.authorName)) return false;
    const hay = [p.text, p.authorName, p.poll?.question, ...(p.tags ?? []), ...((p.media ?? []).map((m) => m.url))].filter(Boolean).join(" ");
    return !isBlockedText(hay);
  });
  // Build the reply tree from the SAME bounded read (a reply is recent when its
  // parent is), so a refresh never has to scan the whole store a second time.
  const replies = new Map<string, Post[]>();
  for (const p of recent) if (p.replyTo) { const a = replies.get(p.replyTo) ?? []; a.push(p); replies.set(p.replyTo, a); }
  for (const a of replies.values()) a.sort((x, y) => x.createdAt - y.createdAt);
  let posts = recent.filter((p) => !p.replyTo && !ctx.hidden.has(p.id)); // top-level, minus posts you hid
  if (opts.includeNostr === false) posts = posts.filter((p) => p.source !== "nostr");   // Nostr unsubscribed

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
  // everything else stays, with the verdict surfaced in the UI. The trust index is
  // built ONCE here so per-post trust lookups don't each rescan the full edge list.
  const tidx = trust.buildIndex(ctx.trustEdges, meId);
  const verdicts = new Map<string, ModerationVerdict>();
  posts = posts.filter((p) => {
    const bot = p.author === "rss-bot" || p.author === "system" || p.author === "ai-bot";
    const pk = bot ? undefined : p.author;
    const tw = pk
      ? { blocked: trust.isBlockedI(tidx, pk), muted: trust.isMutedI(tidx, pk), score: trust.scoreI(tidx, pk, p.community), vouchCount: trust.vouchCountI(tidx, pk) }
      : { blocked: false, muted: false, score: 0, vouchCount: 0 };
    const v = evaluateModeration([p.text, p.poll?.question].filter(Boolean).join(" "), {
      profile: opts.moderation,
      authorPk: pk,
      authorName: p.authorName,
      authorReputation: ctx.profiles[p.author] ?? (p.author === meId ? 999 : 0),
      knownAuthor: bot || p.author === meId || (p.author in ctx.profiles) || p.author.startsWith("nostr:"),
      community: p.community,
      values: opts.values,
    }, tw);
    verdicts.set(p.id, v);
    return v.action !== "hide";
  });

  // On-device AI spam/scam/bot filter (opt-in). Flagged posts are removed entirely.
  // The ML classification itself runs on the main thread (feedService) — here we only
  // FILTER by the already-known junk verdicts (+ the obvious-junk heuristic, via isJunk).
  // It ONLY judges external user content — never your own / system / RSS posts.
  if (opts.hideJunk) {
    const ours = (p: Post) => p.author === meId || p.author === "rss-bot" || p.author === "system" || p.author === "ai-bot";
    posts = posts.filter((p) => ours(p) || !ctx.isJunk(p.id, p.text ?? ""));
  }

  // "Hide" mode for NSFW / foul language: drop flagged-text posts entirely.
  if (opts.hideFlaggedText) {
    posts = posts.filter((p) => !isAdultText(p.text ?? ""));
  }

  // Personal opt-out: hide RSS-Bot stories from topics you've muted in Topics.
  if (opts.mutedTopics?.length) {
    const muted = new Set(opts.mutedTopics);
    posts = posts.filter((p) => p.author !== "rss-bot" || !(p.tags?.[0] && muted.has(p.tags[0])));
  }
  // Per-feed opt-out: hide individual network feeds you've toggled off (by feed id).
  if (opts.mutedFeeds?.length) {
    const mutedF = new Set(opts.mutedFeeds);
    posts = posts.filter((p) => !(p.feedId && mutedF.has(p.feedId)));
  }

  // "For You" = real human activity + RSS Bot posts only from topics you subscribed to.
  if (algorithm === "ai-curated") {
    const subTags = new Set((opts.subscribedTopics ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "")));
    posts = posts.filter((p) => p.author !== "rss-bot" || (p.tags?.[0] && subTags.has(p.tags[0])));
  }

  const reasons = new Map<string, RecommendationReason>();
  const now = Date.now();
  const me = meId;
  const friends = new Set(opts.friends ?? []);
  const myVec = ctx.interestVector;

  const scored = posts.map((p) => {
    const ageH = (now - p.createdAt) / 3.6e6;
    const recency = Math.exp(-ageH / 24);                       // 1d half-ish life
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
        factors.push({ label: "Recency", weight: recency });
        break;
      case "community":
        score = (p.community === opts.community ? 10 : -100) + recency + engagement;
        factors.push({ label: "In this community", weight: p.community === opts.community ? 10 : -100 });
        factors.push({ label: "Recency", weight: recency });
        factors.push({ label: "Engagement", weight: engagement, detail: `${engagement} reactions` });
        break;
      case "discovery":
        score = (1 - affinity) * 3 + engagement + recency * 2 + (p.author !== me ? 1 : -5);
        factors.push({ label: "New to you", weight: (1 - affinity) * 3, detail: `${(affinity * 100).toFixed(0)}% similar to your usual` });
        factors.push({ label: "Quality signal", weight: engagement, detail: `${engagement} reactions` });
        factors.push({ label: "Recency", weight: recency * 2 });
        factors.push({ label: p.author !== me ? "Outside your usual circle" : "Your own post", weight: p.author !== me ? 1 : -5 });
        break;
      case "ai-curated":
      default:
        score = 6 + recency * 6 + engagement * 0.5;
        factors.push({ label: p.author === "rss-bot" ? "From a topic you follow" : "Human activity", weight: 6 });
        factors.push({ label: "Recency", weight: recency * 6 });
        factors.push({ label: "Engagement", weight: engagement * 0.5, detail: `${engagement} reactions` });
        break;
    }

    // Newest-first boost across all ranked feeds (chronological is already time-ordered).
    if (algorithm !== "chronological") {
      score += freshness * 40;
      factors.push({ label: "Freshness (newest first)", weight: freshness * 40, detail: "just posted" });
    }

    reasons.set(p.id, { postId: p.id, algorithm, score, factors: factors.sort((a, b) => b.weight - a.weight) });
    return { p, score };
  });

  // Sort by score, then newest-first as the tiebreaker.
  scored.sort((a, b) => b.score - a.score || b.p.createdAt - a.p.createdAt);
  const ranked = (algorithm === "trending" || algorithm === "discovery")
    ? balanceSources(scored.map((s) => s.p))
    : balanceByTime(scored.map((s) => s.p));

  // Embeddings (a 64–256-float vector per post) are only needed for the ranking that
  // just finished. Drop them from the result so the postMessage back to the main thread
  // — and its structured-clone deserialize — stays small. The UI never reads
  // post.embedding, and reaction/learn paths re-read the full post from storage. These
  // are storage copies (worker read / recentPosts), so this never touches IndexedDB.
  for (const p of ranked) delete p.embedding;
  for (const arr of replies.values()) for (const p of arr) delete p.embedding;

  return { posts: ranked, reasons, verdicts, replies };
}

/** Interleave Ledger and Nostr posts 1:1 (each keeping its ranked order) so neither
 *  source exceeds ~50%; the larger source's surplus is kept (appended), not dropped. */
function balanceSources(posts: Post[]): Post[] {
  const nostr = posts.filter((p) => p.source === "nostr");
  const ledger = posts.filter((p) => p.source !== "nostr");
  if (!nostr.length || !ledger.length) return posts;
  const n = Math.min(nostr.length, ledger.length);
  const out: Post[] = [];
  for (let i = 0; i < n; i++) { out.push(ledger[i], nostr[i]); }
  out.push(...ledger.slice(n), ...nostr.slice(n));
  return out;
}

const SOURCE_WINDOW_MS = 30 * 60 * 1000; // keep mixed Ledger/Nostr posts within ~30 min of each other

/** Time-coherent 50/50 mix: walk both timelines newest-first in ~30-minute windows,
 *  interleave 1:1 within each window, then drop the busier source's surplus in as a
 *  group — so a Ledger post is never placed next to a Nostr post from hours away. */
function balanceByTime(posts: Post[]): Post[] {
  const nostr = posts.filter((p) => p.source === "nostr").sort((a, b) => b.createdAt - a.createdAt);
  const ledger = posts.filter((p) => p.source !== "nostr").sort((a, b) => b.createdAt - a.createdAt);
  if (!nostr.length || !ledger.length) return posts;
  const out: Post[] = [];
  let li = 0, ni = 0;
  while (li < ledger.length || ni < nostr.length) {
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
