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

// The relay holds the entire global graph (the whole RSS catalog + every post), and
// Gun replays ALL of it on connect — 1K+ records/sec. Verifying + embedding + storing
// each one synchronously as it arrives pins the main thread (the app goes unresponsive).
// So we QUEUE incoming records and drain them in small batches that yield to the event
// loop between each, keeping the UI responsive no matter how big the firehose is.
const postQueue: string[] = [];
const seenPostJson = new Set<string>(); // skip exact re-fires (Gun re-emits a record on every touch)
let draining = false;
async function drainPostQueue() {
  if (draining) return;
  draining = true;
  try {
    while (postQueue.length) {
      const batch: Post[] = [];
      for (const j of postQueue.splice(0, 12)) {
        try { batch.push(JSON.parse(j)); } catch { /* skip malformed */ }
      }
      if (batch.length) { try { await feedService.absorbMany(batch); } catch { /* keep draining */ } }
      await new Promise((r) => setTimeout(r, 0)); // yield — let rendering + input run between batches
    }
  } finally { draining = false; }
}
function enqueuePost(json: string) {
  if (seenPostJson.has(json)) return;          // identical record already queued/processed
  seenPostJson.add(json);
  if (seenPostJson.size > 20000) seenPostJson.clear(); // bound memory on very long sessions
  postQueue.push(json);
  drainPostQueue();
}

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

      // Outgoing publish — register IMMEDIATELY so nothing you create in the first
      // few seconds (before the deferred incoming sync below) is ever lost.
      bus.on("post:publish", (p) => this.putPost(p));
      bus.on("swarm:publish", (m) => { seenSwarm.add(m.id); this.putSwarm(m); });
      bus.on("profile:publish", (p) => { try { gun?.get(ROOT).get("profiles").get(p.pk).put({ json: JSON.stringify(p) }); } catch {} });
      // Fetch ONE profile on demand (when you open someone's page) instead of streaming
      // all of them. The size guard skips an abusively-large node so a stray 110KB-header
      // profile can't stall the page either.
      bus.on("profile:request", (pk) => { try { gun?.get(ROOT).get("profiles").get(pk).once((d: any) => { if (d?.json && d.json.length <= 60000) { try { profileService.ingest(JSON.parse(d.json) as Profile); } catch {} } }); } catch {} });
      bus.on("market:publish", (l) => { try { gun?.get(ROOT).get("market").get(l.id).put({ json: JSON.stringify(l) }); } catch {} });
      bus.on("trust:publish", (e) => { try { gun?.get(ROOT).get("trust").get(`${e.from}|${e.to}|${e.community ?? ""}`).put({ json: JSON.stringify(e) }); } catch {} });

      // Incoming subscriptions replay the relay's ENTIRE graph on connect (Gun warns
      // "syncing 1K+ records a second") — processing that dump as it arrives is what
      // froze the initial load. So DEFER subscribing until the app has painted and
      // gone idle: the feed already fills from the local IndexedDB cache, and once
      // subscribed, posts batch in through the yielding queue (drainPostQueue) instead
      // of all at once. This is the difference between a usable first paint and a
      // frozen tab.
      const subscribeIncoming = () => {
        if (!gun) return;
        // Feed posts (human + bot) → queue, drained in yielding batches.
        gun.get(ROOT).get("posts").map().on((d: any) => { if (d?.json) enqueuePost(d.json); });
        // Swarm Lounge messages → store + surface.
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
        // Profiles are NOT streamed here. Eagerly pulling EVERY profile forced Gun to
        // merge every node on boot, and a single profile carrying a big inline image
        // (a 110KB base64 header) takes Gun ~2s to process — a handful of them pinned the
        // main thread and froze the feed. Profiles now load ON DEMAND (profile:request,
        // wired in start()) when you actually open someone's page.
        // Marketplace listings.
        gun.get(ROOT).get("market").map().on((d: any) => {
          if (d?.json) { try { marketplaceService.ingest(JSON.parse(d.json) as Listing); } catch {} }
        });
        // Web-of-trust edges.
        gun.get(ROOT).get("trust").map().on((d: any) => {
          if (d?.json) { try { trustService.ingest(JSON.parse(d.json) as TrustEdge); } catch {} }
        });
        // Shared RSS fetch ledger (distributes who pulls which feed each hour).
        gun.get(ROOT).get("rssfetch").map().on((d: any, key: string) => {
          if (d && typeof d.at === "number" && d.at > (rssLedger.get(key) ?? 0)) rssLedger.set(key, d.at);
        });
      };
      const ric = (globalThis as any).requestIdleCallback;
      if (typeof ric === "function") ric(subscribeIncoming, { timeout: 4000 });
      else setTimeout(subscribeIncoming, 2500);
    } catch (e) {
      console.warn("[gun] disabled (init failed)", e);
      gun = null;
    }
  }

  putPost(p: Post) { try { gun?.get(ROOT).get("posts").get(p.id).put({ json: JSON.stringify(p) }); } catch {} }
  putSwarm(m: ChatMessage) { try { gun?.get(ROOT).get("swarm").get(m.id).put({ json: JSON.stringify(m) }); } catch {} }
}

export const gunService = new GunService();
