// ============================================================
//  peerService — the peer-to-peer networking layer (PeerJS).
//
//  GitHub-Pages-static means no server, so ZuccBook uses a serverless
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
import type { ChatMessage, Post, RichPresence } from "@/types";

const HUB_ID = "nebula-hub-v1";

type Envelope =
  | { t: "presence"; d: RichPresence }
  | { t: "post"; d: Post }
  | { t: "dm"; d: ChatMessage }
  | { t: "react"; d: { postId: string; emoji: string; from: string; fromName: string } }
  | { t: "hello"; d: { pk: string } };

class PeerService {
  private peer: Peer | null = null;
  private isHub = false;
  private hubConn: DataConnection | null = null;     // client → hub
  private clients = new Map<string, DataConnection>(); // hub → clients
  private leaving = false;
  private reelectTimer: any = null;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    presenceService.bindTransport((p) => this.send({ t: "presence", d: p }));
    // Relay local reactions to the swarm (bus avoids a feed↔peer import cycle).
    bus.on("feed:react-out", ({ postId, emoji }) =>
      this.send({ t: "react", d: { postId, emoji, from: identityService.pk, fromName: identityService.current?.username ?? "Someone" } }));
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

  private async handle(env: Envelope, fromId?: string) {
    if (!env || !(env as any).t) return;
    switch (env.t) {
      case "presence": presenceService.ingest(env.d); if (this.isHub) this.broadcast(env, fromId); break;
      case "post":
        if ((env.d.author) !== identityService.pk) { env.d.source = "relay"; await feedService.ingest(env.d); }
        if (this.isHub) this.broadcast(env, fromId);
        break;
      case "dm":
        if (env.d.author !== identityService.pk) { await storage.putMessage(env.d); bus.emit("chat:message", env.d); }
        if (this.isHub) this.broadcast(env, fromId);
        break;
      case "react":
        if (env.d.from !== identityService.pk) {
          const post = await storage.getPost(env.d.postId);
          await feedService.applyReaction(env.d.postId, env.d.emoji, env.d.from);
          if (post && post.author === identityService.pk) bus.emit("notify", { text: `${env.d.fromName} reacted ${env.d.emoji} to your post` });
        }
        if (this.isHub) this.broadcast(env, fromId);
        break;
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
      c.on("open", () => { this.clients.set(c.peer, c); bus.emit("peer:connected", { pk: c.peer }); });
      c.on("data", (d) => this.handle(d as Envelope, c.peer));
      c.on("close", () => { this.clients.delete(c.peer); bus.emit("peer:disconnected", { pk: c.peer }); });
      c.on("error", () => {});
    });
  }

  private startClient() {
    this.isHub = false;
    const c = this.peer!.connect(HUB_ID, { reliable: true });
    this.hubConn = c;
    c.on("open", () => { c.send({ t: "hello", d: { pk: identityService.pk } }); presenceService.announceSelf(); });
    c.on("data", (d) => this.handle(d as Envelope));
    c.on("close", () => { if (!this.leaving) this.reelect(); });
    c.on("error", () => { if (!this.leaving) this.reelect(); });
  }

  private reelect() {
    clearTimeout(this.reelectTimer);
    try { this.peer?.destroy(); } catch {}
    this.peer = null; this.hubConn = null;
    this.reelectTimer = setTimeout(() => this.connect(), 400 + Math.random() * 1000);
  }
}

export const peerService = new PeerService();
