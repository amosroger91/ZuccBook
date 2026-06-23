// ============================================================
//  profileService — public, shareable profiles. Assembles your
//  profile (identity + reputation + joined communities + custom
//  HTML/header/location) and syncs it to others via Gun, so anyone
//  can click your name and view your page. Holds a cache of peers'
//  profiles received from the graph.
// ============================================================
import type { Profile, Post } from "@/types";
import { bus } from "@/lib/events";
import { signProfile, profileIsAuthentic } from "@/lib/records";
import { identityService } from "./identityService";
import { reputationService } from "./reputationService";
import { communityService } from "./communityService";
import { walletService } from "./walletService";
import { storage } from "./storage";

const cache = new Map<string, Profile>();

/** Drop oversized inline fields (a big base64 header/html) before a profile goes on
 *  the graph — those choke Gun and stall every peer that ingests them. Small profiles
 *  pass through untouched; the full version stays in the owner's local cache. */
function slimForGraph(p: Profile): Profile {
  if (JSON.stringify(p).length <= 50000) return p;
  let slim: Profile = { ...p, header: undefined, html: undefined };
  if (JSON.stringify(slim).length > 50000) slim = { ...slim, avatar: undefined };
  return slim;
}

class ProfileService {
  get(pk: string): Profile | null { return cache.get(pk) ?? null; }

  /** Ask the graph for a peer's full profile ON DEMAND (when you open their page) —
   *  profiles aren't streamed eagerly anymore (that froze boot). It arrives async via
   *  profile:update; until then the cached/snapshot view shows. */
  request(pk: string) {
    if (pk && pk !== identityService.pk) bus.emit("profile:request", pk);
  }

  /** Warm the in-memory cache from the durable store at boot, so peers' pages
   *  render instantly and work offline (before/without a fresh Gun sync). */
  async loadCache() {
    try { for (const p of await storage.allProfiles()) if (!cache.has(p.pk)) cache.set(p.pk, p); } catch {}
  }

  /** A profile arrived from the graph (Gun). Verify the signature before
   *  caching it — otherwise anyone could publish a profile under your pk and
   *  change the name/avatar/wallet address others see for you. Cached to
   *  IndexedDB too, so it persists across reloads and offline sessions. */
  async ingest(p: Profile) {
    if (!p || !p.pk) return;
    const prev = cache.get(p.pk);
    if (prev && (prev.updatedAt ?? 0) >= (p.updatedAt ?? 0)) return;
    if (!(await profileIsAuthentic(p))) return;
    cache.set(p.pk, p);
    storage.putProfile(p);
    bus.emit("profile:update", p);
  }

  /** Best-effort profile when none has synced: a verified-but-cached one from
   *  the durable store, else a lightweight SNAPSHOT reconstructed from the
   *  name/avatar denormalized on the person's posts. Lets you view someone's
   *  page from their posts alone, even if they've never been online with you. */
  async snapshot(pk: string): Promise<Profile | null> {
    const stored = await storage.getProfile(pk);
    if (stored) { if (!cache.has(pk)) cache.set(pk, stored); return stored; }
    let posts: Post[] = [];
    try { posts = await storage.postsByAuthor(pk); } catch {}
    if (!posts.length) return null;
    const latest = posts.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    return {
      pk,
      username: latest.authorName || "Someone",
      avatar: latest.authorAvatar || undefined,
      badges: [],
      reputation: 0,
      communities: [],
      updatedAt: 0,   // 0 marks this as a non-authoritative snapshot
    };
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
    storage.putProfile(p);          // local cache/store keeps your FULL profile (your own view)
    // Publish a SLIM copy to the graph. A profile node carrying a large inline image
    // (a 110KB base64 header) chokes Gun's sync and stalls every peer that ingests it —
    // that was the second feed-freeze. Strip the heavy fields and re-sign the slim copy
    // so it still verifies; your full profile stays on this device. (Big images should
    // travel as media refs, not inline — TODO.)
    const slim = slimForGraph(p);
    if (me && slim !== p) await signProfile(slim, me.privateKeyJwk);
    bus.emit("profile:publish", slim);
  }
}

export const profileService = new ProfileService();
