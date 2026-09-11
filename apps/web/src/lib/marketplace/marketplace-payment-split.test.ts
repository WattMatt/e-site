// @vitest-environment node
/**
 * marketplace-payment edge function — split construction (finding #26).
 *
 * Two defects, both of which become PERMANENT per-supplier state the moment
 * the first supplier onboards, because the split_code is persisted on
 * marketplace.paystack_subaccounts and reused forever:
 *
 * (a) The split was created with `bearer_type: 'all'`. Paystack defines that
 *     as the transaction fee being shared across every account in the split
 *     INCLUDING the payout account — so E-Site absorbs roughly half of each
 *     fee (~R15 of a R30-capped fee on a R10 000 order, about 3% of its own
 *     commission), against live Terms of Service 4.2 which state the supplier
 *     absorbs the Paystack fee and E-Site absorbs no part of it. The KYC pack
 *     submitted to Paystack declares bearer 'subaccount'.
 *
 * (b) `if (splitCode) txPayload.split_code = splitCode` silently initialised
 *     the charge with NO split at all when the supplier had no subaccount
 *     row — so 100% settled into E-Site's account — while the code below it
 *     still stamped commission_rate and commission_amount on the order and the
 *     supplier's order page still promised them 94% "on settlement".
 *
 * THE FIXTURE RULE. Both assertions are made against the JSON body that
 * reaches api.paystack.co, because that body IS the money movement — an
 * internal variable or a 200 response proves nothing about where the funds
 * land. The no-subaccount fixture asserts on the ABSENCE of a
 * /transaction/initialize call: a test that only checked the status code would
 * pass while a full-value capture went through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const FN = '../../../../../apps/edge-functions/supabase/functions/marketplace-payment/index.ts'

const ORDER_ID = '55555555-5555-4555-8555-555555555555'
const SUPPLIER_ID = '66666666-6666-4666-8666-666666666666'
const SUBACCOUNT = 'ACCT_supplier01'

type Order = Record<string, any>
type Sub = Record<string, any> | null

interface Harness {
  handler: (req: Request) => Promise<Response>
  /** Every Paystack POST, as { path, body }. */
  calls: Array<{ path: string; body: any }>
  /** Every write to marketplace.orders made by the service client. */
  orderUpdates: any[]
  /** Every write to marketplace.paystack_subaccounts. */
  subUpdates: any[]
}

async function load(opts: { order?: Order; sub?: Sub } = {}): Promise<Harness> {
  vi.resetModules()
  const calls: Array<{ path: string; body: any }> = []
  const orderUpdates: any[] = []
  const subUpdates: any[] = []

  const order: Order = {
    id: ORDER_ID,
    contractor_org_id: 'org-contractor',
    supplier_id: SUPPLIER_ID,
    total_amount: 10000,
    payment_status: 'pending',
    commission_rate: null,
    paystack_split_code: null,
    notes: null,
    created_by_profile: { id: 'u1', email: 'buyer@acme.test', full_name: 'Buyer' },
    ...opts.order,
  }
  const sub: Sub = opts.sub === undefined ? { subaccount_code: SUBACCOUNT, split_code: null } : opts.sub

  const env: Record<string, string> = {
    SUPABASE_URL: 'https://cbskbnvvgcybmfikxgky.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_anon',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_service',
    PAYSTACK_SECRET_KEY: 'sk_test_key',
  }
  ;(globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: () => {} }

  vi.doMock('https://esm.sh/@supabase/supabase-js@2', () => ({
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'buyer@acme.test' } }, error: null }) },
      schema: () => ({
        from: (t: string) => {
          const b: any = {}
          const chain = () => b
          b.select = chain
          b.eq = (..._a: unknown[]) => {
            if (b._pending) {
              const p = b._pending; b._pending = null
              if (t === 'orders') orderUpdates.push(p)
              if (t === 'paystack_subaccounts') subUpdates.push(p)
              return Promise.resolve({ data: null, error: null })
            }
            return b
          }
          b.update = (payload: any) => { b._pending = payload; return b }
          b.single = async () =>
            t === 'orders' ? { data: order, error: null } : { data: sub, error: null }
          b.maybeSingle = async () =>
            t === 'orders' ? { data: order, error: null } : { data: sub, error: null }
          return b
        },
      }),
    }),
  }))

  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const url = String(input)
    const path = url.replace('https://api.paystack.co', '')
    calls.push({ path, body: JSON.parse(String(init.body)) })
    const data =
      path === '/split'
        ? { split_code: 'SPL_new01' }
        : { authorization_url: 'https://paystack.test/pay', access_code: 'AC', reference: 'REF' }
    return new Response(JSON.stringify({ status: true, message: 'ok', data }), { status: 200 })
  })

  const mod = await import(FN)
  return { handler: mod.handler, calls, orderUpdates, subUpdates }
}

function post(body: unknown = { orderId: ORDER_ID }): Request {
  return new Request('https://edge.test/marketplace-payment', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const initCalls = (h: Harness) => h.calls.filter((c) => c.path === '/transaction/initialize')
const splitCalls = (h: Harness) => h.calls.filter((c) => c.path === '/split')

beforeEach(() => { vi.unstubAllGlobals() })

describe('marketplace-payment — the supplier bears the Paystack fee (Terms 4.2)', () => {
  it('creates the split with bearer_type "subaccount" and names the bearer', async () => {
    const h = await load()
    const res = await h.handler(post())
    expect(res.status).toBe(200)

    expect(splitCalls(h)).toHaveLength(1)
    const split = splitCalls(h)[0].body
    expect(split.bearer_type).toBe('subaccount')
    // Paystack REQUIRES bearer_subaccount whenever bearer_type is 'subaccount';
    // omitting it is rejected at the API, so assert it is actually populated.
    expect(split.bearer_subaccount).toBe(SUBACCOUNT)
    expect(split.subaccounts).toEqual([{ subaccount: SUBACCOUNT, share: 94 }])
  })

  it('never creates a split whose fee is shared with the payout account', async () => {
    const h = await load()
    await h.handler(post())
    for (const c of splitCalls(h)) {
      expect(c.body.bearer_type).not.toBe('all')
      expect(c.body.bearer_type).not.toBe('account')
    }
  })

  it('persists the new split code against the supplier', async () => {
    const h = await load()
    await h.handler(post())
    expect(h.subUpdates).toEqual([{ split_code: 'SPL_new01' }])
  })

  it('reuses an existing split without re-creating one', async () => {
    const h = await load({ sub: { subaccount_code: SUBACCOUNT, split_code: 'SPL_existing' } })
    const res = await h.handler(post())
    expect(res.status).toBe(200)
    expect(splitCalls(h)).toHaveLength(0)
    expect(initCalls(h)[0].body.split_code).toBe('SPL_existing')
  })
})

describe('marketplace-payment — a supplier with no payout account cannot be charged against', () => {
  it('422s when the supplier has no subaccount row, and initialises NOTHING', async () => {
    const h = await load({ sub: null })
    const res = await h.handler(post())
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/payout onboarding/i) })

    // The defect this replaces: the charge went ahead split-less and 100% of
    // the order value settled to E-Site.
    expect(initCalls(h)).toHaveLength(0)
    expect(splitCalls(h)).toHaveLength(0)
  })

  it('422s when a row exists but carries no subaccount_code', async () => {
    const h = await load({ sub: { subaccount_code: null, split_code: null } })
    const res = await h.handler(post())
    expect(res.status).toBe(422)
    expect(initCalls(h)).toHaveLength(0)
  })

  it('does not stamp commission columns on an order it refused to charge', async () => {
    const h = await load({ sub: null })
    await h.handler(post())
    // The ledger must not claim a 6% commission on a transaction that never ran.
    expect(h.orderUpdates).toHaveLength(0)
  })

  it('every successful initialise carries a split_code', async () => {
    for (const sub of [
      { subaccount_code: SUBACCOUNT, split_code: null },
      { subaccount_code: SUBACCOUNT, split_code: 'SPL_existing' },
    ]) {
      const h = await load({ sub })
      const res = await h.handler(post())
      expect(res.status).toBe(200)
      expect(initCalls(h)).toHaveLength(1)
      expect(typeof initCalls(h)[0].body.split_code).toBe('string')
      expect(initCalls(h)[0].body.split_code).toMatch(/^SPL_/)
    }
  })

  it('an order that already carries a split code is charged with it', async () => {
    const h = await load({ order: { paystack_split_code: 'SPL_onorder' }, sub: null })
    const res = await h.handler(post())
    expect(res.status).toBe(200)
    expect(initCalls(h)[0].body.split_code).toBe('SPL_onorder')
  })
})
