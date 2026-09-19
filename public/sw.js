// LibraLex service worker — deliberately minimal.
//
// Every page is auth-gated and renders live Convex data, so we do NOT cache app
// HTML or API responses (that would risk showing stale or another session's data).
// The only job here is: when a page navigation fails because the device is
// offline, show a calm, branded offline page instead of the browser's dino.
//
// Bump CACHE when offline.html changes so clients pick up the new copy.
const CACHE = "libralex-offline-v1"
const OFFLINE_URL = "/offline.html"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  // Only page navigations get the fallback; everything else (assets, API, Convex,
  // Clerk, /mcp) goes straight to the network untouched.
  if (event.request.mode !== "navigate") return

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL)
      return cached || Response.error()
    }),
  )
})
