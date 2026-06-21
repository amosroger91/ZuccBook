# 🌌 ZuccBook

### A social network that no company owns — not even a little.

Stop and think about how strange this is for a second:

**This app has no server.** There's no company in the middle. When you post, chat,
or talk here, it doesn't travel to a Facebook data center to be stored, scanned,
profiled, sold, or "moderated" by someone you'll never meet. Your identity, your
posts, and your messages live **on your own device**, and you talk to other people
**directly, browser-to-browser**. There is no central database — so there's nothing
for a tech billionaire to mine, nothing to leak, nothing to subpoena, and nothing
anyone can flip a switch to take away. The AI that powers your feed and your
companion runs **on your own computer**, not in someone's cloud.

And here's the part that's honestly just *very cool*: **the GitHub repository you're
reading right now is also what hosts the live app — for free.** The same code is
both the product *and* the server. GitHub Pages serves these static files to the
whole world at $0/month. No hosting bill. No backend to run. No infrastructure to
own. A complete social platform that fits in a folder and costs nothing to keep
alive. (Yes, it's called *ZuccBook*. Yes, that's the joke.) 😄

> **In plain terms:** normally a social app = your data sitting on a corporation's
> computers, under their rules. ZuccBook flips it: *your* computer is the computer,
> *you* own your account (it's literally a file), and the "website" is just free,
> public, static code anyone can read, fork, or re-host. Decentralization, for real.

## This is radical ownership as a tech consumer

ZuccBook is what it looks like to **own your software instead of renting it from a
platform.** You own your identity (a keypair on your device), your data (in your
browser, not a data center), the AI (it runs on your own GPU), your money (a
self-custody wallet whose key never leaves you), and even *what you trust* — there
is no company in the middle deciding any of it. Nobody can mine you, profile you,
sell you, shadow‑ban you, or flip a switch to take it away, because there is no
"them": just your device, talking directly to other people's devices, over free
and open code. You are not the product. You are the owner.

## 🔗 Live app: https://amosroger91.github.io/ZuccBook/

> Open it in **two browser windows** to watch presence, chatrooms, and the post
> relay connect peer-to-peer with no server in between.

---

## What it does

- **Own your identity** — on first launch your browser generates a cryptographic
  keypair (Web Crypto, ECDSA P-256). Your public key *is* your account; every post
  is signed by it. **Export it as a file** to move to another device. No email, no
  password, no signup, no server.
- **Local feed engine** — posts are ranked **on your device** with on-device
  embeddings + vector search. Newest-first by default, plus For You / Trending /
  Discovery, and a **"why am I seeing this?"** breakdown on every post.
- **On-device AI companion** — a real LLM (WebLLM / WebGPU) that runs **entirely in
  your browser**. Pick the model; it downloads once and is then **cached** (loads
  from memory on later visits). Private by construction — your prompts never leave
  your machine. Falls back to a fast offline engine when there's no WebGPU.
- **Chatrooms** — live peer-to-peer rooms: text chat, presence, reactions, image
  sharing, and **voice/video** (WebRTC mesh), all with no server.
- **Direct & swarm messages** — DMs and a global "Swarm Lounge".
- **Watch & Listen Together** — internet radio *and* YouTube, with a **persistent
  mini-player** docked at the bottom of every screen (play/pause, station, volume).
- **Topics & RSS Bot** — subscribe to topics and a bot keeps your feed alive even
  with zero human traffic: it pulls the top stories from the most relevant feeds
  (curated list across 10 topics + your own custom feeds, individually toggleable)
  and posts the headline, summary, link, and time. Stories you "missed" while away
  backfill into the timeline at their real publish time.
- **Communities** — Discord/Reddit-style servers with text/voice/stage/event channels.
- **Wallet & Market (Polygon)** — a self-custody Polygon wallet (send/receive MATIC
  & USDC) and a marketplace where buying pays the seller on-chain, peer-to-peer.
  Pay anyone from their profile. **Real money — see the risk note below.**
- **Topics / RSS Bot** — subscribe to topics (news, tech, YouTube channels,
  podcasts, Reddit, GitHub releases, CVEs, local news, 3D printing, daily Bible
  verse…) and a bot keeps your feed alive with the latest. Add your own feeds.
- **Profiles** — display name + uploadable photo, stored locally and shared peer-to-peer.
- **Reputation, not followers** — helpfulness/expertise/participation/trust, with ranks & badges.
- **Layered local moderation** — an explainable on-device agent (allow → warn →
  reduce → review → flag) with a contextual **web of trust**, not a corporate
  ban-hammer. You decide what you see, and every verdict shows its reasoning.
- **AI-driven fact-checking** — a **"Fact-check this"** button uses your **own
  device's LLM** to derive keywords from a headline, searches **PolitiFact**, and
  links a real fact-check if one exists (with an **"Is this in error?"** re-check
  on each result). You donate a moment of your own compute to the platform's
  integrity — no fact-check server, no third party deciding truth for you.
- **Live online count** + rich presence (online/idle/away/dnd + activity).
- **Offline-first** — everything lives in your browser (IndexedDB); the UI is the
  **Bliss / Luna** glass design system (a Windows-XP homage).

---

## RSS: an old idea that quietly fixes social media

ZuccBook leans hard on **[RSS](https://en.wikipedia.org/wiki/RSS)** — a 25-year-old
open standard that big social media spent a decade burying, because it does the one
thing their business model can't survive: it lets *you* read everything from
*everywhere* without an algorithm deciding what you deserve to see.

Here's the humility most platforms refuse to admit: **we are not the whole
internet.** Facebook, X, and TikTok all pretend their walled garden *is* the world,
and trap you inside it. ZuccBook does the opposite — it assumes the good stuff lives
out *there*, on everyone else's timelines, and simply **tunes in.** Through RSS,
your ZuccBook timeline can monitor *other* timelines: news sites, YouTube channels,
**TikTok creators**, podcasts, subreddits, GitHub releases, a daily Bible verse —
any feed on the open web. The "RSS Bot" pulls them in and posts them right alongside
your friends' posts.

And the part that matters most: **you control your own algorithm.** There is no
engagement-maximizing black box optimizing for outrage to sell ads. *You* pick the
topics, *you* toggle each individual source on or off, *you* choose the ranking
(Newest / For You / Trending / Discovery), and the ranking that does run runs **on
your device** where you can inspect exactly why anything surfaced. The feed is
yours, assembled from the whole open web, on your terms — not a corporation's.

---

## Posting is permanent — by design

There's a flip side to having no central server: **there's no central server to delete from.**
When you post on ZuccBook, it doesn't sit in one company's database where a "delete"
button can wipe it. It's **signed by your key and replicated** — across the durable
[Gun.js](https://gun.eco/) graph, across the peers who received it, and into the
local storage of everyone who's already seen it. The same architecture that means
**nobody can censor or memory-hole your posts** also means **you can't un-ring the
bell.** Once something is out, it's out.

This is the honest trade of real decentralization, and the app says so right in the
composer: *posting is permanent — once it's out, it spreads across the network and
can't be unsent or deleted. Post like it's forever, because it is.* Treat it like
speaking in public, not like a draft you can quietly take back.

---

## How it works (genuinely no backend)

GitHub Pages only serves static files, so ZuccBook is pure browser tech:

- **[PeerJS](https://peerjs.com/) / WebRTC** — direct browser-to-browser data &
  media through a free public broker. Chatrooms and the post relay use a **star
  topology**: the first person in a room becomes the relay hub and re-election
  happens automatically if they leave.
- **Web Crypto** — your identity keypair, signing, and verification.
- **WebLLM (WebGPU/WASM)** — the AI companion, cached locally after first download.
- **IndexedDB + localStorage** — all your data, on your device, offline-first.
- **[Gun.js](https://gun.eco/)** — a decentralized graph database that syncs over
  public relay peers, so posts (human **and** RSS-Bot) and the public Swarm Lounge
  **persist and reach people who were offline** — still with no database you own or pay for.
- **No accounts, no auth server, no central database, no hosting cost.**

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design, storage schema,
service/AI/P2P layers, and the Phase 2 / Phase 3 roadmap.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

(Use `localhost` or HTTPS — Web Crypto and getUserMedia need a secure context.)

## Deploy (this is the cool part)

```bash
npm run build      # -> dist/  (static files)
```
Push `dist/` to a `gh-pages` branch (or any static host / IPFS / a USB stick) and
it's live. `base: "./"` + HashRouter mean it runs from any path with no server
config. The repo hosts itself.

## ⚠️ Money & risk (please read)

The Wallet/Market move **real funds on Polygon**. ZuccBook is **non-custodial,
open-source software provided “as is”, with no warranty** — it never holds your
keys or your money. The wallet is a **hot burner wallet** whose private key lives
in your browser; if you lose the device or clear site data without exporting the
key, the funds are **gone**. Blockchain transactions are **permanent and
irreversible**. The marketplace is **peer-to-peer with no escrow and no refunds** —
paying a listing sends money to a stranger with no guarantee of delivery. **You
alone are responsible for your funds and transactions. The authors are not liable
for any loss, theft, failed transaction, scam, or damages. Nothing here is
financial advice.** Only use small amounts you can afford to lose.

## Honest limits

- The public PeerJS broker is best-effort; heavy use would want a self-hosted relay.
- Voice/video is a mesh, so it's tuned for small rooms (~8).
- RSS feeds are fetched through public CORS proxies, so a source can occasionally fail.
- True background posting while the tab is closed needs a Service Worker; today the
  feed backfills "missed" stories on return and tops up while open.
- The on-device LLM needs WebGPU and a one-time model download (then it's cached).

## Full feature atlas

See **[FEATURES.md](FEATURES.md)** for the complete catalog of everything the
platform does — and, for each feature, the backend‑less / peer‑to‑peer trick that
makes it possible. Architecture deep‑dive in **[ARCHITECTURE.md](ARCHITECTURE.md)**;
moderation philosophy in **[MODERATION.md](MODERATION.md)**.

## Tech

React · TypeScript · Vite · Material UI (Bliss/Luna theme) · Zustand · IndexedDB (`idb`)
· Gun.js · PeerJS (WebRTC) · Web Crypto · WebLLM (WebGPU) · ethers.js (Polygon).

MIT. *Not affiliated with Facebook/Meta — the name is affectionate satire.*
