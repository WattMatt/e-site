/* E-Site service worker — app shell only (owner decision D1, 2026-10-05).
 *
 * What it does, and nothing else:
 *   1. /_next/static/* and /icons/* — cache-first. These are content-hashed
 *      or versioned public files, identical for every user.
 *   2. Page navigations — always the network. If the network fails, an
 *      offline page built HERE (never fetched, never cached) is shown.
 *   3. Everything else — not touched: no respondWith, the browser handles it.
 *
 * What it must never do: store HTML, RSC payloads, API responses, server
 * actions, Supabase calls or anything else that belongs to one signed-in
 * user. Only same-origin GETs under the two static prefixes reach a cache.
 * Unit-tested in src/lib/pwa/sw.test.ts against this exact file.
 *
 * Kill switch: deploy with NEXT_PUBLIC_SW_DISABLED=true and the page-side
 * registrar unregisters every installed copy on the next visit.
 */
const VERSION = 'v1'
const STATIC_CACHE = 'esite-static-' + VERSION
const MAX_STATIC_ENTRIES = 400
const STATIC_PREFIXES = ['/_next/static/', '/icons/']

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('esite-') && k !== STATIC_CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlineResponse))
  }
})

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
    trim(cache)
  }
  return response
}

async function trim(cache) {
  const keys = await cache.keys()
  const excess = keys.length - MAX_STATIC_ENTRIES
  for (let i = 0; i < excess; i++) await cache.delete(keys[i])
}

function offlineResponse() {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<title>Offline — E-Site</title><style>'
    + ':root{color-scheme:dark;--bg:#0B0B12;--fg:#EDE8DF;--dim:#9098B0;--amber:#E8923A}'
    + '@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#ECE7DD;--fg:#1C1814;--dim:#5E574A;--amber:#B5670F}}'
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);'
    + 'font:16px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box;text-align:center}'
    + 'h1{font-size:20px;margin:16px 0 8px}p{color:var(--dim);margin:0 0 24px;max-width:320px}'
    + '.mark{width:56px;height:56px;border-radius:14px;background:#E8923A;display:inline-flex;align-items:center;justify-content:center}'
    + 'button{min-height:48px;padding:0 24px;border-radius:8px;border:0;background:var(--amber);color:#0B0B12;font:inherit;font-weight:700}'
    + '</style></head><body><main>'
    + '<div class="mark"><svg viewBox="0 0 20 20" width="34" height="34" aria-hidden="true"><path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill="#0B0B12"/></svg></div>'
    + '<h1>You are offline</h1>'
    + '<p>E-Site needs a connection to load this page. Nothing you saved before going offline is lost.</p>'
    + '<button type="button" onclick="location.reload()">Try again</button>'
    + '</main></body></html>'
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
