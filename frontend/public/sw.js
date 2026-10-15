const CACHE_NAME = "brick-erp-shell-v2";
const OFFLINE_ROUTE = "/offline";
const DASHBOARD_ROUTE = "/dashboard";

async function cacheOfflineShell(cache) {
  const response = await fetch(OFFLINE_ROUTE, { cache: "reload" });
  if (!response.ok) throw new Error("Offline shell could not be cached.");
  const html = await response.clone().text();
  await cache.put(OFFLINE_ROUTE, response);

  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g)) {
    const asset = new URL(match[1], self.location.origin);
    if (asset.origin === self.location.origin) assets.add(asset.href);
  }
  await Promise.all([...assets].map(async asset => {
    try {
      const assetResponse = await fetch(asset, { cache: "reload" });
      if (assetResponse.ok) await cache.put(asset, assetResponse);
    } catch { /* Offline page still works in its server-rendered language. */ }
  }));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cacheOfflineShell(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("brick-erp-shell-") && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && (url.pathname === DASHBOARD_ROUTE || url.pathname === OFFLINE_ROUTE || url.pathname === "/expenses")) {
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch {
        if (url.pathname === DASHBOARD_ROUTE) {
          const dashboard = await cache.match(DASHBOARD_ROUTE);
          if (dashboard) return dashboard;
        }
        if (url.pathname === "/expenses") {
          const expenses = await cache.match("/expenses");
          if (expenses) return expenses;
        }
        return (await cache.match(OFFLINE_ROUTE)) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-") || url.pathname === "/manifest.webmanifest") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    })());
  }
});
