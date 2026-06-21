// ============================================================
//  audioPlayerService — a single <audio> element for mp3s shared on
//  the timeline. One track plays at a time; it keeps playing across
//  route changes and surfaces in the persistent bottom audio bar with
//  play/pause, seek and volume. Participates in the global media:play
//  exclusivity so starting it pauses radio / videos and vice-versa.
// ============================================================
import { bus } from "@/lib/events";

class AudioPlayerService {
  private el: HTMLAudioElement | null = null;
  current: { url: string; title: string; postId?: string } | null = null;
  playing = false;
  volume = 0.9;

  /** Pause when any other media source starts. Call once at boot. */
  init() {
    bus.on("media:play", ({ id }) => { if (id !== "music") this.pause(); });
  }

  private ensure(): HTMLAudioElement {
    if (!this.el) {
      const el = new Audio();
      el.preload = "metadata";
      el.volume = this.volume;
      el.addEventListener("play", () => { this.playing = true; this.emit(); bus.emit("media:play", { id: "music" }); });
      el.addEventListener("pause", () => { this.playing = false; this.emit(); });
      el.addEventListener("ended", () => { this.playing = false; this.emit(); });
      el.addEventListener("timeupdate", () => bus.emit("audio:time", { cur: el.currentTime, dur: el.duration || 0 }));
      this.el = el;
    }
    return this.el;
  }

  play(track: { url: string; title: string; postId?: string }) {
    const el = this.ensure();
    if (this.current?.url !== track.url) { el.src = track.url; this.current = track; }
    bus.emit("media:play", { id: "music" }); // stop other media
    el.play().catch(() => {});
  }
  toggle() {
    const el = this.ensure();
    if (el.paused) { bus.emit("media:play", { id: "music" }); el.play().catch(() => {}); }
    else el.pause();
  }
  pause() { if (this.el && !this.el.paused) this.el.pause(); }
  stop() { if (this.el) { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); } this.current = null; this.playing = false; this.emit(); }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); if (this.el) this.el.volume = this.volume; }
  seekFrac(frac: number) { const el = this.el; if (el && el.duration) el.currentTime = Math.max(0, Math.min(1, frac)) * el.duration; }
  isCurrent(url: string) { return this.current?.url === url; }

  private emit() { bus.emit("audio:now", { title: this.current?.title ?? null, playing: this.playing, url: this.current?.url ?? null }); }
}

export const audioPlayerService = new AudioPlayerService();
