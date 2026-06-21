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
