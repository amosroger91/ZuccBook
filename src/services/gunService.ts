// ============================================================
//  gunService — durable, cross-user persistence + sync via Gun.js,
//  a decentralized graph DB that syncs over public relay peers.
//
//  This is what makes posts (human AND RSS-Bot) and the public Swarm
//  Lounge actually persist and reach people who weren't online when
//  they were created — beyond the ephemeral live PeerJS relay and the
//  device-local IndexedDB. Records are stored as JSON blobs keyed by
//  id (Gun graphs don't love arrays), so reactions/replies ride along.
//
//  Private data (DMs, named chatrooms) is deliberately NOT put on the
//  public graph.
// ============================================================
// @ts-ignore — gun ships no/loose types; treat as any.
import Gun from "gun";
import { bus } from "@/lib/events";
import { feedService } from "./feedService";
import { profileService } from "./profileService";
import { storage } from "./storage";
import type { ChatMessage, Post, Profile } from "@/types";

// Public Gun relay peers (best-effort; Gun also keeps a local copy and
// reconciles when a relay is reachable).
const PEERS = [
  "https://gun-manhattan.herokuapp.com/gun",
  "https://peer.wallie.io/gun",
  "https://relay.peer.ooo/gun",
];
const ROOT = "zuccbook-v1";

let gun: any = null;
let started = false;
const seenSwarm = new Set<string>();

class GunService {
  start() {
    if (started) return;
    started = true;
    // Everything here is best-effort: Gun must never be able to block the app.
    try {
      gun = (Gun as any)({ peers: PEERS, localStorage: false });

      // Incoming feed posts (human + bot) → absorb (dedupe + merge reactions).
      gun.get(ROOT).get("posts").map().on((d: any) => {
        if (d?.json) { try { feedService.absorb(JSON.parse(d.json)); } catch {} }
      });
      // Incoming Swarm Lounge messages → store + surface.
      gun.get(ROOT).get("swarm").map().on((d: any) => {
        if (!d?.json) return;
        try {
          const m: ChatMessage = JSON.parse(d.json);
          if (!m.id || seenSwarm.has(m.id)) return;
          seenSwarm.add(m.id);
          storage.putMessage(m);
          bus.emit("chat:message", m);
        } catch {}
      });

      // Incoming public profiles → cache for viewing others' pages.
      gun.get(ROOT).get("profiles").map().on((d: any) => {
        if (d?.json) { try { profileService.ingest(JSON.parse(d.json) as Profile); } catch {} }
      });

      // Outgoing: publish whatever the app marks for persistence.
      bus.on("post:publish", (p) => this.putPost(p));
      bus.on("swarm:publish", (m) => { seenSwarm.add(m.id); this.putSwarm(m); });
      bus.on("profile:publish", (p) => { try { gun?.get(ROOT).get("profiles").get(p.pk).put({ json: JSON.stringify(p) }); } catch {} });
    } catch (e) {
      console.warn("[gun] disabled (init failed)", e);
      gun = null;
    }
  }

  putPost(p: Post) { try { gun?.get(ROOT).get("posts").get(p.id).put({ json: JSON.stringify(p) }); } catch {} }
  putSwarm(m: ChatMessage) { try { gun?.get(ROOT).get("swarm").get(m.id).put({ json: JSON.stringify(m) }); } catch {} }
}

export const gunService = new GunService();
