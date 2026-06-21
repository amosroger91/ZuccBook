// ============================================================
//  communityService — subreddits / Discord-style servers / interest
//  groups. Each has channels (text, voice, stage, events). Stored
//  locally; membership + posts sync over the peer relay (Phase 2:
//  CRDT-merged community state).
// ============================================================
import type { Community, Channel, CommunityValues, CommunityPhilosophy } from "@/types";
import { storage } from "./storage";
import { identityService } from "./identityService";
import { newId } from "@/lib/id";

// Each community's moderation philosophy — adapts the agent, not a global rule.
export const PHILOSOPHY_PRESETS: Record<CommunityPhilosophy, CommunityValues> = {
  professional: { philosophy: "professional", strictness: 0.9, allowProfanity: false, focus: ["spam", "scam"] },
  casual: { philosophy: "casual", strictness: 0.4, allowProfanity: true, focus: ["scam"] },        // e.g. gaming: casual language ok, watch harassment
  faith: { philosophy: "faith", strictness: 0.7, allowProfanity: false, focus: ["toxic", "nsfw"] },
  open: { philosophy: "open", strictness: 0.3, allowProfanity: true, focus: [] },
  custom: { philosophy: "custom", strictness: 0.6, allowProfanity: true, focus: [] },
};

class CommunityService {
  async list(): Promise<Community[]> { return storage.communities(); }

  async create(input: { name: string; description: string; icon?: string; visibility?: Community["visibility"] }): Promise<Community> {
    const me = identityService.pk;
    const c: Community = {
      id: newId("c"),
      name: input.name,
      description: input.description,
      icon: input.icon ?? "🌐",
      visibility: input.visibility ?? "public",
      channels: [
        { id: newId("ch"), name: "general", kind: "text" },
        { id: newId("ch"), name: "voice", kind: "voice" },
        { id: newId("ch"), name: "events", kind: "events" },
      ],
      members: [me],
      moderators: [me],
      createdAt: Date.now(),
      owner: me,
      values: PHILOSOPHY_PRESETS.open,
    };
    await storage.putCommunity(c);
    return c;
  }

  async setPhilosophy(id: string, philosophy: CommunityPhilosophy) {
    const all = await storage.communities();
    const c = all.find((x) => x.id === id);
    if (c) { c.values = PHILOSOPHY_PRESETS[philosophy]; await storage.putCommunity(c); }
    return c;
  }

  async join(id: string) {
    const all = await storage.communities();
    const c = all.find((x) => x.id === id);
    if (c && !c.members.includes(identityService.pk)) { c.members.push(identityService.pk); await storage.putCommunity(c); }
    return c;
  }

  async leave(id: string) {
    const all = await storage.communities();
    const c = all.find((x) => x.id === id);
    if (c) { c.members = c.members.filter((m) => m !== identityService.pk); await storage.putCommunity(c); }
    return c;
  }

  async update(id: string, fields: Partial<Pick<Community, "name" | "description" | "icon" | "visibility">>) {
    const all = await storage.communities();
    const c = all.find((x) => x.id === id);
    if (c) { Object.assign(c, fields); await storage.putCommunity(c); }
    return c;
  }

  async remove(id: string) { await storage.deleteCommunity(id); }

  async addChannel(id: string, name: string, kind: Channel["kind"]) {
    const all = await storage.communities();
    const c = all.find((x) => x.id === id);
    if (c) { c.channels.push({ id: newId("ch"), name, kind }); await storage.putCommunity(c); }
    return c;
  }

  async seedDefaults() {
    if ((await storage.communities()).length) return;
    const defaults = [
      { name: "ZuccBook HQ", description: "Announcements & meta about the platform itself", icon: "🌌" },
      { name: "AI Lab", description: "On-device models, embeddings, WebGPU experiments", icon: "🧠" },
      { name: "Synthwave", description: "Music, listen-together rooms, late-night vibes", icon: "🎧" },
      { name: "Tabletop", description: "Chess, poker, trivia — peer-to-peer game nights", icon: "♟️" },
    ];
    for (const d of defaults) await this.create({ ...d, visibility: "public" });
  }
}

export const communityService = new CommunityService();
