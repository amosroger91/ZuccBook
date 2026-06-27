// Guards against tag-shape crashes: posts from peers / third-party clients may omit
// the optional `tags` array, and the ranker must not throw when filtering by topic.
import { describe, it, expect } from "vitest";
import { rankFeed, type RankContext } from "./feedRank";
import type { Post } from "@/types";

function post(over: Partial<Post>): Post {
  return {
    id: "p" + Math.random().toString(36).slice(2),
    author: "rss-bot",
    authorName: "RSS Bot",
    kind: "text",
    text: "hello world",
    tags: [],
    createdAt: Date.now(),
    reactions: {},
    source: "relay",
    ...over,
  } as Post;
}

function ctx(over: Partial<RankContext> = {}): RankContext {
  return {
    algorithm: "ai-curated",
    opts: { moderation: "discovery", subscribedTopics: ["tech"], mutedTopics: ["spam"] },
    meId: "me",
    interestVector: [],
    hidden: new Set<string>(),
    trustEdges: [],
    profiles: {},
    isJunk: () => false,
    ...over,
  } as RankContext;
}

describe("rankFeed tag safety", () => {
  it("does not throw when a post omits tags (undefined)", () => {
    // Simulate a peer/third-party post with no tags array at runtime.
    const posts = [post({ tags: undefined as unknown as string[] }), post({ author: "nostr:x", tags: undefined as unknown as string[] })];
    expect(() => rankFeed(posts, ctx())).not.toThrow();
  });

  it("still applies topic filters for posts that DO have tags", () => {
    const kept = post({ id: "keep", tags: ["tech"] });
    const muted = post({ id: "drop", tags: ["spam"] });
    const r = rankFeed([kept, muted], ctx());
    const ids = r.posts.map((p) => p.id);
    expect(ids).toContain("keep");      // subscribed topic kept
    expect(ids).not.toContain("drop");  // muted topic removed
  });
});
