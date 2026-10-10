const CACHE_NAME = "brick-erp-shell-v1";
const OFFLINE_ROUTE = "/offline";
const DASHBOARD_ROUTE = "/dashboard";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.add(OFFLINE_ROUTE);
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
