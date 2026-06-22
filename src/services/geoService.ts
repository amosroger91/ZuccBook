// ============================================================
//  geoService — a single, coarse location for the network world-map.
//  Privacy-first:
//   • Used ONLY to place an anonymous dot on the node map.
//   • Coarsened to ~0.1° (~11 km) before it's ever stored or shared.
//   • GPS is opt-in (we ask once, scoped to the map). Without it we
//     fall back to an IP-based guess so the map isn't empty.
//  The chosen location rides along on presence (presenceService),
//  so peers render it on their map too.
// ============================================================
import { presenceService } from "./presenceService";

export interface Geo { lat: number; lon: number; source: "gps" | "ip"; at: number }

const KEY = "ledger:geo";
const ASK_KEY = "ledger:geoAsked";
// Round to ~11 km so we never store or broadcast a precise position.
const coarse = (n: number) => Math.round(n * 10) / 10;

class GeoService {
  private geo: Geo | null = null;

  current(): Geo | null { return this.geo; }
  asked(): boolean { try { return localStorage.getItem(ASK_KEY) === "1"; } catch { return false; } }
  markAsked() { try { localStorage.setItem(ASK_KEY, "1"); } catch {} }

  private apply(g: Geo) {
    this.geo = g;
    try { localStorage.setItem(KEY, JSON.stringify(g)); } catch {}
    presenceService.setGeo({ lat: g.lat, lon: g.lon, source: g.source });
  }

  /** Load any cached location; if none, fall back to a coarse IP-based guess
   *  (no permission needed). Called once at boot so you appear on the map. */
  async init() {
    try {
      const r = localStorage.getItem(KEY);
      if (r) { const g = JSON.parse(r) as Geo; this.apply(g); }
    } catch {}
    if (!this.geo) await this.ipLocate();
  }

  /** Approximate location from IP (third-party lookup, CORS-friendly, no key). */
  async ipLocate(): Promise<boolean> {
    if (this.geo?.source === "gps") return true; // never downgrade a real fix
    for (const url of ["https://ipwho.is/", "https://ipapi.co/json/"]) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const j: any = await r.json();
        const lat = Number(j.latitude), lon = Number(j.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
          this.apply({ lat: coarse(lat), lon: coarse(lon), source: "ip", at: Date.now() });
          return true;
        }
      } catch {}
    }
    return false;
  }

  /** Ask the browser for precise location (shows the OS permission prompt).
   *  We immediately coarsen it — we only ever keep a ~11 km approximation. */
  requestPrecise(): Promise<boolean> {
    this.markAsked();
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve(false);
      navigator.geolocation.getCurrentPosition(
        (pos) => { this.apply({ lat: coarse(pos.coords.latitude), lon: coarse(pos.coords.longitude), source: "gps", at: Date.now() }); resolve(true); },
        () => resolve(false),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
      );
    });
  }
}

export const geoService = new GeoService();
