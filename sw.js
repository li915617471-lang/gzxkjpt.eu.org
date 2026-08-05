const CACHE_VERSION = "fx-public-v31";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./article.html",
  "./category.html",
  "./governance.html",
  "./offline.html",
  "./styles.css?v=17",
  "./article.css?v=5",
  "./category.css?v=5",
  "./governance.css",
  "./app.js?v=16",
  "./article.js?v=17",
  "./category.js?v=9",
  "./governance.js",
  "./pwa.js?v=3",
  "./cloud-config.js",
  "./cloud.js",
  "./content-service.js?v=13",
  "./intelligence-service.js?v=2",
  "./assets/vendor/supabase-2.111.0.min.js",
  "./assets/vendor/lucide-0.468.0.min.js",
  "./assets/vendor/hls-1.6.13.min.js",
  "./data/content.json",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/datacenter.jpg",
  "./assets/chipboard.jpg",
  "./assets/energy.jpg",
  "./assets/factory.jpg",
  "./assets/network.jpg",
  "./assets/platform-overview.webm",
  "./assets/robotics.jpg",
  "./assets/semiconductor.jpg",
  "./assets/solar.jpg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(CORE_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) { return key !== CACHE_VERSION; }).map(function (key) {
          return caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || (fallbackUrl ? cache.match(fallbackUrl) : Response.error());
  }
}

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/admin.html")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./offline.html"));
    return;
  }

  if (url.pathname.endsWith("/data/content.json") || url.pathname.endsWith("/data/intelligence-draft.json") || url.pathname.endsWith("/feed.xml") || url.pathname.endsWith("/feed.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (["script", "style"].includes(request.destination)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      });
    })
  );
});
