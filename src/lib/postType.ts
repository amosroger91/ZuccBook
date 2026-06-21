// ============================================================
//  postType — classify a post by the kind of content it carries so
//  the feed can be filtered (videos / images / music / links / text
//  / polls). Detection mirrors how PostCard actually renders a post.
// ============================================================
import type { Post } from "@/types";

export type ContentFilter = "all" | "text" | "video" | "image" | "music" | "link" | "poll";

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const SPOTIFY_RE = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]+/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i;
const URL_RE = /https?:\/\/[^\s]+/g;

export interface PostSignals {
  video: boolean; image: boolean; music: boolean; link: boolean; poll: boolean; text: boolean;
}

export function postSignals(p: Post): PostSignals {
  const t = p.text ?? "";
  const urls = t.match(URL_RE) ?? [];
  const video = YT_RE.test(t);
  const music = SPOTIFY_RE.test(t);
  const imageLink = urls.some((u) => IMG_RE.test(u));
  const imageMedia = !!p.media?.some((m) => m.type === "image");
  const image = imageLink || imageMedia;
  const link = urls.some((u) => !IMG_RE.test(u) && !YT_RE.test(u) && !SPOTIFY_RE.test(u));
  const poll = !!p.poll;
  // "Text" = a plain post: real words and no media/links/poll attached.
  const textOnly = !video && !music && !image && !link && !poll && !!t.trim();
  return { video, image, music, link, poll, text: textOnly };
}

export function matchesFilter(p: Post, f: ContentFilter): boolean {
  if (f === "all") return true;
  return postSignals(p)[f];
}

/** Keyword search across post text, author and tags (case-insensitive, all terms). */
export function matchesQuery(p: Post, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${p.text ?? ""} ${p.authorName ?? ""} ${(p.tags ?? []).join(" ")}`.toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}
