// ============================================================
//  config.js — env with sane defaults. The ROOT constant MUST match
//  the frontend (src/services/gunService.ts `ROOT`) so this relay
//  joins the same graph and persists the same records.
// ============================================================
const env = process.env;
const list = (s, fallback = []) =>
  s ? s.split(",").map((x) => x.trim()).filter(Boolean) : fallback;

export const config = {
  port: Number(env.PORT) || 8787,
  // Gun graph root — keep in lockstep with the frontend.
  root: env.GUN_ROOT || "zuccbook-v1",
  // Where Gun's radisk persists the graph. EPHEMERAL on Render free tier;
  // point at a mounted disk for durable 24/7 persistence (see render.yaml).
  gunDataDir: env.GUN_DATA_DIR || "./data",
  // Public Gun relays we also sync FROM (so a freshly-woken relay bootstraps
  // its graph from the swarm instead of starting empty).
  gunPeers: list(env.GUN_PEERS, [
    "https://gun-manhattan.herokuapp.com/gun",
    "https://peer.wallie.io/gun",
    "https://relay.peer.ooo/gun",
  ]),
  rss: {
    refreshMs: Number(env.RSS_REFRESH_MS) || 10 * 60 * 1000, // 10 min
    concurrency: Number(env.RSS_CONCURRENCY) || 4,
    fetchTimeoutMs: Number(env.RSS_FETCH_TIMEOUT_MS) || 12000,
    maxItems: Number(env.RSS_MAX_ITEMS) || 800, // ring buffer of newest RSS items
  },
  // Optional RSSHub base for sources with no native RSS (Twitch, etc.).
  rsshubBase: (env.RSSHUB_BASE || "https://rsshub.app").replace(/\/$/, ""),
  // CORS: "*" allows any origin (GitHub Pages / custom domain); or a CSV list.
  corsOrigin: env.CORS_ORIGIN || "*",

  // --- contributor node / network points (the Ledger Node desktop app) ---
  // "relay" = the always-on central box: read-only persistence + the merged API
  //           + the points ledger (it tallies contribution).
  // "node"  = a contributor running on someone's PC: it ALSO publishes aggregated
  //           RSS into the global feed and reports signed heartbeats to earn points.
  mode: env.LEDGER_MODE === "node" ? "node" : "relay",
  // Publish aggregated RSS into the global Gun feed so every client sees it.
  // ON by default — the central relay seeds the feed; desktop nodes also publish.
  publishRss: env.LEDGER_PUBLISH_RSS !== "false",
  // Where a contributor node reports its points.
  relayBase: (env.LEDGER_RELAY || "https://ledger-server.onrender.com").replace(/\/$/, ""),
  // Path to the operator's identity JSON (the file the web app exports). Empty =
  // run anonymously: still contributes, but earns no points (nothing to credit).
  identityPath: env.LEDGER_IDENTITY || "",
  // How often a node sends a contribution heartbeat.
  heartbeatMs: Number(env.LEDGER_HEARTBEAT_MS) || 5 * 60 * 1000,
  // Points policy (uptime + items). Caps bound how fast points can be claimed.
  points: {
    uptimePerBeat: Number(env.LEDGER_UPTIME_POINTS) || 1, // per heartbeat of real uptime
    itemWeight: Number(env.LEDGER_ITEM_WEIGHT) || 1, // points per published item
    itemCapPerBeat: Number(env.LEDGER_ITEM_CAP) || 50, // max items credited per heartbeat
  },
};
