# Ledger — Server (Gun relay + RSS worker + points)

> The **lightweight** backend for Ledger. The app still runs with **no server**
> (identity on-device, data in IndexedDB, P2P over Gun/WebRTC). This box does the
> three things pure-P2P can't do alone:
>
> 1. **Persistence** — a **Gun.js relay** that stays online 24/7, syncs the global
>    graph (feed, creator posts, profiles, NFT metadata), and persists it to disk so
>    data survives when every human peer is offline.
> 2. **Aggregation** — an **RSS worker** that refreshes the *entire* topic catalog
>    (news, YouTube, podcasts, Reddit, GitHub, TikTok, Twitch via RSSHub…) every few
>    minutes and **publishes every story into the global Gun feed**, so clients
>    receive them over the graph and **never have to fetch RSS themselves**.
> 3. **Network points** — a small contribution ledger: contributor nodes send signed
>    heartbeats, the relay tallies points (uptime + items), and profiles display them.
>
> No database. No blockchain. Just a relay and a poller.

**Live:** `https://ledger.wellspringstudiollc.com` (behind Apache + Let's Encrypt; the
Render free-tier blueprint in [`render.yaml`](./render.yaml) also works). The relay is
at `/gun`.

---

## How RSS refresh works — who computes (the important part)

The relay is the **only** thing that fetches RSS. It refreshes the **whole catalog**
([`src/rss/feeds.js`](./src/rss/feeds.js), ported from the app's topics) every
`RSS_REFRESH_MS` (**default 10 min**) — resolving soft refs server-side (YouTube
handles → `videos.xml`, podcast names → their feed via Apple's iTunes search, CVE
keywords → NVD) and falling back through CORS proxies when a source throttles the
server IP. Each story is published into the global Gun feed once (idempotent by a
stable id). The result:

- **Clients never fetch RSS on their own.** The app opens the relay as a Gun peer and
  the stories just arrive over the graph — zero client-side network/CPU for feeds.
- **The only client-side "compute" is a manual refresh.** The app's **Refresh now**
  button (and adding a *private* custom feed) does a one-off client-side pull — for
  when you want data *fresher than the relay's last cycle*. Under normal use nobody
  needs it, because the relay's data is at most a few minutes old (well under the app's
  1-hour client cache).
- **One fetch, everyone benefits.** A feed is pulled once per cycle for the whole
  network instead of once per device.

Add to the shared catalog at runtime with `POST /api/feeds` (any RSS/Atom URL, a
YouTube `channelId`, or an RSSHub route) — the relay starts pulling it for everyone.

---

## API

| Method & path | What it returns |
|---|---|
| `GET /gun` | The Gun.js relay endpoint (in the frontend's peer list). |
| `GET /health` · `GET /api/stats` | Liveness + store/feed counts + last refresh time. |
| `GET /api/timeline` | Merged Gun posts + RSS, newest-first, paged. |
| `GET /api/posts` | Gun-persisted posts only (`?author=<pk>`, `?limit=`). |
| `GET /api/profiles/:pk` · `GET /api/nft[/:id]` | Persisted profile / NFT metadata. |
| `GET /api/feeds` · `GET /api/feeds/:id` | The shared RSS catalog / one feed's items. |
| `POST /api/feeds` | Add a feed: `{ url }` **or** `{ channelId }` **or** `{ rsshub: "/twitch/live/x" }` (+ `topic`). |
| `DELETE /api/feeds/:id` | Remove a feed from the shared catalog. |
| `POST /api/refresh` | Force a catalog refresh (also a handy uptime-ping target). |
| `POST /api/contrib` | A contributor node's **signed** points heartbeat (verified, then credited). |
| `GET /api/points/:pk` · `GET /api/leaderboard` | A user's network points / the top contributors. |

`GET /api/timeline` params: `limit` (≤200) · `before` (createdAt-ms cursor) ·
`topics` (CSV; filters RSS by tag) · `kinds` (CSV) · `source` (`all`|`gun`|`rss`).
Every item is the frontend's `Post` shape; RSS items use `author:"rss-bot"`, which is
exempt from the app's signature verification (see `src/lib/records.ts#isBotAuthor`).

---

## Run locally

```bash
cd server && npm install && npm run dev      # http://localhost:8787
curl localhost:8787/health
curl "localhost:8787/api/timeline?limit=5"
```

## Deploy

**Live deployment (this box):** a Docker container behind Apache —

```bash
# on the server, in /opt/ledger:
git pull --ff-only
docker build -t ledger-server ./server
docker rm -f ledger-server
docker network create ledger-net 2>/dev/null || true
docker run -d --name ledger-server --restart unless-stopped --network ledger-net \
  -p 127.0.0.1:8787:8787 -e GUN_DATA_DIR=/data -v ledger-data:/data \
  -e RSSHUB_BASE=http://rsshub:1200 ledger-server
```

Apache vhost (`ledger.wellspringstudiollc.com`) reverse-proxies to `127.0.0.1:8787`
with a WebSocket upgrade for `/gun`; cert via `certbot --apache`.

**Self-hosted RSSHub** (the public `rsshub.app` is now restricted to "testing only", so
the app's "add any RSSHub route" option needs a real instance). Runs as a sibling
container on the same network; the relay reaches it at `http://rsshub:1200`:

```bash
docker run -d --name rsshub --restart unless-stopped --network ledger-net \
  -e NODE_ENV=production -e CACHE_TYPE=memory diygod/rsshub:latest
```

It powers Twitch/Instagram/X/etc. routes. **Not** YouTube (needs an API key on RSSHub —
the relay fetches `videos.xml` directly instead) or Reddit (Reddit blocks datacenter
IPs, so neither direct nor RSSHub-on-the-same-box can pull it).

**Render (free):** New ▸ Blueprint ▸ this repo (reads `render.yaml`, `rootDir: server`).

## Frontend wiring (done)

- `src/services/gunService.ts` lists `https://ledger.wellspringstudiollc.com/gun` as a
  Gun peer → durable persistence **and** the relay's server-aggregated RSS over the graph.
- `src/services/index.ts` no longer auto-fetches RSS (the relay does it); it only seeds
  the default topic subscriptions. **Refresh now** in Topics is the sole client-side pull.
- `src/components/topics/RelayFeeds.tsx` configures the shared catalog via `/api/feeds`.
- `src/components/profile/ProfileView.tsx` shows a "Network pts" tile from `/api/points/:pk`.

## Config

All env vars optional — see [`.env.example`](./.env.example).

| Var | Default | Notes |
|---|---|---|
| `GUN_ROOT` | `zuccbook-v1` | **Must match** the frontend's `ROOT` (graph namespace; not brand text). |
| `GUN_DATA_DIR` | `./data` | radisk persistence; mount a volume here for durability. |
| `RSS_REFRESH_MS` | `600000` | How often the relay refreshes the **whole** catalog (10 min). |
| `RSS_CONCURRENCY` | `6` | Feeds fetched in parallel per cycle. |
| `RSS_MAX_ITEMS` | `1500` | Ring buffer of newest items kept in memory. |
| `LEDGER_PUBLISH_RSS` | `true` | Publish aggregated RSS into the global Gun feed. |
| `RSSHUB_BASE` | `https://rsshub.app` | Base for RSSHub routes. Public rsshub.app is restricted — point at a **self-hosted** instance (`http://rsshub:1200`). |
| `LEDGER_MODE` | `relay` | `node` = a desktop contributor (publishes + signed heartbeats). |

## Honest limitations

- **Signatures:** human posts/profiles/listings are signed and verified on the frontend
  (`src/lib/records.ts`); bot authors (`rss-bot`/`system`) are exempt, so relay RSS is
  accepted. The relay itself doesn't re-verify what it persists — like any Gun peer.
- **Server-side fetch gaps:** YouTube needs a consent cookie (handled) — its `videos.xml`
  then fetches fine. **Reddit blocks datacenter IPs entirely** (direct *and* via RSSHub on
  the same box), so subreddits fill only via a user **Refresh now**. RSSHub routes use the
  **self-hosted** instance (public `rsshub.app` is restricted to testing).
- **In-memory read index:** the timeline is served from RAM and rebuilt from the Gun graph
  on boot; sized for a community swarm, not millions of posts.
- **Render free tier** sleeps after ~15 min idle with an ephemeral disk; the live VPS
  deployment above avoids both.
