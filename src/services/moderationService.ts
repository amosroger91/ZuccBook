// ============================================================
//  moderationService — a layered, explainable moderation *advisor*
//  (not a platform delete switch). It composes content signals,
//  author reputation/history, the viewer's web of trust, and the
//  community's values into a graded, auditable Verdict. The action
//  is advice the UI applies (reduce / review / flag…); the user can
//  always override. See MODERATION.md.
// ============================================================
import type { ModerationProfile, ModerationVerdict, ModerationSignal, ModerationAction, CommunityValues } from "@/types";
import { trustService } from "./trustService";

const LEX = {
  slurs: ["slur1", "slur2"],
  nsfw: ["nsfw", "explicit", "xxx"],
  scam: ["free money", "click here", "buy now", "crypto giveaway", "dm me to earn", "double your", "seed phrase", "airdrop claim"],
  spam: ["subscribe to my", "follow back", "promo code"],
  toxic: ["idiot", "trash", "stupid", "kill yourself", "kys", "loser"],
};
type Cat = keyof typeof LEX;
const CAT_WEIGHT: Record<Cat, number> = { slurs: 0.9, nsfw: 0.5, scam: 0.8, spam: 0.45, toxic: 0.5 };

// User-layer profile → which categories matter + base thresholds.
const PROFILES: Record<ModerationProfile, { cats: Cat[]; reduce: number; flag: number }> = {
  "family-friendly": { cats: ["slurs", "nsfw", "scam", "spam", "toxic"], reduce: 0.5, flag: 0.9 },
  academic: { cats: ["slurs", "scam", "spam", "toxic"], reduce: 0.7, flag: 1.2 },
  gaming: { cats: ["slurs", "scam", "spam"], reduce: 1.0, flag: 1.8 },
  discovery: { cats: ["slurs", "scam", "spam"], reduce: 0.8, flag: 1.4 },
  unfiltered: { cats: ["slurs", "scam"], reduce: 99, flag: 99 }, // only mutes/strong distrust restrict
};

export interface EvalContext {
  profile: ModerationProfile;
  authorPk?: string;
  authorName?: string;
  authorReputation?: number;
  knownAuthor?: boolean;     // do we have a profile for them?
  community?: string;
  values?: CommunityValues;
}

class ModerationService {
  /** The layered evaluation. Returns a graded, explainable verdict. */
  evaluate(text: string, ctx: EvalContext): ModerationVerdict {
    const t = (text || "").toLowerCase();
    const signals: ModerationSignal[] = [];
    const labels: string[] = [];
    const prof = PROFILES[ctx.profile];

    // ----- viewer web-of-trust (overrides everything) -----
    if (ctx.authorPk && (trustService.isBlocked(ctx.authorPk) || trustService.isMuted(ctx.authorPk))) {
      const blocked = trustService.isBlocked(ctx.authorPk);
      return { action: "hide", allowed: false, confidence: 1, reasoning: blocked ? "You blocked this person." : "You muted this person.", signals: [{ label: blocked ? "You blocked them" : "You muted them", weight: 1 }], labels: [blocked ? "blocked" : "muted"] };
    }
    const trust = ctx.authorPk ? trustService.score(ctx.authorPk, ctx.community) : 0;

    // ----- content signals (community focus widens what's considered) -----
    let content = 0;
    const cats = new Set<Cat>([...prof.cats, ...((ctx.values?.focus ?? []).filter((f): f is Cat => f in LEX))]);
    for (const cat of cats) {
      if (cat === "toxic" && ctx.values?.allowProfanity) continue;
      const hits = LEX[cat].filter((w) => t.includes(w));
      if (hits.length) { const wgt = CAT_WEIGHT[cat] * hits.length; content += wgt; labels.push(cat); signals.push({ label: cat, weight: wgt, detail: hits.join(", ") }); }
    }
    if (/(https?:\/\/\S+){3,}/.test(t)) { content += 0.4; labels.push("link-spam"); signals.push({ label: "many links", weight: 0.4 }); }
    if (/(.)\1{7,}/.test(t)) { content += 0.2; signals.push({ label: "repetition", weight: 0.2 }); }
    if (text && text.length > 24 && text.replace(/[^A-Z]/g, "").length / text.replace(/[^A-Za-z]/g, "").length > 0.7) { content += 0.2; signals.push({ label: "shouting (ALL CAPS)", weight: 0.2 }); }

    // ----- reputation & history -----
    let context = 0;
    const rep = ctx.authorReputation ?? 0;
    if (ctx.authorPk && ctx.knownAuthor === false) { context += 0.3; signals.push({ label: "unknown author", weight: 0.3, detail: "no profile in your network yet" }); }
    if (rep >= 75) { context -= 0.5; signals.push({ label: "established reputation", weight: -0.5, detail: `${rep} rep` }); }
    else if (rep > 0 && rep < 10 && content > 0) { context += 0.2; signals.push({ label: "low reputation", weight: 0.2, detail: `${rep} rep` }); }

    // ----- web of trust -----
    if (trust >= 0.5) signals.push({ label: "vouched by your circle", weight: -Math.min(0.8, trust * 0.5), detail: `${trustService.vouchCount(ctx.authorPk!)} vouches` });
    else if (trust <= -0.3) signals.push({ label: "distrusted by your circle", weight: Math.min(1, -trust * 0.6), detail: "blocked/reported by people you trust" });

    // ----- combine -----
    const trustBonus = trust > 0 ? trust * 0.6 : 0;       // trust softens restriction
    const distrust = trust < 0 ? -trust * 0.8 : 0;        // distrust hardens it
    let restriction = content + context + distrust - trustBonus;

    // community strictness tightens thresholds
    const strict = ctx.values ? 0.6 + ctx.values.strictness : 1;
    const reduceT = prof.reduce / strict;
    const flagT = prof.flag / strict;

    let action: ModerationAction = "allow";
    if (restriction >= flagT) action = trust >= 0.5 ? "review" : "flag";          // trusted+flagged → let community decide
    else if (restriction >= reduceT) action = "reduce";
    else if (restriction >= reduceT * 0.5 && labels.length) action = "warn";
    else if (trust >= 1) action = "allow";

    const confidence = Math.max(0, Math.min(1, action === "allow" ? 1 - restriction / Math.max(0.5, reduceT) : restriction / Math.max(0.5, flagT)));
    const reasoning = this.reason(action, signals, ctx);
    return { action, allowed: true, confidence: Number(confidence.toFixed(2)), reasoning, signals: signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)), labels: [...new Set(labels)] };
  }

  private reason(action: ModerationAction, signals: ModerationSignal[], ctx: EvalContext): string {
    if (action === "allow") return signals.some((s) => s.weight < 0) ? "Looks fine — trusted/established author." : "No concerning signals.";
    const top = signals.filter((s) => s.weight > 0).slice(0, 3).map((s) => s.label);
    const where = ctx.values ? ` (this community's "${ctx.values.philosophy}" standard)` : "";
    const verb = { warn: "Worth a look", reduce: "Shown reduced", review: "Sent for community review", flag: "Flagged", hide: "Hidden" }[action] ?? "Noted";
    return `${verb}${where}: ${top.join(", ") || "mixed signals"}.`;
  }

  /** Content-only check for your own composer (no author/trust layers). */
  classify(text: string, profile: ModerationProfile): ModerationVerdict {
    return this.evaluate(text, { profile });
  }
}

export const moderationService = new ModerationService();
