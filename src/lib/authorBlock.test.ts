import { describe, it, expect } from "vitest";
import { isBlockedAuthorName, isBlockedText } from "./authorBlock";

describe("isBlockedAuthorName", () => {
  it("matches the aéPiot spam brand across accent + case variants", () => {
    for (const name of ["aéPiot", "aepiot", "AÉPIOT", "aePiot", "AePiOt", "  aéPiot  "]) {
      expect(isBlockedAuthorName(name)).toBe(true);
    }
  });
  it("matches when embedded in a longer name", () => {
    expect(isBlockedAuthorName("MultiSearch Tag Explorer aéPiot")).toBe(true);
  });
  it("does not flag normal usernames or null", () => {
    for (const name of ["Roger A.", "npub1cnmz20a", "piot", "satoshi", "", undefined, null]) {
      expect(isBlockedAuthorName(name)).toBe(false);
    }
  });
});

describe("isBlockedText — spam brands in links/body", () => {
  it("catches the brand inside a shared URL", () => {
    expect(isBlockedText("check this https://aepiot.com/explore now")).toBe(true);
    expect(isBlockedText("see https://multisearch.aépiot.net/x")).toBe(true);
  });
  it("ignores normal posts/links", () => {
    for (const t of ["just a normal post about gardening", "https://example.com/article", ""]) {
      expect(isBlockedText(t)).toBe(false);
    }
  });
});

describe("isBlockedText — child-safety screen", () => {
  it("drops unambiguous coded terms (incl. separator/obfuscation evasion)", () => {
    for (const t of ["pthc", "p t h c", "p.t.h.c", "lolicon art", "child porn", "childp0rn", "jailbait pics"]) {
      expect(isBlockedText(t)).toBe(true);
    }
  });
  it("drops minor-indicator combined with explicit/NSFW language", () => {
    for (const t of ["preteen nudes", "underage porn", "13yo nude", "naked child", "12 y/o xxx"]) {
      expect(isBlockedText(t)).toBe(true);
    }
  });
  it("does NOT flag benign posts about children", () => {
    for (const t of [
      "my kid's birthday party was so fun",
      "great resource for child development",
      "the kids built a sandcastle today",
      "minor bug fix shipped",
      "watching a movie with my toddler",
    ]) {
      expect(isBlockedText(t)).toBe(false);
    }
  });
  it("does NOT flag adult NSFW with no minor indicator", () => {
    for (const t of ["adult content, 18+ only", "my onlyfans link", "nsfw art (adults)"]) {
      expect(isBlockedText(t)).toBe(false);
    }
  });
});
