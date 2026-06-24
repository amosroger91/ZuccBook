// ============================================================
//  storage.ts — the offline-first persistence layer (IndexedDB).
//  Every other service reads/writes through here. localStorage is
//  used only for tiny hot values (current settings); everything
//  substantial lives in IndexedDB so the app works fully offline.
// ============================================================
import { openDB, unwrap, type DBSchema, type IDBPDatabase } from "idb";
import type {
  SecretIdentity, Post, ChatMessage, Community,
  ReputationLedgerEntry, CompanionMessage, AppSettings, Profile,
} from "@/types";

interface LedgerDB extends DBSchema {
  identity: { key: string; value: SecretIdentity };
  posts: { key: string; value: Post; indexes: { byTime: number; byAuthor: string; byCommunity: string } };
  messages: { key: string; value: ChatMessage; indexes: { byChannel: string; byTime: number } };
  communities: { key: string; value: Community };
  reputation: { key: string; value: ReputationLedgerEntry; indexes: { byTime: number } };
  companion: { key: string; value: CompanionMessage; indexes: { byTime: number } };
  // Cached public profiles of people we've seen — so a peer's page survives
  // reloads and is viewable even when they're offline (keyed by public key).
  profiles: { key: string; value: Profile };
  kv: { key: string; value: unknown };
}

// Frozen IndexedDB name — NOT brand text. Renaming it points the app at an
// empty database and orphans every existing user's local data. Kept (along with
// the "nebula:settings" localStorage key below) through the Ledger rebrand.
const DB_NAME = "nebula";
const DB_VERSION = 2;
let dbp: Promise<IDBPDatabase<LedgerDB>> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB<LedgerDB>(DB_NAME, DB_VERSION, {
      // Versioned + idempotent so existing users migrate without re-creating
      // (and throwing on) stores they already have.
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore("identity", { keyPath: "publicKey" });
          const posts = d.createObjectStore("posts", { keyPath: "id" });
          posts.createIndex("byTime", "createdAt");
          posts.createIndex("byAuthor", "author");
          posts.createIndex("byCommunity", "community");
          const msgs = d.createObjectStore("messages", { keyPath: "id" });
          msgs.createIndex("byChannel", "channel");
          msgs.createIndex("byTime", "createdAt");
          d.createObjectStore("communities", { keyPath: "id" });
          const rep = d.createObjectStore("reputation", { keyPath: "id" });
          rep.createIndex("byTime", "at");
          const comp = d.createObjectStore("companion", { keyPath: "id" });
          comp.createIndex("byTime", "at");
          d.createObjectStore("kv");
        }
        if (oldVersion < 2 && !d.objectStoreNames.contains("profiles")) {
          d.createObjectStore("profiles", { keyPath: "pk" });
        }
      },
    });
  }
  return dbp;
}

// Ask the browser to make this origin's storage durable so it isn't evicted
// between visits. This is what keeps an INSTALLED PWA from "forgetting" you:
// without it, iOS/Safari (and others, under storage pressure) can clear the
// IndexedDB that holds your identity, logging you out on the next launch.
// Best-effort and idempotent — safe to call repeatedly. Browsers grant it more
// readily for installed PWAs and right after a user gesture (e.g. sign-in).
let persistTried = false;
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const s: StorageManager | undefined = navigator.storage;
    if (!s?.persist) return false;
    if (await s.persisted?.()) return true;     // already durable — nothing to do
    if (persistTried) return false;             // don't spam the request
    persistTried = true;
    return await s.persist();
  } catch { return false; }
}

/* ---------- identity ---------- */
export const storage = {
  async saveIdentity(id: SecretIdentity) {
    (await db()).put("identity", id);
    // The moments we save an identity (create / import / token login) are
    // exactly when we most want storage to stick — request durability now.
    void requestPersistentStorage();
  },
  async loadIdentity(): Promise<SecretIdentity | undefined> {
    const all = await (await db()).getAll("identity");
    return all[0];
  },
  async clearIdentity() {
    const d = await db();
    const keys = await d.getAllKeys("identity");
    await Promise.all(keys.map((k) => d.delete("identity", k)));
  },

  /* ---------- posts ---------- */
  async putPost(p: Post) { (await db()).put("posts", p); },
  async getPost(id: string) { return (await db()).get("posts", id); },
  async allPosts(): Promise<Post[]> {
    return (await (await db()).getAllFromIndex("posts", "byTime")).reverse();
  },
  async postsByAuthor(pk: string) { return (await db()).getAllFromIndex("posts", "byAuthor", pk); },
  async deletePost(id: string) { (await db()).delete("posts", id); },
  /** Bounded newest-first working set for the feed. A community view reads that
   *  community's index; the global view scans the newest window (capped) and keeps
   *  every human/self/peer post while capping the rss/nostr firehose at `limit` —
   *  so per-render cost is constant no matter how large the global corpus grows. */
  async recentPosts(limit = 800, community?: string): Promise<Post[]> {
    const d = await db();
    if (community) {
      const all = await d.getAllFromIndex("posts", "byCommunity", community);
      all.sort((a, b) => b.createdAt - a.createdAt);
      return all.slice(0, limit);
    }
    // Read ONLY the newest `scanCap` posts (newest-first) via a raw IndexedDB cursor.
    // Bounding the read is the whole game at scale. The previous getAllFromIndex loaded
    // the ENTIRE posts store — thousands of records each carrying a 256-float embedding —
    // into memory on EVERY feed refresh; that single bulk deserialize cost ~2s on a large
    // corpus and, fired back-to-back as the relay/Nostr firehose streamed in, pinned the
    // main thread ("page unresponsive"). A *raw* cursor (no per-item await — the await was
    // the slow part of the earlier cursor attempt) walks just the newest window and stops,
    // so feed cost is constant no matter how large the global corpus grows.
    const scanCap = Math.max(limit * 2, 1200);
    const raw = unwrap(d) as unknown as IDBDatabase;
    const newest = await new Promise<Post[]>((resolve, reject) => {
      const acc: Post[] = [];
      const req = raw.transaction("posts", "readonly").objectStore("posts").index("byTime").openCursor(null, "prev");
      req.onsuccess = () => {
        const cur = req.result;
        if (cur && acc.length < scanCap) { acc.push(cur.value as Post); cur.continue(); }
        else resolve(acc);
      };
      req.onerror = () => reject(req.error);
    });
    // `newest` is already newest-first: keep every human/self/changelog post and cap the
    // rss-bot + nostr firehose at `limit`, so per-render cost stays constant.
    const out: Post[] = [];
    let firehose = 0;
    for (const p of newest) {
      if (p.author === "rss-bot" || p.source === "nostr") { if (firehose < limit) { out.push(p); firehose++; } } // rss-bot + nostr = the firehose
      else out.push(p); // humans, your posts, changelog — always kept within the window
    }
    return out;
  },
  /** Cap the external/ephemeral firehose (RSS + Nostr) at `keep` newest, deleting
   *  the oldest surplus. Never touches your own/peer posts. RSS re-syncs from the
   *  relay and Nostr re-streams, so this is a safe rolling cache. Returns # deleted. */
  async pruneEphemeralPosts(keep = 2500): Promise<number> {
    const d = await db();
    const ids: string[] = [];
    let cur = await d.transaction("posts").store.index("byTime").openCursor(null, "next"); // oldest first
    while (cur) { const p = cur.value as Post; if (p.author === "rss-bot" || p.source === "nostr") ids.push(p.id); cur = await cur.continue(); }
    const surplus = ids.length - keep;
    if (surplus <= 0) return 0;
    const tx = d.transaction("posts", "readwrite");
    for (let i = 0; i < surplus; i++) tx.store.delete(ids[i]);
    await tx.done;
    return surplus;
  },

  /* ---------- profiles (cached peer profiles, viewable offline) ---------- */
  async putProfile(p: Profile) { (await db()).put("profiles", p); },
  async getProfile(pk: string): Promise<Profile | undefined> { return (await db()).get("profiles", pk); },
  async allProfiles(): Promise<Profile[]> { return (await db()).getAll("profiles"); },

  /* ---------- messages ---------- */
  async putMessage(m: ChatMessage) { (await db()).put("messages", m); },
  async messages(channel: string): Promise<ChatMessage[]> {
    return (await (await db()).getAllFromIndex("messages", "byChannel", channel)).sort((a, b) => a.createdAt - b.createdAt);
  },

  /* ---------- communities ---------- */
  async putCommunity(c: Community) { (await db()).put("communities", c); },
  async communities(): Promise<Community[]> { return (await db()).getAll("communities"); },
  async deleteCommunity(id: string) { (await db()).delete("communities", id); },

  /* ---------- reputation ---------- */
  async addReputation(e: ReputationLedgerEntry) { (await db()).put("reputation", e); },
  async reputationLedger(): Promise<ReputationLedgerEntry[]> {
    return (await (await db()).getAllFromIndex("reputation", "byTime")).reverse();
  },

  /* ---------- companion ---------- */
  async addCompanionMsg(m: CompanionMessage) { (await db()).put("companion", m); },
  async companionHistory(): Promise<CompanionMessage[]> {
    return (await (await db()).getAllFromIndex("companion", "byTime"));
  },

  /* ---------- kv ---------- */
  async kvGet<T>(key: string): Promise<T | undefined> { return (await db()).get("kv", key) as Promise<T | undefined>; },
  async kvSet<T>(key: string, value: T) { (await db()).put("kv", value, key); },

  /* ---------- settings (kv-backed, mirrored to localStorage for sync reads) ---------- */
  async saveSettings(s: AppSettings) {
    await this.kvSet("settings", s);
    try { localStorage.setItem("nebula:settings", JSON.stringify(s)); } catch {}
  },
  async loadSettings(): Promise<AppSettings | undefined> {
    return (await this.kvGet<AppSettings>("settings")) ?? readSettingsSync();
  },
};

export function readSettingsSync(): AppSettings | undefined {
  try { const r = localStorage.getItem("nebula:settings"); return r ? JSON.parse(r) : undefined; } catch { return undefined; }
}

export const DEFAULT_SETTINGS: AppSettings = {
  feedAlgorithm: "chronological",
  moderationProfile: "discovery",
  companionPersona: "friend",
  useWebLLM: true,
  llmOptOut: false,
  llmModel: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  llmAuto: true,
  presenceStatus: "online",
  reducedMotion: false,
  showFactChecks: true,
  filterNsfw: true,
  censorProfanity: false,
  nostrEnabled: true,
  autoTranslate: true,
  showAds: true,
};
