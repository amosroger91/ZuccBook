/* Ledger service worker — offline app shell + installability.
 *
 * Deliberately conservative because Ledger is local-first and peer-to-peer:
 *  - Only same-origin GET requests are ever cached (the built app shell/assets).
 *  - Cross-origin traffic (Gun relays, PeerJS, the on-device model CDN, embeds)
 *    is passed straight through and never cached — we must not serve stale P2P
 *    data or interfere with live connections.
 *  - Navigations are network-first so a fresh deploy is picked up immediately,
 *    falling back to the cached shell when offline.
 *
 * The scope is derived from this file's location, so it works unchanged whether
 * served from a domain root, a GitHub Pages subpath, IPFS, or a USB stick.
 */
const VERSION = "zb-v3"; // bump → activate() purges every old cache, forcing all clients onto the fresh build.
// IMPORTANT: bump this whenever a STABLE-named asset changes (logo.png, favicon.ico,
// icon-*.png, manifest). Those are cached cache-first, so without a version bump
// clients keep serving the OLD copy forever (hashed JS/CSS update on their own).
const SCOPE = new URL("./", self.location).pathname;
const SHELL = SCOPE; // start_url / index.html

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.add(new Request(SHELL, { cache: "reload" })).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin / P2P / CDN traffic

  // Navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || caches.match(req))),
    );
    return;
  }

  // Static assets (the hashed JS/CSS/icons): cache-first, populate on miss.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});
