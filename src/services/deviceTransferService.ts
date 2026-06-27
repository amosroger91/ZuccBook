// ============================================================
//  deviceTransferService — "log in on another device" over P2P.
//
//  Modeled on PeerDrop: the logged-in ("old") device hosts a PeerJS
//  peer under a short random code and shows a tiny QR/link carrying
//  just that code + a one-time secret. The new device connects, proves
//  the secret, and the OLD device streams the FULL identity (keys +
//  avatar + bio + custom HTML — everything) straight over the WebRTC
//  data channel. The bytes never touch a server, and nothing heavy has
//  to fit inside the QR, so your whole profile comes across — not just
//  your name.
//
//  Security: the private key is only ever sent to a peer that presents
//  the random secret embedded in the QR/link (so a code-guesser gets
//  nothing), and only once. WebRTC is DTLS-encrypted end to end. This is
//  strictly safer than the old approach of stuffing the key into a URL.
// ============================================================
import { Peer, type DataConnection } from "peerjs";
import { identityService } from "./identityService";
import { bufToB64url } from "@/lib/crypto";
import type { SecretIdentity } from "@/types";
// Pure URL helpers live in deviceLink (no peerjs) so the app shell can parse
// the pairing link without pulling this module's WebRTC stack into the entry.
// Imported (used by HostHandle.link below) AND re-exported for existing consumers.
import { buildLink, parseLink } from "./deviceLink";
export { buildLink, parseLink };

// Frozen link scheme — NOT brand text. Existing device-link QR codes/URLs
// embed this prefix; renaming it breaks links already in the wild. Kept as-is
// through the Ledger rebrand.
const PREFIX = "zuccbook-link-v1-";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/0/1 (unambiguous)

// STUN for normal NAT traversal + a free public TURN relay for the strict
// networks that can't go direct. TURN only relays DTLS-encrypted packets, so
// it never sees the identity.
const ICE = {
  config: {
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
      { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
    ],
  },
};

export type HostStatus = "starting" | "ready" | "linking" | "sent" | "error";

export interface HostHandle {
  code: string;
  secret: string;
  link(): string;
  stop(): void;
}

function makeCode(n = 6): string {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[a[i] % ALPHABET.length];
  return s;
}
function makeSecret(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return bufToB64url(a.buffer);
}

class DeviceTransferService {
  private hostPeer: Peer | null = null;
  private rxPeer: Peer | null = null;

  /** OLD device: host a one-time link that streams the full identity. */
  host(onStatus: (s: HostStatus) => void): HostHandle {
    this.stopHost();
    const code = makeCode(6);
    const secret = makeSecret();
    let sent = false;
    onStatus("starting");

    const startPeer = (id: string) => {
      const peer = new Peer(id, ICE as any);
      this.hostPeer = peer;
      peer.on("open", () => onStatus("ready"));
      peer.on("connection", (conn: DataConnection) => {
        conn.on("data", (raw: any) => {
          if (!raw || raw.t !== "claim") return;
          if (raw.secret !== secret) { try { conn.send({ t: "denied" }); setTimeout(() => conn.close(), 50); } catch {} return; }
          if (sent) { try { conn.send({ t: "busy" }); } catch {} return; }
          const me = identityService.current;
          if (!me) { try { conn.send({ t: "error" }); } catch {} return; }
          onStatus("linking");
          try { conn.send({ t: "identity", data: me }); sent = true; onStatus("sent"); }
          catch { onStatus("error"); }
        });
      });
      peer.on("error", (e: any) => {
        if (e?.type === "unavailable-id") {
          try { peer.destroy(); } catch {}   // free the collided peer before retrying
          startPeer(PREFIX + makeCode(6));    // rare code collision — pick a new code
        } else onStatus("error");
      });
    };
    startPeer(PREFIX + code);

    return { code, secret, link: () => buildLink(code, secret), stop: () => this.stopHost() };
  }

  stopHost() { if (this.hostPeer) { try { this.hostPeer.destroy(); } catch {} this.hostPeer = null; } }

  /** NEW device: connect to the code, prove the secret, receive the identity. */
  receive(code: string, secret: string, cb: {
    onStatus: (s: "connecting" | "waiting" | "connected" | "importing") => void;
    onIdentity: (id: SecretIdentity) => void;
    onError: (m: string) => void;
  }) {
    this.stopRx();
    let tries = 0, done = false;

    const connect = () => {
      const peer = new Peer(ICE as any);
      this.rxPeer = peer;
      peer.on("open", () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on("open", () => { cb.onStatus("connected"); try { conn.send({ t: "claim", secret }); } catch {} });
        conn.on("data", (raw: any) => {
          if (!raw || !raw.t) return;
          if (raw.t === "identity") { done = true; cb.onIdentity(raw.data as SecretIdentity); }
          else if (raw.t === "denied") cb.onError("This link didn't match — generate a fresh one on your other device.");
          else if (raw.t === "busy") cb.onError("That link was already used. Generate a fresh one on your other device.");
          else if (raw.t === "error") cb.onError("Your other device couldn't share its account.");
        });
        conn.on("error", () => {});
      });
      peer.on("error", (e: any) => {
        if (done) return;
        // Tear down THIS failed peer before retrying — otherwise each retry leaks
        // a live Peer (its socket, ICE agents and reconnect timers), up to 10×.
        try { peer.destroy(); } catch {}
        if (this.rxPeer === peer) this.rxPeer = null;
        if (e?.type === "peer-unavailable") {
          if (tries < 10) { tries++; cb.onStatus("waiting"); setTimeout(connect, 1000); }
          else cb.onError("Couldn't reach your other device. Keep the QR screen open on it and try again.");
        } else cb.onError("Network error — check your connection and try again.");
      });
    };
    cb.onStatus("connecting");
    connect();
  }

  stopRx() { if (this.rxPeer) { try { this.rxPeer.destroy(); } catch {} this.rxPeer = null; } }
}

export const deviceTransferService = new DeviceTransferService();
