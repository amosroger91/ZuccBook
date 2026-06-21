// ============================================================
//  reputationService — reputation instead of follower counts.
//  Tracks helpfulness, expertise, participation and trust, and
//  awards badges/ranks. No vanity metrics; the ledger is local
//  and (Phase 2) co-signed by peers who vouch for you.
// ============================================================
import type { Badge, ReputationLedgerEntry } from "@/types";
import { storage } from "./storage";
import { newId } from "@/lib/id";

const RANKS = [
  { min: 0, name: "Drifter" },
  { min: 25, name: "Signal" },
  { min: 75, name: "Voyager" },
  { min: 200, name: "Luminary" },
  { min: 500, name: "Constellation" },
];

export const BADGES: Record<string, Badge> = {
  founder: { id: "founder", label: "Founder", icon: "🌌", description: "Generated an identity early", tier: 3 },
  helpful: { id: "helpful", label: "Helpful", icon: "🤝", description: "Recognized for helping others", tier: 1 },
  creator: { id: "creator", label: "Creator", icon: "✦", description: "Posted original content", tier: 1 },
  host: { id: "host", label: "Host", icon: "🎧", description: "Hosted a Listen Together room", tier: 2 },
  sage: { id: "sage", label: "Sage", icon: "📚", description: "High expertise reputation", tier: 2 },
};

class ReputationService {
  async award(kind: ReputationLedgerEntry["kind"], delta: number, reason: string) {
    const entry: ReputationLedgerEntry = { id: newId("rep"), kind, delta, reason, at: Date.now() };
    await storage.addReputation(entry);
    return entry;
  }
  async total(): Promise<number> {
    return (await storage.reputationLedger()).reduce((s, e) => s + e.delta, 0);
  }
  async breakdown(): Promise<Record<string, number>> {
    const out: Record<string, number> = { helpful: 0, expertise: 0, participation: 0, trust: 0 };
    for (const e of await storage.reputationLedger()) out[e.kind] = (out[e.kind] || 0) + e.delta;
    return out;
  }
  rank(total: number): string {
    let r = RANKS[0].name;
    for (const tier of RANKS) if (total >= tier.min) r = tier.name;
    return r;
  }
  nextRank(total: number): { name: string; remaining: number } | null {
    const next = RANKS.find((t) => t.min > total);
    return next ? { name: next.name, remaining: next.min - total } : null;
  }
}

export const reputationService = new ReputationService();
