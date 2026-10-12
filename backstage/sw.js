// Backstage offline support (home-screen install and the iPhone app).
// - The app itself (page, script, styles) is fetched fresh when online and kept for offline.
// - Library lists (/api/...) are fetched fresh when online; the last good copy is kept and
//   served when offline, marked with X-Backstage-Offline so the page can say so.
// - Photos are kept once viewed. Changes (POST/PUT/DELETE) always need the internet.
// Signing out clears the saved library (the page deletes the data caches).
const SHELL = "bs-shell-v1";
const DATA = "bs-data";
const MEDIA = "bs-media";
const SHELL_FILES = ["/backstage/", "/backstage/app.js", "/backstage/app.css", "/backstage/vendor/preact-htm.js", "/backstage/demo.js",
  "/backstage/manifest.webmanifest", "/backstage/icon-192.png", "/backstage/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("bs-shell-") && name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});

const offlineCopy = async (cached) => {
  const headers = new Headers(cached.headers);
  headers.set("X-Backstage-Offline", "1");
  return new Response(await cached.blob(), { status: cached.status, headers });
};

async function networkFirst(request, cacheName, { mark = false, ignoreSearch = false } = {}) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(request, copy)).catch(() => {});
    } else if (res.status === 401 && cacheName === DATA) {
      caches.delete(DATA);
      caches.delete(MEDIA);
    }
    return res;
  } catch (err) {
    const cached = await caches.match(request, { cacheName, ignoreSearch });
    if (!cached) throw err;
    return mark ? offlineCopy(cached) : cached;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: MEDIA });
  if (cached) return cached;
  const res = await fetch(request);
  const type = res.headers.get("Content-Type") || "";
  if (res.status === 200 && type.startsWith("image/")) {
    const copy = res.clone();
    caches.open(MEDIA).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/media/")) {
    if (!req.headers.has("Range")) event.respondWith(cacheFirst(req));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    // Chat transcripts and site stats are only useful online.
    if (url.pathname.startsWith("/api/chats") || url.pathname.startsWith("/api/stats") || url.pathname.startsWith("/api/shared")) return;
    event.respondWith(networkFirst(req, DATA, { mark: true }));
    return;
  }
  if (req.mode === "navigate" && url.pathname.startsWith("/backstage")) {
    event.respondWith(networkFirst(req, SHELL, { ignoreSearch: true }).catch(() => caches.match("/backstage/", { cacheName: SHELL })));
    return;
  }
  if (url.pathname.startsWith("/backstage/") && !url.pathname.endsWith("/sw.js")) {
    event.respondWith(networkFirst(req, SHELL, { ignoreSearch: true }));
  }
});
