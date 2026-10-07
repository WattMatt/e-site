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
