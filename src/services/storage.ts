// ============================================================
//  storage.ts — the offline-first persistence layer (IndexedDB).
//  Every other service reads/writes through here. localStorage is
//  used only for tiny hot values (current settings); everything
//  substantial lives in IndexedDB so the app works fully offline.
// ============================================================
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  SecretIdentity, Post, ChatMessage, Community,
  ReputationLedgerEntry, CompanionMessage, AppSettings,
} from "@/types";

interface ZuccBookDB extends DBSchema {
  identity: { key: string; value: SecretIdentity };
  posts: { key: string; value: Post; indexes: { byTime: number; byAuthor: string; byCommunity: string } };
  messages: { key: string; value: ChatMessage; indexes: { byChannel: string; byTime: number } };
  communities: { key: string; value: Community };
  reputation: { key: string; value: ReputationLedgerEntry; indexes: { byTime: number } };
  companion: { key: string; value: CompanionMessage; indexes: { byTime: number } };
  kv: { key: string; value: unknown };
}

const DB_NAME = "nebula";
const DB_VERSION = 1;
let dbp: Promise<IDBPDatabase<ZuccBookDB>> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB<ZuccBookDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
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
      },
    });
  }
  return dbp;
}

/* ---------- identity ---------- */
export const storage = {
  async saveIdentity(id: SecretIdentity) { (await db()).put("identity", id); },
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
};
