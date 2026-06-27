// ============================================================
//  peerService — the peer-to-peer networking layer (PeerJS).
//
//  GitHub-Pages-static means no server, so Ledger uses a serverless
//  hub-relay: the first peer to claim a well-known id ("nebula-hub-vN")
//  becomes the relay HUB; everyone else connects to it as a CLIENT.
//  The hub relays presence, new posts, and direct messages to the
//  swarm. If the hub leaves, clients re-elect. This is the same proven
//  pattern used for rooms; voice/video (full WebRTC mesh) layers on
//  top in Phase 2 (see ROADMAP).
//
//  PeerJS is loaded from the local bundle (dependency), so the app
//  never hard-depends on a third-party CDN to boot.
// ============================================================
import { Peer, type DataConnection } from "peerjs";
import { bus } from "@/lib/events";
import { identityService } from "./identityService";
import { presenceService } from "./presenceService";
import { feedService } from "./feedService";
import { storage } from "./storage";
import type { ChatMessage, Post, RichPresence, WatchPartyState } from "@/types";

// Frozen network id — NOT brand text. Renaming this forks the P2P swarm so
// existing clients can't find new ones. Kept as-is through the Ledger rebrand.
const HUB_ID = "nebula-hub-v1";

type Envelope =
  | { t: "presence"; d: RichPresence }
  | { t: "post"; d: Post }
  | { t: "dm"; d: ChatMessage }
  | { t: "react"; d: { postId: string; emoji: string; from: string; fromName: string } }
  | { t: "stage"; d: WatchPartyState }
  | { t: "wqueue"; d: { room: string; items: { videoId: string; title?: string; by: string }[] } }
  | { t: "sync-req"; d: { have: string[] } }   // "here are the post ids I have — send me what I'm missing"
  | { t: "sync-posts"; d: Post[] }              // a batch of history posts to backfill
  | { t: "hello"; d: { pk: string } };

const SYNC_MAX = 800;   // cap how many history posts we backfill per peer (deeper history rides Gun)
const SYNC_BATCH = 40;

class PeerService {
  private peer: Peer | null = null;
  private isHub = false;
  private hubConn: DataConnection | null = null;     // client → hub
  private clients = new Map<string, DataConnection>(); // hub → clients
  private leaving = false;
  private reelectTimer: any = null;
  private started = false;
  private lastStage: WatchPartyState | null = null; // most recent (any room) — replayed to new joiners
  private stagesByRoom = new Map<string, WatchPartyState>(); // latest state per watch room
  private queuesByRoom = new Map<string, { videoId: string; title?: string; by: string }[]>(); // up-next per room

  currentStage(room = "lobby") { return this.stagesByRoom.get(room) ?? null; }
  queueFor(room = "lobby") { return this.queuesByRoom.get(room) ?? []; }
  /** Public rooms with a live video (for the lobby's "active rooms" list). */
  activeRooms(): WatchPartyState[] {
    return [...this.stagesByRoom.values()].filter((s) => s.videoId && !(s.room ?? "lobby").startsWith("priv:"));
  }

  start() {
    if (this.started) return;
    this.started = true;
    presenceService.bindTransport((p) => this.send({ t: "presence", d: p }));
    // Relay local reactions to the swarm (bus avoids a feed↔peer import cycle).
    bus.on("feed:react-out", ({ postId, emoji }) =>
      this.send({ t: "react", d: { postId, emoji, from: identityService.pk, fromName: identityService.current?.username ?? "Someone" } }));
    // Relay local watch-party changes; remember the latest so late joiners catch up.
    bus.on("stage:out", (s) => { this.lastStage = s; this.stagesByRoom.set(s.room ?? "lobby", s); this.send({ t: "stage", d: s }); });
    bus.on("watch:queue-out", ({ room, items }) => { this.queuesByRoom.set(room, items); this.send({ t: "wqueue", d: { room, items } }); });
    this.connect();
  }

  stop() {
    this.leaving = true;
    clearTimeout(this.reelectTimer);
    for (const c of this.clients.values()) try { c.close(); } catch {}
    this.clients.clear();
    try { this.hubConn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
  }

  /** Publish a post to the swarm (best-effort relay). */
  publishPost(post: Post) { this.send({ t: "post", d: post }); }
  sendDM(msg: ChatMessage) { this.send({ t: "dm", d: msg }); }

  private send(env: Envelope) {
    if (this.isHub) this.broadcast(env);
    else { try { if (this.hubConn?.open) this.hubConn.send(env); } catch {} }
  }
  private broadcast(env: Envelope, except?: string) {
    for (const [id, c] of this.clients) { if (id === except) continue; try { if (c.open) c.send(env); } catch {} }
  }
  // Send to one specific peer (the hub replies to a given client; a client replies to the hub).
  private sendTo(fromId: string | undefined, env: Envelope) {
    const c = this.isHub && fromId ? this.clients.get(fromId) : this.hubConn;
    try { if (c?.open) c.send(env); } catch {}
  }

  /* ---------- timeline history sync ---------- */
  // On connect, tell the peer everything we already have so they can backfill
  // the gaps both ways — no missed posts, no deletes, no duplicates.
  private async sendSyncReq(conn: DataConnection) {
    try {
      const have = await storage.allPostIds();   // keys only — don't load full posts just for ids
      if (conn.open) conn.send({ t: "sync-req", d: { have } });
    } catch {}
  }
  // Reply to a sync-req with the posts the requester is missing (newest first, batched).
  private async sendHistory(fromId: string | undefined, have: string[]) {
    try {
      const haveSet = new Set(have);
      // We only backfill the newest SYNC_MAX anyway (deeper history rides Gun), so
      // read just that bounded window instead of the entire post store.
      const missing = (await storage.recentPosts(SYNC_MAX))
        .filter((p) => !haveSet.has(p.id))
        .slice(0, SYNC_MAX);
      for (let i = 0; i < missing.length; i += SYNC_BATCH) {
        this.sendTo(fromId, { t: "sync-posts", d: missing.slice(i, i + SYNC_BATCH) });
      }
    } catch {}
  }

  private async handle(env: Envelope, fromId?: string) {
    if (!env || !(env as any).t) return;
    switch (env.t) {
      case "presence": presenceService.ingest(env.d); if (this.isHub) this.broadcast(env, fromId); break;
      case "post":
        if ((env.d.author) !== identityService.pk) { env.d.source = "relay"; await feedService.ingest(env.d); }
        if (this.isHub) this.broadcast(env, fromId);
        break;
      case "dm":
        if (env.d.author !== identityService.pk) {
          await storage.putMessage(env.d); bus.emit("chat:message", env.d);
          bus.emit("alert", { kind: "dm", text: `${env.d.authorName} sent you a message`, route: "/messages" });
        }
        if (this.isHub) this.broadcast(env, fromId);
        break;
      case "react":
        if (env.d.from !== identityService.pk) {
          const post = await storage.getPost(env.d.postId);
          await feedService.applyReaction(env.d.postId, env.d.emoji, env.d.from);
          if (post && post.author === identityService.pk) {
            bus.emit("notify", { text: `${env.d.fromName} reacted ${env.d.emoji} to your post` });
            bus.emit("alert", { kind: "reaction", text: `${env.d.fromName} reacted ${env.d.emoji} to your post`, route: "/", postId: env.d.postId });
          }
        }
        if (this.isHub) this.broadcast(env, fromId);
        break;
      case "stage":
        this.lastStage = env.d;
        this.stagesByRoom.set(env.d.room ?? "lobby", env.d);
        bus.emit("stage:in", env.d);
        if (this.isHub) this.broadcast(env, fromId);
        break;
      case "wqueue":
        this.queuesByRoom.set(env.d.room, env.d.items);
        bus.emit("watch:queue", env.d);
        if (this.isHub) this.broadcast(env, fromId);
        break;
      case "sync-req":
        this.sendHistory(fromId, env.d.have);   // they told us what they have → send the gaps
        break;
      case "sync-posts": {
        const me = identityService.pk;
        // backfill: insert/merge only (absorbMany never deletes or duplicates)
        await feedService.absorbMany(env.d.map((p) => (p.author !== me ? { ...p, source: "relay" as const } : p)));
        break;
      }
      case "hello": if (this.isHub) presenceService.announceSelf(); break;
    }
  }

  /* ---------- connection lifecycle ---------- */
  private connect() {
    if (this.leaving || !Peer) return;
    this.peer = new Peer(HUB_ID);
    this.peer.on("open", () => { this.startHub(); });
    this.peer.on("error", (e: any) => {
      if (e?.type === "unavailable-id") {
        try { this.peer?.destroy(); } catch {}
        this.peer = new Peer();
        this.peer.on("open", (id) => { bus.emit("peer:open", { id }); this.startClient(); });
        this.peer.on("error", () => { if (!this.leaving) this.reelect(); });
      } else if (!this.leaving) { this.reelect(); }
    });
  }

  private startHub() {
    this.isHub = true;
    bus.emit("peer:open", { id: this.peer!.id });
    presenceService.announceSelf();
    this.peer!.on("connection", (c) => {
      c.on("open", () => {
        this.clients.set(c.peer, c);
        bus.emit("peer:connected", { pk: c.peer });
        // Catch the newcomer up on every in-progress watch room.
        for (const s of this.stagesByRoom.values()) if (s.videoId) { try { c.send({ t: "stage", d: s }); } catch {} }
        // Reconcile timeline history with the newcomer (both directions).
        this.sendSyncReq(c);
      });
      c.on("data", (d) => this.handle(d as Envelope, c.peer));
      // Only forget the client if THIS connection is still the one we hold for that
      // peer id. A quick reconnect replaces the map entry; without this check the old
      // connection's late "close" would delete the new, active one.
      c.on("close", () => { if (this.clients.get(c.peer) === c) { this.clients.delete(c.peer); bus.emit("peer:disconnected", { pk: c.peer }); } });
      c.on("error", () => {});
    });
  }

  private startClient() {
    this.isHub = false;
    const c = this.peer!.connect(HUB_ID, { reliable: true });
    this.hubConn = c;
    c.on("open", () => { c.send({ t: "hello", d: { pk: identityService.pk } }); presenceService.announceSelf(); this.sendSyncReq(c); });
    c.on("data", (d) => this.handle(d as Envelope));
    // Only re-elect if the connection that closed is still our CURRENT hub link.
    // A stale, previously-replaced hubConn finishing its close must not tear down
    // the new active connection/peer.
    c.on("close", () => { if (!this.leaving && this.hubConn === c) this.reelect(); });
    c.on("error", () => { if (!this.leaving && this.hubConn === c) this.reelect(); });
  }

  private reelect() {
    clearTimeout(this.reelectTimer);
    try { this.peer?.destroy(); } catch {}
    this.peer = null; this.hubConn = null;
    this.reelectTimer = setTimeout(() => this.connect(), 400 + Math.random() * 1000);
  }
}

export const peerService = new PeerService();
