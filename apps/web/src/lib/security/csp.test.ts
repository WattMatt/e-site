import { describe, it, expect } from 'vitest'
import { buildContentSecurityPolicy } from './csp'

/** Pull a single directive (e.g. "frame-src") out of the joined policy string. */
function directive(policy: string, name: string): string {
  const found = policy.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(name + ' '))
  return found ?? ''
}

describe('buildContentSecurityPolicy — frame-src guards document preview', () => {
  it('production frame-src permits the iframe sources previews actually use', () => {
    const frame = directive(buildContentSecurityPolicy({ dev: false }), 'frame-src')
    // Regression guard: 'none' blanks every in-app PDF preview (the 2026-06-12 bug).
    expect(frame).not.toContain("'none'")
    expect(frame).toContain("'self'") // same-origin streaming + draft-preview routes
    expect(frame).toContain('https://*.supabase.co') // signed URLs for stored docs
    expect(frame).toContain('blob:')
  })

  it('development frame-src also allows the local Supabase stack over http', () => {
    const frame = directive(buildContentSecurityPolicy({ dev: true }), 'frame-src')
    expect(frame).toContain('http://127.0.0.1:*')
    expect(frame).toContain('http://localhost:*')
  })

  it('production keeps upgrade-insecure-requests; development drops it so local http previews load', () => {
    expect(buildContentSecurityPolicy({ dev: false })).toContain('upgrade-insecure-requests')
    expect(buildContentSecurityPolicy({ dev: true })).not.toContain('upgrade-insecure-requests')
  })

  it('still locks down object-src and base-uri', () => {
    const policy = buildContentSecurityPolicy({ dev: false })
    expect(directive(policy, 'object-src')).toContain("'none'")
    expect(directive(policy, 'base-uri')).toContain("'self'")
  })

  it('lets the tariff map run MapLibre: blob workers and the OpenFreeMap tile host, nothing wider', () => {
    const policy = buildContentSecurityPolicy({ dev: false })
    expect(directive(policy, 'worker-src')).toBe("worker-src 'self' blob:")
    expect(directive(policy, 'connect-src')).toContain('https://tiles.openfreemap.org')
    expect(directive(policy, 'connect-src')).not.toContain('*.openfreemap.org')
  })
})

describe('buildContentSecurityPolicy — Sentry ingest follows the DSN', () => {
  // The production DSN is in Sentry's DE region. Until 2026-10-07 connect-src
  // hard-coded https://ingest.sentry.io, which does not match
  // o<org>.ingest.de.sentry.io, so every browser envelope was refused.
  const DE_INGEST = 'https://o1000000000000001.ingest.de.sentry.io'

  it('allows the exact ingest origin the configured DSN posts to', () => {
    const connect = directive(
      buildContentSecurityPolicy({ dev: false, sentryIngestOrigin: DE_INGEST }),
      'connect-src',
    )
    expect(connect.split(' ')).toContain(DE_INGEST)
  })

  it('does not fall back to a wildcard or the legacy host', () => {
    const connect = directive(
      buildContentSecurityPolicy({ dev: false, sentryIngestOrigin: DE_INGEST }),
      'connect-src',
    )
    expect(connect).not.toContain('*.sentry.io')
    expect(connect.split(' ')).not.toContain('https://ingest.sentry.io')
  })

  it('allows no Sentry host when no DSN is configured', () => {
    const connect = directive(
      buildContentSecurityPolicy({ dev: false, sentryIngestOrigin: null }),
      'connect-src',
    )
    expect(connect).not.toContain('sentry')
  })
})
