import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveSentryIngestOrigin } from './sentry-hosts'

// Invented ids — the shape of a real DSN, not E-Site's.
const DE_DSN = 'https://0123456789abcdef@o1000000000000001.ingest.de.sentry.io/2000000000000002'
const US_DSN = 'https://0123456789abcdef@o1000000000000001.ingest.us.sentry.io/2000000000000002'

describe('resolveSentryIngestOrigin', () => {
  it('returns the exact DE-region ingest origin the browser SDK posts envelopes to', () => {
    expect(resolveSentryIngestOrigin(DE_DSN)).toBe('https://o1000000000000001.ingest.de.sentry.io')
  })

  it('follows the DSN to another region rather than assuming one', () => {
    expect(resolveSentryIngestOrigin(US_DSN)).toBe('https://o1000000000000001.ingest.us.sentry.io')
  })

  it('never carries the DSN public key (userinfo) or the project path into the origin', () => {
    const origin = resolveSentryIngestOrigin(DE_DSN)!
    expect(origin).not.toContain('0123456789abcdef')
    expect(origin).not.toContain('@')
    expect(origin).not.toContain('2000000000000002')
  })

  it('returns null when no DSN is configured — browser Sentry does not start, so nothing to allow', () => {
    expect(resolveSentryIngestOrigin(undefined)).toBeNull()
    expect(resolveSentryIngestOrigin('')).toBeNull()
    expect(resolveSentryIngestOrigin('   ')).toBeNull()
  })

  it('returns null for a malformed or non-https DSN instead of widening the CSP', () => {
    expect(resolveSentryIngestOrigin('not a url')).toBeNull()
    expect(resolveSentryIngestOrigin('http://key@o1.ingest.de.sentry.io/2')).toBeNull()
    expect(resolveSentryIngestOrigin("https://key@o1.ingest.de.sentry.io/2 'unsafe-inline'")).toBeNull()
  })
})

describe('sentryIngestOrigin (build-time value)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is derived from NEXT_PUBLIC_SENTRY_DSN', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', DE_DSN)
    vi.resetModules()
    const mod = await import('./sentry-hosts')
    expect(mod.sentryIngestOrigin).toBe('https://o1000000000000001.ingest.de.sentry.io')
  })
})
