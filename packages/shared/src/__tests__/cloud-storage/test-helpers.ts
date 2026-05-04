import { vi, beforeEach, afterEach } from 'vitest'

/**
 * Shared fetch-mocking helpers for cloud-storage provider tests.
 *
 * Each provider test seeds env vars + replaces `globalThis.fetch` with a
 * scripted handler that matches request URLs in order, asserts the body,
 * and returns canned Responses.
 */

declare const globalThis: {
  fetch: typeof fetch
  process?: { env: Record<string, string> }
}

export interface FetchExpectation {
  /** Substring (or RegExp) matched against the request URL. */
  url: string | RegExp
  /** Optional method assertion; defaults to no check. */
  method?: string
  /** Optional body-substring assertion. */
  bodyContains?: string
  /** Status to return (default 200). */
  status?: number
  /** JSON body to return. Mutually exclusive with `text` and `stream`. */
  json?: unknown
  /** Plain text body. */
  text?: string
  /** Headers to include. */
  headers?: Record<string, string>
}

/**
 * Install a scripted fetch on globalThis. Each call consumes the next
 * expectation in order. Throws if requests exceed the script length or
 * don't match.
 */
export function scriptFetch(expectations: FetchExpectation[]) {
  let i = 0
  const calls: { url: string; method?: string; bodyText: string }[] = []

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (i >= expectations.length) {
      throw new Error(`fetch: unexpected call #${i + 1} to ${input.toString()}`)
    }
    const exp = expectations[i++]!
    const url = input.toString()
    const method = init?.method ?? 'GET'
    const bodyText =
      typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : ''
    calls.push({ url, method, bodyText })

    // URL match
    if (typeof exp.url === 'string' && !url.includes(exp.url)) {
      throw new Error(`fetch #${i}: expected url to include "${exp.url}", got "${url}"`)
    }
    if (exp.url instanceof RegExp && !exp.url.test(url)) {
      throw new Error(`fetch #${i}: expected url to match ${exp.url}, got "${url}"`)
    }
    // Method
    if (exp.method && method !== exp.method) {
      throw new Error(`fetch #${i}: expected method ${exp.method}, got ${method}`)
    }
    // Body substring
    if (exp.bodyContains && !bodyText.includes(exp.bodyContains)) {
      throw new Error(`fetch #${i}: expected body to include "${exp.bodyContains}", got "${bodyText}"`)
    }

    // Build response
    const status = exp.status ?? 200
    const headers = new Headers(exp.headers ?? {})
    let body: string | null = null
    if (exp.json !== undefined) {
      body = JSON.stringify(exp.json)
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    } else if (exp.text !== undefined) {
      body = exp.text
    }
    return new Response(body, { status, headers })
  }) as typeof fetch

  return {
    /** Returns the recorded calls so tests can inspect URLs/bodies. */
    calls,
    /** Throws if not all expectations were consumed. */
    assertExhausted() {
      if (i !== expectations.length) {
        throw new Error(`fetch: ${expectations.length - i} expectation(s) not consumed`)
      }
    },
  }
}

/** Set provider creds in process.env for the duration of a test. */
export function withProviderCreds() {
  beforeEach(() => {
    globalThis.process = globalThis.process ?? { env: {} }
    Object.assign(globalThis.process.env, {
      DROPBOX_APP_KEY: 'test-dropbox-key',
      DROPBOX_APP_SECRET: 'test-dropbox-secret',
      GOOGLE_CLIENT_ID: 'test-google-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
      MS_GRAPH_CLIENT_ID: 'test-ms-id',
      MS_GRAPH_CLIENT_SECRET: 'test-ms-secret',
    })
  })
  afterEach(() => {
    if (globalThis.process?.env) {
      delete globalThis.process.env.DROPBOX_APP_KEY
      delete globalThis.process.env.DROPBOX_APP_SECRET
      delete globalThis.process.env.GOOGLE_CLIENT_ID
      delete globalThis.process.env.GOOGLE_CLIENT_SECRET
      delete globalThis.process.env.MS_GRAPH_CLIENT_ID
      delete globalThis.process.env.MS_GRAPH_CLIENT_SECRET
    }
  })
}
