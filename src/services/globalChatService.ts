// ============================================================
//  globalChatService — "Global Chat": a public Nostr (NIP-28)
//  channel. Messages are kind-42 events that reference a fixed
//  channel-create (kind 40) event id; ANYONE on Nostr can join,
//  not just Ledger users. No server and no gateway — it rides the
//  same public relays as the feed and is signed by your Nostr key
//  (reused from nostrService). Truly global, fully serverless.
//
//  NIP-28: https://github.com/nostr-protocol/nips/blob/master/28.md
// ============================================================
import { finalizeEvent, verifyEvent, nip19, type Event as NostrEvent } from "nostr-tools";
import { nostrService } from "./nostrService";
import { isBlockedAuthorName, isBlockedText } from "@/lib/authorBlock";
import type { ChatMessage } from "@/types";

// "Global Chat" points at an EXISTING, already-active public Nostr channel so it's
// populated from day one (a brand-new room would just be empty). This is "Amethyst
// Users" — the busiest public NIP-28 channel as of 2026-06 (a popular Nostr client's
// room that became a general hangout: ~55 people, hundreds of recent messages). To
// re-point at a different/busier room, run ledger-e2e/find-active-channels.mjs and
// drop in the winner. `?gc=<64-hex>` overrides it (the e2e harness uses a throwaway
// channel so automated tests never post into the real room).
const DEFAULT_CHANNEL_ID = "42224859763652914db53052103f0b744df79dfc4efef7e950fc0802fc3df3c5";
const channelOverride = (() => { try { const g = new URLSearchParams(location.search).get("gc"); return g && /^[0-9a-f]{64}$/i.test(g) ? g.toLowerCase() : null; } catch { return null; } })();
export const GLOBAL_CHANNEL_ID = channelOverride || DEFAULT_CHANNEL_ID;

const CHAT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://nostr.mom"];
const shortNpub = (pk: string) => { try { return nip19.npubEncode(pk).slice(0, 11) + "…"; } catch { return pk.slice(0, 8) + "…"; } };

export interface GlobalChatHandlers {
  onStatus: (s: string) => void;
  onChat: (m: ChatMessage) => void;
}
export interface GlobalChatController {
  sendChat: (text: string) => Promise<void>;
  leave: () => void;
}

// NIP-92 `imeta` tags carry attached media. Pull out IMAGE urls (mime image/* or an
// image extension) so we can render them inline — many Nostr clients (e.g. Amethyst)
// post images this way rather than as a bare url in the text.
function imetaImages(e: NostrEvent): string[] {
  const urls: string[] = [];
  for (const t of e.tags || []) {
    if (!Array.isArray(t) || t[0] !== "imeta") continue;
    const fields = t.slice(1).filter((s): s is string => typeof s === "string");
    const url = fields.find((f) => f.startsWith("url "))?.slice(4).trim() || "";
    const mime = fields.find((f) => f.startsWith("m "))?.slice(2).trim() || "";
    if (url && (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url))) urls.push(url);
  }
  return [...new Set(urls)];
}

function toMessage(e: NostrEvent): ChatMessage {
  const imgs = imetaImages(e);
  let text = e.content || "";
  for (const u of imgs) text = text.split(u).join(" ");   // don't also show the url as raw text
  text = text.replace(/[ \t]{2,}/g, " ").trim();
  return {
    id: e.id,
    channel: "global",
    author: "nostr:" + e.pubkey,
    authorName: shortNpub(e.pubkey),
    text,
    media: imgs.length ? imgs.map((url) => ({ type: "image" as const, url, mime: "image/" + ((url.match(/\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:\?|$)/i)?.[1] || "jpeg").toLowerCase().replace("jpg", "jpeg")) })) : undefined,
    reactions: {},
    createdAt: (e.created_at || 0) * 1000 || Date.now(),
  };
}

// Author display-name/avatar (kind-0) cache — module level so it survives re-mounts
// (incl. React StrictMode's double-mount) and is shared across the dock + full page.
const profileCache = new Map<string, { name?: string; avatar?: string }>();

/** Join the global NIP-28 channel: streams kind-42 messages live (with recent
 *  history) and lets you post. Returns a controller; call leave() to disconnect. */
export function joinGlobalChat(handlers: GlobalChatHandlers): GlobalChatController {
  const sockets = new Set<WebSocket>();
  const subId = "gc" + Math.random().toString(36).slice(2, 9);
  const profSub = "gp" + Math.random().toString(36).slice(2, 9);
  const filter = { kinds: [42], "#e": [GLOBAL_CHANNEL_ID], limit: 120 };
  const emitted = new Map<string, ChatMessage>(); // id → message, to re-emit when its author's profile arrives
  const want = new Set<string>();                 // pubkeys still needing a profile
  const requested = new Set<string>();            // pubkeys already subscribed (don't re-queue)
  let profTimer: ReturnType<typeof setTimeout> | null = null;
  let left = false;
  let everConnected = false;

  const withProfile = (msg: ChatMessage, pub: string): ChatMessage => {
    const p = profileCache.get(pub);
    // Don't adopt a profile display name that hits the blocklist (e.g. a spam brand).
    const name = p?.name && !isBlockedAuthorName(p.name) ? p.name : msg.authorName;
    return p && (name !== msg.authorName || p.avatar) ? { ...msg, authorName: name, authorAvatar: p.avatar || msg.authorAvatar } : msg;
  };
  const emit = (e: NostrEvent) => {
    if (!e || e.kind !== 42) return;
    try { if (!verifyEvent(e)) return; } catch { return; }      // drop forgeries
    const msg = toMessage(e);
    // Content-safety screen: never surface blocked messages (spam brands in the
    // text/links, or child-exploitation signals). e.content is screened raw so a
    // term inside a stripped media URL still counts.
    const hay = [msg.text, e.content, msg.authorName, ...((msg.media ?? []).map((m) => m.url))].filter(Boolean).join(" ");
    if (isBlockedText(hay) || isBlockedAuthorName(msg.authorName)) return;
    emitted.set(msg.id, msg);
    handlers.onChat(withProfile(msg, e.pubkey));
    if (!profileCache.has(e.pubkey) && !requested.has(e.pubkey)) { want.add(e.pubkey); scheduleProfiles(); }
  };
  const absorbProfile = (e: NostrEvent) => {
    if (!e || e.kind !== 0) return;
    let name: string | undefined, avatar: string | undefined;
    try { const m = JSON.parse(e.content || "{}"); name = m.display_name || m.displayName || m.name || undefined; avatar = m.picture || undefined; } catch {}
    profileCache.set(e.pubkey, { name, avatar });
    if (left || (!name && !avatar)) return;
    for (const msg of emitted.values()) if (msg.author === "nostr:" + e.pubkey) handlers.onChat(withProfile(msg, e.pubkey));
  };
  // Resolve names/avatars in ONE batched kind-0 REQ over the OPEN channel sockets,
  // debounced so the load burst coalesces — never a fresh connection per author
  // (that exhausts the browser's WebSocket pool on a busy channel).
  const scheduleProfiles = () => { if (profTimer) clearTimeout(profTimer); profTimer = setTimeout(flushProfiles, 700); };
  const flushProfiles = () => {
    profTimer = null;
    if (left) return;
    want.forEach((p) => requested.add(p));
    want.clear();
    if (!requested.size) return;
    const req = JSON.stringify(["REQ", profSub, { kinds: [0], authors: [...requested].slice(-500) }]);
    for (const w of sockets) if (w.readyState === WebSocket.OPEN) { try { w.send(req); } catch {} }
  };

  const connect = (relay: string) => {
    if (left) return;
    let w: WebSocket;
    try { w = new WebSocket(relay); } catch { return; }
    sockets.add(w);
    w.onopen = () => {
      if (left) { try { w.close(); } catch {} return; }
      if (!everConnected) { everConnected = true; handlers.onStatus("connected"); }
      try { w.send(JSON.stringify(["REQ", subId, filter])); } catch {}
      if (requested.size) flushProfiles();   // a reconnected relay re-serves the profile sub
    };
    w.onmessage = (m) => {
      try {
        const d = JSON.parse(typeof m.data === "string" ? m.data : "");
        if (d[0] === "EVENT" && d[1] === subId) emit(d[2]);
        else if (d[0] === "EVENT" && d[2] && d[2].kind === 0) absorbProfile(d[2]);
      } catch {}
    };
    w.onerror = () => {};
    w.onclose = () => { sockets.delete(w); if (!left) setTimeout(() => connect(relay), 4000 + Math.random() * 3000); }; // reconnect with jitter
  };

  handlers.onStatus("connecting…");
  for (const r of CHAT_RELAYS) connect(r);

  return {
    async sendChat(text: string) {
      const t = text.trim();
      if (!t || left) return;
      const { sk } = await nostrService.myKeys();
      const ev = finalizeEvent({ kind: 42, created_at: Math.floor(Date.now() / 1000), tags: [["e", GLOBAL_CHANNEL_ID, CHAT_RELAYS[0], "root"]], content: t }, sk);
      emit(ev);                                          // optimistic echo (relay re-broadcast dedupes by id)
      const out = JSON.stringify(["EVENT", ev]);
      for (const w of sockets) { if (w.readyState === WebSocket.OPEN) { try { w.send(out); } catch {} } }
    },
    leave() { left = true; if (profTimer) clearTimeout(profTimer); for (const w of sockets) { try { w.close(); } catch {} } sockets.clear(); },
  };
}

/** Your own author id ("nostr:<hex>") — for "is this my message?" in the UI. */
export async function myGlobalAuthor(): Promise<string> {
  const { pk } = await nostrService.myKeys();
  return "nostr:" + pk;
}
