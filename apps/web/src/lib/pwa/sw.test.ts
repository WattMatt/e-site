/**
 * Runs the REAL public/sw.js in a sandbox and fires fetch events at it. The
 * property under test is what it refuses to touch: anything that could carry
 * one signed-in user's data must never reach a cache or be answered by the
 * worker. Each case targets the specific line that guards it, so deleting
 * that line fails the case.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import vm from 'vm'

const SOURCE = readFileSync(path.join(__dirname, '../../../public/sw.js'), 'utf8')
const ORIGIN = 'https://www.e-site.live'
const OTHER = 'https://cdn.example.com'

type Handler = (event: unknown) => void

/** A Response whose `type` is set the way a browser would (Node always says 'default'). */
function res(body: string, status = 200, type: 'basic' | 'cors' | 'opaque' = 'basic'): Response {
  const r = new Response(status === 204 ? null : body, { status })
  Object.defineProperty(r, 'type', { value: type })
  const clone = r.clone.bind(r)
  Object.defineProperty(r, 'clone', { value: () => { const c = clone(); Object.defineProperty(c, 'type', { value: type }); return c } })
  return r
}

function load(fetchImpl: (req: unknown) => Promise<Response>, opts: { putRejects?: boolean } = {}) {
  const handlers: Record<string, Handler> = {}
  const store = new Map<string, Map<string, Response>>()
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map())
      const c = store.get(name)!
      return {
        match: async (req: { url: string }) => c.get(req.url),
        put: async (req: { url: string }, r: Response) => {
          if (opts.putRejects) throw new DOMException('Quota exceeded', 'QuotaExceededError')
          c.set(req.url, r)
        },
        keys: async () => [...c.keys()].map(url => ({ url })),
        delete: async (req: { url: string }) => c.delete(req.url),
      }
    },
  }
  const enablePreload = vi.fn(async () => {})
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, h: Handler) => { handlers[type] = h },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
    registration: { navigationPreload: { enable: enablePreload } },
  }
  vm.runInNewContext(SOURCE, { self, caches, fetch: fetchImpl, Response, URL, Promise, console, DOMException })
  return { handlers, store, enablePreload }
}

function fetchEvent(url: string, init: { method?: string; mode?: string; preload?: Promise<Response | undefined> } = {}) {
  let responded: Promise<Response> | null = null
  const pending: Promise<unknown>[] = []
  const request = { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }
  return {
    event: {
      request,
      preloadResponse: init.preload,
      respondWith: (p: Promise<Response>) => { responded = p },
      waitUntil: (p: Promise<unknown>) => { pending.push(p) },
    },
    responded: () => responded as Promise<Response> | null,
    settled: () => Promise.all(pending),
  }
}

let fetchMock: ReturnType<typeof vi.fn>
let sw: ReturnType<typeof load>
beforeEach(() => {
  fetchMock = vi.fn(async () => res('ok'))
  sw = load(fetchMock)
})

const entries = () => [...sw.store.values()].reduce((n, c) => n + c.size, 0)

describe('public/sw.js — what it never touches', () => {
  it.each([
    ['an RSC payload', `${ORIGIN}/projects/p1?_rsc=abc`, {}],
    ['an API call', `${ORIGIN}/api/notifications/dispatch`, {}],
    ['a server action (POST, fetch)', `${ORIGIN}/projects/p1/diary`, { method: 'POST' }],
    ['a no-JS form submit (POST, navigate)', `${ORIGIN}/auth/signout`, { method: 'POST', mode: 'navigate' }],
    ['a cross-origin static-looking URL', `${OTHER}/_next/static/chunks/x.js`, {}],
    ['a cross-origin navigation', `${OTHER}/some-page`, { mode: 'navigate' }],
    ['a Supabase call', 'https://cbskbnvvgcybmfikxgky.supabase.co/rest/v1/projects', {}],
    ['an icon (fixed name: left to HTTP caching so a new icon reaches installs)', `${ORIGIN}/icons/icon-192.png`, {}],
    ['the manifest', `${ORIGIN}/manifest.webmanifest`, {}],
    ['an optimised image', `${ORIGIN}/_next/image?url=x&w=64&q=75`, {}],
  ])('leaves %s entirely to the browser', async (_label, url, init) => {
    const e = fetchEvent(url, init)
    sw.handlers.fetch(e.event)
    expect(e.responded()).toBeNull()
    expect(entries()).toBe(0)
  })
})

describe('public/sw.js — hashed static assets', () => {
  const chunk = `${ORIGIN}/_next/static/chunks/app-abc123.js`

  it('are served cache-first after the first download', async () => {
    const first = fetchEvent(chunk)
    sw.handlers.fetch(first.event)
    expect(await (await first.responded()!).text()).toBe('ok')
    await first.settled()
    const second = fetchEvent(chunk)
    sw.handlers.fetch(second.event)
    await second.responded()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a 404', () => res('nope', 404)],
    ['a 206 partial response', () => res('part', 206)],
    ['an opaque response', () => res('x', 200, 'opaque')],
    ['a CORS response', () => res('x', 200, 'cors')],
  ])('are not stored when the response is %s', async (_l, make) => {
    fetchMock.mockResolvedValueOnce(make())
    const e = fetchEvent(chunk)
    sw.handlers.fetch(e.event)
    await e.responded()
    await e.settled()
    expect(entries()).toBe(0)
  })

  it('still load when the cache refuses the write (full disk)', async () => {
    sw = load(fetchMock, { putRejects: true })
    const e = fetchEvent(chunk)
    sw.handlers.fetch(e.event)
    const r = await e.responded()!
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('ok')
    await expect(e.settled()).resolves.toBeDefined()
  })

  it('are capped at 400 entries, oldest evicted first', async () => {
    for (let i = 0; i <= 400; i++) {
      const e = fetchEvent(`${ORIGIN}/_next/static/chunks/c${i}.js`)
      sw.handlers.fetch(e.event)
      await e.responded()
      await e.settled()
    }
    const cache = [...sw.store.values()][0]
    expect(cache.size).toBe(400)
    expect(cache.has(`${ORIGIN}/_next/static/chunks/c0.js`)).toBe(false)
    expect(cache.has(`${ORIGIN}/_next/static/chunks/c400.js`)).toBe(true)
  })
})

describe('public/sw.js — page navigations', () => {
  it('go to the network and the HTML is never cached', async () => {
    fetchMock.mockResolvedValueOnce(res('<html>dashboard for one user</html>'))
    const e = fetchEvent(`${ORIGIN}/dashboard`, { mode: 'navigate' })
    sw.handlers.fetch(e.event)
    expect(await (await e.responded()!).text()).toContain('dashboard for one user')
    await e.settled()
    expect(entries()).toBe(0)
  })

  it('use the navigation-preload response when the browser started one', async () => {
    const e = fetchEvent(`${ORIGIN}/dashboard`, { mode: 'navigate', preload: Promise.resolve(res('preloaded')) })
    sw.handlers.fetch(e.event)
    expect(await (await e.responded()!).text()).toBe('preloaded')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('show a self-contained offline page when the network is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const e = fetchEvent(`${ORIGIN}/projects/p1`, { mode: 'navigate' })
    sw.handlers.fetch(e.event)
    const r = await e.responded()!
    expect(r.status).toBe(503)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(await r.text()).toContain('You are offline')
    expect(entries()).toBe(0)
  })
})

describe('public/sw.js — activation', () => {
  it('enables navigation preload, deletes older E-Site caches and leaves other caches alone', async () => {
    sw.store.set('esite-static-v0', new Map())
    sw.store.set('someone-else', new Map())
    sw.store.set('esite-static-v1', new Map())
    let done: Promise<unknown> = Promise.resolve()
    sw.handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
    expect([...sw.store.keys()].sort()).toEqual(['esite-static-v1', 'someone-else'])
    expect(sw.enablePreload).toHaveBeenCalled()
  })
})
