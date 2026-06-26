// ============================================================
//  deviceLink — the PURE "#/link?c=…~…" device-pairing URL helpers,
//  with zero dependencies (no peerjs). Split out of deviceTransferService
//  so the app shell can parse the link on first render without dragging
//  the PeerJS WebRTC stack into the initial bundle. deviceTransferService
//  re-exports these for its existing consumers.
// ============================================================

export function buildLink(code: string, secret: string): string {
  return `${location.origin}${location.pathname}#/link?c=${code}~${secret}`;
}

export function parseLink(hash: string): { code: string; secret: string } | null {
  const m = hash.match(/^#\/link\?c=([^~]+)~(.+)$/);
  if (!m) return null;
  try {
    return { code: decodeURIComponent(m[1]), secret: decodeURIComponent(m[2]) };
  } catch {
    return { code: m[1], secret: m[2] };
  }
}
