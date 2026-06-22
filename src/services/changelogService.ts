// ============================================================
//  changelogService — turns the repo's own git history into timeline
//  activity. Pulls recent commits from the GitHub API (CORS-enabled,
//  no key) and posts them as "Ledger Dev 🛠️" so the app's evolution
//  shows up right in the feed. Deduped by commit SHA and persisted via
//  Gun, exactly like the RSS bot — so it spreads across the network.
// ============================================================
import type { Post } from "@/types";
import { storage } from "./storage";
import { feedService } from "./feedService";
import { embed } from "@/lib/embeddings";
import { bus } from "@/lib/events";

// Real GitHub repo path — the changelog feed fetches commits from here via the
// GitHub API. Must stay the actual repo slug; update if the repo is renamed.
const REPO = "amosroger91/Ledger";
const THROTTLE_MS = 30 * 60 * 1000;

class ChangelogService {
  async refresh(force = false): Promise<number> {
    const last = (await storage.kvGet<number>("changelog:lastRun")) ?? 0;
    if (!force && Date.now() - last < THROTTLE_MS) return 0;
    await storage.kvSet("changelog:lastRun", Date.now());
    let posted = 0;
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=15`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (!r.ok) return 0;
      const commits: any[] = await r.json();
      for (const c of commits) {
        const sha: string = c.sha; if (!sha) continue;
        const id = "commit_" + sha.slice(0, 12);
        if (await storage.getPost(id)) continue;       // dedupe by commit
        const msg: string = (c.commit?.message ?? "").trim();
        const title = msg.split("\n")[0];
        const body = msg.slice(title.length).trim().split("\n").filter((l) => !/^Co-Authored-By:/i.test(l.trim())).join("\n").trim();
        const date = Date.parse(c.commit?.committer?.date ?? c.commit?.author?.date ?? "") || Date.now();
        const post: Post = {
          id,
          author: "system",
          authorName: "Ledger Dev 🛠️",
          kind: "text",
          text: [`🛠️ ${title}`, body, c.html_url].filter(Boolean).join("\n\n"),
          tags: ["ledger"],
          createdAt: date,
          reactions: {},
          embedding: embed(`${title} ${body} ledger changelog commit`),
          source: "relay",
        };
        await feedService.ingest(post);   // ingest dedupes; ignored if already present
        bus.emit("post:publish", post);   // persist + distribute over Gun
        posted++;
      }
    } catch { /* offline / rate-limited — try again next time */ }
    return posted;
  }
}

export const changelogService = new ChangelogService();
