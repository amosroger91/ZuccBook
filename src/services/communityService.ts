// ============================================================
//  communityService — subreddits / Discord-style servers / interest
//  groups. Each has channels (text, voice, stage, events). Stored
//  locally; membership + posts sync over the peer relay (Phase 2:
//  CRDT-merged community state).
// ============================================================
import type { Community, Channel } from "@/types";
import { storage } from "./storage";
import { identityService } from "./identityService";
import { newId } from "@/lib/id";

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
    };
    await storage.putCommunity(c);
    return c;
  }

  async join(id: string) {
    const all = await storage.communities();
    const c = all.find((x) => x.id === id);
    if (c && !c.members.includes(identityService.pk)) { c.members.push(identityService.pk); await storage.putCommunity(c); }
    return c;
  }

  async addChannel(id: string, name: string, kind: Channel["kind"]) {
    const all = await storage.communities();
    const c = all.find((x) => x.id === id);
    if (c) { c.channels.push({ id: newId("ch"), name, kind }); await storage.putCommunity(c); }
    return c;
  }

  async seedDefaults() {
    if ((await storage.communities()).length) return;
    const defaults = [
      { name: "Nebula HQ", description: "Announcements & meta about the platform itself", icon: "🌌" },
      { name: "AI Lab", description: "On-device models, embeddings, WebGPU experiments", icon: "🧠" },
      { name: "Synthwave", description: "Music, listen-together rooms, late-night vibes", icon: "🎧" },
      { name: "Tabletop", description: "Chess, poker, trivia — peer-to-peer game nights", icon: "♟️" },
    ];
    for (const d of defaults) await this.create({ ...d, visibility: "public" });
  }
}

export const communityService = new CommunityService();
