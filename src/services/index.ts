// ============================================================
//  services/index.ts — composition root. Boots every service in
//  the right order, seeds first-run demo content, and brings the
//  P2P layer online. Import { boot } once from the app entry.
// ============================================================
import { storage, DEFAULT_SETTINGS } from "./storage";
import { identityService } from "./identityService";
import { feedService } from "./feedService";
import { companionService } from "./companionService";
import { communityService } from "./communityService";
import { presenceService } from "./presenceService";
import { peerService } from "./peerService";
import type { AppSettings, Post } from "@/types";
import { embed } from "@/lib/embeddings";
import { newId } from "@/lib/id";

export interface BootResult { onboarded: boolean; settings: AppSettings }

export async function boot(): Promise<BootResult> {
  const settings = (await storage.loadSettings()) ?? DEFAULT_SETTINGS;
  await storage.saveSettings(settings);

  await feedService.init();
  const me = await identityService.load();
  companionService.configure(settings.companionPersona, settings.useWebLLM);

  if (me) {
    presenceService.setStatus(settings.presenceStatus);
    await communityService.seedDefaults();
    await seedDemoFeed();
    peerService.start();
  }

  return { onboarded: !!me, settings };
}

/** Called right after onboarding finishes (identity just created). */
export async function onOnboarded() {
  await communityService.seedDefaults();
  await seedDemoFeed();
  peerService.start();
}

const DEMO = [
  { name: "NovaPilot", text: "shipped a fully on-device feed ranker today — embeddings + cosine, zero servers. the browser is a supercomputer #ai #webgpu", tags: ["ai", "webgpu"], reactions: 7 },
  { name: "LunarSage", text: "hosting a synthwave listen-together room at 9pm. same track, same timestamp, everyone vibing #synthwave #music", tags: ["synthwave", "music"], reactions: 12 },
  { name: "CipherWolf", text: "your identity should be a file you own, not a row in someone's database. exported mine to a USB stick today #decentralization", tags: ["decentralization", "identity"], reactions: 9 },
  { name: "PixelOracle", text: "p2p chess works! no game server, just two browsers and webRTC. who wants a match? ♟️ #games #p2p", tags: ["games", "p2p"], reactions: 5 },
  { name: "EchoNomad", text: "reputation > follower counts. earned 'Helpful' for answering 3 questions in AI Lab. feels better than a like #reputation", tags: ["reputation"], reactions: 8 },
  { name: "ZenComet", text: "offline-first means i drafted this on the subway and it posted when i resurfaced. service workers are magic #offline", tags: ["offline"], reactions: 6 },
  { name: "FluxRaven", text: "the AI companion summarized my whole feed in one line and flagged a sketchy 'miracle cure' post. local moderation is underrated #ai", tags: ["ai", "moderation"], reactions: 11 },
  { name: "AstroSpark", text: "glassmorphism + animated gradients + a dash of blade runner = the dashboard i always wanted #design #ui", tags: ["design", "ui"], reactions: 4 },
];

async function seedDemoFeed() {
  if ((await storage.allPosts()).length > 0) return;
  let t = Date.now();
  for (const d of DEMO) {
    t -= 1000 * 60 * (15 + Math.random() * 90);
    const reactions: Record<string, string[]> = {};
    const pool = ["⭐", "🔥", "🚀", "💜"];
    let left = d.reactions;
    for (const e of pool) { const n = Math.min(left, Math.ceil(Math.random() * 4)); if (n > 0) reactions[e] = Array.from({ length: n }, (_, i) => `demo_${e}_${i}`); left -= n; }
    const post: Post = {
      id: newId("post"),
      author: "demo_" + d.name,
      authorName: d.name,
      kind: "text",
      text: d.text,
      tags: d.tags,
      createdAt: t,
      reactions,
      embedding: embed(d.text + " " + d.tags.join(" ")),
      source: "cache",
    };
    await storage.putPost(post);
  }
}
