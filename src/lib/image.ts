// Small image helpers — read a File to a data URL, load an <img>, and
// produce a compact square avatar data URL (kept tiny so it can ride the
// roster/posts across the network).
export function readDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
}
export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
export async function compressBanner(file: File, maxW = 1280): Promise<string> {
  const img = await loadImg(await readDataUrl(file));
  const scale = Math.min(1, maxW / (img.width || maxW));
  const w = Math.round((img.width || maxW) * scale), h = Math.round((img.height || 400) * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.82);
}
export async function compressAvatar(file: File, size = 128): Promise<string> {
  const img = await loadImg(await readDataUrl(file));
  const c = document.createElement("canvas"); c.width = c.height = size;
  const s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = (img.height - s) / 2;
  c.getContext("2d")!.drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.85);
}

// Downscale a post/reply image to a compact JPEG. Full-res photos are multi-MB,
// which exceeds IndexedDB quotas and the Gun relay size limits we sync through —
// so the picture persists locally but is dropped on round-trip (text stays, the
// image vanishes). A capped-dimension JPEG keeps posts small enough to persist
// and sync everywhere. GIFs are left untouched (canvas would kill the animation);
// on any failure we fall back to the original so an upload never breaks.
export async function compressPostImage(file: File, maxDim = 1280, quality = 0.72): Promise<string> {
  const original = await readDataUrl(file);
  if (file.type === "image/gif") return original;
  try {
    const img = await loadImg(original);
    const longest = Math.max(img.width, img.height) || 1;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round((img.width || maxDim) * scale));
    const h = Math.max(1, Math.round((img.height || maxDim) * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); if (!ctx) return original;
    ctx.drawImage(img, 0, 0, w, h);
    const out = c.toDataURL("image/jpeg", quality);
    return out && out.length < original.length ? out : original;
  } catch {
    return original;
  }
}
