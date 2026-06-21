// ============================================================
//  listenTogetherService — synchronized media rooms (the flagship
//  "Spotify Jam + Discord Voice + Watch Party"). Fetches free,
//  CORS-friendly HTTPS internet-radio stations and plays one in a
//  shared room; the host's playback position is the clock, synced
//  to members over the peer relay (Phase 2). Local playback works
//  standalone today.
// ============================================================
const MIRRORS = [
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://fr1.api.radio-browser.info",
];
const GENRES = ["lofi", "jazz", "synthwave", "classical", "rock", "country", "electronic", "ambient"];

export interface Station { name: string; url: string; genre: string; bitrate: number; }

let base: string | null = null;
let audio: HTMLAudioElement | null = null;
let volume = 0.6;

async function apiGet(path: string): Promise<any> {
  const order = base ? [base, ...MIRRORS.filter((m) => m !== base)] : MIRRORS;
  for (const m of order) {
    try { const r = await fetch(m + path, { cache: "no-store" }); if (r.ok) { base = m; return r.json(); } } catch {}
  }
  throw new Error("Radio directory unreachable");
}

class ListenTogetherService {
  async stations(): Promise<Station[]> {
    const lists = await Promise.all(GENRES.map(async (g) => {
      try {
        const arr = await apiGet(`/json/stations/search?tag=${encodeURIComponent(g)}&order=votes&reverse=true&hidebroken=true&limit=5`);
        return (arr as any[])
          .filter((s) => s.url_resolved?.startsWith("https://"))
          .slice(0, 2)
          .map((s) => ({ name: (s.name || "Unknown").trim().slice(0, 40), url: s.url_resolved, genre: g, bitrate: s.bitrate || 0 }));
      } catch { return []; }
    }));
    const seen = new Set<string>();
    return lists.flat().filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
  }

  async play(url: string): Promise<boolean> {
    this.stop();
    audio = new Audio(url); audio.volume = volume;
    try { await audio.play(); return true; } catch { return false; }
  }
  stop() { if (audio) { try { audio.pause(); } catch {} audio.src = ""; audio = null; } }
  setVolume(v: number) { volume = Math.max(0, Math.min(1, v)); if (audio) audio.volume = volume; }
  get volume() { return volume; }
  get playing() { return !!audio && !audio.paused; }
}

export const listenTogetherService = new ListenTogetherService();
