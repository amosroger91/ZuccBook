// Decode HTML entities that ride along in RSS feeds (e.g. Reddit emits "&#32;"
// for spaces, "&amp;" for &). Dependency-free and DOM-free so it's safe to call
// at render time. Numeric/hex first, named last (and "&amp;" last of all) so we
// don't accidentally re-form entities.
export function decodeEntities(input: string): string {
  if (!input || input.indexOf("&") === -1) return input;
  return input
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&");
}
