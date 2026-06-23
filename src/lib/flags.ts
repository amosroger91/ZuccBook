// ============================================================
//  flags.ts — URL-driven feature kill switch for bisecting a
//  freeze. `?off=a,b,c` disables named subsystems so we can flip
//  layers off one at a time and find which one breaks the load,
//  WITHOUT a redeploy per test. `?off=all` disables everything
//  gated. Completely inert when `?off=` is absent.
//
//  Known flags (grep `isOff(`):
//    boot services: gun, peer, nostr, rss, changelog, factcheck,
//                   publish, prune, geo, communities
//    UI:            cards (feed PostCards), digest (sidebar),
//                   players (global media players), background
// ============================================================

const RAW =
  typeof location !== "undefined" ? new URLSearchParams(location.search).get("off") ?? "" : "";
const OFF = new Set(RAW.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

/** True when `?off=<name>` (or `?off=all`) disabled this subsystem. */
export function isOff(name: string): boolean {
  return OFF.has("all") || OFF.has(name);
}

export const ANY_OFF = OFF.size > 0;
