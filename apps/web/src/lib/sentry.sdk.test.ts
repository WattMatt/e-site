import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

// The real browser SDK, end to end: lib/sentry.ts initialises @sentry/browser
// 8.55.1 (the version @sentry/nextjs 8.55.1 ships to the browser), the page
// sits on a URL carrying an auth secret, and the envelopes the SDK hands to
// fetch are read back. What is asserted is what would leave the browser.
//
// Every value below is invented, but shaped like the real thing: a Supabase
// token_hash, a recovery fragment with access/refresh tokens, a 43-character
// base64url /auth/wa-link token, a signed Storage URL. /legal/privacy promises
// Sentry receives "IP address, stack traces, and limited request metadata".

const browserSdkPath = (() => {
  const fromHere = createRequire(import.meta.url)
  const nextjs = fromHere.resolve('@sentry/nextjs')
  const react = createRequire(nextjs).resolve('@sentry/react')
  return createRequire(react).resolve('@sentry/browser')
})()

vi.mock('@sentry/nextjs', async () => import(/* @vite-ignore */ browserSdkPath))

const WA_TOKEN = 'Qm9ndXNXYUxpbmtUb2tlbkZvclNlbnRyeVRlc3RzMDE'
const TOKEN_HASH = 'pkce_7c1e9b4f2a8d6e3c5b0a9f8e7d6c5b4a3928170f6e5d4c3b2a1908f7e6'
const ACCESS = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.c2lnbmF0dXJlLWJvZ3Vz'
const REFRESH = 'r3fr3shB0gusT0k3n'
const SIGNED = 'eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJzbmFnLXBob3RvcyJ9.c2lnLWJvZ3Vz'
const SECRETS = [WA_TOKEN, TOKEN_HASH, ACCESS, REFRESH, SIGNED]

type Sent = { body: string }

describe('browser Sentry over the wire (real @sentry/browser 8.55.1)', () => {
  let sent: Sent[]

  beforeEach(() => {
    vi.resetModules()
    sent = []
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/2')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        const body = init?.body
        sent.push({ body: typeof body === 'string' ? body : new TextDecoder().decode(body as Uint8Array) })
        return new Response('{}', { status: 200 })
      }),
    )
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: `https://www.e-site.live/auth/callback?token_hash=${TOKEN_HASH}&type=recovery&next=/reset-password/confirm`,
    })
  })

  afterEach(async () => {
    const Sentry = await import('@sentry/nextjs')
    await Sentry.close?.(0)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    window.history.replaceState({}, '', '/')
  })

  async function boot() {
    const { initSentry } = await import('./sentry')
    await initSentry()
    return import('@sentry/nextjs')
  }

  async function flushed(Sentry: typeof import('@sentry/nextjs')) {
    await Sentry.flush(2000)
    return sent.map((s) => s.body).join('\n')
  }

  it('an error event carries no secret from the page URL, fragment, referrer or breadcrumbs', async () => {
    // Land on a WhatsApp sign-in link, then the recovery redirect's fragment.
    window.history.replaceState({}, '', `/auth/wa-link/${WA_TOKEN}`)
    const Sentry = await boot()
    window.history.pushState(
      {},
      '',
      `/reset-password/confirm#access_token=${ACCESS}&expires_in=3600&refresh_token=${REFRESH}&token_type=bearer&type=recovery`,
    )
    Sentry.addBreadcrumb({
      category: 'fetch',
      type: 'http',
      data: {
        method: 'GET',
        url: `https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/snag-photos/p/1.jpg?token=${SIGNED}`,
        status_code: 200,
      },
    })

    Sentry.captureException(new Error('boom'))
    const wire = await flushed(Sentry)

    expect(wire).toContain('boom') // the event really was sent
    for (const secret of SECRETS) expect(wire).not.toContain(secret)
    // What stays is still useful: the route shape and the harmless params.
    expect(wire).toContain('/auth/wa-link/[token]')
    expect(wire).toContain('type=recovery')
    expect(wire).toContain('token_type=bearer')
  })

  it('a transaction carries no secret in its name, request or span descriptions', async () => {
    window.history.replaceState({}, '', `/auth/wa-link/${WA_TOKEN}?code=0b1f6c2e-5a4d-4c3b-9a8f-7e6d5c4b3a21`)
    const Sentry = await boot()
    // initSentry samples 20% of traces; this test needs the one it starts.
    Sentry.getClient()!.getOptions().tracesSampleRate = 1

    // Shaped like Next's app-router pageload: name = pathname, source 'url'
    // (@sentry/nextjs appRouterRoutingInstrumentation.js). The SDK keeps a
    // 'url'-sourced name out of the envelope's trace header and baggage.
    Sentry.startSpan(
      { name: window.location.pathname, op: 'pageload', forceTransaction: true, attributes: { 'sentry.source': 'url' } },
      () => {
      Sentry.startSpan(
        {
          name: `GET https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/x.jpg?token=${SIGNED}`,
          op: 'http.client',
          attributes: {
            url: `https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/x.jpg?token=${SIGNED}`,
            'http.url': `https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/x.jpg?token=${SIGNED}`,
          },
        },
        () => undefined,
      )
      },
    )
    const wire = await flushed(Sentry)

    expect(wire).toContain('"type":"transaction"')
    for (const secret of [...SECRETS, '0b1f6c2e-5a4d-4c3b-9a8f-7e6d5c4b3a21']) expect(wire).not.toContain(secret)
    expect(wire).toContain('/auth/wa-link/[token]')
  })
})
