// ============================================================
//  events.ts — a tiny typed event bus. The whole app is event
//  driven: services emit, the UI and other services subscribe.
//  Decouples the service layer from React entirely.
// ============================================================
import type { Post, ChatMessage, RichPresence, ListenRoom } from "@/types";

export interface NebulaEvents {
  "identity:ready": { pk: string };
  "feed:post": Post;
  "feed:updated": void;
  "chat:message": ChatMessage;
  "chat:typing": { channel: string; pk: string };
  "presence:update": RichPresence;
  "peer:open": { id: string };
  "peer:connected": { pk: string };
  "peer:disconnected": { pk: string };
  "listen:state": ListenRoom;
  "companion:thinking": boolean;
  "toast": { kind: "info" | "success" | "warn" | "error"; message: string };
}

type Handler<T> = (payload: T) => void;

class Bus {
  private map = new Map<keyof NebulaEvents, Set<Handler<any>>>();

  on<K extends keyof NebulaEvents>(evt: K, fn: Handler<NebulaEvents[K]>): () => void {
    let set = this.map.get(evt);
    if (!set) { set = new Set(); this.map.set(evt, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof NebulaEvents>(evt: K, payload: NebulaEvents[K]): void {
    const set = this.map.get(evt);
    if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error("[bus]", evt, e); } }
  }
}

export const bus = new Bus();

/** Convenience for the common toast event. */
export const toast = (message: string, kind: NebulaEvents["toast"]["kind"] = "info") =>
  bus.emit("toast", { kind, message });
