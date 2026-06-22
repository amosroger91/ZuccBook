// ============================================================
//  relayService — HTTP client for Ledger's always-on relay
//  (the deployed backend at ledger.wellspringstudiollc.com).
//
//  The relay does double duty: it's a Gun peer (see gunService PEERS,
//  for durable persistence + server-aggregated RSS that arrives over
//  the graph), and it exposes this HTTP API for things Gun can't do —
//  configuring the shared RSS feed list and reading network-contribution
//  points. CORS is open on the relay, so the browser can call it directly.
// ============================================================
const RELAY = ((import.meta as any).env?.VITE_LEDGER_RELAY as string) || "https://ledger.wellspringstudiollc.com";

export interface NetworkFeed {
  id: string;
  title: string;
  url: string;
  topic: string;
}

export interface Contribution {
  pk: string;
  points: number;
  uptimePoints: number;
  itemPoints: number;
  items: number;
  nodes: number;
  online: boolean;
  lastSeen: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(RELAY + path, init);
  if (!r.ok) throw new Error(`relay ${r.status}`);
  return r.json() as Promise<T>;
}

export const LEDGER_RELAY = RELAY;

export const relayService = {
  base: RELAY,
  health: () => api<any>("/health"),
  /** A user's network-contribution points — null if the relay is unreachable. */
  points: (pk: string) => api<Contribution>(`/api/points/${encodeURIComponent(pk)}`).catch(() => null),
  leaderboard: () => api<{ leaders: Contribution[] }>("/api/leaderboard"),
  /** The shared, server-side RSS feed list everyone's timeline draws from. */
  listFeeds: () => api<{ feeds: NetworkFeed[] }>("/api/feeds"),
  /** Add any feed: { url } | { channelId } | { rsshub: "/twitch/live/x" }, + optional topic. */
  addFeed: (body: Record<string, string>) =>
    api<{ feed: NetworkFeed }>("/api/feeds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  removeFeed: (id: string) => api<{ removed: boolean }>(`/api/feeds/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
