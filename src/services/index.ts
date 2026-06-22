// ============================================================
//  services/index.ts — composition root. Boots every service in
//  the right order and brings the P2P layer online. The feed is
//  intentionally empty until real posts arrive from you or peers —
//  no sample/AI-generated content is injected.
// ============================================================
import { storage, DEFAULT_SETTINGS, requestPersistentStorage } from "./storage";
import { identityService } from "./identityService";
import { feedService } from "./feedService";
import { companionService } from "./companionService";
import { communityService } from "./communityService";
import { presenceService } from "./presenceService";
import { geoService } from "./geoService";
import { peerService } from "./peerService";
import { rssService } from "./rssService";
import { gunService } from "./gunService";
import { profileService } from "./profileService";
import { trustService } from "./trustService";
import { bestModelForHardware, isWebGPU } from "./companionService";
import { audioPlayerService } from "./audioPlayerService";
import { factCheckService } from "./factCheckService";
import { changelogService } from "./changelogService";
import { nostrService } from "./nostrService";
import { alertsService } from "./alertsService";
import type { AppSettings } from "@/types";

export interface BootResult { onboarded: boolean; settings: AppSettings }

export async function boot(): Promise<BootResult> {
  // Make storage durable so an installed PWA keeps you signed in across launches
  // (prevents the browser from evicting the IndexedDB that holds your identity).
  void requestPersistentStorage();
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(await storage.loadSettings()) };
  // Auto-enable the on-device LLM on WebGPU-capable devices (unless the user
  // explicitly opted out in Settings) — the model downloads automatically.
  if (typeof navigator !== "undefined" && (navigator as any).gpu && !settings.llmOptOut) {
    settings.useWebLLM = true;
  }
  // Hardware-aware auto-selection: until the user explicitly picks a model,
  // choose the best one this device can run, then download it on load.
  if (isWebGPU() && !settings.llmOptOut && settings.llmAuto !== false) {
    try {
      const best = await bestModelForHardware();
      if (best.id !== settings.llmModel) settings.llmModel = best.id;
    } catch { /* keep current model */ }
  }
  await storage.saveSettings(settings);

  await feedService.init();
  audioPlayerService.init();           // shared mp3 player joins media exclusivity
  await alertsService.load();          // notification center (clickable alerts)
  await factCheckService.loadLinks();  // restore user-linked PolitiFact fact-checks
  await trustService.load();           // load my web-of-trust edges
  await profileService.loadCache();    // warm cached peer profiles (viewable offline)
  await purgeSeededPosts();            // remove demo posts left by earlier builds
  const me = await identityService.load();
  companionService.configure(settings.useWebLLM, settings.llmModel);
  // "Just download it" — start fetching the model immediately (best-effort,
  // cached by WebLLM after the first time). Progress shows in the UI.
  if (isWebGPU() && !settings.llmOptOut) companionService.preload().catch(() => {});

  if (me) {
    presenceService.setStatus(settings.presenceStatus);
    geoService.init().catch(() => {}); // coarse location for the network map (cache → IP fallback)
    await communityService.seedDefaults();
    gunService.start();   // durable cross-user persistence + sync (posts, swarm, profiles)
    peerService.start();
    profileService.publishSelf().catch(() => {}); // share my public profile
    // RSS is now refreshed by the always-on relay — it pulls every topic in the
    // catalog every few minutes and seeds the global Gun feed, which we receive
    // over the peer connection. So clients do NOT fetch feeds on their own: we
    // only seed the default topic SUBSCRIPTIONS (for the Topics UI + the "For
    // You" filter). The sole client-side fetch is a manual "Refresh now" in
    // Topics, for when you want data fresher than the relay's last cycle.
    rssService.seedDefaults().catch(() => {});
    changelogService.refresh().catch(() => {}); // repo commits → timeline activity
    if (settings.showFactChecks) factCheckService.refresh().catch(() => {}); // PolitiFact index
    if (settings.nostrEnabled !== false) nostrService.start().catch(() => {}); // stream Nostr notes for your topics
  }
  return { onboarded: !!me, settings };
}

/** Called right after onboarding finishes (identity just created). */
export async function onOnboarded() {
  await communityService.seedDefaults();
  gunService.start();
  peerService.start();
  rssService.seedDefaults().catch(() => {}); // relay refreshes feeds for everyone; no client-side fetch
  changelogService.refresh().catch(() => {});
  nostrService.start().catch(() => {}); // stream Nostr notes (on by default for new accounts)
}

// Earlier builds seeded sample posts; strip them so the feed only ever shows
// real content from you and other people on the network.
async function purgeSeededPosts() {
  for (const p of await storage.allPosts()) {
    if (p.author.startsWith("demo_") || p.source === "cache") await storage.deletePost(p.id);
  }
}
