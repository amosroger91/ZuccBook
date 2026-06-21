// Deterministic gradient avatar from a public key (no image needed).
const PALETTE = ["#6ee7ff", "#a78bfa", "#f472b6", "#5dffa0", "#ffcc66", "#ff9a5d", "#7aa2ff"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarGradient(seed: string): string {
  const h = hash(seed || "x");
  const a = PALETTE[h % PALETTE.length];
  const b = PALETTE[(h >> 3) % PALETTE.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
