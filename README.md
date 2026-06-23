<p align="center">
  <img src="public/logo.png" alt="Ledger logo" width="140" height="140" />
</p>

<h1 align="center">Ledger</h1>

<p align="center"><b>A social network you own — peer-to-peer at the core, minimally centralized by design.</b></p>

Stop and think about how strange this is for a second:

**The social core runs with no company-owned backend.** Your identity, your posts,
and your messages live **on your own device**, and you talk to other people
**directly, browser-to-browser**. When you post or chat here, it doesn't travel to a
corporate data center to be scanned, profiled, sold, or "moderated" by someone you'll
never meet. There's no company-owned database in the middle — nothing for a tech
giant to mine, profile, or flip a switch to take away. The AI that powers your feed
and your companion runs **on your own computer**, not in someone's cloud.

To be precise (because this is easy to oversell): Ledger is **minimally
centralized**, not zero-infrastructure. The peer-to-peer core needs no backend, but
it does lean on **shared, swappable relays** — public WebRTC/Gun peers for sync, and
an **optional** persistence + RSS-aggregation node ([`server/`](./server), described
below). None of them own your data or hold authority over you, they only pass along
signed records anyone can verify, and the app keeps working if they disappear. In
short: **core social functionality is peer-to-peer; optional relay services improve
persistence and discovery.**

And here's the part that's honestly just *very cool*: **the GitHub repository you're
reading right now is also what serves the live app — for free.** GitHub Pages serves
these static files to the whole world at $0/month, with **no required backend** of
your own. A complete social platform that fits in a folder. (The name fits what it
is: every post is a **signed entry in an open record** that no company keeps the
books on — your social life as a public ledger that *you* own, not them.) 😄

> **In plain terms:** normally a social app = your data sitting on a corporation's
> computers, under their rules. Ledger flips it: *your* computer is the computer,
> *you* own your account (it's literally a file), and the "website" is just free,
> public, static code anyone can read, fork, or re-host. Decentralization where it
> counts — and honest about the shared relays where it doesn't.

## This is radical ownership as a tech consumer

Ledger is what it looks like to **own your software instead of renting it from a
platform.** You own your identity (a keypair on your device), your data (in your
browser, not a data center), the AI (it runs on your own GPU), your money (a
self-custody wallet whose key never leaves you), and even *what you trust* — no
company in the middle decides any of it. The relays Ledger syncs through can't mine
you, profile you, sell you, shadow‑ban you, or memory-hole you: they only pass along
**signed** records anyone can verify, and you can point at different ones or run your
own. You are not the product. You are the owner.

## 🔗 Live app: https://amosroger91.github.io/Ledger/

> Open it in **two browser windows** to watch presence, chatrooms, and the post
> relay connect peer-to-peer — through free public relays, with no company-owned
> backend in between.

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
  sharing, and **voice/video** (WebRTC mesh), all browser-to-browser through a free
  public broker.
- **Chat — Ledger Chat & Global Chat** — DMs plus two live rooms, each a one-tap
  bubble that docks bottom-right and stays connected while minimized: **Ledger Chat**
  (the in-app, Gun-backed lounge — formerly "Swarm Lounge"), and **Global Chat**, a
  public **Nostr ([NIP-28](https://github.com/nostr-protocol/nips/blob/master/28.md))**
  channel that anyone on the Nostr network shares with you — no server, no gateway.
- **Watch & Listen Together** — internet radio *and* YouTube, with a **persistent
  mini-player** docked at the bottom of every screen (play/pause, station, volume).
- **Topics & RSS Bot** — subscribe to topics and a bot keeps your feed alive even
  with zero human traffic: it pulls the top stories from the most relevant feeds
  (curated list across 10 topics + your own custom feeds, individually toggleable)
  and posts the headline, summary, link, and time. Stories you "missed" while away
  backfill into the timeline at their real publish time.
- **Nostr bridge** — Ledger speaks **[Nostr](https://nostr.com/)**: notes (kind 1)
  for popular hashtags and the topics you follow stream in from public relays as
  external **NOSTR** users (each note's schnorr signature verified before it's shown).
  You can **reply and react**, and because Ledger holds a Nostr keypair for you, those
  actually reach the real authors. **Sign in with your existing Nostr account** (paste
  your `nsec…` at sign-up) or get a fresh key automatically. Markdown-formatted and
  foreign-language notes render cleanly, with one-tap **translate-to-English**. The
  same Nostr key signs **Global Chat** — a public **NIP-28** channel (see above).
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
- **On-device adult-content filter** — optional NSFW filtering that runs **entirely
  in your browser**: explicit images are classified by a local neural net
  ([nsfwjs](https://github.com/infinitered/nsfwjs) / TensorFlow.js — the picture
  never leaves your device) and blurred behind a tap, and posts with explicit
  language are gated. A separate **profanity censor** can mask cuss words inline
  (f\*\*k). On by default, toggleable in Settings, fails open so it never breaks the feed.
- **AI-driven fact-checking** — a **"Fact-check this"** button uses your **own
  device's LLM** to derive keywords from a headline, searches **PolitiFact**, and
  links a real fact-check if one exists (with an **"Is this in error?"** re-check
  on each result). You donate a moment of your own compute to the platform's
  integrity — no fact-check server, no third party deciding truth for you.
- **Live online count** + rich presence (online/idle/away/dnd + activity).
- **Notifications** — an in-app bell for replies, reactions, DMs and watch-party
  invites; tap one to jump straight to the post.
- **Live changelog in your feed** — the app's own GitHub commits stream into the
  timeline as "Ledger Dev 🛠️", so you watch it evolve from inside the app.
- **Run a node, earn network points** — anyone can run the optional persistence
  node (below) and earn points on a transparent contribution leaderboard
  (uptime + items served). No company decides who counts.
- **Offline-first** — everything lives in your browser (IndexedDB); the UI is the
  **Bliss / Luna** glass design system (a Windows-XP homage).

---

## RSS: an old idea that quietly fixes social media

Ledger leans hard on **[RSS](https://en.wikipedia.org/wiki/RSS)** — a 25-year-old
open standard that big social media spent a decade burying, because it does the one
thing their business model can't survive: it lets *you* read everything from
*everywhere* without an algorithm deciding what you deserve to see.

Here's the humility most platforms refuse to admit: **we are not the whole
internet.** Facebook, X, and TikTok all pretend their walled garden *is* the world,
and trap you inside it. Ledger does the opposite — it assumes the good stuff lives
out *there*, on everyone else's timelines, and simply **tunes in.** Through RSS,
your Ledger timeline can monitor *other* timelines: news sites, YouTube channels,
**TikTok creators**, podcasts, subreddits, GitHub releases, a daily Bible verse —
any feed on the open web. An always-on **relay** pulls the whole catalog server-side
every few minutes and seeds the stories into the shared feed, so they appear right
alongside your friends' posts and **your device never has to fetch them.** You only
pull anything yourself if you hit "Refresh now" wanting something fresher than the
relay's last cycle.

And the part that matters most: **you control your own algorithm.** There is no
engagement-maximizing black box optimizing for outrage to sell ads. *You* pick the
topics, *you* toggle each individual source on or off, *you* choose the ranking
(Newest / For You / Trending / Discovery), and the ranking that does run runs **on
your device** where you can inspect exactly why anything surfaced. The feed is
yours, assembled from the whole open web, on your terms — not a corporation's.

---

## Distributed fetching — readers share the load

Pulling RSS costs *some* compute — somebody has to actually hit each feed. The
optional relay node does this routinely server-side, so feeds stay fresh even when
no one's around. But Ledger also has a **client-side** trick for when *you* hit
"Refresh now," so the news layer doesn't *depend* on the relay: the readers share
the work, together, exactly once.

Every feed carries a tiny **shared "last-fetched" stamp** on the
[Gun.js](https://gun.eco/) graph. When you refresh, your device looks at only the
feeds *you personally follow*, and only pulls the ones **nobody has fetched in the
last hour**. Whatever you pull lands on the shared timeline, so everyone else just
*receives* it — they never re-fetch it. So if you follow feeds 1–3 and your friend
follows 2–4, and you refresh first, you grab 1–3; when they refresh, 2 and 3 are
already fresh, so they only pull 4.

The result is genuinely cool:

- **No duplicated work** — the load spreads across the exact people who care about
  each feed, so nobody fetches the whole internet, only the slivers real humans
  actually read.
- **It self-balances** — the more readers a feed has, the less often any one of
  them has to do the pull.
- **"You're contributing compute" is literally true** — on a manual refresh your
  device does a real, relevant, un-duplicated piece of work on behalf of everyone
  who follows those same feeds.

So even with the relay switched off, the news layer keeps running on borrowed slices
of its readers' devices — no cron job required, no per-user cloud bill.

---

## Nostr — plug into the wider open network

RSS brings the read-only web in; **[Nostr](https://nostr.com/)** plugs Ledger into a
whole *interactive* decentralized network — millions of notes from a protocol that,
like Ledger, has no company in the middle. A raw-WebSocket client connects to public
relays and streams in **kind-1 notes** for popular hashtags **plus the topics you
follow**, ingesting them as posts authored by `nostr:<pubkey>`. They sit right in your
feed but are clearly marked as a different **type** of user (external), and **every
note's schnorr signature is verified** before it's shown, so forgeries are dropped.

It's genuinely **two-way**. On first use Ledger generates a **Nostr keypair** for you
(or, at sign-up, you can paste your existing **`nsec…`** to sign in with the account
you already have). With it, your **replies** (NIP-10) and **reactions** (kind 7) are
signed and published back to the relays — the real Nostr authors actually receive
them — and you can post brand-new notes too. A couple of niceties make the foreign
firehose readable:

- **Markdown rendering** — Nostr notes commonly use `**bold**`, `*italic*`, `` `code` ``,
  links, `#hashtags` and `nostr:` references; Ledger renders that formatting safely
  (as escaped React nodes, never injected HTML).
- **Translate to English** — non-English notes get a one-tap **"Translate to English"**
  (clearly labeled, with a toggle back to the original), or auto-translate from Settings.

Toggle the whole bridge on/off in **Settings → Nostr posts**. Nothing about it touches
your Ledger identity — it's a separate key for a separate network, bridged into one feed.

---

## Your timeline is also the app's changelog

Ledger has no separate "release notes" page — it ships its own story **into your feed.**
A built-in bot pulls the repository's recent **GitHub commits** (via the public GitHub
API, no key), de-dupes them by commit **SHA**, and posts each one as **"Ledger Dev 🛠️"**
right in the timeline — then syncs them over [Gun.js](https://gun.eco/) like any other
post, so the whole network watches the project evolve in real time, from inside the app.

That same timeline is one **unified, signed, self-healing record**: human posts, RSS-Bot
stories (backfilled at their real publish time), bridged Nostr notes, and the dev
changelog all land in the same place, ranked on your device, and reconciled
peer-to-peer (see [Emergent collective memory](#emergent-collective-memory) below).

---

## Emergent collective memory

Here's the part that feels almost alive. With no *required* server, where does the
*history* live? **In the swarm — and it heals itself.**

When any two people connect peer-to-peer, their apps quietly **reconcile their
timelines**: each one tells the other which posts it already has, and they
**backfill each other's gaps** — never deleting, never duplicating, only filling in
what's missing. Combined with the durable [Gun.js](https://gun.eco/) graph that
persists posts across sessions (and the optional always-on node, if one is running),
this means the network's memory isn't stored in one company-owned place — it's
**smeared across everyone who's ever been online**, and every new connection makes
it more complete.

So picture it: someone's been on the network for months, posting and collecting a
deep timeline. You sign up today. The moment you're both online, your app and
theirs shake hands and sync — and **you can scroll back through everything they
could see, as if you'd been here the whole time.** Nobody "uploaded the database" to
a company — the history simply *emerges* from people meeting, the same way a rumor
spreads through a town until everyone knows it (and an always-on node, if present,
just makes sure it's always there) — except here it's exact, signed, and lossless.

No company-owned archive. No "you had to be there." Just a collective memory that
**reassembles itself out of the people who hold it** — and, optionally, a node that
keeps a copy always reachable.

---

## Posting is permanent — by design

There's a flip side to a company-free core: **there's no single database to delete from.**
When you post on Ledger, it doesn't sit in one company's database where a "delete"
button can wipe it. It's **signed by your key and replicated** — across the durable
[Gun.js](https://gun.eco/) graph, across the peers who received it, and into the
local storage of everyone who's already seen it. The same architecture that means
**nobody can censor or memory-hole your posts** also means **you can't un-ring the
bell.** Once something is out, it's out.

This is the honest trade of decentralization, and the app says so right in the
composer: *posting is permanent — once it's out, it spreads across the network and
can't be unsent or deleted. Post like it's forever, because it is.* Treat it like
speaking in public, not like a draft you can quietly take back.

---

## Have your cake and eat it too — the optional persistence node

Pure peer-to-peer has one honest weakness: if nobody who holds a post is currently
online, that post is temporarily unreachable until someone who has it reconnects.
Big platforms "solve" this with a data center that *owns* everything. Ledger takes a
middle path that keeps the ownership story completely intact: **one optional node
that is just another peer.**

The [`server/`](./server) directory is a tiny Node.js process (Express + Gun.js,
~four dependencies) that does three things:

- **Durable persistence** — it joins the *same* Gun graph every browser uses (its
  `GUN_ROOT` must match the client's `zuccbook-v1`) and writes everything to disk
  (Gun's radisk). Because it's online 24/7, the global feed, profiles, listings,
  trust edges and the network-points ledger survive even when **zero humans** are
  online. Someone who signs up today syncs the full history in seconds instead of
  waiting for a peer who happens to hold it.
- **Server-side RSS aggregation** — it polls the whole topic catalog every ~10
  minutes and seeds the stories into the shared feed, so your device never has to
  fetch them (see ["Distributed fetching"](#distributed-fetching--the-readers-are-the-server) above).
- **A network-points ledger** — it tallies contribution (uptime + items published)
  for anyone running a node, exposed at `/api/leaderboard` and `/api/points/:pk`.

**Why this is cake, eaten:** the node has **no special authority.** It's *read-only*
— it never originates content, can't sign as you, can't censor, can't delete, and
holds no data that isn't already public and replicated across every peer. It is one
more voice in the swarm that simply never sleeps.

**And if it stops, nothing breaks.** Pull the plug and the app keeps working exactly
as before: clients still talk browser-to-browser over PeerJS, still sync over the
other public Gun relays, still keep everything in local IndexedDB, and still backfill
each other's gaps on every connection. You lose the *convenience* of always-available
history and server-side RSS — not your identity, your posts, your messages, or your
ability to use the app. The node is a **luxury, not a dependency.** That's the entire
trick: the reliability of a server with none of the lock-in.

Run your own — it's four commands:

```bash
cd server
cp .env.example .env        # set GUN_ROOT to match the client (zuccbook-v1)
npm install && npm start    # :8787 — /gun is the relay, /api/* the read API
# or with Docker:
# docker build -t ledger-server . && docker run -p 8787:8787 -v ledger-data:/data ledger-server
```

The live app lists one such node (`ledger.wellspringstudiollc.com/gun`) **alongside**
the public Gun relays in `src/services/gunService.ts` — but it sits there as just
another peer. Delete that line and the app is unchanged.

---

## How it works (genuinely no required backend)

GitHub Pages only serves static files, so the Ledger *app* is pure browser tech and
needs nothing else to run:

- **[PeerJS](https://peerjs.com/) / WebRTC** — direct browser-to-browser data &
  media through a free public broker. Chatrooms and the post relay use a **star
  topology**: the first person in a room becomes the relay hub and re-election
  happens automatically if they leave.
- **Web Crypto** — your identity keypair, signing, and verification.
- **WebLLM (WebGPU/WASM)** — the AI companion, cached locally after first download.
- **IndexedDB + localStorage** — all your data, on your device, offline-first.
- **[Gun.js](https://gun.eco/)** — a decentralized graph database that syncs over
  public relay peers, so posts (human **and** RSS-Bot) and the public Ledger Chat
  **persist and reach people who were offline** — still with no database you own or pay for.
- **[Nostr](https://nostr.com/)** — a raw-WebSocket client to public Nostr relays
  bridges the wider network into your feed: read verified notes, and publish signed
  replies, reactions and notes with your own Nostr key (`nostr-tools` is used only for
  the crypto — keygen, signing, verification, npub/nsec encoding).
- **An optional persistence node** — a tiny Node.js + Gun relay we keep online 24/7
  for durable history and server-side RSS. It's just another peer with **no
  authority**, and the app works fine without it — see
  [Have your cake and eat it too](#have-your-cake-and-eat-it-too--the-optional-persistence-node) above.
- **No accounts, no auth server, no central database you're locked into, no required hosting cost.**

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

The Wallet/Market move **real funds on Polygon**. Ledger is **non-custodial,
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
- RSS is fetched **server-side by the always-on relay** (it refreshes the whole topic
  catalog every ~10 min and seeds the feed for everyone); clients only fetch on a manual
  "Refresh now." A few sources behind aggressive anti-bot walls can still come up empty.
- True background posting while the tab is closed needs a Service Worker; today the
  feed backfills "missed" stories on return and tops up while open.
- The on-device LLM needs WebGPU and a one-time model download (then it's cached).
- The on-device adult-content filter is best-effort: image classification (nsfwjs)
  isn't perfect and lazy-loads a model on first use (one-time ~MB download), and the
  text filter is wordlist-based, so it catches explicit terms but not context. It
  fails open — a check that errors never blocks content.
- The persistence node is genuinely **optional**; on a free hosting tier its disk can
  be ephemeral, so for truly durable 24/7 history mount a real volume (`GUN_DATA_DIR`).

## Full feature atlas

See **[FEATURES.md](FEATURES.md)** for the complete catalog of everything the
platform does — and, for each feature, the backend‑less / peer‑to‑peer trick that
makes it possible. Architecture deep‑dive in **[ARCHITECTURE.md](ARCHITECTURE.md)**;
moderation philosophy in **[MODERATION.md](MODERATION.md)**.

## Tech

**App:** React · TypeScript · Vite · Material UI (Bliss/Luna theme) · Zustand · IndexedDB (`idb`)
· Gun.js · PeerJS (WebRTC) · nostr-tools (Nostr bridge) · Web Crypto · WebLLM (WebGPU) ·
ethers.js (Polygon) · nsfwjs + TensorFlow.js & obscenity (on-device content filtering).

**Optional node:** Node.js · Express · Gun.js · rss-parser (see [`server/`](./server)).

MIT. *Independent and unaffiliated — there's no company behind Ledger. You own
the ledger, not us.*
