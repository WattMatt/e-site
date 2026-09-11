// @vitest-environment node
/**
 * send-email edge function — relay hardening contract.
 *
 * The audit of 2026-09-10 proved `send-email` was an unauthenticated open
 * relay on two paths, both reproduced against production:
 *
 *   (a) With NO Authorization header at all, `type:"data-subject-request"`
 *       passed PUBLIC_TYPES and sent from `E-Site <noreply@e-site.live>` to an
 *       ATTACKER-CHOSEN `to`, with an attacker-chosen `subject` and full HTML
 *       body control through the unescaped `requestTypeLabel`.
 *
 *   (b) The function is deployed `--no-verify-jwt`, and the role check only
 *       base64-DECODED the bearer token. A JWT signed with the literal string
 *       `notasignature` claiming `role:service_role` therefore reached the
 *       `account-invite` / `rfi-created` passthroughs, which forward
 *       `{to, subject, html}` verbatim — `rfi-created` for an ARRAY of
 *       recipients, 100 per Resend batch call. Arbitrary-HTML bulk mail,
 *       DKIM-signed and DMARC-passing from e-site.live.
 *
 * THE FIXTURE RULE. Every assertion below is made against the JSON body that
 * actually reaches api.resend.com — the wire payload, not an internal return
 * value and not "a response was produced". Reinstating a caller-supplied `to`,
 * dropping an escape, or going back to decoding-as-authorisation each turn a
 * specific assertion red, and the `sends` array proves whether mail left the
 * building at all. Mutation-verified in the PR description.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const FN = '../../../../../apps/edge-functions/supabase/functions/send-email/index.ts'

const SUPABASE_URL = 'https://cbskbnvvgcybmfikxgky.supabase.co'
const SERVICE_KEY = 'sb_secret_REAL_SERVICE_ROLE_KEY'
const ANON_KEY = 'sb_publishable_ANON_KEY'

/** A JWT whose payload claims service_role but whose signature is garbage. */
function forgedServiceRoleJwt(): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    role: 'service_role',
    iss: 'supabase',
    exp: 9999999999,
  })}.notasignature`
}

type Sent = { url: string; body: any; auth: string | undefined }

interface Harness {
  handler: (req: Request) => Promise<Response>
  /** Every email that actually reached Resend, flattened one entry per message. */
  sends: Sent[]
  /** Credentials presented to the Supabase auth-admin verification probe. */
  probes: string[]
}

/**
 * Load the edge function with a stubbed Deno + fetch. Module-level state (the
 * send counter) is reset per test by resetModules.
 */
async function load(opts: { serviceRoleValid?: (token: string) => boolean } = {}): Promise<Harness> {
  vi.resetModules()
  const sends: Sent[] = []
  const probes: string[] = []

  const env: Record<string, string> = {
    RESEND_API_KEY: 're_test_key',
    SITE_URL: 'https://www.e-site.live',
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    SUPABASE_ANON_KEY: ANON_KEY,
  }
  ;(globalThis as any).Deno = {
    env: { get: (k: string) => env[k] },
    serve: () => {},
  }

  const isValid = opts.serviceRoleValid ?? ((t: string) => t === SERVICE_KEY)

  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const url = String(input)
    const auth = String(init.headers?.Authorization ?? '').replace(/^Bearer /, '')

    // Supabase auth-admin probe used to VERIFY a presented service-role
    // credential (as opposed to believing a decoded claim).
    if (url.startsWith(`${SUPABASE_URL}/auth/v1/`)) {
      probes.push(auth)
      return new Response(isValid(auth) ? '[]' : '{"msg":"unauthorized"}', {
        status: isValid(auth) ? 200 : 401,
      })
    }

    if (url === 'https://api.resend.com/emails') {
      sends.push({ url, body: JSON.parse(String(init.body)), auth })
      return new Response('{"id":"1"}', { status: 200 })
    }
    if (url === 'https://api.resend.com/emails/batch') {
      for (const m of JSON.parse(String(init.body))) sends.push({ url, body: m, auth })
      return new Response('{"data":[]}', { status: 200 })
    }
    throw new Error(`unexpected fetch to ${url}`)
  })

  const mod = await import(FN)
  return { handler: mod.handler, sends, probes }
}

function post(body: unknown, authorization?: string): Request {
  return new Request('https://edge.test/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  })
}

/** The exact shape the production POPIA form action sends. */
function dsrPayload(over: Record<string, unknown> = {}) {
  return {
    to: 'arno@watsonmattheus.com',
    subject: '[POPIA] Access request (POPIA §23) from Jane',
    requester: { name: 'Jane Doe', email: 'jane@example.com' },
    requestType: 'access',
    requestTypeLabel: 'Access request (POPIA §23)',
    description: 'Please send me a copy of everything you hold about me.',
    receivedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('unauthenticated caller cannot use the DSR branch as a relay', () => {
  it('ignores a caller-supplied recipient and mails the hardcoded Information Officer', async () => {
    const h = await load()
    const res = await h.handler(
      post({
        type: 'data-subject-request',
        payload: dsrPayload({ to: 'victim@target.example' }),
      })
      // deliberately NO Authorization header — this is the live path (a)
    )

    expect(res.status).toBe(200)
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].body.to).toBe('arno@watsonmattheus.com')
    expect(JSON.stringify(h.sends[0].body)).not.toContain('victim@target.example')
  })

  it('builds the subject server-side and ignores a caller-supplied one', async () => {
    const h = await load()
    await h.handler(
      post({
        type: 'data-subject-request',
        payload: dsrPayload({ subject: 'Your Standard Bank account is suspended' }),
      })
    )
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].body.subject).not.toContain('Standard Bank')
    expect(h.sends[0].body.subject).toContain('[POPIA]')
  })

  it('escapes every attacker-controlled string into the HTML body', async () => {
    const h = await load()
    const inject = '<a href="https://phish.example">Reset your password</a>'
    await h.handler(
      post({
        type: 'data-subject-request',
        payload: dsrPayload({
          requestTypeLabel: inject,
          requester: { name: `${inject}NAME`, email: `${inject}EMAIL` },
          description: `${inject}DESC`,
        }),
      })
    )

    expect(h.sends).toHaveLength(1)
    const html: string = h.sends[0].body.html
    // The literal anchor tag must not survive into the message anywhere.
    expect(html).not.toContain('<a href="https://phish.example"')
    expect(html).not.toContain('phish.example">')
    expect(html).toContain('&lt;a href=&quot;https://phish.example&quot;&gt;')
    // ...and it must be escaped in EVERY field, not just the one that already was.
    for (const marker of ['NAME', 'EMAIL', 'DESC']) {
      const at = html.indexOf(marker)
      expect(at, marker).toBeGreaterThan(-1)
      expect(html.slice(Math.max(0, at - 200), at), marker).not.toContain('<a href')
    }
  })

  it('re-validates requestType against the five known values and sends nothing otherwise', async () => {
    const h = await load()
    const res = await h.handler(
      post({
        type: 'data-subject-request',
        payload: dsrPayload({ requestType: 'wire-transfer', requestTypeLabel: 'Wire transfer' }),
      })
    )
    expect(res.status).toBe(400)
    expect(h.sends).toHaveLength(0)
  })

  it('caps how many DSR emails one instance will relay', async () => {
    const h = await load()
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) {
      const res = await h.handler(post({ type: 'data-subject-request', payload: dsrPayload() }))
      statuses.push(res.status)
    }
    expect(statuses).toContain(429)
    expect(h.sends.length).toBeLessThan(40)
    expect(h.sends.length).toBeGreaterThan(0)
  })
})

describe('a forged service_role JWT cannot reach the arbitrary-HTML passthroughs', () => {
  const attackerMail = {
    to: 'victim@target.example',
    subject: 'Action required: verify your E-Site account',
    html: '<a href="https://phish.example">Verify now</a>',
  }

  it('rejects account-invite signed with `notasignature`', async () => {
    const h = await load()
    const res = await h.handler(
      post({ type: 'account-invite', payload: attackerMail }, `Bearer ${forgedServiceRoleJwt()}`)
    )
    expect(res.status).toBe(403)
    expect(h.sends).toHaveLength(0)
  })

  it('rejects rfi-created bulk fan-out signed with `notasignature`', async () => {
    const h = await load()
    const res = await h.handler(
      post(
        {
          type: 'rfi-created',
          payload: {
            ...attackerMail,
            to: Array.from({ length: 120 }, (_, i) => `victim${i}@target.example`),
          },
        },
        `Bearer ${forgedServiceRoleJwt()}`
      )
    )
    expect(res.status).toBe(403)
    expect(h.sends).toHaveLength(0)
  })

  it('rejects an unauthenticated account-invite', async () => {
    const h = await load()
    const res = await h.handler(post({ type: 'account-invite', payload: attackerMail }))
    expect(res.status).toBe(403)
    expect(h.sends).toHaveLength(0)
  })

  it('rejects the public anon key, which ships in the browser bundle', async () => {
    const h = await load()
    const res = await h.handler(
      post({ type: 'account-invite', payload: attackerMail }, `Bearer ${ANON_KEY}`)
    )
    expect(res.status).toBe(403)
    expect(h.sends).toHaveLength(0)
  })

  it('denies the anon key even if the platform were to accept it', async () => {
    // "The public key cannot pass" must be a property of this file, not an
    // assumption about how the auth-admin route treats an anon credential.
    // Here the platform says YES to everything and the answer is still no.
    const h = await load({ serviceRoleValid: () => true })
    const res = await h.handler(
      post({ type: 'account-invite', payload: attackerMail }, `Bearer ${ANON_KEY}`)
    )
    expect(res.status).toBe(403)
    expect(h.sends).toHaveLength(0)
    expect(h.probes).not.toContain(ANON_KEY)
  })
})

describe('control: the gate is a gate, not a wall', () => {
  it('a real service-role credential still sends account-invite', async () => {
    const h = await load()
    const res = await h.handler(
      post(
        {
          type: 'account-invite',
          payload: { to: 'newuser@wmeng.co.za', subject: 'Welcome', html: '<p>hi</p>' },
        },
        `Bearer ${SERVICE_KEY}`
      )
    )
    expect(res.status).toBe(200)
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].body.to).toBe('newuser@wmeng.co.za')
  })

  it('a real service-role credential still fans rfi-created out to every recipient', async () => {
    const h = await load()
    const res = await h.handler(
      post(
        {
          type: 'rfi-created',
          payload: {
            to: ['a@wmeng.co.za', 'b@wmeng.co.za'],
            subject: 'RFI 001',
            html: '<p>see attached</p>',
          },
        },
        `Bearer ${SERVICE_KEY}`
      )
    )
    expect(res.status).toBe(200)
    expect(h.sends.map((s) => s.body.to)).toEqual(['a@wmeng.co.za', 'b@wmeng.co.za'])
  })

  it('accepts a legacy JWT-shaped service-role key that the platform confirms', async () => {
    // The edge runtime injects `sb_secret_…` while the web app may still hold
    // the legacy JWT-shaped key (CLAUDE.md, 2026-07-23). Both are real
    // credentials; a string compare against the injected one is not enough,
    // so the platform is asked.
    const legacy = 'eyJhbGciOiJIUzI1NiJ9.legacy.sig'
    const h = await load({ serviceRoleValid: (t) => t === SERVICE_KEY || t === legacy })
    const res = await h.handler(
      post(
        { type: 'account-invite', payload: { to: 'x@wmeng.co.za', subject: 's', html: '<p>h</p>' } },
        `Bearer ${legacy}`
      )
    )
    expect(res.status).toBe(200)
    expect(h.sends).toHaveLength(1)
    expect(h.probes).toContain(legacy)
  })
})
