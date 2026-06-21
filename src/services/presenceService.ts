// ============================================================
//  presenceService — rich presence (Discord / Xbox Live style).
//  Holds my own status+activity and a roster of peers seen on the
//  network. The actual wire transport is peerService; this service
//  is the source of truth the UI renders.
// ============================================================
import type { PresenceStatus, RichPresence } from "@/types";
import { bus } from "@/lib/events";
import { identityService } from "./identityService";

class PresenceService {
  private roster = new Map<string, RichPresence>();
  private status: PresenceStatus = "online";
  private activity?: RichPresence["activity"];

  setStatus(s: PresenceStatus) { this.status = s; this.announceSelf(); }
  setActivity(kind: string, detail: string) {
    this.activity = { kind, detail, since: Date.now() };
    this.announceSelf();
  }
  clearActivity() { this.activity = undefined; this.announceSelf(); }

  self(): RichPresence {
    const me = identityService.current;
    return {
      pk: me?.publicKey ?? "",
      username: me?.username ?? "You",
      status: this.status,
      activity: this.activity,
      lastSeen: Date.now(),
    };
  }

  /** Apply a presence update received from a peer. */
  ingest(p: RichPresence) {
    if (!p.pk || p.pk === identityService.pk) return;
    this.roster.set(p.pk, { ...p, lastSeen: Date.now() });
    bus.emit("presence:update", p);
  }
  remove(pk: string) {
    const cur = this.roster.get(pk);
    if (cur) { cur.status = "offline"; bus.emit("presence:update", cur); }
    this.roster.delete(pk);
  }

  list(): RichPresence[] {
    const now = Date.now();
    return [...this.roster.values()].filter((p) => now - p.lastSeen < 120000);
  }

  // peerService calls this to actually transmit
  private announce?: (p: RichPresence) => void;
  bindTransport(fn: (p: RichPresence) => void) { this.announce = fn; }
  announceSelf() { this.announce?.(this.self()); }
}

export const presenceService = new PresenceService();
