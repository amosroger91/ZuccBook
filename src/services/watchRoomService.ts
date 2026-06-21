// ============================================================
//  watchRoomService — tracks which "Watch with friends" room you're
//  in. Rooms work like chatrooms: one big public Lobby, named public
//  rooms anyone can join, and private rooms (priv:*) shared by name.
//  Watch-party sync messages are scoped to a room id so different
//  rooms watch different things at the same time.
// ============================================================
import { bus } from "@/lib/events";

export const LOBBY = "lobby";
export const isPrivate = (room: string) => room.startsWith("priv:");
export const roomLabel = (room: string) => (room === LOBBY ? "Public Lobby" : isPrivate(room) ? room.slice(5) : room);

class WatchRoomService {
  current: string = LOBBY;
  /** Switch rooms. Pass a bare name for public, or makePrivate(name) for private. */
  set(room: string) { if (room && room !== this.current) { this.current = room; bus.emit("watchroom:change", room); } }
  makePrivate(name: string) { return "priv:" + name.trim().toLowerCase().replace(/\s+/g, "-"); }
  makePublic(name: string) { return name.trim().toLowerCase().replace(/\s+/g, "-"); }
  /** A stable room id for watching a specific shared video together. */
  forVideo(videoId: string) { return `watch-${videoId}`; }
}

export const watchRoomService = new WatchRoomService();
