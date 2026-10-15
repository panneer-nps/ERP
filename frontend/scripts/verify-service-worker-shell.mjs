import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://erp.example.test";
const handlers = new Map();
const requests = [];
const cacheEntries = new Map();
let networkOnline = true;
const cache = {
  async put(key, response) {
    const url = typeof key === "string" ? new URL(key, origin) : new URL(key.url);
    cacheEntries.set(url.href, await response.clone().text());
  },
  async match(key) {
    const url = typeof key === "string" ? new URL(key, origin) : new URL(key.url);
    const body = cacheEntries.get(url.href);
    return body === undefined ? undefined : new Response(body);
  },
};
const html = [
  '<link rel="stylesheet" href="/_next/static/css/offline.css">',
  '<script src="/_next/static/chunks/framework.js"></script>',
  '<script src="/_next/static/chunks/app/offline/page.js"></script>',
  '<script src="https://cdn.example.test/unrelated.js"></script>',
].join("");
let skipWaitingCalled = false;

vm.runInNewContext(source, {
  URL,
  Response,
  fetch: async (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url, origin);
    requests.push({ url: url.href, options });
    if (!networkOnline) throw new Error("network unavailable");
    if (url.pathname === "/offline") return new Response(html, { status: 200 });
    if (url.pathname.endsWith("unavailable.js")) throw new Error("asset offline");
    if (url.pathname === "/dashboard") return new Response("cached dashboard", { status: 200 });
    if (url.pathname === "/expenses") return new Response("cached expenses", { status: 200 });
    if (url.pathname === "/manifest.webmanifest") return new Response(JSON.stringify({ name: "Brick Chamber ERP", display: "standalone" }), { status: 200 });
    if (url.origin === origin && url.pathname.startsWith("/_next/static/")) return new Response(`cached:${url.pathname}`, { status: 200 });
    return new Response("not found", { status: 404 });
  },
  caches: { open: async () => cache, keys: async () => [], delete: async () => true },
  self: {
    location: { origin },
    clients: { claim: async () => undefined },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: async () => { skipWaitingCalled = true; },
  },
});

let installation;
handlers.get("install")({ waitUntil(promise) { installation = promise; } });
await installation;

assert.equal(cacheEntries.has(`${origin}/offline`), true, "offline HTML should be cached");
assert.equal(cacheEntries.has(`${origin}/_next/static/css/offline.css`), true, "offline CSS should be cached");
assert.equal(cacheEntries.has(`${origin}/_next/static/chunks/framework.js`), true, "shared hydration runtime should be cached");
assert.equal(cacheEntries.has(`${origin}/_next/static/chunks/app/offline/page.js`), true, "offline language-switcher code should be cached");
assert.equal(requests.some(request => request.url.startsWith("https://cdn.example.test/")), false, "external assets must not be fetched for the offline shell");
assert.equal(skipWaitingCalled, true, "the worker should activate after caching the shell");

const manifestRequest = { url: `${origin}/manifest.webmanifest`, method: "GET", mode: "cors" };
const onlineManifest = await dispatchFetch(manifestRequest);
assert.equal(JSON.parse(await onlineManifest.text()).display, "standalone", "the install manifest should be served while online");

async function dispatchFetch(request) {
  let responsePromise;
  handlers.get("fetch")({ request, respondWith(promise) { responsePromise = Promise.resolve(promise); } });
  return responsePromise ? responsePromise : undefined;
}

const dashboardRequest = { url: `${origin}/dashboard`, method: "GET", mode: "navigate" };
const expensesRequest = { url: `${origin}/expenses`, method: "GET", mode: "navigate" };
await dispatchFetch(dashboardRequest);
await dispatchFetch(expensesRequest);
networkOnline = false;

const cachedDashboard = await dispatchFetch(dashboardRequest);
assert.equal(await cachedDashboard.text(), "cached dashboard", "offline navigation should serve the cached dashboard");
const cachedExpenses = await dispatchFetch(expensesRequest);
assert.equal(await cachedExpenses.text(), "cached expenses", "offline navigation should serve the cached expense page");
const offlineFallback = await dispatchFetch({ url: `${origin}/reports`, method: "GET", mode: "navigate" });
assert.equal((await offlineFallback.text()).includes("/offline"), true, "uncached navigation should serve the cached offline page");
const cachedLocaleChunk = await dispatchFetch({ url: `${origin}/_next/static/chunks/app/offline/page.js`, method: "GET", mode: "no-cors" });
assert.equal((await cachedLocaleChunk.text()).includes("offline/page.js"), true, "offline language-switcher code should be served from cache");
const cachedManifest = await dispatchFetch(manifestRequest);
assert.equal(JSON.parse(await cachedManifest.text()).name, "Brick Chamber ERP", "the installed app manifest should be served from cache offline");

const requestsBeforeBypass = requests.length;
assert.equal(await dispatchFetch({ url: `${origin}/api/auth/status`, method: "GET", mode: "cors" }), undefined, "API reads must bypass the service worker");
assert.equal(await dispatchFetch({ url: `${origin}/expenses`, method: "POST", mode: "cors" }), undefined, "writes must bypass the service worker");
assert.equal(requests.length, requestsBeforeBypass, "bypassed requests must not be sent to the worker's network fetch path");

console.log(JSON.stringify({ check: "service-worker-offline-shell", cachedOfflineHtml: true, cachedStylesheet: true, cachedHydrationRuntime: true, cachedLocaleSwitcher: true, installedAppManifest: true, dashboardFallback: true, expensesFallback: true, uncachedRouteFallback: true, apiAndWritesBypassCache: true, externalAssetsSkipped: true }));
