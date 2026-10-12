// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A fake posthog-node client that models what a FROZEN serverless function
// delivers. posthog-node's capture()/identify() only queue: a send starts when
// the queue reaches flushAt or the flushInterval timer fires, and nobody awaits
// that background send. On Vercel the function is frozen once the response is
// out, so the only events that reach PostHog are the ones whose send was
// AWAITED — through shutdown() or flush(). The fake therefore counts an event
// as delivered only when one of those is awaited. A client built with
// flushAt: 20 and never shut down delivers nothing here, as in production.
const { instances, failures, afterMock, realAfter } = vi.hoisted(() => {
  type Message = { kind: 'capture' | 'identify'; distinctId: string; event?: string; properties?: unknown }
  const instances: Array<{
    key: string
    options: Record<string, unknown>
    queue: Message[]
    delivered: Message[]
    capture: ReturnType<typeof vi.fn>
    identify: ReturnType<typeof vi.fn>
    flush: ReturnType<typeof vi.fn>
    shutdown: ReturnType<typeof vi.fn>
  }> = []
  return {
    instances,
    // Switches the fake consults, so a test can make one step fail.
    failures: { construct: null as Error | null, capture: null as Error | null, shutdown: null as unknown },
    afterMock: vi.fn<(task: () => unknown) => void>(),
    realAfter: { current: null as null | ((task: () => unknown) => void) },
  }
})

vi.mock('posthog-node', () => {
  class PostHog {
    key: string
    options: Record<string, unknown>
    queue: Array<{ kind: 'capture' | 'identify'; distinctId: string; event?: string; properties?: unknown }> = []
    delivered: typeof this.queue = []
    constructor(key: string, options: Record<string, unknown>) {
      if (failures.construct) throw failures.construct
      this.key = key
      this.options = options
      instances.push(this as never)
    }
    capture = vi.fn(({ distinctId, event, properties }: { distinctId: string; event: string; properties?: unknown }) => {
      if (failures.capture) throw failures.capture
      this.queue.push({ kind: 'capture', distinctId, event, properties })
    })
    identify = vi.fn(({ distinctId, properties }: { distinctId: string; properties?: unknown }) => {
      this.queue.push({ kind: 'identify', distinctId, properties })
    })
    flush = vi.fn(async () => {
      this.delivered.push(...this.queue.splice(0))
    })
    on = vi.fn()
    shutdown = vi.fn(async () => {
      if (failures.shutdown) throw failures.shutdown
      this.delivered.push(...this.queue.splice(0))
    })
  }
  return { PostHog }
})

// The real after() throws outside a request scope (where vitest runs), which
// exercises the inline fallback. Tests that need the deferred path capture the
// task instead.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  realAfter.current = actual.after as (task: () => unknown) => void
  return { ...actual, after: afterMock }
})

import { trackServer, identifyServer, ANALYTICS_EVENTS } from './analytics'

const delivered = () => instances.flatMap((c) => c.delivered)

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  instances.length = 0
  failures.construct = null
  failures.capture = null
  failures.shutdown = null
  afterMock.mockReset()
  afterMock.mockImplementation((task) => realAfter.current!(task))
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY
  warn.mockRestore()
})

describe('trackServer delivers each event before the function can freeze', () => {
  it('outside a request scope: the event is sent before trackServer resolves', async () => {
    await trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED, { rfi_id: 'r1' })

    expect(delivered()).toEqual([
      { kind: 'capture', distinctId: 'user-1', event: 'rfi_created', properties: { rfi_id: 'r1' } },
    ])
  })

  it('inside a request: the send is handed to after(), so the response is not delayed', async () => {
    const tasks: Array<() => unknown> = []
    afterMock.mockImplementation((task) => {
      tasks.push(task)
    })

    await trackServer('user-1', ANALYTICS_EVENTS.PROJECT_CREATED, { project_id: 'p1' })

    // The action has returned; nothing has been sent yet.
    expect(tasks).toHaveLength(1)
    expect(delivered()).toEqual([])

    // Next runs the after() task once the response is out, and keeps the
    // function alive until it settles.
    await tasks[0]()
    expect(delivered()).toEqual([
      { kind: 'capture', distinctId: 'user-1', event: 'project_created', properties: { project_id: 'p1' } },
    ])
  })

  it('builds a client that sends one event at a time with no timer, on the EU host', async () => {
    await trackServer('user-1', ANALYTICS_EVENTS.SNAG_RESOLVED)

    expect(instances).toHaveLength(1)
    expect(instances[0].key).toBe('phc_test_key')
    expect(instances[0].options).toMatchObject({
      host: 'https://eu.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
    })
  })

  it('each call shuts down only its own client, so one request never waits on another', async () => {
    await trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED)
    await trackServer('user-2', ANALYTICS_EVENTS.RFI_CLOSED)

    expect(instances).toHaveLength(2)
    for (const client of instances) expect(client.shutdown).toHaveBeenCalledTimes(1)
    expect(delivered().map((m) => m.distinctId)).toEqual(['user-1', 'user-2'])
  })

  it('does nothing when no PostHog key is configured', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY

    await trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED)

    expect(instances).toHaveLength(0)
    expect(afterMock).not.toHaveBeenCalled()
  })
})

describe('identifyServer delivers before the function can freeze', () => {
  it('sends the identify before resolving outside a request scope', async () => {
    await identifyServer('user-1', { org_id: 'o1', role: 'owner' })

    expect(delivered()).toEqual([
      { kind: 'identify', distinctId: 'user-1', properties: { org_id: 'o1', role: 'owner' } },
    ])
  })

  it('hands the send to after() inside a request', async () => {
    const tasks: Array<() => unknown> = []
    afterMock.mockImplementation((task) => {
      tasks.push(task)
    })

    await identifyServer('user-1', { role: 'admin' })
    expect(delivered()).toEqual([])

    await tasks[0]()
    expect(delivered()).toHaveLength(1)
  })
})

describe('an analytics failure never reaches the action', () => {
  it('a client that cannot be built', async () => {
    failures.construct = new Error('boom')

    await expect(trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED)).resolves.toBeUndefined()
    await expect(identifyServer('user-1', {})).resolves.toBeUndefined()
  })

  it('capture() throwing', async () => {
    failures.capture = new Error('capture failed')

    await expect(trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED)).resolves.toBeUndefined()
  })

  it('shutdown() rejecting, inline and deferred', async () => {
    // posthog-node rejects shutdown() with a bare string when it times out.
    failures.shutdown = 'Timeout while shutting down PostHog. Some events may not have been sent.'

    await expect(trackServer('user-1', ANALYTICS_EVENTS.RFI_CREATED)).resolves.toBeUndefined()

    const tasks: Array<() => unknown> = []
    afterMock.mockImplementation((task) => {
      tasks.push(task)
    })
    await expect(identifyServer('user-1', {})).resolves.toBeUndefined()
    // The after() task itself must not reject either.
    await expect(Promise.resolve(tasks[0]())).resolves.toBeUndefined()
  })
})
