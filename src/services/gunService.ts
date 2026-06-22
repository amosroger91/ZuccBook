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
import { marketplaceService } from "./marketplaceService";
import { trustService } from "./trustService";
import { storage } from "./storage";
import type { ChatMessage, Post, Profile, Listing, TrustEdge } from "@/types";

// Public Gun relay peers (best-effort; Gun also keeps a local copy and
// reconciles when a relay is reachable).
const PEERS = [
  "https://gun-manhattan.herokuapp.com/gun",
  "https://peer.wallie.io/gun",
  "https://relay.peer.ooo/gun",
  // Ledger's own always-on relay (Apache -> ledger-server container): durable
  // 24/7 persistence + it seeds the global feed with server-aggregated RSS.
  "https://ledger.wellspringstudiollc.com/gun",
];
// Frozen graph namespace — NOT brand text. This is the shared Gun root every
// peer (and the relay backend) reads/writes; renaming it forks the entire
// decentralized graph and orphans all existing data. Kept through the Ledger
// rebrand and must match the backend's GUN_ROOT.
const ROOT = "zuccbook-v1";

let gun: any = null;
let started = false;
const seenSwarm = new Set<string>();
const rssLedger = new Map<string, number>(); // feedKey → last-fetched epoch (shared across everyone)

class GunService {
  /** When was this feed last fetched by ANYONE (per the shared ledger)? */
  rssLastFetch(key: string): number { return rssLedger.get(key) ?? 0; }
  /** Claim that we just fetched this feed, so others skip it for the next hour. */
  markRssFetched(key: string) {
    const at = Date.now();
    rssLedger.set(key, at);
    try { gun?.get(ROOT).get("rssfetch").get(key).put({ at }); } catch {}
  }

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
      // Incoming marketplace listings.
      gun.get(ROOT).get("market").map().on((d: any) => {
        if (d?.json) { try { marketplaceService.ingest(JSON.parse(d.json) as Listing); } catch {} }
      });
      // Incoming web-of-trust edges.
      gun.get(ROOT).get("trust").map().on((d: any) => {
        if (d?.json) { try { trustService.ingest(JSON.parse(d.json) as TrustEdge); } catch {} }
      });
      // Shared RSS fetch ledger — who fetched which feed, and when, so the work
      // is distributed: each feed is pulled once an hour by whoever refreshes first.
      gun.get(ROOT).get("rssfetch").map().on((d: any, key: string) => {
        if (d && typeof d.at === "number" && d.at > (rssLedger.get(key) ?? 0)) rssLedger.set(key, d.at);
      });

      // Outgoing: publish whatever the app marks for persistence.
      bus.on("post:publish", (p) => this.putPost(p));
      bus.on("swarm:publish", (m) => { seenSwarm.add(m.id); this.putSwarm(m); });
      bus.on("profile:publish", (p) => { try { gun?.get(ROOT).get("profiles").get(p.pk).put({ json: JSON.stringify(p) }); } catch {} });
      bus.on("market:publish", (l) => { try { gun?.get(ROOT).get("market").get(l.id).put({ json: JSON.stringify(l) }); } catch {} });
      bus.on("trust:publish", (e) => { try { gun?.get(ROOT).get("trust").get(`${e.from}|${e.to}|${e.community ?? ""}`).put({ json: JSON.stringify(e) }); } catch {} });
    } catch (e) {
      console.warn("[gun] disabled (init failed)", e);
      gun = null;
    }
  }

  putPost(p: Post) { try { gun?.get(ROOT).get("posts").get(p.id).put({ json: JSON.stringify(p) }); } catch {} }
  putSwarm(m: ChatMessage) { try { gun?.get(ROOT).get("swarm").get(m.id).put({ json: JSON.stringify(m) }); } catch {} }
}

export const gunService = new GunService();
