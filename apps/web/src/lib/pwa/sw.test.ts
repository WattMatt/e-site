/**
 * Runs the REAL public/sw.js in a sandbox and fires fetch events at it. The
 * property under test is what it refuses to touch: anything that could carry
 * one signed-in user's data must never reach a cache or be answered by the
 * worker.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import vm from 'vm'

const SOURCE = readFileSync(path.join(__dirname, '../../../public/sw.js'), 'utf8')
const ORIGIN = 'https://www.e-site.live'

type Handler = (event: unknown) => void

function load(fetchImpl: (req: unknown) => Promise<Response>) {
  const handlers: Record<string, Handler> = {}
  const store = new Map<string, Map<string, Response>>()
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map())
      const c = store.get(name)!
      return {
        match: async (req: { url: string }) => c.get(req.url)?.clone(),
        put: async (req: { url: string }, res: Response) => { c.set(req.url, res) },
        keys: async () => [...c.keys()].map(url => ({ url })),
        delete: async (req: { url: string }) => c.delete(req.url),
      }
    },
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, h: Handler) => { handlers[type] = h },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  }
  vm.runInNewContext(SOURCE, { self, caches, fetch: fetchImpl, Response, URL, Promise, console })
  return { handlers, store }
}

function fetchEvent(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
  let responded: Promise<Response> | null = null
  const request = { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: init.headers ?? {} }
  return {
    event: { request, respondWith: (p: Promise<Response>) => { responded = p } },
    responded: () => responded,
  }
}

const ok = (body = 'ok') => new Response(body, { status: 200 })
Object.defineProperty(Response.prototype, 'type', { get: () => 'basic', configurable: true })

let fetchMock: ReturnType<typeof vi.fn>
let sw: ReturnType<typeof load>
beforeEach(() => {
  fetchMock = vi.fn(async () => ok())
  sw = load(fetchMock)
})

describe('public/sw.js', () => {
  it.each([
    ['an RSC payload', `${ORIGIN}/projects/p1?_rsc=abc`, { headers: { RSC: '1' } }],
    ['an API call', `${ORIGIN}/api/notifications/dispatch`, {}],
    ['a server action', `${ORIGIN}/projects/p1/diary`, { method: 'POST' }],
    ['a Supabase call', 'https://cbskbnvvgcybmfikxgky.supabase.co/rest/v1/projects', {}],
    ['a signed storage URL', 'https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/x', {}],
    ['the manifest', `${ORIGIN}/manifest.webmanifest`, {}],
  ])('leaves %s entirely to the browser (no respondWith, nothing cached)', async (_label, url, init) => {
    const e = fetchEvent(url, init)
    sw.handlers.fetch(e.event)
    expect(e.responded()).toBeNull()
    expect(sw.store.size).toBe(0)
  })

  it('serves hashed static assets cache-first', async () => {
    const url = `${ORIGIN}/_next/static/chunks/app-abc123.js`
    const first = fetchEvent(url)
    sw.handlers.fetch(first.event)
    expect(await (await first.responded()!).text()).toBe('ok')
    const second = fetchEvent(url)
    sw.handlers.fetch(second.event)
    await second.responded()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed static response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }))
    const e = fetchEvent(`${ORIGIN}/_next/static/chunks/missing.js`)
    sw.handlers.fetch(e.event)
    expect((await e.responded()!).status).toBe(404)
    const cache = [...sw.store.values()][0]
    expect(cache?.size ?? 0).toBe(0)
  })

  it('sends page navigations to the network and never caches the HTML', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>dashboard for one user</html>', { status: 200 }))
    const e = fetchEvent(`${ORIGIN}/dashboard`, { mode: 'navigate' })
    sw.handlers.fetch(e.event)
    expect(await (await e.responded()!).text()).toContain('dashboard for one user')
    expect(sw.store.size).toBe(0)
  })

  it('shows a self-contained offline page when a navigation cannot reach the network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const e = fetchEvent(`${ORIGIN}/projects/p1`, { mode: 'navigate' })
    sw.handlers.fetch(e.event)
    const res = await e.responded()!
    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toContain('You are offline')
    expect(sw.store.size).toBe(0)
  })

  it('on activate, deletes older E-Site caches and leaves other caches alone', async () => {
    sw.store.set('esite-static-v0', new Map())
    sw.store.set('someone-else', new Map())
    sw.store.set('esite-static-v1', new Map())
    let done: Promise<unknown> = Promise.resolve()
    sw.handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
    expect([...sw.store.keys()].sort()).toEqual(['esite-static-v1', 'someone-else'])
  })
})
