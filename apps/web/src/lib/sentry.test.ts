import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// What the browser and server SDKs are initialised with is a privacy decision,
// not a tuning knob: /legal/privacy tells users Sentry receives "IP address,
// stack traces, and limited request metadata only". Session Replay (a DOM
// recording of whatever is on screen) and server-side local variable capture
// (the values of every local in each stack frame — tenant rows, costs, rates)
// both exceed that. Until 2026-10-07 the CSP refused every browser envelope,
// which was the only thing stopping unmasked replays leaving the browser.

const init = vi.fn()
const replayIntegration = vi.fn(() => ({ name: 'Replay' }))

vi.mock('@sentry/nextjs', () => ({
  init,
  replayIntegration,
  captureException: vi.fn(),
}))

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
