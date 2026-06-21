// ============================================================
//  profileService — public, shareable profiles. Assembles your
//  profile (identity + reputation + joined communities + custom
//  HTML/header/location) and syncs it to others via Gun, so anyone
//  can click your name and view your page. Holds a cache of peers'
//  profiles received from the graph.
// ============================================================
import type { Profile } from "@/types";
import { bus } from "@/lib/events";
import { identityService } from "./identityService";
import { reputationService } from "./reputationService";
import { communityService } from "./communityService";

const cache = new Map<string, Profile>();

class ProfileService {
  get(pk: string): Profile | null { return cache.get(pk) ?? null; }

  /** A profile arrived from the graph (Gun). */
  ingest(p: Profile) {
    if (!p || !p.pk) return;
    const prev = cache.get(p.pk);
    if (prev && (prev.updatedAt ?? 0) >= (p.updatedAt ?? 0)) return;
    cache.set(p.pk, p);
    bus.emit("profile:update", p);
  }

  async buildSelf(): Promise<Profile | null> {
    const me = identityService.current;
    if (!me) return null;
    const reputation = await reputationService.total();
    const communities = (await communityService.list())
      .filter((c) => c.members.includes(me.publicKey))
      .map((c) => c.name);
    return {
      pk: me.publicKey,
      username: me.username,
      avatar: me.avatar || undefined,
      header: me.header || undefined,
      bio: me.bio || undefined,
      html: me.html || undefined,
      location: me.location || undefined,
      badges: me.badges ?? [],
      reputation,
      communities,
      updatedAt: Date.now(),
    };
  }

  /** Publish my profile to the graph + local cache. */
  async publishSelf() {
    const p = await this.buildSelf();
    if (p) { cache.set(p.pk, p); bus.emit("profile:publish", p); }
  }
}

export const profileService = new ProfileService();
