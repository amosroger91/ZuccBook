// ============================================================
//  events.ts — a tiny typed event bus. The whole app is event
//  driven: services emit, the UI and other services subscribe.
//  Decouples the service layer from React entirely.
// ============================================================
import type { Post, ChatMessage, RichPresence, ListenRoom, WatchPartyState, Profile, Listing, TrustEdge, Alert } from "@/types";

export interface ZuccBookEvents {
  "identity:ready": { pk: string };
  "feed:post": Post;
  "feed:updated": void;
  "feed:react-out": { postId: string; emoji: string };
  "post:publish": Post;          // persist a post to the durable graph (Gun)
  "swarm:publish": ChatMessage;  // persist a Swarm Lounge message
  "profile:publish": Profile;    // persist/sync my public profile
  "profile:update": Profile;     // a peer's profile arrived
  "market:publish": Listing;     // persist/sync a marketplace listing
  "market:update": Listing;      // a listing arrived/changed
  "trust:publish": TrustEdge;    // share a web-of-trust edge
  "trust:update": TrustEdge;     // a trust edge arrived
  "notify": { text: string };
  "alert": { kind: Alert["kind"]; text: string; route: string; postId?: string };  // raise a clickable alert
  "alerts:updated": void;        // the alert list changed
  "focus:post": { postId: string };  // scroll to & highlight a post in the feed
  "chat:message": ChatMessage;
  "chat:typing": { channel: string; pk: string };
  "presence:update": RichPresence;
  "peer:open": { id: string };
  "peer:connected": { pk: string };
  "peer:disconnected": { pk: string };
  "listen:state": ListenRoom;
  "listen:now": { station: { name: string; genre: string; url: string } | null; playing: boolean };
  "stage:in": WatchPartyState;   // a watch-party update arrived from a peer
  "stage:out": WatchPartyState;  // local watch-party change to broadcast
  "watch:start": { videoId: string };  // start/replace the watch-party video (current room)
  "watchroom:change": string;           // you switched watch-with-friends rooms
  "feedvideo:play": { videoId: string; dockId: string };  // play a feed video in the global player
  "spotify:play": { embedUrl: string; dockId: string };   // play a Spotify embed in the global player
  "audio:now": { title: string | null; playing: boolean; url: string | null };  // shared mp3 player state
  "audio:time": { cur: number; dur: number };             // shared mp3 player progress
  "media:play": { id: string };         // some media started — others should pause
  "companion:thinking": boolean;
  "rss:refreshing": boolean;
  "factcheck:ready": void;       // PolitiFact index loaded — re-check posts
  "companion:model": { state: "loading" | "ready" | "error"; id: string; progress?: number; text?: string };
  "toast": { kind: "info" | "success" | "warn" | "error"; message: string };
}

type Handler<T> = (payload: T) => void;

class Bus {
  private map = new Map<keyof ZuccBookEvents, Set<Handler<any>>>();

  on<K extends keyof ZuccBookEvents>(evt: K, fn: Handler<ZuccBookEvents[K]>): () => void {
    let set = this.map.get(evt);
    if (!set) { set = new Set(); this.map.set(evt, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof ZuccBookEvents>(evt: K, payload: ZuccBookEvents[K]): void {
    const set = this.map.get(evt);
    if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error("[bus]", evt, e); } }
  }
}

export const bus = new Bus();

/** Convenience for the common toast event. */
export const toast = (message: string, kind: ZuccBookEvents["toast"]["kind"] = "info") =>
  bus.emit("toast", { kind, message });
