import { describe, it, expect } from "vitest";
import * as trust from "./trustMath";
import type { TrustEdge, TrustKind } from "@/types";

// A varied edge set: direct relations from "me", one-hop vouches, multiple edges
// to the same target, community-scoped edges, and a self-vouch edge cycle.
const KINDS: TrustKind[] = ["vouch", "block", "mute", "report"];
const edges: TrustEdge[] = [];
let at = 1000;
for (const from of ["me", "a", "b", "c", "d"]) {
  for (const to of ["a", "b", "c", "d", "e", "me"]) {
    if (from === to && from !== "me") continue;
    // deterministic spread of kinds + occasional community scoping
    const kind = KINDS[(from.charCodeAt(0) + to.charCodeAt(0)) % KINDS.length];
    edges.push({ from, to, kind, at: at++, community: (at % 3 === 0 ? "rust" : undefined) } as TrustEdge);
  }
}

describe("trustMath indexed variants match the per-call versions", () => {
  const me = "me";
  const idx = trust.buildIndex(edges, me);
  const targets = ["a", "b", "c", "d", "e", "me", "ghost"];
  const communities = [undefined, "rust", "other"];

  it("isBlocked / isMuted parity", () => {
    for (const to of targets) {
      expect(trust.isBlockedI(idx, to)).toBe(trust.isBlocked(edges, me, to));
      expect(trust.isMutedI(idx, to)).toBe(trust.isMuted(edges, me, to));
    }
  });

  it("vouchCount parity", () => {
    for (const to of targets) {
      expect(trust.vouchCountI(idx, to)).toBe(trust.vouchCount(edges, to));
    }
  });

  it("score parity (incl. community scoping + self/unknown targets)", () => {
    for (const to of targets) {
      for (const c of communities) {
        expect(trust.scoreI(idx, to, c)).toBeCloseTo(trust.score(edges, me, to, c), 10);
      }
    }
  });

  it("handles an empty graph", () => {
    const e: TrustIndexGuard = trust.buildIndex([], me);
    expect(trust.scoreI(e, "a")).toBe(0);
    expect(trust.isBlockedI(e, "a")).toBe(false);
    expect(trust.vouchCountI(e, "a")).toBe(0);
  });
});

// local alias so the test reads clearly without importing the interface name
type TrustIndexGuard = ReturnType<typeof trust.buildIndex>;
