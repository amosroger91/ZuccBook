// ============================================================
//  authorBlock — pure, dependency-free content safety filter, used by the
//  feed ranker (main thread + feed worker) to DROP posts entirely.
//
//  Two jobs:
//   1. Spam brands (e.g. "aéPiot") that flood the network under throwaway
//      identities — matched in the display name AND anywhere in the post
//      body / links / tags.
//   2. Child-safety: drop posts associated with child sexual exploitation.
//      Nostr is open and unmoderated, so this is a defensive client-side
//      screen — it removes unambiguous coded terms and the co-occurrence of
//      a minor indicator with explicit/NSFW language. (It can't detect CSAM
//      *imagery* — that needs server-side perceptual-hash matching against
//      NCMEC/PhotoDNA; the on-device NSFW image classifier is the only
//      image-side screen available client-side.)
//
//  Matching is case- and accent-insensitive, and a separator-collapsed pass
//  (strip non-alphanumerics) defeats obfuscation like "p t h c" / "ch1ld".
// ============================================================

// Spam-brand substrings (normalized) — dropped from name, body, or links.
const SPAM_TERMS = ["aepiot"];

// Unambiguous child-exploitation coded terms. Checked against the COLLAPSED
// (alphanumeric-only) text, so spacing/punctuation/leet evasion still matches.
const CSAM_CODED = [
  "childporn", "kidporn", "kiddieporn", "kiddyporn", "childp0rn", "childpron",
  "preteenporn", "pthc", "lolicon", "shotacon", "jailbait", "cppedo", "pedofile",
];

// Co-occurrence screen: a MINOR indicator together with an EXPLICIT/NSFW term
// is dropped. Requiring BOTH keeps ordinary posts about kids/parenting safe.
const MINOR_RE = /\b(child|children|kid|kids|minor|minors|preteen|pre[\s-]?teens?|underage|under[\s-]?age|toddler|infant|tween|schoolgirl|schoolboy|loli|shota)\b/;
// Ages 1–17 written as "12yo", "12 y/o", "13 years old" (18+ deliberately excluded).
const AGE_RE = /\b(?:[1-9]|1[0-7])\s?(?:yo|y\/o|y\.?o\.?|(?:yrs?|years?)\s?old)\b/;
const EXPLICIT_RE = /\b(porn|p0rn|nudes?|naked|nudity|sex|sexual|sexting|xxx|nsfw|explicit|hentai|cum|onlyfans|fuck|rape|molest)\b/;

/** lowercase + strip diacritics so accented spellings can't dodge the filter. */
function normalize(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
/** normalized + all non-alphanumerics removed — defeats spacing/punctuation evasion. */
function collapse(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

/** True if a display name contains a blocked spam brand (e.g. "aéPiot"). */
export function isBlockedAuthorName(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = normalize(name);
  const c = collapse(name);
  return SPAM_TERMS.some((b) => n.includes(b) || c.includes(b));
}

/** True if the text (post body, links, tags, name…) contains a blocked spam
 *  brand or child-exploitation signal. Drop the whole post when this is true. */
export function isBlockedText(text: string | undefined | null): boolean {
  if (!text) return false;
  const n = normalize(text);
  const c = collapse(text);
  // spam brands — in the body or inside a link
  if (SPAM_TERMS.some((t) => n.includes(t) || c.includes(t))) return true;
  // unambiguous coded terms (separator-proof)
  if (CSAM_CODED.some((t) => c.includes(t))) return true;
  // minor indicator + explicit/NSFW term
  if (EXPLICIT_RE.test(n) && (MINOR_RE.test(n) || AGE_RE.test(n))) return true;
  return false;
}
