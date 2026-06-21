# 🌌 Nebula

**A decentralized, local-first, browser-native social platform.** No accounts, no
email, no servers required for core functionality, ~$0 to host. You generate a
cryptographic identity you own, your feed is ranked by AI **on your own device**,
and people connect **peer-to-peer**.

Think *Twitter × Discord × Reddit × Spotify Social × Xbox Live × Twitch Chat ×
an AI companion* — running from static files.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
# or
npm run build && npm run preview
```

Open it in **two browser windows** to see presence, the post relay, and Swarm
Lounge chat connect peer-to-peer.

> Needs a secure context for Web Crypto — use `localhost` or HTTPS (both fine).

---

## What works today (MVP)

- **Own your identity** — a P-256 keypair generated on-device (Web Crypto). Your
  public key is your id; every post is signed. **Export/import** it as a file to
  move between devices. No password, no email, no server.
- **Local feed engine** — posts ranked on your machine with on-device embeddings
  + vector search. Five algorithms (For You / Newest / Trending / Discovery /
  Circle) and a **"why am I seeing this?"** breakdown on every post.
- **Local AI companion** — summarizes your feed, explains trends, suggests
  communities, drafts replies, flags misinformation. Runs locally (fast heuristic
  engine; optional **on-device WebGPU LLM** via WebLLM in Settings).
- **Communities** — Discord/Reddit-style servers with text/voice/stage/event
  channels.
- **Peer-to-peer** — presence (online/idle/away/dnd + rich activity), a global
  post relay, and the **Swarm Lounge** chat, all over PeerJS with **no backend**.
- **Listen Together** — synced internet radio with rich presence ("Listening to…").
- **Reputation, not followers** — a ledger of helpfulness/expertise/participation/
  trust, with ranks and badges.
- **Layered moderation** — local AI + selectable filter profiles (Family-Friendly,
  Academic, Gaming, Discovery, Unfiltered).
- **Offline-first** — everything lives in IndexedDB; the UI is a cyberpunk/glass
  Material UI shell.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design, storage schema,
service/AI/P2P layers, and the Phase 2 / Phase 3 roadmaps.

---

## Tech

React · TypeScript · Vite · Material UI · Zustand · IndexedDB (`idb`) · PeerJS
(WebRTC) · Web Crypto · optional WebLLM (WebGPU).

## Deploy (GitHub Pages / any static host)

`npm run build` → deploy `dist/`. The build uses `base: "./"` + HashRouter, so it
runs from any path with no server config (GitHub Pages, Netlify, IPFS, even a USB
stick).

## Status

A production-grade **foundation + MVP** that proves the architecture end-to-end.
The heaviest features (full WebRTC voice/video mesh, E2E group chat, P2P games,
WebGPU LLM by default) are scoped with clean interfaces in the roadmap. MIT.
