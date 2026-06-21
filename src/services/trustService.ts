// ============================================================
//  trustService — the web of trust. Directed edges (vouch/block/
//  mute/report), optionally community-scoped. Trust is contextual
//  and computed from *your* relationships + one hop ("do people I
//  trust vouch for this person?"), never a global score. Edges sync
//  over Gun so trust spreads through relationships, not an authority.
// ============================================================
import type { TrustEdge, TrustKind } from "@/types";
import { bus } from "@/lib/events";
import { signTrust, trustIsAuthentic } from "@/lib/records";
import { identityService } from "./identityService";
import { storage } from "./storage";

// All known edges (mine + peers'), keyed by `${from}|${to}|${community||""}`.
const edges = new Map<string, TrustEdge>();
let loaded = false;

function key(e: { from: string; to: string; community?: string }) { return `${e.from}|${e.to}|${e.community ?? ""}`; }

class TrustService {
  async load() {
    if (loaded) return;
    loaded = true;
    const mine = (await storage.kvGet<TrustEdge[]>("trust:mine")) ?? [];
    for (const e of mine) edges.set(key(e), e);
  }

  async ingest(e: TrustEdge) {
    if (!e || !e.from || !e.to) return;
    const k = key(e);
    const prev = edges.get(k);
    if (prev && prev.at >= e.at) return;
    if (!(await trustIsAuthentic(e))) return;   // can't forge someone else's vouch/block
    edges.set(k, e);
    bus.emit("trust:update", e);
  }

  private async persistMine() {
    const me = identityService.pk;
    await storage.kvSet("trust:mine", [...edges.values()].filter((e) => e.from === me));
  }

  async set(to: string, kind: TrustKind, opts: { community?: string; reason?: string } = {}) {
    const me = identityService.pk;
    if (!me || to === me) return;
    const e: TrustEdge = { from: me, to, kind, community: opts.community, reason: opts.reason, at: Date.now() };
    const secret = identityService.current;
    if (secret) await signTrust(e, secret.privateKeyJwk);
    edges.set(key(e), e);
    await this.persistMine();
    bus.emit("trust:publish", e);
    bus.emit("trust:update", e);
  }
  vouch(to: string, community?: string) { return this.set(to, "vouch", { community }); }
  block(to: string, reason?: string) { return this.set(to, "block", { reason }); }
  mute(to: string) { return this.set(to, "mute", {}); }
  report(to: string, reason?: string) { return this.set(to, "report", { reason }); }
  async clear(to: string, community?: string) {
    const me = identityService.pk;
    for (const kind of ["vouch", "block", "mute", "report"] as TrustKind[]) edges.delete(key({ from: me, to, community }));
    await this.persistMine();
  }

  /** My direct edge to someone (most recent kind), ignoring community for the menu. */
  myRelation(to: string): TrustKind | null {
    const me = identityService.pk;
    let best: TrustEdge | null = null;
    for (const e of edges.values()) if (e.from === me && e.to === to) { if (!best || e.at > best.at) best = e; }
    return best?.kind ?? null;
  }
  isMuted(to: string): boolean { return this.myRelation(to) === "mute"; }

  /** People I've vouched for (for the 1-hop walk). */
  private myVouches(): string[] {
    const me = identityService.pk;
    return [...edges.values()].filter((e) => e.from === me && e.kind === "vouch").map((e) => e.to);
  }

  /** Contextual trust toward `to` from my perspective. Direct + one hop.
   *  Returns roughly -2..+2 (negative = distrust). community boosts matches. */
  score(to: string, community?: string): number {
    const me = identityService.pk;
    if (!me || to === me) return 0;
    const w = (kind: TrustKind) => (kind === "vouch" ? 1 : kind === "report" ? -0.6 : kind === "block" ? -1 : kind === "mute" ? -0.8 : 0);
    let s = 0;
    // direct
    for (const e of edges.values()) {
      if (e.from !== me || e.to !== to) continue;
      s += w(e.kind) * (community && e.community === community ? 1.5 : 1);
    }
    // one hop: people I vouched for, vouching/blocking `to`
    const trusted = new Set(this.myVouches());
    for (const e of edges.values()) {
      if (e.to !== to || !trusted.has(e.from)) continue;
      s += w(e.kind) * 0.4 * (community && e.community === community ? 1.5 : 1);
    }
    return Math.max(-2, Math.min(2, s));
  }

  /** How many distinct people (in your trust graph) vouched for `to`. */
  vouchCount(to: string): number {
    return new Set([...edges.values()].filter((e) => e.to === to && e.kind === "vouch").map((e) => e.from)).size;
  }
}

export const trustService = new TrustService();
