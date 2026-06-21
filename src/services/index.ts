// ============================================================
//  services/index.ts — composition root. Boots every service in
//  the right order and brings the P2P layer online. The feed is
//  intentionally empty until real posts arrive from you or peers —
//  no sample/AI-generated content is injected.
// ============================================================
import { storage, DEFAULT_SETTINGS } from "./storage";
import { identityService } from "./identityService";
import { feedService } from "./feedService";
import { companionService } from "./companionService";
import { communityService } from "./communityService";
import { presenceService } from "./presenceService";
import { peerService } from "./peerService";
import { rssService } from "./rssService";
import { gunService } from "./gunService";
import { profileService } from "./profileService";
import { trustService } from "./trustService";
import { bestModelForHardware, isWebGPU } from "./companionService";
import { audioPlayerService } from "./audioPlayerService";
import type { AppSettings } from "@/types";

export interface BootResult { onboarded: boolean; settings: AppSettings }

export async function boot(): Promise<BootResult> {
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
  await trustService.load();           // load my web-of-trust edges
  await purgeSeededPosts();            // remove demo posts left by earlier builds
  const me = await identityService.load();
  companionService.configure(settings.useWebLLM, settings.llmModel);
  // "Just download it" — start fetching the model immediately (best-effort,
  // cached by WebLLM after the first time). Progress shows in the UI.
  if (isWebGPU() && !settings.llmOptOut) companionService.preload().catch(() => {});

  if (me) {
    presenceService.setStatus(settings.presenceStatus);
    await communityService.seedDefaults();
    gunService.start();   // durable cross-user persistence + sync (posts, swarm, profiles)
    peerService.start();
    profileService.publishSelf().catch(() => {}); // share my public profile
    rssService.refresh().catch(() => {}); // fire-and-forget; throttled internally
    // Keep topping up while the app is open so new stories arrive during a
    // session; the service throttles actual fetches.
    setInterval(() => rssService.refresh().catch(() => {}), 6 * 60 * 1000);
  }
  return { onboarded: !!me, settings };
}

/** Called right after onboarding finishes (identity just created). */
export async function onOnboarded() {
  await communityService.seedDefaults();
  gunService.start();
  peerService.start();
}

// Earlier builds seeded sample posts; strip them so the feed only ever shows
// real content from you and other people on the network.
async function purgeSeededPosts() {
  for (const p of await storage.allPosts()) {
    if (p.author.startsWith("demo_") || p.source === "cache") await storage.deletePost(p.id);
  }
}
