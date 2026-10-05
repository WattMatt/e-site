import { describe, it, expect } from 'vitest'
import {
  createReadOnlyMgmtQuery, retryDelayMs, parseRetryAfterMs,
  ManagementApiUnavailableError, isInfrastructureError,
} from './mgmt-query'

// A fake Management API: answers each request with the next scripted response.
// A scripted `Error` is thrown the way fetch throws on a network failure.
type Scripted = { status: number; body: string; headers?: Record<string, string> } | Error

function fakeApi(script: Scripted[]) {
  const requests: Array<{ url: string; body: string; auth: string | null }> = []
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    requests.push({ url, body: String(init.body), auth: headers.get('Authorization') })
    const next = script.shift()
    if (!next) throw new Error('fake API: no scripted response left')
    if (next instanceof Error) throw next
    return new Response(next.body, { status: next.status, headers: next.headers })
  }) as unknown as typeof globalThis.fetch
  const sleeps: number[] = []
  const sleep = async (ms: number) => { sleeps.push(ms) }
  return { fetch, sleep, sleeps, requests }
}

const THROTTLED = { status: 429, body: '{"message":"ThrottlerException: Too Many Requests"}' }
const OK = { status: 200, body: '[{"ok":true}]' }

function make(api: ReturnType<typeof fakeApi>, extra: Partial<Parameters<typeof createReadOnlyMgmtQuery>[0]> = {}) {
  return createReadOnlyMgmtQuery({
    projectRef: 'ref123', token: () => 'sbp_test', fetch: api.fetch, sleep: api.sleep,
    random: () => 0.5, ...extra,
  })
}

describe('createReadOnlyMgmtQuery', () => {
  it('retries a 429 and returns the rows of the 200 that follows', async () => {
    const api = fakeApi([THROTTLED, THROTTLED, OK])
    const rows = await make(api)('SELECT true AS ok')
    expect(rows).toEqual([{ ok: true }])
    expect(api.requests).toHaveLength(3)
    expect(api.sleeps).toHaveLength(2)
  })

  it('retries a 5xx the same way', async () => {
    const api = fakeApi([{ status: 503, body: 'upstream' }, { status: 502, body: '' }, OK])
    expect(await make(api)('SELECT true AS ok')).toEqual([{ ok: true }])
    expect(api.requests).toHaveLength(3)
  })

  it('retries a network failure (fetch throwing)', async () => {
    const api = fakeApi([new TypeError('fetch failed'), OK])
    expect(await make(api)('SELECT true AS ok')).toEqual([{ ok: true }])
  })

  it('honours Retry-After when it is longer than the backoff', async () => {
    const api = fakeApi([{ ...THROTTLED, headers: { 'Retry-After': '7' } }, OK])
    await make(api)('SELECT true AS ok')
    expect(api.sleeps[0]).toBeGreaterThanOrEqual(7000)
  })

  // The distinct infrastructure error. 543 "✗" lines in run 37289583207 were
  // all 429s; none was a predicate that returned false.
  it('reports retry exhaustion as an INFRASTRUCTURE error, not a query error', async () => {
    const api = fakeApi(Array.from({ length: 4 }, () => THROTTLED))
    const err = await make(api, { maxAttempts: 4 })('SELECT true AS ok').catch((e) => e)
    expect(err).toBeInstanceOf(ManagementApiUnavailableError)
    expect(isInfrastructureError(err)).toBe(true)
    expect(err.status).toBe(429)
    expect(err.attempts).toBe(4)
    expect(err.message).toMatch(/ThrottlerException/)
    expect(api.requests).toHaveLength(4)
    expect(api.sleeps).toHaveLength(3) // no pointless sleep after the last attempt
  })

  // A SQL error is the DATABASE answering. It must stay a per-directive
  // failure, and retrying it would only burn the rate limit.
  it('does not retry a 400, and does not dress it up as infrastructure', async () => {
    const api = fakeApi([{ status: 400, body: '{"message":"Failed to run sql query: ERROR: 42601: syntax error"}' }])
    const err = await make(api)('SELECT (').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isInfrastructureError(err)).toBe(false)
    expect(err.message).toMatch(/Management API 400.*42601/)
    expect(api.requests).toHaveLength(1)
  })

  it('treats a rejected token (401/403) as infrastructure, without retrying', async () => {
    for (const status of [401, 403]) {
      const api = fakeApi([{ status, body: '{"message":"Unauthorized"}' }])
      const err = await make(api)('SELECT true AS ok').catch((e) => e)
      expect(isInfrastructureError(err)).toBe(true)
      expect(api.requests).toHaveLength(1)
    }
  })

  it('still refuses a 200 that carries an error object instead of rows', async () => {
    const api = fakeApi([{ status: 200, body: '{"message":"oops"}' }])
    const err = await make(api)('SELECT true AS ok').catch((e) => e)
    expect(err.message).toMatch(/Unexpected response/)
    expect(isInfrastructureError(err)).toBe(false)
  })

  // READ ONLY BY CONSTRUCTION: no caller can route around the wrapper.
  it('wraps every statement in a READ ONLY transaction and sends the token', async () => {
    const api = fakeApi([OK])
    await make(api)('SELECT true AS ok')
    const sent = JSON.parse(api.requests[0].body).query as string
    expect(sent).toBe('BEGIN READ ONLY;\nSELECT true AS ok;\nCOMMIT;')
    expect(api.requests[0].auth).toBe('Bearer sbp_test')
    expect(api.requests[0].url).toBe('https://api.supabase.com/v1/projects/ref123/database/query')
  })

  it('reports each retry to the caller', async () => {
    const api = fakeApi([THROTTLED, OK])
    const seen: Array<{ attempt: number; status: number | null }> = []
    await make(api, { onRetry: (i) => seen.push({ attempt: i.attempt, status: i.status }) })('SELECT 1')
    expect(seen).toEqual([{ attempt: 1, status: 429 }])
  })
})

describe('retryDelayMs', () => {
  const base = { baseDelayMs: 1000, maxDelayMs: 30_000 }

  it('grows exponentially with equal jitter: between half and all of the step', () => {
    expect(retryDelayMs({ ...base, attempt: 1, retryAfterMs: null, random: () => 0 })).toBe(500)
    expect(retryDelayMs({ ...base, attempt: 1, retryAfterMs: null, random: () => 1 })).toBe(1000)
    expect(retryDelayMs({ ...base, attempt: 4, retryAfterMs: null, random: () => 0 })).toBe(4000)
    expect(retryDelayMs({ ...base, attempt: 4, retryAfterMs: null, random: () => 1 })).toBe(8000)
  })

  it('never exceeds the cap', () => {
    expect(retryDelayMs({ ...base, attempt: 30, retryAfterMs: null, random: () => 1 })).toBe(30_000)
  })

  it('waits at least as long as Retry-After asks', () => {
    expect(retryDelayMs({ ...base, attempt: 1, retryAfterMs: 12_000, random: () => 0 })).toBe(12_000)
  })
})

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-10-05T10:00:00Z')
  it('reads delta-seconds', () => expect(parseRetryAfterMs('3', now)).toBe(3000))
  it('reads an HTTP-date', () => expect(parseRetryAfterMs('Mon, 05 Oct 2026 10:00:05 GMT', now)).toBe(5000))
  it('clamps a past date to zero', () => expect(parseRetryAfterMs('Mon, 05 Oct 2026 09:00:00 GMT', now)).toBe(0))
  it('caps an absurd value at a minute', () => expect(parseRetryAfterMs('86400', now)).toBe(60_000))
  it('ignores absent or garbage values', () => {
    expect(parseRetryAfterMs(null, now)).toBeNull()
    expect(parseRetryAfterMs('soon', now)).toBeNull()
  })
})
