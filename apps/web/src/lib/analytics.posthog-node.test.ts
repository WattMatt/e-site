// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// analytics.test.ts uses a fake client that encodes how posthog-node queues.
// This file checks that reading against the REAL library: trackServer runs
// against posthog-node itself, pointed at a local server standing in for
// PostHog. Outside a request scope after() throws and the send runs inline,
// so by the time trackServer resolves the request must have arrived.

type Received = { path: string; body: { api_key: string; batch: Array<{ event: string; distinct_id: string; type: string }> } }

let server: Server
let received: Received[] = []
let status = 200

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      received.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') })
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(status === 200 ? '{"status":1}' : '{"type":"authentication_error","code":"authentication_failed"}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  // posthog-hosts.ts passes a non-PostHog-Cloud host through unchanged.
  process.env.NEXT_PUBLIC_POSTHOG_HOST = `http://127.0.0.1:${port}`
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_local_test'
})

afterAll(async () => {
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  received = []
  status = 200
  vi.resetModules()
})

describe('trackServer against the real posthog-node', () => {
  it('the event has reached the server when trackServer resolves', async () => {
    const { trackServer, ANALYTICS_EVENTS } = await import('./analytics')

    await trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED, { rfi_id: 'r1' })

    expect(received).toHaveLength(1)
    expect(received[0].path).toBe('/batch/')
    expect(received[0].body.api_key).toBe('phc_local_test')
    expect(received[0].body.batch).toMatchObject([{ event: 'rfi_created', distinct_id: 'user-1', type: 'capture' }])
  })

  it('identifyServer has reached the server when it resolves', async () => {
    const { identifyServer } = await import('./analytics')

    await identifyServer('user-1', { role: 'owner' })

    expect(received).toHaveLength(1)
    expect(received[0].body.batch).toMatchObject([{ event: '$identify', distinct_id: 'user-1', type: 'identify' }])
  })

  it('a rejected key (401, as production has today) neither throws nor hangs', async () => {
    status = 401
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { trackServer, ANALYTICS_EVENTS } = await import('./analytics')

    const started = Date.now()
    await expect(trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED)).resolves.toBeUndefined()

    // One send plus one retry, well inside the shutdown bound.
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(received.length).toBeGreaterThanOrEqual(1)
    // shutdown() resolves cleanly on a 401, so the only trace of a bad key is
    // the line trackServer writes from the client's 'error' event, and it
    // must be written before trackServer resolves (the function freezes next).
    expect(warn.mock.calls.flat().map(String).join(' ')).toMatch(/event rfi_created was not sent:.*status=401/)
    error.mockRestore()
    warn.mockRestore()
  }, 10_000)
})
