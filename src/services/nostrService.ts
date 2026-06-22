// ============================================================
//  nostrService — bridges the Nostr network into Ledger.
//
//  Nostr notes (kind 1) for the topics you follow are pulled from
//  public relays and ingested as posts authored by "nostr:<pubkey>"
//  (source: "nostr") so they appear seamlessly in your feed but are
//  clearly a different TYPE of user (external). Their schnorr
//  signature is verified before ingest, so forgeries are dropped.
//
//  Bidirectional: Ledger holds a Nostr keypair for you (generated on
//  first use), so your reactions (kind 7), replies (kind 1, NIP-10)
//  and brand-new notes are signed and published back to the relays —
//  the real Nostr authors actually receive them. Search uses NIP-50
//  on search-capable relays. Profiles come from kind-0 metadata.
// ============================================================
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, nip19, type Event as NostrEvent } from "nostr-tools";
import { storage } from "./storage";
import { feedService } from "./feedService";
import { rssService, topicSlug } from "./rssService";
import { bus } from "@/lib/events";
import type { Post, Profile } from "@/types";

const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];
// NIP-50 (search) capable relays.
const SEARCH_RELAYS = ["wss://relay.nostr.band", "wss://relay.noswhere.com"];
// High-volume Nostr hashtags so the bridged feed is actually populated.
const POPULAR_TAGS = ["nostr", "bitcoin", "news", "technology", "ai", "art", "music", "sports", "politics", "food", "gaming", "crypto", "science", "photography", "travel", "health", "memes", "plebchain", "grownostr"];

// querySync that can never hang (some relays never send EOSE for NIP-50 search).
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

// NIP-10: the event id this note is replying to (reply marker → root → last e-tag).
function replyParent(e: NostrEvent): string | null {
  const es = (e.tags ?? []).filter((t) => t[0] === "e" && t[1]);
  if (!es.length) return null;
  return (es.find((t) => t[3] === "reply") ?? es.find((t) => t[3] === "root") ?? es[es.length - 1])[1];
}

const hexToBytes = (hex: string) => { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return a; };
const bytesToHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const shortNpub = (pubkey: string) => { try { return nip19.npubEncode(pubkey).slice(0, 12) + "…"; } catch { return pubkey.slice(0, 10) + "…"; } };

class NostrService {
  private pool = new SimplePool();
  private sub: { close: () => void } | null = null;
  private sk: Uint8Array | null = null;
  private pkHex = "";
  private profiles = new Map<string, Profile>();   // pubkeyHex → profile
  private seen = new Set<string>();                 // event ids
  private wantProfiles = new Set<string>();
  private started = false;

  /** This device's Nostr identity (generated + persisted on first use). */
  async myKeys(): Promise<{ sk: Uint8Array; pk: string; npub: string }> {
    if (!this.sk) {
      let hex = await storage.kvGet<string>("nostr:sk");
      if (!hex) { hex = bytesToHex(generateSecretKey()); await storage.kvSet("nostr:sk", hex); }
      this.sk = hexToBytes(hex);
      this.pkHex = getPublicKey(this.sk);
    }
    return { sk: this.sk, pk: this.pkHex, npub: nip19.npubEncode(this.pkHex) };
  }
  myNpub(): string { return this.pkHex ? nip19.npubEncode(this.pkHex) : ""; }
  isStarted() { return this.started; }

  /** Begin streaming Nostr notes. We subscribe to a broad set of high-volume
   *  Nostr hashtags (so the feed actually fills) PLUS the topics you follow in
   *  Ledger — Ledger's topic slugs alone (#worldnews, #localnews…) barely exist
   *  on Nostr, which is why nothing showed before. */
  async start() {
    if (this.started) return;
    this.started = true;
    await this.myKeys();
    let topicTags: string[] = [];
    try {
      const cfg = await rssService.config();
      topicTags = (cfg.topics ?? []).map(topicSlug).filter((t) => t.length > 2);
    } catch {}
    const tags = [...new Set([...POPULAR_TAGS, ...topicTags])].slice(0, 24);
    this.subscribe(tags);
  }

  stop() {
    this.started = false;
    try { this.sub?.close(); } catch {}
    this.sub = null;
    bus.emit("feed:updated", undefined);   // drop nostr posts from the view
  }

  private subscribe(tags: string[]) {
    try { this.sub?.close(); } catch {}
    try {
      this.sub = this.pool.subscribeMany(RELAYS, [{ kinds: [1], "#t": tags, limit: 80 }], {
        onevent: (e) => { this.onNote(e); },
        oneose: () => {},
      });
    } catch { /* relays unreachable — non-fatal */ }
  }

  private async onNote(e: NostrEvent) {
    if (!e || e.kind !== 1 || this.seen.has(e.id)) return;
    this.seen.add(e.id);
    try { if (!verifyEvent(e)) return; } catch { return; }   // drop unverifiable notes
    const post = this.toPost(e);
    // NIP-10: if this note replies to a note/post we already have, thread it as a
    // comment; otherwise leave it top-level (don't orphan it into the void).
    const parentEventId = replyParent(e);
    if (parentEventId) {
      const local = `nostr_${parentEventId}`;
      if (await storage.getPost(local)) post.replyTo = local;
      else { const mirror = await storage.kvGet<{ ledgerId?: string }>("nostr:mirrorback:" + parentEventId); if (mirror?.ledgerId) post.replyTo = mirror.ledgerId; }
    }
    await feedService.ingest(post);
    this.ensureProfile(e.pubkey);
  }

  private toPost(e: NostrEvent): Post {
    const tags = (e.tags ?? []).filter((t) => t[0] === "t" && t[1]).map((t) => t[1].toLowerCase());
    const prof = this.profiles.get(e.pubkey);
    return {
      id: "nostr_" + e.id,
      author: "nostr:" + e.pubkey,
      authorName: prof?.username || shortNpub(e.pubkey),
      authorAvatar: prof?.avatar || undefined,
      kind: "text",
      text: e.content,
      tags: tags.length ? tags : ["nostr"],
      createdAt: (e.created_at || 0) * 1000 || Date.now(),
      reactions: {},
      source: "nostr",
      nostrId: e.id,
      nostrPubkey: e.pubkey,
    };
  }

  private ensureProfile(pubkey: string) {
    if (this.profiles.has(pubkey) || this.wantProfiles.has(pubkey)) return;
    this.wantProfiles.add(pubkey);
    this.pool.get(RELAYS, { kinds: [0], authors: [pubkey] }).then((m) => { if (m) this.absorbProfile(m); }).catch(() => {});
  }

  private absorbProfile(e: NostrEvent) {
    try {
      const m = JSON.parse(e.content || "{}");
      const prof: Profile = {
        pk: "nostr:" + e.pubkey,
        username: m.display_name || m.displayName || m.name || shortNpub(e.pubkey),
        avatar: m.picture || undefined,
        header: m.banner || undefined,
        bio: m.about || undefined,
        website: m.website || undefined,
        badges: [],
        reputation: 0,
        communities: [],
        updatedAt: (e.created_at || 0) * 1000,
      };
      this.profiles.set(e.pubkey, prof);
      bus.emit("profile:update", prof);
      bus.emit("feed:updated", undefined);   // posts pick up the real name/avatar
    } catch {}
  }

  /** A profile for a "nostr:<hex>" author — from cache or fetched kind-0 metadata. */
  async profile(pk: string): Promise<Profile> {
    const pubkey = pk.replace(/^nostr:/, "");
    if (!this.profiles.has(pubkey)) {
      try { const m = await this.pool.get(RELAYS, { kinds: [0], authors: [pubkey] }); if (m) this.absorbProfile(m); } catch {}
    }
    return this.profiles.get(pubkey) ?? { pk, username: shortNpub(pubkey), badges: [], reputation: 0, communities: [], updatedAt: 0 };
  }
  npubFor(pk: string): string { try { return nip19.npubEncode(pk.replace(/^nostr:/, "")); } catch { return pk; } }

  /** Search Nostr (NIP-50, or by npub) and ingest matches so they show in the feed. */
  async search(q: string): Promise<number> {
    const query = q.trim();
    if (query.length < 2) return 0;
    // npub → that author's recent notes
    if (/^npub1[a-z0-9]+$/i.test(query)) {
      try {
        const { data } = nip19.decode(query);
        const events = await withTimeout(this.pool.querySync(RELAYS, { kinds: [1], authors: [data as string], limit: 40 }), 8000, [] as NostrEvent[]);
        this.ensureProfile(data as string);
        for (const e of events) await this.onNote(e);
        return events.length;
      } catch { return 0; }
    }
    let n = 0;
    // NIP-50 full-text search (search-capable relays) — timed so a non-EOSE relay can't hang it.
    try { for (const e of await withTimeout(this.pool.querySync(SEARCH_RELAYS, { kinds: [1], search: query, limit: 40 }), 8000, [] as NostrEvent[])) { await this.onNote(e); n++; } } catch {}
    // Hashtag fallback (works on every relay) — robust even when NIP-50 is flaky.
    const tag = query.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (tag.length >= 2) { try { for (const e of await withTimeout(this.pool.querySync(RELAYS, { kinds: [1], "#t": [tag], limit: 30 }), 8000, [] as NostrEvent[])) { await this.onNote(e); n++; } } catch {} }
    return n;
  }

  /** React (kind 7) to a Nostr note. */
  async reactToNote(post: Post, emoji: string) {
    if (post.source !== "nostr" || !post.nostrId || !post.nostrPubkey) return;
    const { sk } = await this.myKeys();
    const ev = finalizeEvent({ kind: 7, created_at: Math.floor(Date.now() / 1000), tags: [["e", post.nostrId], ["p", post.nostrPubkey]], content: emoji || "+" }, sk);
    try { await Promise.any(this.pool.publish(RELAYS, ev)); } catch {}
  }

  /** Generic NIP-10 reply to any root note id+author. */
  async publishReply(rootId: string, rootPubkey: string, text: string): Promise<NostrEvent> {
    const { sk } = await this.myKeys();
    const ev = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [["e", rootId, "", "root"], ["p", rootPubkey]], content: text }, sk);
    try { await Promise.any(this.pool.publish(RELAYS, ev)); } catch {}
    return ev;
  }

  /** Reply (kind 1, NIP-10) to a Nostr note. */
  async replyToNote(post: Post, text: string) {
    if (post.source !== "nostr" || !post.nostrId || !post.nostrPubkey) return;
    await this.publishReply(post.nostrId, post.nostrPubkey, text);
  }

  /** Mirror a Ledger post onto Nostr exactly once (cached by post id), returning
   *  the root note ref. Nostr posts already have a root, so they pass through. */
  private async rootFor(post: Post): Promise<{ id: string; pubkey: string } | null> {
    if (post.source === "nostr" && post.nostrId && post.nostrPubkey) return { id: post.nostrId, pubkey: post.nostrPubkey };
    const key = "nostr:mirror:" + post.id;
    const cached = await storage.kvGet<{ id: string; pubkey: string }>(key);
    if (cached) return cached;
    const body = `${post.text ?? ""}\n\n— via ${post.authorName} on Ledger`;
    const ev = await this.publishNote(body, post.tags ?? []);
    const ref = { id: ev.id, pubkey: ev.pubkey };
    await storage.kvSet(key, ref);
    // reverse map: a Nostr reply to this mirrored note threads back under the Ledger post
    await storage.kvSet("nostr:mirrorback:" + ev.id, { ledgerId: post.id });
    return ref;
  }

  /** Ask-AI bridge: mirror the original post to Nostr (if not already) and post
   *  the AI's comment there as a reply, so the whole exchange lives on Nostr too.
   *  No-op unless Nostr is active. */
  async bridgeAiComment(parent: Post, commentText: string) {
    if (!this.started) return;
    try { const root = await this.rootFor(parent); if (root) await this.publishReply(root.id, root.pubkey, commentText); } catch {}
  }

  /** Publish a brand-new note (kind 1) to Nostr — used by the composer. */
  async publishNote(text: string, hashtags: string[] = []): Promise<NostrEvent> {
    const { sk } = await this.myKeys();
    const tags = [...new Set(hashtags.map((t) => t.toLowerCase()))].map((t) => ["t", t]);
    const ev = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content: text }, sk);
    try { await Promise.any(this.pool.publish(RELAYS, ev)); } catch {}
    return ev;
  }
}

export const nostrService = new NostrService();
