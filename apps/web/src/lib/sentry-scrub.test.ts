import { describe, it, expect } from 'vitest'
import { redactUrl, scrubEvent, scrubBreadcrumb } from './sentry-scrub'

// Values are invented; shapes are the app's real ones (auth/callback route,
// Supabase recovery redirect, wa-link / tender / proposal bearer links,
// signed Storage URLs, reset-password's carried email).
const WA = 'Qm9ndXNXYUxpbmtUb2tlbkZvclNlbnRyeVRlc3RzMDE'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.c2lnbmF0dXJlLWJvZ3Vz'
const HOST = 'https://www.e-site.live'

describe('redactUrl', () => {
  it.each([
    [
      `${HOST}/auth/callback?token_hash=pkce_7c1e9b4f2a8d&type=recovery&next=/reset-password/confirm`,
      `${HOST}/auth/callback?token_hash=REDACTED&type=recovery&next=/reset-password/confirm`,
    ],
    [`${HOST}/auth/callback?code=0b1f6c2e-5a4d-4c3b-9a8f-7e6d5c4b3a21`, `${HOST}/auth/callback?code=REDACTED`],
    [
      `${HOST}/reset-password/confirm#access_token=${JWT}&expires_in=3600&refresh_token=r3fr3sh&token_type=bearer&type=recovery`,
      `${HOST}/reset-password/confirm#access_token=REDACTED&expires_in=3600&refresh_token=REDACTED&token_type=bearer&type=recovery`,
    ],
    // The 2026-07-07 invite incident shape: error fragment stays readable.
    [
      `${HOST}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`,
      `${HOST}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`,
    ],
    [`${HOST}/reset-password?step=code&email=someone%40example.co.za`, `${HOST}/reset-password?step=code&email=REDACTED`],
    [
      `https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/snag-photos/p/1.jpg?token=${JWT}`,
      'https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/snag-photos/p/1.jpg?token=REDACTED',
    ],
    [`${HOST}/auth/wa-link/${WA}`, `${HOST}/auth/wa-link/[token]`],
    [`/auth/wa-link/${WA}?x=1`, '/auth/wa-link/[token]?x=1'],
    [`${HOST}/tender/invite/${WA}`, `${HOST}/tender/invite/[token]`],
    [`${HOST}/proposal/${WA}`, `${HOST}/proposal/[token]`],
    // Secrets inside another URL's ?next=, %-encoded.
    [
      `${HOST}/login?next=%2Fauth%2Fwa-link%2F${WA}%3Fcode%3Dabc123%26type%3Dx`,
      `${HOST}/login?next=%2Fauth%2Fwa-link%2F[token]%3Fcode%3DREDACTED%26type%3Dx`,
    ],
    // Case-insensitive, every occurrence, and a span description.
    [`GET ${HOST}/api/x?Token=a&token=b`, `GET ${HOST}/api/x?Token=REDACTED&token=REDACTED`],
    // A bare query string (server request.query_string).
    ['token_hash=abc&type=invite', 'token_hash=REDACTED&type=invite'],
  ])('%s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected)
  })

  it('leaves look-alike params, route patterns and chunk URLs alone', () => {
    const keep = [
      `${HOST}/projects/1/cables?error_code=otp_expired&barcode=123&tokens=5`,
      `${HOST}/projects/1/proposals/2`,
      '/auth/wa-link/[token]',
      `${HOST}/_next/static/chunks/app/(auth)/auth/wa-link/%5Btoken%5D/page-3f2a.js`,
      'TypeError: Cannot read properties of undefined (reading \'code\')',
    ]
    for (const s of keep) expect(redactUrl(s)).toBe(s)
  })

  it('is idempotent', () => {
    const once = redactUrl(`${HOST}/auth/wa-link/${WA}?token_hash=x#access_token=y`)
    expect(redactUrl(once)).toBe(once)
  })
})

describe('scrubEvent', () => {
  it('redacts every URL-bearing field the SDK fills, and keeps the rest', () => {
    class LiveScope {
      url = `${HOST}/auth/wa-link/${WA}`
    }
    const scope = new LiveScope()
    const event = {
      message: `fetch failed: ${HOST}/auth/callback?code=abc`,
      transaction: `/auth/wa-link/${WA}`,
      request: {
        url: `${HOST}/reset-password/confirm#access_token=${JWT}&type=recovery`,
        query_string: [['token_hash', 'abc']],
        headers: { Referer: `${HOST}/auth/callback?token_hash=abc`, 'User-Agent': 'UA' },
      },
      exception: { values: [{ type: 'Error', value: `bad ${HOST}/tender/invite/${WA}` }] },
      breadcrumbs: [{ category: 'navigation', data: { from: `/auth/wa-link/${WA}`, to: `/x#refresh_token=r` } }],
      spans: [{ description: `GET /s?token=${JWT}`, data: { url: `/s?token=${JWT}`, 'http.url': `/s?token=${JWT}` } }],
      contexts: { trace: { data: { 'http.url': `/s?token=${JWT}` } } },
      tags: { url: `${HOST}/proposal/${WA}` },
      sdkProcessingMetadata: { capturedSpanScope: scope },
    }
    const out = scrubEvent(event)

    const wire = JSON.stringify({ ...out, sdkProcessingMetadata: undefined })
    expect(wire).not.toContain(WA)
    expect(wire).not.toContain(JWT)
    expect(wire).not.toContain('code=abc')
    expect(wire).not.toContain('token_hash=abc')
    expect(out.transaction).toBe('/auth/wa-link/[token]')
    expect(out.request.headers['User-Agent']).toBe('UA')
    expect(out.request.url).toContain('type=recovery')
    expect(out.request.query_string).toEqual([['token_hash', 'REDACTED']])
    // Live SDK objects are not walked or rewritten.
    expect(scope.url).toBe(`${HOST}/auth/wa-link/${WA}`)
  })

  it('redacts an object-shaped query_string by key', () => {
    const out = scrubEvent({ request: { query_string: { code: 'abc', type: 'invite', Email: 'a@b.co' } } })
    expect(out.request.query_string).toEqual({ code: 'REDACTED', type: 'invite', Email: 'REDACTED' })
  })

  it('does not redact a field merely named like a param outside the query', () => {
    // captureError extras carry e.g. a Postgres error code; that stays.
    const out = scrubEvent({ extra: { code: '23505' } })
    expect(out.extra.code).toBe('23505')
  })

  it('survives cycles', () => {
    const a: Record<string, unknown> = { url: `/proposal/${WA}` }
    a.self = a
    expect(() => scrubEvent(a)).not.toThrow()
    expect(a.url).toBe('/proposal/[token]')
  })
})

describe('scrubBreadcrumb', () => {
  it('redacts data.url / data.to / data.from', () => {
    const bc = scrubBreadcrumb({
      category: 'navigation',
      data: { from: `/auth/wa-link/${WA}`, to: `/reset-password/confirm#access_token=${JWT}`, url: `/x?code=1` },
    })
    expect(bc.data).toEqual({
      from: '/auth/wa-link/[token]',
      to: '/reset-password/confirm#access_token=REDACTED',
      url: '/x?code=REDACTED',
    })
  })
})
