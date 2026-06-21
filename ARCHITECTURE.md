# Nebula — Architecture

> A decentralized, local-first, browser-native social platform. No accounts, no
> servers required for core functionality, ~$0 to host. The browser is the
> computer; the user owns the identity; the feed and the AI run on-device.

This document is the design deliverable: philosophy, structure, schemas,
service & component architecture, the P2P and AI layers, deployment, and the
three-phase roadmap. It describes both **what is implemented today** (the MVP in
this repo) and **what the architecture is built to grow into**.

---

## 1. Philosophy

Traditional social media centralizes the database, the recommendation engine,
moderation, identity, and chat. Nebula inverts every one of those:

| Concern | Traditional | Nebula |
|---|---|---|
| Identity | account on a server | a keypair you generate & own (a file) |
| Feed ranking | cloud recommender | on-device embeddings + vector search |
| AI | cloud inference | local (heuristic engine, optional WebGPU LLM) |
| Chat | central servers | peer-to-peer (WebRTC / PeerJS), relay fallback |
| Moderation | central policy | layered: local AI → community → user filters |
| Storage | their database | your IndexedDB (offline-first) |
| Hosting cost | $$$ | static files (~$0) |

**Design tenet:** the platform should keep working even if the website
disappears — because the app is just static files, the data is in your browser,
and your identity is a file you can carry anywhere.

---

## 2. Tech stack

- **Frontend:** React 18 + TypeScript + Vite + Material UI (Emotion).
- **State:** Zustand (app/session/UI) + an event bus (service↔UI decoupling).
- **Storage:** IndexedDB (`idb`) for everything substantial; localStorage for
  tiny hot values; Service Worker caching for offline (Phase 2).
- **Networking:** PeerJS (WebRTC data + media) in a serverless hub-relay; the
  PeerJS library is vendored via npm so the app never hard-depends on a CDN.
- **AI:** a local heuristic engine (always available, offline) behind a provider
  interface, with an optional on-device LLM (WebLLM / WebGPU) lazy-loaded on opt-in.
- **Crypto:** Web Crypto API (ECDSA P-256) — keygen, signing, verification.
- **Deploy:** static build; GitHub Pages compatible; `base: "./"` + HashRouter
  so it runs from any path with no server config.

---

## 3. Folder structure

```
SocialExperiment/
├─ index.html                 # boot splash + root
├─ vite.config.ts             # base "./", @ alias
├─ src/
│  ├─ main.tsx                # ReactDOM root, Theme + Router providers
│  ├─ App.tsx                 # boot(), routing, onboarding gate, toasts
│  ├─ types/index.ts          # the entire domain model (single source of truth)
│  ├─ theme/theme.ts          # cyberpunk/glass MUI theme
│  ├─ lib/                    # pure, framework-free utilities
│  │  ├─ crypto.ts            #   Web Crypto identity, sign/verify, canonical JSON
│  │  ├─ events.ts            #   typed event bus + toast helper
│  │  ├─ embeddings.ts        #   local embeddings, cosine, InterestProfile
│  │  ├─ id.ts / time.ts
│  ├─ services/               # the service layer (no React imports)
│  │  ├─ storage.ts           #   IndexedDB schema + all persistence
│  │  ├─ identityService.ts   #   keypair, sign, export/import
│  │  ├─ feedService.ts       #   posts, feed algorithms, "why recommended"
│  │  ├─ companionService.ts  #   local AI companion (heuristic + WebLLM)
│  │  ├─ moderationService.ts #   layered local moderation
│  │  ├─ reputationService.ts #   reputation ledger, ranks, badges
│  │  ├─ presenceService.ts   #   rich presence state
│  │  ├─ peerService.ts       #   PeerJS hub-relay (presence/post/DM)
│  │  ├─ communityService.ts  #   servers/subreddits/groups + channels
│  │  ├─ listenTogetherService.ts # synced internet radio
│  │  └─ index.ts             #   composition root: boot() + demo seed
│  ├─ store/useStore.ts       # Zustand app state
│  └─ components/
│     ├─ common/              # Background, GlassCard, avatar helpers
│     ├─ layout/              # AppShell, PresenceList
│     ├─ onboarding/          # identity generation/import
│     ├─ feed/                # FeedView, Composer, PostCard, WhyRecommended
│     ├─ companion/ communities/ messages/ listen/ profile/ settings/
```

---

## 4. Storage schema (IndexedDB: `nebula` v1)

| Store | Key | Indexes | Holds |
|---|---|---|---|
| `identity` | `publicKey` | — | the secret identity (incl. private JWK) — never transmitted |
| `posts` | `id` | `byTime`, `byAuthor`, `byCommunity` | all known posts (self/peer/relay/cache) |
| `messages` | `id` | `byChannel`, `byTime` | chat messages per channel |
| `communities` | `id` | — | communities + their channels & membership |
| `reputation` | `id` | `byTime` | reputation ledger entries |
| `companion` | `id` | `byTime` | companion conversation history |
| `kv` | string key | — | `settings`, `interest` (embedding centroid), misc |

`localStorage`: only `nebula:settings` (mirror for synchronous first-paint reads).

Records that cross the network are wrapped in a **signature envelope**:
`Signed<T> = { data, sig, pk, v }` where `sig` signs `canonical(data)` (stable
key-sorted JSON) so any peer can verify authorship from the embedded public key.

---

## 5. Service architecture (event-driven, layered)

```
        UI (React) ──reads──▶ services ──persist──▶ storage (IndexedDB)
            ▲                    │
            └──── event bus ◀────┘  (feed:updated, chat:message, presence:update, toast…)
                     ▲
                peerService (WebRTC) ── ingests remote records ──▶ services
```

- The **service layer has zero React imports** — it's plain TS, independently
  testable, and reusable from a Service Worker.
- Services **emit events**; the UI subscribes via the bus and re-reads. This
  keeps rendering decoupled from transport and lets a post arriving over WebRTC
  update the feed with no prop drilling.
- `services/index.ts#boot()` is the composition root: load settings → init feed
  interest profile → load identity → configure companion → (if onboarded) seed
  demo + defaults → start P2P.

---

## 6. Identity & signing

- `crypto.ts` uses **ECDSA P-256** via Web Crypto. `generateKeyMaterial()`
  returns `{ publicKey (base64url SPKI), privateKeyJwk }`. The **public key is the
  user id**.
- Every post/message can be wrapped with `signRecord()` and checked with
  `verifyRecord()` — no central authority, anyone verifies anyone.
- **Export/import:** the identity (incl. private key) serializes to a JSON file.
  That file *is* the account; move it between devices. No password, no email, no
  auth server.

---

## 7. AI architecture

Two providers behind **one interface** (`companionService`):

1. **Heuristic engine** — deterministic, instant, fully offline. Summarizes
   feeds, explains trends, suggests communities, drafts replies, flags
   misinformation markers. Always available; no download.
2. **WebLLM (optional)** — a real on-device LLM over **WebGPU**, lazy-loaded from
   the `@mlc-ai/web-llm` ESM **only when the user opts in** (Settings → "Use
   on-device LLM"). Falls back to the heuristic engine if WebGPU/model is
   unavailable. All inference is local; nothing is sent to a server.

**Feed recommendation** is its own local AI system (`embeddings.ts` +
`feedService`):
- Each post is embedded into a 256-d L2-normalized vector (hashed word +
  char-trigram features — dependency-free, swappable for transformer embeddings).
- An `InterestProfile` is the centroid of what you engage with; ranking uses
  cosine similarity + recency + engagement, per selected algorithm.
- **Every ranking is explainable**: `RecommendationReason` lists weighted
  factors, surfaced in the "Why am I seeing this?" popover. No black box.

---

## 8. P2P networking layer

`peerService` implements a **serverless hub-relay** over PeerJS (the proven
pattern for static hosting):

- First peer to claim a well-known id (`nebula-hub-v1`) becomes the **hub**;
  others connect as **clients**. The hub relays `presence`, `post`, and `dm`
  envelopes to the swarm. If the hub leaves, clients **re-elect**.
- This gives real cross-browser presence, a global post relay, and a public
  "Swarm Lounge" chat today, with **no backend**.
- **Phase 2** layers a full WebRTC **mesh** for voice/video and direct,
  end-to-end-encrypted DMs (ECDH-derived keys from the existing identity
  keypairs), plus relay redundancy and CRDT merge for community state.

---

## 9. State management strategy

- **Zustand** (`useStore`) holds session/UI state shared widely: `ready`,
  `onboarded`, public `me`, `settings`, `presence`, `onlineCount`.
- **Service data** (feed, messages, companion history) is **not** mirrored into
  global state — components fetch on demand from services and refresh on the
  relevant bus event. This avoids a giant global store and keeps each view's
  data lifecycle local and cheap.
- **Settings** are the one cross-cutting concern in the store; writing them
  persists to IndexedDB and reconfigures dependent services (companion, presence).

---

## 10. UX system

Cyberpunk / Blade Runner aesthetic, implemented with MUI + Emotion:
- **Glassmorphism**: every `Paper` is a frosted, blurred, cyan-edged surface.
- **Animated gradient nebula** backdrop (respects `reducedMotion`).
- Neon cyan→violet→magenta gradient accents; Orbitron display + Rajdhani UI fonts
  (progressively enhanced, system fallback so it works offline).
- Responsive shell: collapsing nav rail, sticky top bar with live online count
  and presence dot, right-rail companion digest.

---

## 11. Deployment

The build is **static files** — host them anywhere.

```bash
npm install
npm run build          # → dist/
npm run preview        # local smoke test
```

**GitHub Pages:** push `dist/` (or build in CI), enable Pages on the branch/folder.
`base: "./"` + HashRouter mean it works from `user.github.io/repo/` with no
404-on-refresh and no server rewrites. Also deployable to IPFS, Netlify, or a USB
stick — open `index.html` over any static server.

---

## 12. Roadmap

### MVP (this repo — implemented)
- ✅ Cryptographic identity (generate/sign/verify, export/import file)
- ✅ Offline-first IndexedDB storage + event-driven service layer
- ✅ Signed posts; feed with 5 local algorithms; local embeddings + vector search
- ✅ Inspectable "why recommended"
- ✅ Local AI companion (heuristic) + WebLLM hook; feed summary, trends, drafts
- ✅ Layered local moderation with selectable profiles
- ✅ Reputation ledger, ranks & badges (no follower counts)
- ✅ Communities with channels (text/voice/stage/events)
- ✅ P2P presence + global post relay + Swarm Lounge chat (PeerJS hub-relay)
- ✅ Listen Together (synced internet radio, rich presence activity)
- ✅ Cyberpunk/glass UI, responsive shell, live online count

### Phase 2 (depth)
- WebRTC **voice/video** mesh; community **voice stages**; screen share; PTT,
  noise suppression, per-user mute/volume.
- **E2E-encrypted DMs & group chats** (ECDH from identity keys); typing
  indicators, reactions, stickers, edit/delete.
- **Listen Together rooms** with true host-clock sync; podcasts & playlists;
  watch parties.
- **Service Worker**: full offline app shell + content cache; background sync of
  drafts/posts when connectivity returns.
- **Transformer embeddings** (transformers.js/WebLLM) behind the embedding
  interface; on-device misinformation classifier for Layer-1 moderation.
- **CRDT** (e.g. Yjs/Automerge) for conflict-free merge of community state,
  reactions, and reputation across relays.

### Phase 3 (scale & ecosystem)
- **Shared Activities** SDK: peer-to-peer Chess, Poker, Trivia, collaborative
  whiteboard/drawing, live coding — no game servers.
- **Discovery without central servers**: public relay directory, interest-based
  rendezvous, web-of-trust reputation co-signing, friend-of-friend graph walk.
- **Multi-relay federation** + optional self-hosted PeerJS/relay nodes for
  resilience; content addressing (IPFS) for large media.
- **Plugin system** for third-party activities, feed algorithms, and companion
  personas — all sandboxed and local-first.
- **Mobile** via the same codebase (PWA install / Capacitor).

---

## 13. Honest status

This repository is a **production-grade foundation + working MVP**, not a
finished "2030 platform" (that is many engineer-years). The systems above that
are marked ✅ run today; the heaviest features (full A/V mesh, E2E group chat,
WebGPU LLM by default, P2P games) have clean interfaces and stubs and are scoped
in Phase 2–3. The point of the MVP is to prove the architecture end-to-end: a
browser-only social app where you own your identity, your feed is ranked by AI on
your device, and people connect peer-to-peer — for ~$0.
