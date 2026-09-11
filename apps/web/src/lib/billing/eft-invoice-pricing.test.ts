// @vitest-environment node
/**
 * eft-invoice edge function — invoiced amount contract (finding #14).
 *
 * The shipped table read:
 *
 *   enterprise: { monthly: 500000_00, annual: 5000000_00 }, // R5,000/mo or R50,000/yr
 *
 * JS numeric separators make `500000_00` the integer 50 000 000 — and the unit
 * is kobo/cents, so that is **R500 000.00**, 100× the commented intent. The
 * annual row is R5 000 000.00. The sibling rows fix the convention beyond
 * argument: `1499_00` is R1 499, matching PLANS.professional.
 *
 * Compounding it, `?? PLAN_AMOUNTS.enterprise[period]` made Enterprise the
 * fallback for ANY unrecognised tier, so `tier:'free'` invoiced R500 000 under
 * the description "E-Site Free Plan".
 *
 * THE FIXTURE RULE. Asserting on the exported constant would be decorative —
 * the number that hurts the customer is the one on the wire to
 * api.paystack.co and in billing.invoices.amount_kobo, which is what
 * /settings/billing renders. Every assertion below is therefore made against
 * the captured `fetch` body and the captured insert payload. Restoring either
 * literal, or reinstating the enterprise fallback, turns a named test red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const FN = '../../../../../apps/edge-functions/supabase/functions/eft-invoice/index.ts'

const ORG = '44444444-4444-4444-8444-444444444444'
const SERVICE_JWT = serviceRoleJwt()

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}
function serviceRoleJwt(): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'service_role' })}.sig`
}
function anonJwt(): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'anon' })}.sig`
}

interface Harness {
  handler: (req: Request) => Promise<Response>
  /** Bodies POSTed to api.paystack.co — the charge the customer actually sees. */
  paystackCalls: any[]
  /** Rows written to billing.invoices — what /settings/billing renders. */
  invoiceInserts: any[]
}

async function load(): Promise<Harness> {
  vi.resetModules()
  const paystackCalls: any[] = []
  const invoiceInserts: any[] = []

  const env: Record<string, string> = {
    PAYSTACK_SECRET_KEY: 'sk_test_key',
    SUPABASE_URL: 'https://cbskbnvvgcybmfikxgky.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_key',
  }
  ;(globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: () => {} }

  vi.doMock('https://esm.sh/@supabase/supabase-js@2', () => ({
    createClient: () => makeStubClient(invoiceInserts),
  }))

  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const url = String(input)
    if (url.startsWith('https://api.paystack.co')) {
      paystackCalls.push(JSON.parse(String(init.body)))
      return new Response(
        JSON.stringify({ status: true, data: { authorization_url: 'https://paystack.test/x' } }),
        { status: 200 },
      )
    }
    throw new Error(`unexpected fetch to ${url}`)
  })

  const mod = await import(FN)
  return { handler: mod.handler, paystackCalls, invoiceInserts }
}

/** Enough of supabase-js for the generate path: org, admin, invoice, notification. */
function makeStubClient(invoiceInserts: any[]) {
  const client: any = {
    schema: (name: string) => ({ from: (t: string) => table(`${name}.${t}`) }),
    from: (t: string) => table(t),
  }
  function table(name: string) {
    const b: any = {}
    const chain = () => b
    b.select = chain; b.eq = chain; b.in = chain; b.limit = chain; b.update = chain
    b.single = async () => {
      if (name === 'organisations') return { data: { name: 'Acme Electrical' }, error: null }
      if (name === 'user_organisations') {
        return {
          data: { user_id: 'u-admin', user: { email: 'admin@acme.test', full_name: 'A Admin' } },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    b.then = undefined
    b.insert = (payload: any) => {
      if (name === 'billing.invoices') invoiceInserts.push(payload)
      const ins: any = {
        select: () => ins,
        single: async () => ({ data: { id: 'inv-1', ...payload }, error: null }),
        catch: (_f: any) => Promise.resolve({ data: null, error: null }),
        then: (f: any) => Promise.resolve({ data: null, error: null }).then(f),
      }
      return ins
    }
    b.upsert = async () => ({ data: null, error: null })
    return b
  }
  return client
}

function post(body: unknown, authorization = `Bearer ${SERVICE_JWT}`): Request {
  return new Request('https://edge.test/eft-invoice', {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('eft-invoice — the amount charged matches the documented price', () => {
  it('Enterprise monthly invoices R5 000.00, not R500 000.00', async () => {
    const h = await load()
    const res = await h.handler(post({ organisationId: ORG, tier: 'enterprise', billingPeriod: 'monthly' }))
    expect(res.status).toBe(200)

    // 5 000 ZAR expressed in cents.
    expect(h.paystackCalls).toHaveLength(1)
    expect(h.paystackCalls[0].amount).toBe(500_000)
    expect(h.invoiceInserts[0].amount_kobo).toBe(500_000)
    expect((await res.json()).amountZAR).toBe('5000.00')
  })

  it('Enterprise annual invoices R50 000.00, not R5 000 000.00', async () => {
    const h = await load()
    const res = await h.handler(post({ organisationId: ORG, tier: 'enterprise', billingPeriod: 'annual' }))
    expect(res.status).toBe(200)
    expect(h.paystackCalls[0].amount).toBe(5_000_000)
    expect(h.invoiceInserts[0].amount_kobo).toBe(5_000_000)
    expect((await res.json()).amountZAR).toBe('50000.00')
  })

  it('leaves the already-correct Professional and Starter rows alone', async () => {
    for (const [tier, period, kobo] of [
      ['professional', 'monthly', 149_900],
      ['professional', 'annual', 1_499_000],
      ['starter', 'monthly', 49_900],
      ['starter', 'annual', 499_000],
    ] as const) {
      const h = await load()
      const res = await h.handler(post({ organisationId: ORG, tier, billingPeriod: period }))
      expect(res.status, `${tier}/${period}`).toBe(200)
      expect(h.paystackCalls[0].amount, `${tier}/${period}`).toBe(kobo)
    }
  })
})

describe('eft-invoice — an unrecognised tier fails instead of defaulting to the priciest plan', () => {
  for (const tier of ['free', 'Professional', 'platinum', 'enterprise ']) {
    it(`rejects tier ${JSON.stringify(tier)} with 400 and charges nothing`, async () => {
      const h = await load()
      const res = await h.handler(post({ organisationId: ORG, tier, billingPeriod: 'annual' }))
      expect(res.status).toBe(400)
      // The whole point: no charge was created and no invoice reached the
      // customer's billing page.
      expect(h.paystackCalls).toHaveLength(0)
      expect(h.invoiceInserts).toHaveLength(0)
    })
  }
})

describe('eft-invoice — service-role gate', () => {
  it('403s an anon-key caller before any Paystack call or invoice write', async () => {
    const h = await load()
    const res = await h.handler(
      post({ organisationId: ORG, tier: 'enterprise', billingPeriod: 'annual' }, `Bearer ${anonJwt()}`),
    )
    expect(res.status).toBe(403)
    expect(h.paystackCalls).toHaveLength(0)
    expect(h.invoiceInserts).toHaveLength(0)
  })

  it('403s the confirm action for an anon-key caller', async () => {
    const h = await load()
    const res = await h.handler(post({ action: 'confirm', invoiceId: 'inv-1' }, `Bearer ${anonJwt()}`))
    expect(res.status).toBe(403)
  })

  it('401s with no Authorization header at all', async () => {
    const h = await load()
    const req = new Request('https://edge.test/eft-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organisationId: ORG, tier: 'enterprise' }),
    })
    expect((await h.handler(req)).status).toBe(401)
  })
})
