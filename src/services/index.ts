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
  // One-time: auto-translate to English is now ON by default (it shipped briefly as
  // off). Flip existing installs once, then respect whatever the user sets after.
  if (!settings.autoTranslateInit) { settings.autoTranslate = true; settings.autoTranslateInit = true; }
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
  storage.pruneEphemeralPosts().catch(() => {});  // cap the RSS/Nostr cache so storage + ranking stay bounded
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
    // ONE unified timeline. Nostr streams live (nostrService.start below); RSS /
    // Reddit / YouTube / podcasts are pulled client-side here so they actually
    // mingle into the same feed — even when the always-on relay isn't seeding
    // them over Gun. Fetching is distributed + throttled (per-feed 1-hour TTL
    // shared via Gun), so this only pulls feeds nobody has refreshed recently.
    // seedDefaults first so the refresh uses the default topic subscriptions.
    rssService.seedDefaults().then(() => rssService.refresh()).catch(() => {});
    setInterval(() => rssService.refresh().catch(() => {}), 15 * 60 * 1000); // keep new stories flowing in
    changelogService.refresh().catch(() => {}); // repo commits → timeline activity
    if (settings.showFactChecks) factCheckService.refresh().catch(() => {}); // PolitiFact index
    if (settings.nostrEnabled !== false) nostrService.start().catch(() => {}); // stream Nostr notes for your topics
    setInterval(() => storage.pruneEphemeralPosts().catch(() => {}), 10 * 60 * 1000); // keep the RSS/Nostr cache bounded during long sessions
  }
  return { onboarded: !!me, settings };
}

/** Called right after onboarding finishes (identity just created). */
export async function onOnboarded() {
  await communityService.seedDefaults();
  gunService.start();
  peerService.start();
  rssService.seedDefaults().then(() => rssService.refresh()).catch(() => {}); // pull RSS/Reddit into the unified timeline
  setInterval(() => rssService.refresh().catch(() => {}), 15 * 60 * 1000);
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
