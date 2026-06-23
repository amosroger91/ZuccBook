/** Open a YouTube video on youtube.com in a new tab, resuming at the given
 *  playback position. Used by the global players so you can pop a video out to
 *  YouTube at the exact moment you were watching (e.g. before a refresh). */
export function openOnYouTube(videoId: string | null | undefined, seconds = 0) {
  if (!videoId) return;
  const t = Math.max(0, Math.floor(seconds || 0));
  const url = `https://www.youtube.com/watch?v=${videoId}${t ? `&t=${t}s` : ""}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
