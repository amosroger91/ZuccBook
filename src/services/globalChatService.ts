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
import type { ChatMessage } from "@/types";

// The kind-40 channel "Ledger Global Chat" (created + published once; see
// ledger-e2e/create-channel.mjs). Everyone subscribes to this id. `?gc=<64-hex>`
// overrides it — used by the e2e harness so tests post to a throwaway channel and
// never pollute the real one.
const DEFAULT_CHANNEL_ID = "05f7c17c1085d8c5ef1a09f001863ba83443ba2e5f1c928eb017c4e503f6735d";
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

function toMessage(e: NostrEvent): ChatMessage {
  return {
    id: e.id,
    channel: "global",
    author: "nostr:" + e.pubkey,
    authorName: shortNpub(e.pubkey),
    text: e.content,
    reactions: {},
    createdAt: (e.created_at || 0) * 1000 || Date.now(),
  };
}

/** Join the global NIP-28 channel: streams kind-42 messages live (with recent
 *  history) and lets you post. Returns a controller; call leave() to disconnect. */
export function joinGlobalChat(handlers: GlobalChatHandlers): GlobalChatController {
  const sockets = new Set<WebSocket>();
  const subId = "gc" + Math.random().toString(36).slice(2, 9);
  const filter = { kinds: [42], "#e": [GLOBAL_CHANNEL_ID], limit: 120 };
  let left = false;
  let everConnected = false;

  const emit = (e: NostrEvent) => {
    if (!e || e.kind !== 42) return;
    try { if (!verifyEvent(e)) return; } catch { return; }      // drop forgeries
    const msg = toMessage(e);
    handlers.onChat(msg);
    // Upgrade the npub stub to a real display name/avatar once the profile loads.
    nostrService.profile("nostr:" + e.pubkey).then((p) => {
      if (!left && p?.username && p.username !== msg.authorName) handlers.onChat({ ...msg, authorName: p.username, authorAvatar: p.avatar });
    }).catch(() => {});
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
    };
    w.onmessage = (m) => { try { const d = JSON.parse(typeof m.data === "string" ? m.data : ""); if (d[0] === "EVENT" && d[1] === subId) emit(d[2]); } catch {} };
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
    leave() { left = true; for (const w of sockets) { try { w.close(); } catch {} } sockets.clear(); },
  };
}

/** Your own author id ("nostr:<hex>") — for "is this my message?" in the UI. */
export async function myGlobalAuthor(): Promise<string> {
  const { pk } = await nostrService.myKeys();
  return "nostr:" + pk;
}
