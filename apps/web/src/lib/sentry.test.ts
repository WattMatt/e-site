import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// What the browser and server SDKs are initialised with is a privacy decision,
// not a tuning knob: /legal/privacy tells users Sentry receives "IP address,
// stack traces, and limited request metadata only". Session Replay (a DOM
// recording of whatever is on screen) and server-side local variable capture
// (the values of every local in each stack frame — tenant rows, costs, rates)
// both exceed that. Until 2026-10-07 the CSP refused every browser envelope,
// which was the only thing stopping unmasked replays leaving the browser.

const { init, replayIntegration, captureException } = vi.hoisted(() => ({
  init: vi.fn(),
  replayIntegration: vi.fn(() => ({ name: 'Replay' })),
  captureException: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ init, replayIntegration, captureException }))

describe('browser Sentry (lib/sentry.ts)', () => {
  beforeEach(() => {
    init.mockClear()
    replayIntegration.mockClear()
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/2')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    delete (window as unknown as Record<string, unknown>).__SENTRY__
  })

  it('initialises without Session Replay', async () => {
    const { initSentry } = await import('./sentry')
    await initSentry()

    expect(init).toHaveBeenCalledTimes(1)
    const options = init.mock.calls[0][0] as Record<string, unknown>
    expect(replayIntegration).not.toHaveBeenCalled()
    expect(options).not.toHaveProperty('replaysSessionSampleRate')
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate')
    const integrations = (options.integrations ?? []) as Array<{ name?: string }>
    expect(integrations.map((i) => i?.name)).not.toContain('Replay')
  })

  // window.__SENTRY__ is the SDK's own global carrier (@sentry/core carrier.js
  // keeps the client and scopes under __SENTRY__[version]). Until 2026-10-07
  // initSentry() replaced it with the module, which discarded the client: on a
  // preview with the CSP fixed, captureException and an uncaught throw each
  // sent zero envelopes.
  it('leaves the SDK global carrier alone', async () => {
    const { initSentry } = await import('./sentry')
    await initSentry()
    expect((window as unknown as Record<string, unknown>).__SENTRY__).toBeUndefined()
  })

  it('captureError forwards to the SDK once initialised', async () => {
    captureException.mockClear()
    const { initSentry, captureError } = await import('./sentry')
    await initSentry()
    const err = new Error('boom')
    captureError(err, { where: 'test' })
    expect(captureException).toHaveBeenCalledWith(err, { extra: { where: 'test' } })
  })

  it('does not opt into default PII', async () => {
    const { initSentry } = await import('./sentry')
    await initSentry()
    const options = init.mock.calls[0][0] as Record<string, unknown>
    expect(options.sendDefaultPii).not.toBe(true)
  })
})

describe('server Sentry (lib/sentry-server.ts)', () => {
  beforeEach(() => init.mockClear())

  it('does not capture local variable values in stack frames', async () => {
    const { initServerSentry } = await import('./sentry-server')
    initServerSentry('https://k@o1.ingest.de.sentry.io/2')

    const options = init.mock.calls[0][0] as Record<string, unknown>
    expect(options.includeLocalVariables).not.toBe(true)
    expect(options.sendDefaultPii).not.toBe(true)
  })
})

// Each init must route every outbound event, transaction and breadcrumb
// through lib/sentry-scrub.ts. Values invented; shapes are the app's own.
const WA = 'Qm9ndXNXYUxpbmtUb2tlbkZvclNlbnRyeVRlc3RzMDE'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.c2lnbmF0dXJlLWJvZ3Vz'
const realisticEvent = () => ({
  transaction: `/auth/wa-link/${WA}`,
  request: {
    url: `https://www.e-site.live/reset-password/confirm#access_token=${JWT}&refresh_token=r3fr3sh&type=recovery`,
    headers: { Referer: 'https://www.e-site.live/auth/callback?token_hash=pkce_7c1e9b4f&type=recovery' },
  },
  breadcrumbs: [
    {
      category: 'fetch',
      data: { url: `https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/a.jpg?token=${JWT}` },
    },
    { category: 'navigation', data: { from: `/auth/wa-link/${WA}`, to: '/auth/callback?code=0b1f6c2e' } },
  ],
  spans: [{ description: `GET /storage/v1/object/sign/a.jpg?token=${JWT}`, data: { 'http.url': `/a.jpg?token=${JWT}` } }],
})
const LEAKS = [WA, JWT, 'r3fr3sh', 'pkce_7c1e9b4f', '0b1f6c2e']

type Hook = (item: unknown, hint?: unknown) => unknown
function expectScrubbingHooks(options: Record<string, unknown>) {
  for (const name of ['beforeSend', 'beforeSendTransaction'] as const) {
    const hook = options[name] as Hook | undefined
    expect(hook, name).toBeTypeOf('function')
    const wire = JSON.stringify(hook!(realisticEvent(), {}))
    for (const leak of LEAKS) expect(wire, `${name} leaks ${leak}`).not.toContain(leak)
    expect(wire).toContain('/auth/wa-link/[token]')
    expect(wire).toContain('type=recovery')
  }
  const beforeBreadcrumb = options.beforeBreadcrumb as Hook | undefined
  expect(beforeBreadcrumb, 'beforeBreadcrumb').toBeTypeOf('function')
  const crumb = beforeBreadcrumb!(
    { category: 'navigation', data: { from: `/auth/wa-link/${WA}`, to: `/x#access_token=${JWT}` } },
    {},
  )
  expect(crumb).toEqual({ category: 'navigation', data: { from: '/auth/wa-link/[token]', to: '/x#access_token=REDACTED' } })
}

describe('URL secrets are scrubbed before anything leaves', () => {
  beforeEach(() => {
    init.mockClear()
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/2')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('browser init scrubs events, transactions and breadcrumbs', async () => {
    const { initSentry } = await import('./sentry')
    await initSentry()
    expectScrubbingHooks(init.mock.calls[0][0] as Record<string, unknown>)
  })

  // The previous server hook read event.breadcrumbs.values. In the JS SDK
  // breadcrumbs is an array, so that was Array.prototype.values and .map
  // threw; core 8.55.1 then drops the event ("original event will not be
  // sent"). Every server error carrying a breadcrumb was lost.
  it('server beforeSend returns an event that carries breadcrumbs', async () => {
    const { initServerSentry } = await import('./sentry-server')
    initServerSentry('https://k@o1.ingest.de.sentry.io/2')
    const beforeSend = (init.mock.calls[0][0] as Record<string, unknown>).beforeSend as Hook
    const event = { message: 'boom', breadcrumbs: [{ category: 'http', data: { url: '/rest/v1/x' } }] }
    expect(beforeSend(event, {})).toEqual(event)
  })

  it('server init scrubs events, transactions and breadcrumbs', async () => {
    const { initServerSentry } = await import('./sentry-server')
    initServerSentry('https://k@o1.ingest.de.sentry.io/2')
    expectScrubbingHooks(init.mock.calls[0][0] as Record<string, unknown>)
  })
})

describe('no app code touches window.__SENTRY__', () => {
  it('only the SDK reads or writes its global carrier', () => {
    const root = path.resolve(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8')
          // Comments may name it; code may not.
          const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
          if (code.includes('__SENTRY__')) offenders.push(path.relative(root, full))
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
