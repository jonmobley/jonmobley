// Backstage offline support (home-screen install and the iPhone app).
// - The app itself (page, script, styles) is fetched fresh when online and kept for offline.
// - Library lists (/api/...) are fetched fresh when online; the last good copy is kept and
//   served when offline, marked with X-Backstage-Offline so the page can say so.
// - Photos are kept once viewed. Changes (POST/PUT/DELETE) always need the internet.
// Signing in or out (or any "please sign in" answer) wipes the saved library, so nobody else
// signing in on this device (e.g. a team member) can ever be shown Jon's copy. A save that was
// still in progress when that happened is thrown away (see `epoch`).
const SHELL = "bs-shell-v3";
const DATA = "bs-data";
const MEDIA = "bs-media";
const SHELL_FILES = ["/backstage/", "/backstage/app.js", "/backstage/app.css", "/backstage/vendor/preact-htm.js", "/backstage/demo.js", "/backstage/social.js",
  "/backstage/manifest.webmanifest", "/backstage/icon-192.png", "/backstage/apple-touch-icon.png"];

// Bumped on every wipe; a response fetched before a wipe is never saved after it.
let epoch = 0;
async function forget() {
  epoch++;
  await Promise.all([caches.delete(DATA), caches.delete(MEDIA)]);
}
function save(cacheName, request, response, at) {
  if (at !== epoch) return;
  caches.open(cacheName)
    .then((c) => (at === epoch ? c.put(request, response) : undefined))
    .then(() => (at !== epoch ? caches.delete(cacheName) : undefined))
    .catch(() => {});
}
// The page asks for a wipe when signing in or out and waits for the reply.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "forget") return;
  event.waitUntil(forget().then(() => event.ports[0]?.postMessage("done")));
});

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
  const at = epoch;
  try {
    const res = await fetch(request);
    if (res.ok) save(cacheName, request, res.clone(), at);
    else if (res.status === 401 || res.status === 403) await forget();
    return res;
  } catch (err) {
    const cached = await caches.match(request, { cacheName, ignoreSearch });
    if (!cached) throw err;
    return mark ? offlineCopy(cached) : cached;
  }
}

async function cacheFirst(request) {
  const at = epoch;
  const cached = await caches.match(request, { cacheName: MEDIA });
  if (cached) return cached;
  const res = await fetch(request);
  const type = res.headers.get("Content-Type") || "";
  if (res.status === 200 && type.startsWith("image/")) save(MEDIA, request, res.clone(), at);
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
