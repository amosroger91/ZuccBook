// ============================================================
//  profileService — public, shareable profiles. Assembles your
//  profile (identity + reputation + joined communities + custom
//  HTML/header/location) and syncs it to others via Gun, so anyone
//  can click your name and view your page. Holds a cache of peers'
//  profiles received from the graph.
// ============================================================
import type { Profile } from "@/types";
import { bus } from "@/lib/events";
import { signProfile, profileIsAuthentic } from "@/lib/records";
import { identityService } from "./identityService";
import { reputationService } from "./reputationService";
import { communityService } from "./communityService";
import { walletService } from "./walletService";

const cache = new Map<string, Profile>();

class ProfileService {
  get(pk: string): Profile | null { return cache.get(pk) ?? null; }

  /** A profile arrived from the graph (Gun). Verify the signature before
   *  caching it — otherwise anyone could publish a profile under your pk and
   *  change the name/avatar/wallet address others see for you. */
  async ingest(p: Profile) {
    if (!p || !p.pk) return;
    const prev = cache.get(p.pk);
    if (prev && (prev.updatedAt ?? 0) >= (p.updatedAt ?? 0)) return;
    if (!(await profileIsAuthentic(p))) return;
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
    let walletAddress: string | undefined;
    try { walletAddress = await walletService.address(); } catch {}
    return {
      walletAddress,
      pk: me.publicKey,
      username: me.username,
      avatar: me.avatar || undefined,
      header: me.header || undefined,
      bio: me.bio || undefined,
      quote: me.quote || undefined,
      html: me.html || undefined,
      location: me.location || undefined,
      website: me.website || undefined,
      email: me.email || undefined,
      phone: me.phone || undefined,
      badges: me.badges ?? [],
      reputation,
      communities,
      updatedAt: Date.now(),
    };
  }

  /** Publish my profile to the graph + local cache (signed, so peers can verify it). */
  async publishSelf() {
    const p = await this.buildSelf();
    if (!p) return;
    const me = identityService.current;
    if (me) await signProfile(p, me.privateKeyJwk);
    cache.set(p.pk, p);
    bus.emit("profile:publish", p);
  }
}

export const profileService = new ProfileService();
