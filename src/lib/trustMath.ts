// ============================================================
//  trustMath — the PURE web-of-trust computations, dependency-free
//  and worker-safe. trustService (main thread) delegates to these,
//  and feedRank (in the feed worker) calls them over a serialized
//  snapshot of the trust edges — so feed moderation and the live
//  trust UI always agree. No imports beyond the edge type.
// ============================================================
import type { TrustEdge, TrustKind } from "@/types";

const w = (kind: TrustKind) => (kind === "vouch" ? 1 : kind === "report" ? -0.6 : kind === "block" ? -1 : kind === "mute" ? -0.8 : 0);

/** My direct edge to someone (most recent kind), ignoring community. */
export function myRelation(edges: TrustEdge[], me: string, to: string): TrustKind | null {
  let best: TrustEdge | null = null;
  for (const e of edges) if (e.from === me && e.to === to) { if (!best || e.at > best.at) best = e; }
  return best?.kind ?? null;
}

export function isMuted(edges: TrustEdge[], me: string, to: string): boolean { return myRelation(edges, me, to) === "mute"; }
export function isBlocked(edges: TrustEdge[], me: string, to: string): boolean { return myRelation(edges, me, to) === "block"; }

/** How many distinct people (in your trust graph) vouched for `to`. */
export function vouchCount(edges: TrustEdge[], to: string): number {
  return new Set(edges.filter((e) => e.to === to && e.kind === "vouch").map((e) => e.from)).size;
}

/** Contextual trust toward `to` from my perspective. Direct + one hop.
 *  Returns roughly -2..+2 (negative = distrust). community boosts matches. */
export function score(edges: TrustEdge[], me: string, to: string, community?: string): number {
  if (!me || to === me) return 0;
  let s = 0;
  // direct
  for (const e of edges) {
    if (e.from !== me || e.to !== to) continue;
    s += w(e.kind) * (community && e.community === community ? 1.5 : 1);
  }
  // one hop: people I vouched for, vouching/blocking `to`
  const trusted = new Set(edges.filter((e) => e.from === me && e.kind === "vouch").map((e) => e.to));
  for (const e of edges) {
    if (e.to !== to || !trusted.has(e.from)) continue;
    s += w(e.kind) * 0.4 * (community && e.community === community ? 1.5 : 1);
  }
  return Math.max(-2, Math.min(2, s));
}

// ============================================================
//  Indexed variants — same math, but the per-`to` edge grouping and the "people
//  I vouched for" set are computed ONCE (buildIndex) instead of scanning the full
//  edge array for every call. feedRank evaluates trust for every post, so the
//  per-call versions above are O(posts × edges); these make it O(edges) once plus
//  O(edges-for-this-author) per post. Results are identical (parity-tested).
// ============================================================
export interface TrustIndex {
  me: string;
  byTo: Map<string, TrustEdge[]>;   // edges grouped by their `.to`
  trusted: Set<string>;             // people `me` vouched for (one-hop sources)
}

export function buildIndex(edges: TrustEdge[], me: string): TrustIndex {
  const byTo = new Map<string, TrustEdge[]>();
  const trusted = new Set<string>();
  for (const e of edges) {
    let a = byTo.get(e.to);
    if (!a) { a = []; byTo.set(e.to, a); }
    a.push(e);
    if (e.from === me && e.kind === "vouch") trusted.add(e.to);
  }
  return { me, byTo, trusted };
}

export function myRelationI(idx: TrustIndex, to: string): TrustKind | null {
  let best: TrustEdge | null = null;
  for (const e of idx.byTo.get(to) ?? []) if (e.from === idx.me) { if (!best || e.at > best.at) best = e; }
  return best?.kind ?? null;
}
export function isMutedI(idx: TrustIndex, to: string): boolean { return myRelationI(idx, to) === "mute"; }
export function isBlockedI(idx: TrustIndex, to: string): boolean { return myRelationI(idx, to) === "block"; }

export function vouchCountI(idx: TrustIndex, to: string): number {
  const s = new Set<string>();
  for (const e of idx.byTo.get(to) ?? []) if (e.kind === "vouch") s.add(e.from);
  return s.size;
}

export function scoreI(idx: TrustIndex, to: string, community?: string): number {
  if (!idx.me || to === idx.me) return 0;
  const arr = idx.byTo.get(to) ?? [];
  let s = 0;
  // direct (mirrors score's first loop)
  for (const e of arr) if (e.from === idx.me) s += w(e.kind) * (community && e.community === community ? 1.5 : 1);
  // one hop (mirrors score's second loop — runs over the same edges independently)
  for (const e of arr) if (idx.trusted.has(e.from)) s += w(e.kind) * 0.4 * (community && e.community === community ? 1.5 : 1);
  return Math.max(-2, Math.min(2, s));
}
