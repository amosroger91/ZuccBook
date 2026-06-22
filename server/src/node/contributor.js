// ============================================================
//  node/contributor.js — desktop Ledger Node extra (mode === "node"):
//  report a SIGNED contribution heartbeat to the relay so the operator
//  earns network points (uptime + items). The RSS publishing itself
//  lives in publisher.js (shared with the central relay), so a node's
//  "items" credit = how many stories it has published to the feed.
//  No identity loaded → still contributes (publishes), just no heartbeat
//  and no points.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { identity } from "../identity.js";
import { publishedCount } from "../publisher.js";

const startedAt = Date.now();
let lastPoints = 0;
let nodeId = "";

/** Stable per-install node id (so item-delta accounting survives restarts). */
function ensureNodeId() {
  try {
    fs.mkdirSync(config.gunDataDir, { recursive: true });
    const p = path.join(config.gunDataDir, "node-id.txt");
    if (fs.existsSync(p)) nodeId = fs.readFileSync(p, "utf8").trim();
    if (!nodeId) {
      nodeId = "node_" + randomUUID().slice(0, 12);
      fs.writeFileSync(p, nodeId);
    }
  } catch {
    nodeId = "node_" + randomUUID().slice(0, 12);
  }
  return nodeId;
}

/** Sign and send a contribution heartbeat to the relay (earns points). */
async function heartbeat() {
  if (!identity.loaded) return; // anonymous: contribute, but nothing to credit
  try {
    const data = {
      pk: identity.pk,
      name: identity.name,
      nodeId,
      items: publishedCount(), // cumulative; the relay credits the capped delta
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      at: Date.now(),
    };
    const env = await identity.sign(data);
    const r = await fetch(`${config.relayBase}/api/contrib`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(env),
    });
    if (r.ok) {
      const j = await r.json();
      lastPoints = j.points ?? lastPoints;
      console.log(`[node] heartbeat ok · ${identity.fingerprint()} · ${lastPoints} pts`);
    }
  } catch {
    /* relay unreachable — retry next interval */
  }
}

export function startContributor() {
  ensureNodeId();
  setTimeout(heartbeat, Math.min(8000, config.heartbeatMs)); // first beat soon
  setInterval(heartbeat, config.heartbeatMs);
  console.log(
    `[node] contributor · id=${nodeId} · identity=${identity.loaded ? identity.fingerprint() : "anonymous"} · relay=${config.relayBase}`,
  );
}

/** Live stats for the tray / local dashboard. */
export function nodeStats() {
  return {
    mode: config.mode,
    nodeId,
    identity: identity.loaded ? identity.fingerprint() : "anonymous",
    anonymous: !identity.loaded,
    published: publishedCount(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    points: lastPoints,
    relay: config.relayBase,
  };
}
