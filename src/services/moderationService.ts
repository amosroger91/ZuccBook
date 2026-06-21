// ============================================================
//  moderationService — Layer 1 (local AI / heuristic) + Layer 3
//  (user-controlled filter profiles). Layer 2 (community rules)
//  plugs in via CommunityService. All moderation is local and
//  inspectable; users pick a profile, nothing is sent anywhere.
// ============================================================
import type { ModerationProfile, ModerationVerdict, Post } from "@/types";

// Tiny illustrative lexicons. A real deployment swaps these for an
// on-device classifier (WebLLM / a small ONNX model) behind this same API.
const LEX = {
  slurs: ["slur1", "slur2"], // placeholders — keep the repo clean
  nsfw: ["nsfw", "explicit", "xxx"],
  spam: ["free money", "click here", "buy now", "crypto giveaway", "dm me to earn"],
  toxic: ["idiot", "trash", "stupid", "kill yourself", "kys"],
};

const PROFILES: Record<ModerationProfile, { blocks: (keyof typeof LEX)[]; threshold: number }> = {
  "family-friendly": { blocks: ["slurs", "nsfw", "spam", "toxic"], threshold: 0.25 },
  academic: { blocks: ["slurs", "spam", "toxic"], threshold: 0.4 },
  gaming: { blocks: ["slurs", "spam"], threshold: 0.6 },
  discovery: { blocks: ["slurs", "spam"], threshold: 0.5 },
  unfiltered: { blocks: [], threshold: 1.1 },
};

class ModerationService {
  classify(text: string, profile: ModerationProfile): ModerationVerdict {
    const t = (text || "").toLowerCase();
    const labels: string[] = [];
    let score = 0;
    const cfg = PROFILES[profile];
    for (const cat of cfg.blocks) {
      for (const term of LEX[cat]) {
        if (t.includes(term)) { labels.push(cat); score += 0.4; }
      }
    }
    // crude spam heuristics
    if (/(https?:\/\/\S+){3,}/.test(t)) { labels.push("spam"); score += 0.3; }
    if (/(.)\1{6,}/.test(t)) { labels.push("spam"); score += 0.2; }
    score = Math.min(1, score);
    return {
      allowed: score < cfg.threshold,
      score,
      labels: [...new Set(labels)],
      layer: "local-ai",
      reason: labels.length ? `matched: ${[...new Set(labels)].join(", ")}` : undefined,
    };
  }

  filterPost(post: Post, profile: ModerationProfile): ModerationVerdict {
    return this.classify([post.text, post.poll?.question].filter(Boolean).join(" "), profile);
  }
}

export const moderationService = new ModerationService();
