// ============================================================
//  nostrService — bridges the Nostr network into Ledger.
//
//  Nostr notes (kind 1) for popular hashtags + the topics you follow
//  are pulled from public relays and ingested as posts authored by
//  "nostr:<pubkey>" (source: "nostr") — they appear seamlessly in your
//  feed but are clearly a different TYPE of user (external). Each note's
//  schnorr signature is verified before ingest, so forgeries are dropped.
//
//  Bidirectional: Ledger holds a Nostr keypair for you (generated on
//  first use), so your reactions (kind 7), replies (kind 1, NIP-10) and
//  brand-new notes are signed and published back to the relays.
//
//  Transport is RAW WebSocket (not nostr-tools' SimplePool, which silently
//  dropped every event in the browser bundle). nostr-tools is used only for
//  the pure crypto: key gen, signing, verification, npub encoding.
// ============================================================
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, nip19, type Event as NostrEvent } from "nostr-tools";
import { storage } from "./storage";
import { feedService } from "./feedService";
import { rssService, topicSlug } from "./rssService";
import { bus } from "@/lib/events";
import type { Post, Profile } from "@/types";

const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.nostr.band",
];
const SEARCH_RELAYS = ["wss://relay.nostr.band", "wss://relay.noswhere.com"];
// Stream from a SMALL subset so popular hashtags don't flood every relay at once.
const STREAM_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const POPULAR_TAGS = ["nostr", "bitcoin", "news", "technology", "ai", "art", "music", "sports", "politics", "food", "gaming", "crypto", "science", "photography", "travel", "health", "memes", "plebchain", "grownostr"];
// Hard cap on Nostr notes ingested per session. The Nostr firehose is endless;
// verifying (schnorr) + embedding + re-rendering every event would saturate the
// tab and crash it. We take a healthy batch, then stop the stream — the feed
// stays bounded (and pruneEphemeralPosts trims the cache).
const NOSTR_SESSION_CAP = 400;

const hexToBytes = (hex: string) => { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return a; };
const bytesToHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const shortNpub = (pubkey: string) => { try { return nip19.npubEncode(pubkey).slice(0, 12) + "…"; } catch { return pubkey.slice(0, 10) + "…"; } };
const rid = () => Math.random().toString(36).slice(2, 10);

// NIP-10: the event id this note replies to (reply marker → root → last e-tag).
function replyParent(e: NostrEvent): string | null {
  const es = (e.tags ?? []).filter((t) => t[0] === "e" && t[1]);
  if (!es.length) return null;
  return (es.find((t) => t[3] === "reply") ?? es.find((t) => t[3] === "root") ?? es[es.length - 1])[1];
}

class NostrService {
  private sk: Uint8Array | null = null;
  private pkHex = "";
  private profiles = new Map<string, Profile>();
  private seen = new Set<string>();
  private wantProfiles = new Set<string>();
  private started = false;

  // Live streaming sockets (one per relay), kept open + auto-reconnecting.
  private sockets = new Map<string, WebSocket>();
  private subId = "led" + rid();
  private filter: Record<string, unknown> | null = null;
  private ingested = 0;     // notes ingested this session
  private capped = false;   // hit NOSTR_SESSION_CAP → stream stopped

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

  /** Link an EXISTING Nostr account by its secret key (nsec… or 64-char hex),
   *  replacing this device's auto-generated key. Returns the npub. Used at
   *  sign-up so people can sign in with their existing Nostr identity. */
  async importKey(input: string): Promise<string> {
    const raw = input.trim().replace(/^nostr:/i, "");
    let sk: Uint8Array;
    if (/^nsec1[a-z0-9]+$/i.test(raw)) {
      const dec = nip19.decode(raw);
      if (dec.type !== "nsec") throw new Error("Not an nsec key");
      sk = dec.data as Uint8Array;
    } else if (/^[0-9a-f]{64}$/i.test(raw)) {
      sk = hexToBytes(raw);
    } else {
      throw new Error("Expected a Nostr nsec… key (or 64-char hex)");
    }
    const pk = getPublicKey(sk);   // throws if the key is invalid
    this.sk = sk;
    this.pkHex = pk;
    await storage.kvSet("nostr:sk", bytesToHex(sk));
    return nip19.npubEncode(pk);
  }

  /** Begin streaming Nostr notes (popular hashtags + your topics). */
  async start() {
    if (this.started) return;
    this.started = true;
    this.ingested = 0; this.capped = false;   // fresh batch each (re)start
    await this.myKeys();
    let topicTags: string[] = [];
    try { const cfg = await rssService.config(); topicTags = (cfg.topics ?? []).map(topicSlug).filter((t) => t.length > 2); } catch {}
    const tags = [...new Set([...POPULAR_TAGS, ...topicTags])].slice(0, 24);
    this.filter = { kinds: [1], "#t": tags, limit: 40 };
    for (const r of STREAM_RELAYS) this.connect(r);
  }

  stop() {
    this.started = false;
    for (const w of this.sockets.values()) { try { w.close(); } catch {} }
    this.sockets.clear();
    bus.emit("feed:updated", undefined);
  }

  /** Open (and keep open, auto-reconnecting) a streaming connection to one relay. */
  private connect(relay: string) {
    if (!this.started || this.capped || !this.filter) return;
    const existing = this.sockets.get(relay);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;
    let w: WebSocket;
    try { w = new WebSocket(relay); } catch { return; }
    this.sockets.set(relay, w);
    w.onopen = () => { try { w.send(JSON.stringify(["REQ", this.subId, this.filter])); } catch {} };
    w.onmessage = (m) => {
      try { const d = JSON.parse(typeof m.data === "string" ? m.data : ""); if (d[0] === "EVENT" && d[1] === this.subId) this.onNote(d[2]); } catch {}
    };
    w.onerror = () => { try { w.close(); } catch {} };
    w.onclose = () => {
      if (this.sockets.get(relay) === w) this.sockets.delete(relay);
      if (this.started && !this.capped) setTimeout(() => this.connect(relay), 4000 + Math.random() * 4000); // reconnect with jitter
    };
  }

  /** Publish a signed event to every open streaming relay (opening any closed ones). */
  private broadcast(ev: NostrEvent) {
    const msg = JSON.stringify(["EVENT", ev]);
    let sent = 0;
    for (const r of RELAYS) {
      const w = this.sockets.get(r);
      if (w && w.readyState === WebSocket.OPEN) { try { w.send(msg); sent++; } catch {} }
      else { try { const t = new WebSocket(r); t.onopen = () => { try { t.send(msg); } catch {}; setTimeout(() => { try { t.close(); } catch {} }, 4000); }; t.onerror = () => { try { t.close(); } catch {} }; } catch {} }
    }
    return sent;
  }

  /** One-shot query against a set of relays; resolves on all-EOSE or timeout. */
  private queryOnce(relays: string[], filter: Record<string, unknown>, ms = 7000): Promise<NostrEvent[]> {
    return new Promise((resolve) => {
      const out: NostrEvent[] = [], seen = new Set<string>(), socks: WebSocket[] = [];
      let done = false, eose = 0;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); socks.forEach((s) => { try { s.close(); } catch {} }); resolve(out); };
      const timer = setTimeout(finish, ms);
      for (const r of relays) {
        let w: WebSocket; try { w = new WebSocket(r); } catch { continue; }
        socks.push(w);
        const sid = "q" + rid();
        w.onopen = () => { try { w.send(JSON.stringify(["REQ", sid, filter])); } catch {} };
        w.onmessage = (m) => {
          try {
            const d = JSON.parse(typeof m.data === "string" ? m.data : "");
            if (d[0] === "EVENT" && d[1] === sid) { const e = d[2] as NostrEvent; if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } }
            else if (d[0] === "EOSE" && d[1] === sid) { if (++eose >= relays.length) finish(); }
          } catch {}
        };
        w.onerror = () => {};
      }
    });
  }

  private async onNote(e: NostrEvent) {
    if (this.capped || !e || e.kind !== 1 || this.seen.has(e.id)) return;
    if (this.seen.size > 8000) this.seen.clear();   // bound memory on very long sessions
    this.seen.add(e.id);
    try { if (!verifyEvent(e)) return; } catch { return; }   // drop unverifiable notes
    const post = this.toPost(e);
    const parentEventId = replyParent(e);
    if (parentEventId) {
      const local = `nostr_${parentEventId}`;
      if (await storage.getPost(local)) post.replyTo = local;
      else { const mirror = await storage.kvGet<{ ledgerId?: string }>("nostr:mirrorback:" + parentEventId); if (mirror?.ledgerId) post.replyTo = mirror.ledgerId; }
    }
    await feedService.ingest(post);
    this.ensureProfile(e.pubkey);
    // Hit the session cap → stop the firehose (close streaming sockets).
    if (++this.ingested >= NOSTR_SESSION_CAP) {
      this.capped = true;
      for (const w of this.sockets.values()) { try { w.close(); } catch {} }
      this.sockets.clear();
    }
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
    this.queryOnce(RELAYS, { kinds: [0], authors: [pubkey], limit: 1 }, 6000).then((evs) => { if (evs[0]) this.absorbProfile(evs[0]); }).catch(() => {});
  }

  private async absorbProfile(e: NostrEvent) {
    try {
      const m = JSON.parse(e.content || "{}");
      const prof: Profile = {
        pk: "nostr:" + e.pubkey,
        username: m.display_name || m.displayName || m.name || shortNpub(e.pubkey),
        avatar: m.picture || undefined,
        header: m.banner || undefined,
        bio: m.about || undefined,
        website: m.website || undefined,
        badges: [], reputation: 0, communities: [],
        updatedAt: (e.created_at || 0) * 1000,
      };
      this.profiles.set(e.pubkey, prof);
      bus.emit("profile:update", prof);
      // Back-fill the photo + display name onto notes we ingested BEFORE this
      // profile loaded (kind-0 metadata arrives a beat after the note), so their
      // cards show the real Nostr avatar instead of just an npub stub.
      try {
        const mine = await storage.postsByAuthor("nostr:" + e.pubkey);
        for (const p of mine) {
          const avatar = prof.avatar || p.authorAvatar;
          const name = prof.username || p.authorName;
          if (p.authorAvatar !== avatar || p.authorName !== name) { p.authorAvatar = avatar; p.authorName = name; await storage.putPost(p); }
        }
      } catch {}
      bus.emit("feed:updated", undefined);
    } catch {}
  }

  /** A profile for a "nostr:<hex>" author — from cache or fetched kind-0 metadata. */
  async profile(pk: string): Promise<Profile> {
    const pubkey = pk.replace(/^nostr:/, "");
    if (!this.profiles.has(pubkey)) {
      const evs = await this.queryOnce(RELAYS, { kinds: [0], authors: [pubkey], limit: 1 }, 6000);
      if (evs[0]) this.absorbProfile(evs[0]);
    }
    return this.profiles.get(pubkey) ?? { pk, username: shortNpub(pubkey), badges: [], reputation: 0, communities: [], updatedAt: 0 };
  }
  npubFor(pk: string): string { try { return nip19.npubEncode(pk.replace(/^nostr:/, "")); } catch { return pk; } }

  /** Search Nostr (NIP-50 / hashtag / npub) and ingest matches into the feed. */
  async search(q: string): Promise<number> {
    const query = q.trim();
    if (query.length < 2) return 0;
    let evs: NostrEvent[] = [];
    if (/^npub1[a-z0-9]+$/i.test(query)) {
      try { const { data } = nip19.decode(query); this.ensureProfile(data as string); evs = await this.queryOnce(RELAYS, { kinds: [1], authors: [data as string], limit: 40 }, 8000); } catch {}
    } else {
      const nip50 = await this.queryOnce(SEARCH_RELAYS, { kinds: [1], search: query, limit: 40 }, 8000);
      const tag = query.toLowerCase().replace(/[^a-z0-9]/g, "");
      const byTag = tag.length >= 2 ? await this.queryOnce(RELAYS, { kinds: [1], "#t": [tag], limit: 30 }, 8000) : [];
      evs = [...nip50, ...byTag];
    }
    for (const e of evs) await this.onNote(e);
    return evs.length;
  }

  /** React (kind 7) to a Nostr note. */
  async reactToNote(post: Post, emoji: string) {
    if (post.source !== "nostr" || !post.nostrId || !post.nostrPubkey) return;
    const { sk } = await this.myKeys();
    this.broadcast(finalizeEvent({ kind: 7, created_at: Math.floor(Date.now() / 1000), tags: [["e", post.nostrId], ["p", post.nostrPubkey]], content: emoji || "+" }, sk));
  }

  /** Generic NIP-10 reply to any root note id+author. */
  async publishReply(rootId: string, rootPubkey: string, text: string): Promise<NostrEvent> {
    const { sk } = await this.myKeys();
    const ev = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [["e", rootId, "", "root"], ["p", rootPubkey]], content: text }, sk);
    this.broadcast(ev);
    return ev;
  }

  async replyToNote(post: Post, text: string) {
    if (post.source !== "nostr" || !post.nostrId || !post.nostrPubkey) return;
    await this.publishReply(post.nostrId, post.nostrPubkey, text);
  }

  /** Publish a brand-new note (kind 1) to Nostr — used by the composer. */
  async publishNote(text: string, hashtags: string[] = []): Promise<NostrEvent> {
    const { sk } = await this.myKeys();
    const tags = [...new Set(hashtags.map((t) => t.toLowerCase()))].map((t) => ["t", t]);
    const ev = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content: text }, sk);
    this.broadcast(ev);
    return ev;
  }

  /** Mirror a Ledger post onto Nostr exactly once (cached), returning the root ref. */
  private async rootFor(post: Post): Promise<{ id: string; pubkey: string } | null> {
    if (post.source === "nostr" && post.nostrId && post.nostrPubkey) return { id: post.nostrId, pubkey: post.nostrPubkey };
    const key = "nostr:mirror:" + post.id;
    const cached = await storage.kvGet<{ id: string; pubkey: string }>(key);
    if (cached) return cached;
    const ev = await this.publishNote(`${post.text ?? ""}\n\n— via ${post.authorName} on Ledger`, post.tags ?? []);
    const ref = { id: ev.id, pubkey: ev.pubkey };
    await storage.kvSet(key, ref);
    await storage.kvSet("nostr:mirrorback:" + ev.id, { ledgerId: post.id });
    return ref;
  }

  /** Ask-AI bridge: mirror the original post to Nostr (once) + post the AI comment as a reply. */
  async bridgeAiComment(parent: Post, commentText: string) {
    if (!this.started) return;
    try { const root = await this.rootFor(parent); if (root) await this.publishReply(root.id, root.pubkey, commentText); } catch {}
  }
}

export const nostrService = new NostrService();
