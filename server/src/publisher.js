// ============================================================
//  publisher.js — publish aggregated RSS items into the GLOBAL Gun feed
//  (`posts`), so every connected client AND the persistent relay see
//  them. Runs on the central relay (seeds the feed for everyone) and on
//  desktop contributor nodes. Idempotent by stable id, so many
//  publishers converge to a single copy per story.
// ============================================================
import { config } from "./config.js";
import { getGun } from "./gun/relay.js";
import { store } from "./store/index.js";

const published = new Set();
let count = 0;

export function publishedCount() {
  return count;
}

/** Push any newly-aggregated RSS items into Gun `posts`. */
export function publishNewRssToGun() {
  const gun = getGun();
  if (!gun) return 0;
  const posts = gun.get(config.root).get("posts");
  let n = 0;
  for (const item of store.rss.values()) {
    if (published.has(item.id)) continue;
    published.add(item.id);
    const { feedId, feedTitle, link, ...post } = item; // drop API-only provenance
    try {
      posts.get(post.id).put({ json: JSON.stringify(post) });
      count++;
      n++;
    } catch {
      /* skip one bad record */
    }
  }
  if (n) console.log(`[publish] ${n} RSS item(s) -> global feed (total ${count})`);
  return n;
}

export function startPublisher() {
  setTimeout(publishNewRssToGun, 6000); // let feeds fill first
  setInterval(publishNewRssToGun, 30000);
  console.log("[publish] RSS -> Gun publishing ON");
}
