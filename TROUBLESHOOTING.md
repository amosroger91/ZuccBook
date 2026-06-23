# Ledger — Troubleshooting & Debugging Playbook

> Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) (the design) and
> [MODERATION.md](./MODERATION.md). This doc is the **debugging deliverable**:
> how this stack actually breaks, how we found the causes, the reusable tooling
> we built, and a step-by-step method for the next time something is "frozen" or
> "broken." Read this before re-deriving anything — most of the expensive dead
> ends are already mapped here.

## Table of contents

1. [The mental model (read this first)](#1-the-mental-model)
2. [The #1 failure mode: "the feed is frozen / page unresponsive"](#2-the-1-failure-mode-the-feed-is-frozen)
3. [The single most important rule: TEST WITH REAL DATA](#3-the-single-most-important-rule-test-with-real-data)
4. [The headless test harness (`ledger-e2e`)](#4-the-headless-test-harness-ledger-e2e)
5. [Bisecting with the `?off=` kill switch](#5-bisecting-with-the-off-kill-switch)
6. [Deep dive: the `richInline` regex freeze (real-data killer)](#6-deep-dive-the-richinline-regex-freeze)
7. [Built-in diagnostic tools](#7-built-in-diagnostic-tools)
8. [Feed virtualization (how it works, how to verify)](#8-feed-virtualization)
9. [Walls & gotchas (and how to get past them)](#9-walls--gotchas)
10. [Deploy & verify](#10-deploy--verify)
11. [Quick reference](#11-quick-reference)

---

## 1. The mental model

Ledger is **local-first and single-threaded in the place that matters**: the feed
is generated, ranked, moderated, parsed, and rendered **on the browser's main
thread**, over data that streams in from an **unbounded, untrusted, real-world
firehose** (Nostr relays + the Gun graph + RSS). Almost every serious bug we've
hit is the same shape:

> **Heavy *synchronous* work on the main thread, scaled by real-world data, during
> feed generation or card render.**

When the main thread is blocked, the whole tab is frozen: no scroll, no clicks,
no rendering — "page unresponsive." The fixes are always one of:
move work **off** the main thread (Web Worker / idle queue), **bound** the work
(virtualize, cap, slice), or **fix an algorithmic blowup** (e.g. a bad regex).

Two structural facts to keep in mind:

- **The Companion LLM already runs in a Web Worker** (`src/services/llm.worker.ts`).
  That's the template for "this is too heavy for the main thread."
- **The NSFW image classifier does *not*** (`src/services/nsfwService.ts`,
  TensorFlow.js + nsfwjs). It's the remaining known main-thread ML cost — see
  [§2](#2-the-1-failure-mode-the-feed-is-frozen) and [§9](#9-walls--gotchas).

---

## 2. The #1 failure mode: "the feed is frozen"

Symptom: the app loads to a splash or a partial feed and then the tab is
**unresponsive** — often *permanently*. This has had **five distinct root
causes**, all on the main thread. If the feed freezes again, suspect these in
order, and **bisect with `?off=`** ([§5](#5-bisecting-with-the-off-kill-switch))
rather than profiling blind.

| # | Root cause | Trigger | Why synthetic feeds hid it | Fix | Commit |
|---|---|---|---|---|---|
| 1 | **`richInline` regex blowup (ReDoS)** — a shared module-global `/g` regex (`RICH_RE`) iterated *while recursing into itself*; recursion corrupts `lastIndex`, the outer loop re-scans → **O(n²⁺)** on any line with markdown markup (`*` `_` `**` `~~` `` ` ``). | Scrolling a **real Nostr feed** (markdown- & multilingual-heavy bodies). | Synthetic English lorem-ipsum has **no markup** → `richInline` never recurses → 0 ops. **This is why every synthetic test passed.** | A **fresh `new RegExp(RICH_RE.source,"g")` per call** so recursion can't corrupt the iterator. | `9b69f9a` |
| 2 | **NSFW classifier on the main thread** — `SafeImage` ran `nsfwService.isAdultImage` → TF.js + nsfwjs MobileNetV2 inference per inline image, synchronously, in post-render effects. | Image-heavy feed mounting many images at once. | Plain-text synthetic feeds have **no images**. | Single-flight, **idle-yielding queue** (`requestIdleCallback`, one image at a time). | `67924ee` |
| 3 | **Unbounded IndexedDB read** — `storage.recentPosts` did `getAllFromIndex("posts","byTime")`, loading the **entire** posts store (each post carries a 256-float embedding) on **every** feed gen. | The relay flood firing feed-gen back-to-back at high post counts. | Small synthetic stores are cheap to `getAll`. | Bounded **raw IDB cursor** (`unwrap(db)`, `openCursor(null,"prev")`, no per-item await), newest ~1200 only. | `e1872ab` |
| 4 | **Large value on the Gun graph** — profiles/posts with big inline base64 blobs (a 110 KB header → 137 KB node; a 6.4 MB inline-audio post). Gun takes ~2 s to merge one such node; `gunService` eagerly streamed *every* profile on boot. | Real peers with fat nodes. | Synthetic data has no fat nodes. | Load profiles **on demand**; `publishSelf` puts a **slim** re-signed copy; skip >60 KB on ingest, >1.5 MB media in enqueue/putPost. | `971ad67` |
| 5 | **Long-post node explosion** — `renderRichText` parsed the **entire** body into thousands of MUI/emotion nodes even when the card was CSS-collapsed. ~9 long notes in the first screen = ~17.5 k nodes. | Real long-form / 10–80 KB Nostr notes. | Synthetic posts are short & uniform. | **Parse only the shown slice** when collapsed (`body.slice(0,1600)`); cap text joins in `feedDigest`/`summarizeFeed`. | `e1b0b28` |

**General rule:** *CSS-clamp ≠ parse-clamp.* Bound what you turn into React nodes
and what you run regexes/models over — not just what's visible.

### Known *accepted* residual (not a freeze, by design)

After fixing #1, the headless harness still flags a **one-time ~5–7 s main-thread
block**. A CPU profile (`profile.mjs`) attributes **35% to `linkProgram`** —
**WebGL shader compilation**, i.e. the NSFW TF.js model warming up its GPU
backend the first time an image is classified. It is **one-time** (then cached),
inherent to on-device moderation, and unrelated to the freeze. To eliminate it,
move `nsfwService` into a Web Worker (mirror `llm.worker.ts` with
`OffscreenCanvas`) or switch TF.js to the WASM backend. **Deliberately deferred.**

---

## 3. The single most important rule: TEST WITH REAL DATA

Four of the five freezes above **cannot be reproduced with synthetic posts.** A
feed of 500 of your own English lorem-ipsum posts is the *best case*: short,
uniform, no markup, no images, no fat nodes, no foreign languages, no firehose
churn. It will pass every test while production is permanently frozen.

> If a "test" isn't loading **real Nostr + real Gun network content** (markdown,
> images, CJK/RTL, long notes, the relay flood), **it is not a test of the feed.**

This is the lesson that cost the most time. The harness in
[§4](#4-the-headless-test-harness-ledger-e2e) exists specifically to load the
**real firehose** and measure the main thread under it.

---

## 4. The headless test harness (`ledger-e2e`)

Location: **`C:\Users\roger\dev\ledger-e2e\`** (a sibling of this repo, kept out
of the app so it never ships). It drives the **installed Chrome in true headless
mode** via `puppeteer-core` — a **separate browser instance + profile**, so it is
**invisible and never steals window focus** (critical: the machine owner games on
the same box; do **not** drive their visible browser).

### Why headless beats the alternatives

| Approach | Problem |
|---|---|
| The "Claude in Chrome" extension tab | Runs **hidden** → `setInterval` throttled to ~1 Hz, `requestAnimationFrame` **paused**, **ResizeObserver delivery deferred**. This *fakes* freezes and *fakes* layout bugs (e.g. card overlap that doesn't exist in a real tab). See [§9](#9-walls--gotchas). |
| Forcing the tab visible | Flushes all the deferred work at once (a misleading CPU/RAM spike) **and** interrupts whatever the user is doing. |
| The in-app preview tool | The preview window is hidden → screenshots time out; rendering suspended. |
| **Headless puppeteer** | Renders **normally** (rAF, ResizeObserver, layout all real), **no permission dialogs block it**, connects to the **real relays**, and never touches the user's screen. ✅ |

### Scripts

| Script | Purpose |
|---|---|
| `test.mjs` | End-to-end: boot → onboard → let the **real firehose** flood in (~1000–1600 posts) → scroll the whole feed, asserting **bounded DOM**, **window advances**, **0 overlaps**, and **no multi-second main-thread block** (via injected `PerformanceObserver('longtask')` + eval-timeout-as-freeze-signal). |
| `nodetest.mjs` | Pure-Node, no browser. Replays the exact `richInline` logic over crafted markup to prove the blowup and the fix deterministically. |
| `profile.mjs` | Attaches the CDP **`Profiler`** during a scroll and prints the **top self-time functions** — use this to *name* a slow function instead of guessing. |
| `analyze.mjs` | Extracts real post bodies from IndexedDB and replays parsers over them (find the pathological input). |

### Running it

```sh
# prerequisites: dev server up in the app repo
cd C:\Users\roger\dev\SocialExperiment && npm run dev      # serves :5173

cd C:\Users\roger\dev\ledger-e2e
node test.mjs                          # against local dev (default)
$env:OFF="body";        node test.mjs  # bisect a feature off (PowerShell)
$env:BASE="https://amosroger91.github.io/Ledger/"; node test.mjs   # against PROD
```

### Harness gotchas (already solved, don't rediscover)

- **A fresh puppeteer profile is NOT onboarded** → the app shows `<Onboarding>`,
  so `#app-scroll` never appears and the boot wait times out. The harness clicks
  **"Generate my identity"** first (Web Crypto works headless; a real Nostr key is
  auto-created so the global feed streams).
- **`protocolTimeout`** must be > the longest legit block, or a slow boot looks
  like a freeze. It's set to 45 s and used as the **freeze threshold** (an eval
  that can't run for that long ⇒ the main thread is blocked that long).
- **Freeze signal of record:** a *purely synchronous* eval. It returns instantly
  if alive, times out only if the renderer is truly blocked. `console`/longtask
  observers survive a freeze (out-of-process); rAF/`setInterval` do not.

---

## 5. Bisecting with the `?off=` kill switch

When micro-benchmarks all come back fast but it **still freezes**, **stop
profiling and bisect.** `src/lib/flags.ts` reads `?off=a,b,c` and `isOff(name)`
gates features. Turn things off one at a time (keep `gun,nostr` **on** so real
data still floods) and watch for the freeze to disappear.

**Flags:** `gun, nostr, peer, rss, changelog, factcheck, publish, prune, geo,
communities, cards, digest, players, background, body, embeds`.

Worked example (this is how cause #1 was found in minutes):

```
?off=cards   → loads (no card list at all)
?off=body    → loads ✅  ← the freeze is in the post-BODY render path
(baseline)   → freezes
```

`off=body` cleanly isolating it pointed straight at `renderRichText`/`richInline`.
In the harness: `OFF=cards node test.mjs`, `OFF=body node test.mjs`, etc.

---

## 6. Deep dive: the `richInline` regex freeze

The most instructive bug in the codebase. `src/components/feed/PostCard.tsx`.

**The bug.** `RICH_RE` was a **module-level global** (`/g`) regex. `richInline`
iterates it with `while ((m = RICH_RE.exec(str)))` **and recurses into itself** to
render the *inner* content of bold/italic/strike/link spans. A `/g` regex carries
mutable `lastIndex` state on the shared object. The recursive call does
`RICH_RE.lastIndex = 0` and runs its own loop, leaving `lastIndex` wherever the
inner string ended. Back in the parent loop, `last = RICH_RE.lastIndex` reads the
**inner call's** value, and the next `exec` resumes from the wrong place. The
zero-width guard (`if (lastIndex === m.index) lastIndex++`) turns the resulting
infinite re-match into an **O(n²⁺) re-scan** of the same line.

**Why it only bites real data.** Recursion only happens when a line *contains
markup*. Real Nostr notes are full of `*`, `_`, `**`, `~~`, `` ` ``. Synthetic
English has none → `RICH_RE.exec` returns `null` immediately → **0 ops**.

**The fix.** A **fresh regex instance per call** so recursion can't touch the
parent's iterator:

```js
// inside richInline(), instead of the shared global RICH_RE:
const re = new RegExp(RICH_RE.source, "g");
while ((m = re.exec(str))) { /* … recursion is now safe … */ }
```

**Proof** (`nodetest.mjs`): shared regex **EXPLODED >5,000,000 ops** on
`"*x* ".repeat(400)`; per-call regex did it in **400 ops / 0.5 ms**. End-to-end
(`test.mjs`, real ~1600-post firehose): **11/14 scroll stops froze ≥25 s → 0/14**
after the fix; the whole feed (index 0→418) scrolls cleanly.

**General rule:** **never iterate a stateful `/g` regex while recursively
re-entering it.** Either use a per-call instance, or a non-global regex with
manual slicing, or collect all matches *first* and recurse *after* the loop.

---

## 7. Built-in diagnostic tools

In `src/lib/diag.ts`, `src/lib/flags.ts`, and `src/main.tsx`. All query-gated, so
they never run for a normal visitor.

| URL | Effect |
|---|---|
| `?diag` | Arms a main-thread **stall heartbeat** + stage timing (`diag()` logs). Arm it *before* anything else runs so a boot freeze is still captured. |
| `?off=a,b,c` | Feature kill switch ([§5](#5-bisecting-with-the-off-kill-switch)). `?off=all` disables everything gated. |
| `?reset` | **Wipes this device's IndexedDB + unregisters the Service Worker, then stops** (no app boot). The recovery path for a bricked local-first install — *give this URL to a user whose prod is stuck.* |

**Inspect prod data WITHOUT booting the (possibly frozen) app:** GitHub Pages
serves real static files, so navigate to any asset on the prod origin (e.g.
`https://amosroger91.github.io/Ledger/logo.png`) — no SPA boot, fully responsive —
then read the same-origin IndexedDB from the console. This is how the pathological
data (2801 posts, 160 notes >20 KB, the 6.4 MB audio post, the 137 KB profile) was
found. (Localhost SPA-fallbacks everything, so this trick is **prod/Pages-only**.)

---

## 8. Feed virtualization

`src/components/feed/FeedView.tsx` uses **`@tanstack/react-virtual`**. Only the
cards in/near the viewport are mounted (~6–13) no matter how large the feed
(verified over 1600 real posts). This **structurally bounds** per-card work (the
NSFW check, embeds, link-preview fetches), so feed *size* can no longer cause a
freeze. **Note:** virtualization **alone did not fix the freeze** — a single
markup-heavy card still froze via cause #1; the regex fix was required.

**The one non-obvious detail — `scrollMargin`.** The feed list shares the app's
`#app-scroll` container with the composer/controls *above* it. The virtualizer is
given that scroll element plus a `scrollMargin` equal to **the list's offset
within the scroll content** (measured via `getBoundingClientRect` + `scrollTop`,
re-measured with a `ResizeObserver` when the header height changes). Items are
absolutely positioned at `translateY(vi.start - scrollMargin)` and measured with
`virtualizer.measureElement` (dynamic heights). Without the correct `scrollMargin`
the window is offset by the composer height. (`react-virtuoso` was tried first and
**failed** — its `customScrollParent` auto-measure rendered 0 items at 0 height
for exactly this shared-scroll-with-content-above layout.)

**Verifying it** (headless, where ResizeObserver actually delivers): bounded
`[data-index]` count, `idxMax` advancing toward the feed size as you scroll, and
**0 overlapping cards** (`rect.top` of each ≥ `rect.bottom` of the previous).

---

## 9. Walls & gotchas

A catalog of the dead ends, so the next person skips them.

- **The "Claude in Chrome" tab runs HIDDEN.** `visibilityState === "hidden"` →
  `setInterval` throttled to ~1 Hz (the diag heartbeat shows **fake** ~1000 ms
  stalls), `requestAnimationFrame` **paused** (any eval awaiting rAF **hangs
  forever** — looks like a freeze, isn't), and **ResizeObserver delivery deferred**
  (so `measureElement` never corrects → **fake** card overlap / spacing wobble).
  **Do not trust the heartbeat, rAF probes, or visual spacing from a hidden tab.**
  Use a **synchronous eval** for liveness and **headless** for anything
  layout/measurement-dependent.
- **A genuinely frozen tab pegs a CPU core and starves the whole extension** —
  *every* call times out, not just the page's. Distinguish a real freeze from a
  wedge with a passive CPU read: `Get-Process chrome` CPU-delta over 2 s. A pegged
  renderer shows ~2.0+ CPU-seconds over 2 s and often a bloated working set; an
  idle one shows ~0. (Idle CPU **+** unresponsive evals usually means a **blocking
  native dialog** — `alert/confirm`/permission — that you can't dismiss through
  the extension; reload via the browser API or use headless, which doesn't
  dialog.)
- **Vite serves stale transforms after long sessions / many edits.** If the
  browser behaves like old code, `curl http://localhost:5173/src/…` the module and
  grep it; restart the dev server if it doesn't match the file. esbuild minifies
  number literals in dev (`60000`→`6e4`) — grep accordingly.
- **Adding a new dependency while the dev server is running corrupts Vite's React
  preamble.** Symptom: `root` stays empty, no boot logs, all modules fetched (0
  pending), and `window.__vite_plugin_react_preamble_installed__ === false`. Fix:
  **kill the dev server, `rm -rf node_modules/.vite`, restart.** (This bit us when
  `@tanstack/react-virtual` was added mid-session.)
- **A fresh browser profile is not onboarded** → the app renders `<Onboarding>`,
  not the feed, so `#app-scroll` never appears. Click "Generate my identity"
  first. (See the harness, [§4](#4-the-headless-test-harness-ledger-e2e).)
- **Navigating to the *identical* URL (same hash) is a no-op** — it won't reload.
  Add a throwaway query param or call `location.reload()` to force a real
  navigation.

---

## 10. Deploy & verify

- **Prod = GitHub Pages**, built and deployed by **`.github/workflows` (deploy.yml)
  on every push to `main`.** Base path is `/Ledger/`; the app uses `HashRouter` so
  it runs from any path with no server config.
- **`gh` CLI is NOT installed** on this machine. Verify a deploy via the REST API:
  ```
  https://api.github.com/repos/amosroger91/Ledger/actions/runs?branch=main&per_page=3
  ```
  Look for the run whose `head_sha` matches your commit → `status: completed`,
  `conclusion: success`.
- **CI does not run `tsc`.** Run `npx tsc --noEmit` **locally** before pushing — a
  type error will *not* fail the deploy, it'll just ship broken.
- **Stale `index.html` cache → phantom "still broken."** Pages caches `index.html`,
  which points at hashed bundle files. After a deploy, a user's browser may serve
  the old `index.html` (old bundle). **Hard-refresh once.** A fresh profile (e.g.
  the headless harness) never hits this — which is why testing prod headlessly is
  the cleanest confirmation.
- **Confirm prod after a fix:** `$env:BASE="https://amosroger91.github.io/Ledger/";
  node test.mjs` from `ledger-e2e`. This was used to confirm `9b69f9a`: 0/14
  freezes, whole feed scrolled, on the **deployed** build against the real firehose.

---

## 11. Quick reference

**Repos / paths**
- App: `C:\Users\roger\dev\SocialExperiment` (GitHub `amosroger91/Ledger`)
- Test harness: `C:\Users\roger\dev\ledger-e2e` (puppeteer-core, not shipped)
- Prod: `https://amosroger91.github.io/Ledger/`
- IndexedDB name: **`nebula`**

**The "it's frozen / broken" playbook**
1. Reproduce with **real data** — `node test.mjs` in `ledger-e2e` (local) or with
   `BASE=` prod. Synthetic posts will lie to you.
2. If it freezes, **bisect**: `OFF=cards`, `OFF=body`, `OFF=embeds`, `OFF=digest`…
   (keep `gun,nostr` on). Find the flag that makes it load.
3. **Name the function**: `node profile.mjs` (CDP Profiler → top self-time).
4. Suspect, in order: a recursive/`/g` regex blowup, an ML model on the main
   thread, an unbounded IndexedDB `getAll`, a fat Gun node, a long-post node
   explosion. (See [§2](#2-the-1-failure-mode-the-feed-is-frozen).)
5. Fix by **moving off-thread / bounding / de-blowing-up**, never by "optimizing"
   a fundamentally main-thread-heavy op in place.
6. `npx tsc --noEmit`, commit, push `main`, verify the Pages run via REST API,
   then **re-run the harness against prod** to close the loop.

**Key commands**
```sh
npm run dev                      # app dev server :5173 (in SocialExperiment)
npx tsc --noEmit                 # typecheck (CI does NOT do this)
node test.mjs                    # e2e freeze/virtualization test (in ledger-e2e)
node profile.mjs                 # CPU profile a scroll
node nodetest.mjs                # pure-Node regex repro
```

**Recovery URLs**
- `…/Ledger/?reset` — wipe IndexedDB + SW for a bricked install.
- `…/Ledger/?diag` — arm the stall heartbeat + stage timing.
- `…/Ledger/?off=all` — boot with all gated features disabled.

---

*Last major update: 2026-06-23 — added cause #1 (`richInline` ReDoS), feed
virtualization, and the `ledger-e2e` headless harness. Maintained as part of the
freeze-diagnostics knowledge base.*
