// ============================================================
//  events.ts — a tiny typed event bus. The whole app is event
//  driven: services emit, the UI and other services subscribe.
//  Decouples the service layer from React entirely.
// ============================================================
import type { Post, ChatMessage, RichPresence, ListenRoom } from "@/types";

export interface ZuccBookEvents {
  "identity:ready": { pk: string };
  "feed:post": Post;
  "feed:updated": void;
  "feed:react-out": { postId: string; emoji: string };
  "notify": { text: string };
  "chat:message": ChatMessage;
  "chat:typing": { channel: string; pk: string };
  "presence:update": RichPresence;
  "peer:open": { id: string };
  "peer:connected": { pk: string };
  "peer:disconnected": { pk: string };
  "listen:state": ListenRoom;
  "listen:now": { station: { name: string; genre: string; url: string } | null; playing: boolean };
  "companion:thinking": boolean;
  "rss:refreshing": boolean;
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
