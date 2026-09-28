// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

/**
 * /api/paystack/webhook is the SINGLE registered Paystack ingress
 * (docs/paystack-go-live-roadmap.md §3C step 8). Until 2026-09-11 it was
 * 307-redirected to /login by middleware and had never received a real
 * delivery, so every billing row in production was written by the callback.
 * It is about to carry real money for the first time.
 *
 * ── What these fixtures must be able to express ─────────────────────────────
 * Five shipped defects in this repo were invisible because the fixture could
 * not express the property under test. The mock Supabase client below is
 * therefore programmable per (schema, table, op): every write can be made to
 * FAIL, with a real Postgres error shape (code/constraint), and every write is
 * recorded so an assertion can say "this write never happened" rather than
 * "the response looked right". A response-code-only assertion would pass for
 * every defect listed here — all of them returned 200 {received:true}.
 *
 * Properties pinned:
 *   #6  invoice.update is handled at all — it is the only event that can clear
 *       projects.status='payment_paused', which a live daily cron sets.
 *   #6  a renewal charge.success carrying NO metadata is matched on customer
 *       code instead of being dropped.
 *   #15 a genuine storage failure returns 500 (so Paystack retries) and does
 *       so BEFORE any invoice is written, so the retry finds a clean state.
 *   #16 refunds and disputes are handled, and a refund revokes the unlock.
 *   #17 a SECOND distinct reference for a feature the org already holds is
 *       recorded and escalated to a human, not console.error'd into a 200.
 *   #19 next_billing_date is stamped, so the nightly downgrade job can see it.
 */

const SECRET = 'sk_test_webhook'

const { serviceClientRef, upsertSubscriptionMock, recordInvoiceMock } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_webhook'
  return {
    serviceClientRef: { value: null as any },
    upsertSubscriptionMock: vi.fn(),
    recordInvoiceMock: vi.fn(),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: async () => serviceClientRef.value,
}))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<typeof import('@esite/shared')>('@esite/shared')
  return {
    ...actual,
    billingService: {
      ...actual.billingService,
      upsertSubscription: (...a: unknown[]) => upsertSubscriptionMock(...a),
      recordInvoice: (...a: unknown[]) => recordInvoiceMock(...a),
    },
  }
})

import { POST } from './route'

// ── Programmable fake Supabase client ───────────────────────────────────────

interface Call {
  key: string
  op: string
  payload: any
  filters: Array<[string, string, unknown]>
}

/**
 * Responses are keyed `<schema>.<table>.<op>`; anything unkeyed resolves to a
 * clean `{ data: null, error: null }`. Setting a key to `{ error: {...} }` is
 * what lets a test assert the FAILURE path — the property the production code
 * could not express because every error was console.error'd.
 */
function makeClient(responses: Record<string, any> = {}) {
  const calls: Call[] = []

  function builder(schema: string, table: string) {
    const ctx = {
      op: '',
      payload: undefined as any,
      filters: [] as Array<[string, string, unknown]>,
    }
    const key = () => `${schema}.${table}.${ctx.op}`

    const settle = () => {
      calls.push({ key: key(), op: ctx.op, payload: ctx.payload, filters: [...ctx.filters] })
      const r = responses[key()]
      if (typeof r === 'function') return Promise.resolve(r(ctx))
      return Promise.resolve(r ?? { data: null, error: null })
    }

    const filter = (name: string) => (col: string, val: unknown) => {
      ctx.filters.push([name, col, val])
      return api
    }

    const api: any = {
      select: (_sel?: string) => { if (!ctx.op) ctx.op = 'select'; return api },
      insert: (p: any) => { ctx.op = 'insert'; ctx.payload = p; return api },
      upsert: (p: any, _o?: any) => { ctx.op = 'upsert'; ctx.payload = p; return api },
      update: (p: any) => { ctx.op = 'update'; ctx.payload = p; return api },
      delete: () => { ctx.op = 'delete'; return api },
      eq: filter('eq'),
      neq: filter('neq'),
      gt: filter('gt'),
      lt: filter('lt'),
      is: filter('is'),
      in: filter('in'),
      or: filter('or'),
      limit: (_n: number) => api,
      order: (_c: string) => api,
      maybeSingle: () => settle(),
      single: () => settle(),
      then: (res: any, rej: any) => settle().then(res, rej),
    }
    return api
  }

  const client: any = {
    schema: (s: string) => ({ from: (t: string) => builder(s, t) }),
    from: (t: string) => builder('public', t),
    calls,
    /** Every recorded call against `<schema>.<table>.<op>`. */
    of: (k: string) => calls.filter((c) => c.key === k),
  }
  return client
}

/** A real Postgres unique-violation error, as PostgREST surfaces it. */
function uniqueViolation(constraint: string) {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${constraint}"`,
    details: `Key (organisation_id, feature_key)=(x, y) already exists.`,
    hint: null,
  }
}

function signedReq(event: Record<string, unknown>, secret = SECRET) {
  const raw = JSON.stringify(event)
  const sig = createHmac('sha512', secret).update(raw).digest('hex')
  return {
    headers: { get: (h: string) => (h === 'x-paystack-signature' ? sig : null) },
    text: async () => raw,
  } as unknown as Parameters<typeof POST>[0]
}

const ORG = 'dddddddd-0000-0000-0000-000000000001'
const REF = 'ref_live_001'

beforeEach(() => {
  upsertSubscriptionMock.mockReset().mockResolvedValue({})
  recordInvoiceMock.mockReset().mockResolvedValue({})
  serviceClientRef.value = makeClient()
})

// ─────────────────────────────────────────────────────────────────────────────
// #6 — invoice.update: the only path that un-pauses a paying customer
// ─────────────────────────────────────────────────────────────────────────────

function invoiceUpdate(status: 'success' | 'failed', extra: Record<string, unknown> = {}) {
  return {
    event: 'invoice.update',
    data: {
      status,
      amount: 49900,
      paid_at: '2026-09-11T08:00:00.000Z',
      transaction: { reference: REF },
      subscription: { subscription_code: 'SUB_abc', next_payment_date: '2026-10-11T00:00:00.000Z' },
      ...extra,
    },
  }
}

describe('invoice.update — finding #6', () => {
  it('restores payment_paused projects to active when the renewal is paid', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': { data: { organisation_id: ORG }, error: null },
    })
    const res = await POST(signedReq(invoiceUpdate('success')))
    expect(res.status).toBe(200)

    const restore = serviceClientRef.value.of('projects.projects.update')
    expect(restore).toHaveLength(1)
    expect(restore[0].payload).toMatchObject({ status: 'active' })
    // Scoped to this org AND only rows the recovery cron paused — never a
    // blanket un-pause of every project in the database.
    expect(restore[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'organisation_id', ORG],
        ['eq', 'status', 'payment_paused'],
      ]),
    )
  })

  it('clears the dunning counters so the recovery cron stops chasing a paid customer', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': { data: { organisation_id: ORG }, error: null },
    })
    await POST(signedReq(invoiceUpdate('success')))
    const upd = serviceClientRef.value.of('billing.subscriptions.update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({
      status: 'active',
      payment_failure_count: 0,
      last_payment_failure_at: null,
    })
  })

  it('refreshes next_billing_date from the renewal payload — finding #19 mirror', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': { data: { organisation_id: ORG }, error: null },
    })
    await POST(signedReq(invoiceUpdate('success')))
    const upd = serviceClientRef.value.of('billing.subscriptions.update')[0]
    expect(upd.payload.next_billing_date).toBe('2026-10-11')
  })

  it('records the renewal invoice through the idempotent upsert, not a raw insert', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': { data: { organisation_id: ORG }, error: null },
    })
    await POST(signedReq(invoiceUpdate('success')))
    // A raw .insert() would 500 forever on a re-delivered invoice.update
    // because billing.invoices has UNIQUE(paystack_reference).
    expect(serviceClientRef.value.of('billing.invoices.insert')).toHaveLength(0)
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(ORG)
    expect(recordInvoiceMock.mock.calls[0][2]).toMatchObject({
      paystackReference: REF,
      status: 'paid',
    })
  })

  it('marks the subscription past_due on a failed renewal and does NOT un-pause projects', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': { data: { organisation_id: ORG }, error: null },
    })
    await POST(signedReq(invoiceUpdate('failed')))
    const upd = serviceClientRef.value.of('billing.subscriptions.update')
    expect(upd[0].payload).toMatchObject({ status: 'past_due' })
    expect(serviceClientRef.value.of('projects.projects.update')).toHaveLength(0)
    expect(recordInvoiceMock.mock.calls[0][2].status).toBe('failed')
  })

  it('also advances a per-user MV subscription period on its annual renewal', async () => {
    // No org subscription carries this code — it is the MV (per-user) one.
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': { data: null, error: null },
      'billing.user_mv_subscriptions.select': { data: { id: 'mv-1' }, error: null },
    })
    await POST(signedReq(invoiceUpdate('success')))
    const mv = serviceClientRef.value.of('billing.user_mv_subscriptions.update')
    expect(mv).toHaveLength(1)
    expect(mv[0].payload).toMatchObject({ status: 'active' })
    expect(mv[0].payload.current_period_end).toBe('2026-10-11T00:00:00.000Z')
  })

  it('accepts invoice.create as an explicit no-op', async () => {
    const res = await POST(signedReq({ event: 'invoice.create', data: { amount: 1 } }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.calls).toHaveLength(0)
  })
})

describe('charge.success without metadata — finding #6', () => {
  function renewal() {
    return {
      event: 'charge.success',
      data: {
        reference: REF,
        amount: 49900,
        metadata: 0, // Paystack literally sends `"metadata": 0` on renewals
        customer: { customer_code: 'CUS_x' },
        plan: { plan_code: 'PLN_y' },
      },
    }
  }

  it('matches a renewal on customer_code instead of dropping it', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': {
        data: { id: 's1', organisation_id: ORG, tier: 'starter', billing_period: 'monthly' },
        error: null,
      },
    })
    await POST(signedReq(renewal()))
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(ORG)
    expect(recordInvoiceMock.mock.calls[0][2]).toMatchObject({ paystackReference: REF, status: 'paid' })
  })

  it('clears the failure counters on a matched renewal', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': {
        data: { id: 's1', organisation_id: ORG, tier: 'starter', billing_period: 'monthly' },
        error: null,
      },
    })
    await POST(signedReq(renewal()))
    const upd = serviceClientRef.value.of('billing.subscriptions.update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ payment_failure_count: 0, last_payment_failure_at: null })
  })

  it('never invents a tier for an unmatched renewal', async () => {
    serviceClientRef.value = makeClient({ 'billing.subscriptions.select': { data: null, error: null } })
    const res = await POST(signedReq(renewal()))
    expect(res.status).toBe(200)
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #15 — a swallowed write must become a 500 so Paystack retries
// ─────────────────────────────────────────────────────────────────────────────

const unlockEvent = {
  event: 'charge.success',
  data: {
    reference: REF,
    amount: 199900,
    metadata: { type: 'feature_unlock', org_id: ORG, feature_key: 'jbcc', amount_kobo: 199900 },
  },
}

const seatEvent = {
  event: 'charge.success',
  data: {
    reference: REF,
    amount: 200000,
    metadata: {
      type: 'feature_seat',
      org_id: ORG,
      user_id: 'u-1',
      feature_key: 'generator_cost_recovery',
      amount_kobo: 200000,
    },
  },
}

const mvEvent = {
  event: 'charge.success',
  id: 'evt_1',
  data: {
    reference: REF,
    amount: 200000,
    metadata: { type: 'mv_subscription', user_id: 'u-1' },
    customer: { customer_code: 'CUS_x' },
  },
}

describe('storage failures return 500 before any invoice is written — finding #15', () => {
  it('feature_unlock: a transient write failure 500s and records NO paid invoice', async () => {
    serviceClientRef.value = makeClient({
      'billing.org_feature_unlocks.upsert': {
        data: null,
        error: { code: '40001', message: 'could not serialize access' },
      },
    })
    const res = await POST(signedReq(unlockEvent))
    expect(res.status).toBe(500)
    // The whole point: a retry must not find a 'paid' invoice already on file.
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('feature_seat: a transient write failure 500s and records NO paid invoice', async () => {
    serviceClientRef.value = makeClient({
      'billing.org_feature_seats.upsert': { data: null, error: { code: '40001', message: 'deadlock' } },
    })
    const res = await POST(signedReq(seatEvent))
    expect(res.status).toBe(500)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('mv_subscription: a failed grant 500s instead of vanishing with no record at all', async () => {
    serviceClientRef.value = makeClient({
      'billing.user_mv_subscriptions.select': { data: null, error: null },
      'billing.user_mv_subscriptions.upsert': { data: null, error: { code: '40001', message: 'deadlock' } },
    })
    const res = await POST(signedReq(mvEvent))
    expect(res.status).toBe(500)
  })

  it('mv_subscription: a successful grant also leaves an invoice row — money moved', async () => {
    // billing.invoices.organisation_id is NOT NULL in prod and mv_subscription
    // metadata carries only user_id, so the buyer's org has to be resolved.
    serviceClientRef.value = makeClient({
      'billing.user_mv_subscriptions.select': { data: null, error: null },
      'public.user_organisations.select': { data: { organisation_id: ORG }, error: null },
    })
    const res = await POST(signedReq(mvEvent))
    expect(res.status).toBe(200)
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(ORG)
  })

  it('mv_subscription: an unresolvable org still leaves a payment-event record', async () => {
    serviceClientRef.value = makeClient({
      'billing.user_mv_subscriptions.select': { data: null, error: null },
      'public.user_organisations.select': { data: null, error: null },
    })
    const res = await POST(signedReq(mvEvent))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')).toHaveLength(1)
  })

  it('subscription tier: a failed upsert 500s rather than silently granting nothing', async () => {
    upsertSubscriptionMock.mockRejectedValue(new Error('connection terminated'))
    const res = await POST(
      signedReq({
        event: 'charge.success',
        data: {
          reference: REF,
          amount: 49900,
          metadata: { org_id: ORG, tier: 'starter', period: 'monthly', amount_kobo: 49900 },
        },
      }),
    )
    expect(res.status).toBe(500)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('a failed invoice write also 500s — the audit trail is not optional', async () => {
    recordInvoiceMock.mockRejectedValue(new Error('connection terminated'))
    const res = await POST(signedReq(unlockEvent))
    expect(res.status).toBe(500)
  })

  it('the happy path still returns 200 and grants + invoices exactly once', async () => {
    const res = await POST(signedReq(unlockEvent))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('billing.org_feature_unlocks.upsert')).toHaveLength(1)
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #17 — a second purchase of a feature the org already holds
// ─────────────────────────────────────────────────────────────────────────────

describe('duplicate feature purchase — finding #17', () => {
  function dupClient() {
    return makeClient({
      'billing.org_feature_unlocks.upsert': {
        data: null,
        error: uniqueViolation('org_feature_unlocks_organisation_id_feature_key_key'),
      },
      'public.user_organisations.select': {
        data: [{ user_id: 'u-owner' }, { user_id: 'u-admin' }],
        error: null,
      },
    })
  }

  it('returns 200, not 500 — a retry can never satisfy this constraint', async () => {
    serviceClientRef.value = dupClient()
    const res = await POST(signedReq(unlockEvent))
    expect(res.status).toBe(200)
  })

  it('still records the invoice — money moved and must be on the books', async () => {
    serviceClientRef.value = dupClient()
    await POST(signedReq(unlockEvent))
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
    expect(recordInvoiceMock.mock.calls[0][2].amountKobo).toBe(199900)
  })

  it('marks that invoice distinguishably so it is not mistaken for a first purchase', async () => {
    serviceClientRef.value = dupClient()
    await POST(signedReq(unlockEvent))
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/duplicate/i)
  })

  it('raises a notification to every org owner/admin — the charge must reach a human', async () => {
    serviceClientRef.value = dupClient()
    await POST(signedReq(unlockEvent))
    const notes = serviceClientRef.value.of('public.notifications.insert')
    expect(notes).toHaveLength(1)
    const rows = notes[0].payload as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ type: 'billing_duplicate_charge', organisation_id: ORG })
    expect(rows.map((r) => r.user_id).sort()).toEqual(['u-admin', 'u-owner'])
    // The reference has to be in the row or the human cannot action the refund.
    expect(JSON.stringify(rows[0])).toContain(REF)
  })

  it('applies the same rule to a duplicate seat assignment', async () => {
    serviceClientRef.value = makeClient({
      'billing.org_feature_seats.upsert': {
        data: null,
        error: uniqueViolation('uq_org_feature_seats_assignment'),
      },
      'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
    })
    const res = await POST(signedReq(seatEvent))
    expect(res.status).toBe(200)
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/duplicate/i)
    expect(serviceClientRef.value.of('public.notifications.insert')).toHaveLength(1)
  })

  it('a 23505 on ANY OTHER constraint still 500s — it is not a blanket success', async () => {
    serviceClientRef.value = makeClient({
      'billing.org_feature_unlocks.upsert': {
        data: null,
        error: uniqueViolation('some_other_unique_index'),
      },
    })
    const res = await POST(signedReq(unlockEvent))
    expect(res.status).toBe(500)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #16 — refunds and disputes
// ─────────────────────────────────────────────────────────────────────────────

describe('refunds — finding #16', () => {
  const refundEvent = {
    event: 'refund.processed',
    data: {
      status: 'processed',
      amount: 199900,
      transaction_reference: REF,
      customer: { customer_code: 'CUS_x' },
    },
  }

  it('flips the invoice to refunded — a legal value in invoices_status_check', async () => {
    serviceClientRef.value = makeClient({
      'billing.org_feature_unlocks.select': { data: { id: 'fu-1', organisation_id: ORG, feature_key: 'jbcc' }, error: null },
      'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
    })
    const res = await POST(signedReq(refundEvent))
    expect(res.status).toBe(200)
    const inv = serviceClientRef.value.of('billing.invoices.update')
    expect(inv).toHaveLength(1)
    expect(inv[0].payload).toMatchObject({ status: 'refunded' })
    expect(inv[0].filters).toEqual(expect.arrayContaining([['eq', 'paystack_reference', REF]]))
  })

  it('revokes the feature unlock bought with that reference', async () => {
    serviceClientRef.value = makeClient({
      'billing.org_feature_unlocks.select': { data: { id: 'fu-1', organisation_id: ORG, feature_key: 'jbcc' }, error: null },
      'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
    })
    await POST(signedReq(refundEvent))
    const rev = serviceClientRef.value.of('billing.org_feature_unlocks.update')
    expect(rev).toHaveLength(1)
    expect(rev[0].payload.revoked_at).toEqual(expect.any(String))
    expect(rev[0].payload.revoked_reason).toMatch(/refund/i)
  })

  it('marks the marketplace order and its commission record refunded', async () => {
    serviceClientRef.value = makeClient()
    await POST(signedReq(refundEvent))
    expect(serviceClientRef.value.of('marketplace.orders.update')[0].payload).toMatchObject({
      payment_status: 'refunded',
    })
    expect(serviceClientRef.value.of('marketplace.commission_records.update')[0].payload).toMatchObject({
      payout_status: 'refunded',
    })
  })

  it('records the event so there is a durable payment-event log', async () => {
    serviceClientRef.value = makeClient()
    await POST(signedReq(refundEvent))
    const ev = serviceClientRef.value.of('billing.payment_events.upsert')
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({ event_type: 'refund.processed', paystack_reference: REF })
  })

  it('does not revoke on refund.pending — only a processed refund takes access away', async () => {
    serviceClientRef.value = makeClient()
    await POST(signedReq({ ...refundEvent, event: 'refund.pending', data: { ...refundEvent.data, status: 'pending' } }))
    expect(serviceClientRef.value.of('billing.org_feature_unlocks.update')).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.invoices.update')).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')).toHaveLength(1)
  })
})

describe('disputes — finding #16', () => {
  const disputeEvent = {
    event: 'charge.dispute.create',
    data: {
      status: 'awaiting-merchant-feedback',
      transaction: { reference: REF, amount: 199900 },
      customer: { customer_code: 'CUS_x' },
    },
  }

  it('never writes status "disputed" to billing.invoices — 23514 would throw', async () => {
    serviceClientRef.value = makeClient({
      'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
    })
    const res = await POST(signedReq(disputeEvent))
    expect(res.status).toBe(200)
    const writes = serviceClientRef.value.of('billing.invoices.update')
    for (const w of writes) expect(w.payload.status).not.toBe('disputed')
  })

  it('records the dispute in the payment-event log the Terms of Service promises', async () => {
    serviceClientRef.value = makeClient()
    await POST(signedReq(disputeEvent))
    const ev = serviceClientRef.value.of('billing.payment_events.upsert')
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({ event_type: 'charge.dispute.create', paystack_reference: REF })
  })

  it('notifies the org owner/admin when the disputed reference maps to an org', async () => {
    serviceClientRef.value = makeClient({
      'billing.invoices.select': { data: { organisation_id: ORG }, error: null },
      'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
    })
    await POST(signedReq(disputeEvent))
    const notes = serviceClientRef.value.of('public.notifications.insert')
    expect(notes).toHaveLength(1)
    expect((notes[0].payload as any[])[0]).toMatchObject({ type: 'billing_dispute_opened' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #19 — the paid period must have an end date
// ─────────────────────────────────────────────────────────────────────────────

describe('next_billing_date is stamped on a first charge — finding #19', () => {
  function firstCharge(period: 'monthly' | 'annual') {
    return {
      event: 'charge.success',
      data: {
        reference: REF,
        amount: 49900,
        paid_at: '2026-09-11T08:00:00.000Z',
        metadata: { org_id: ORG, tier: 'starter', period, amount_kobo: 49900 },
      },
    }
  }

  it('monthly → charge date + 1 month', async () => {
    await POST(signedReq(firstCharge('monthly')))
    expect(upsertSubscriptionMock.mock.calls[0][2].nextBillingDate).toBe('2026-10-11')
  })

  it('annual → charge date + 1 year', async () => {
    await POST(signedReq(firstCharge('annual')))
    expect(upsertSubscriptionMock.mock.calls[0][2].nextBillingDate).toBe('2027-09-11')
  })

  it('never leaves it NULL — a NULL is invisible to downgradeExpiredCancellations', async () => {
    await POST(signedReq(firstCharge('monthly')))
    expect(upsertSubscriptionMock.mock.calls[0][2].nextBillingDate).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Signature guard — must still fail closed
// ─────────────────────────────────────────────────────────────────────────────

describe('signature', () => {
  it('rejects a body signed with the wrong secret and performs no writes', async () => {
    const res = await POST(signedReq(unlockEvent, 'sk_test_wrong'))
    expect(res.status).toBe(401)
    expect(serviceClientRef.value.calls).toHaveLength(0)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Org add-on subscription — Solar (billing.org_addon_subscriptions, 00207)
//
// The webhook is the ONLY writer of that table. Every assertion below checks
// the WRITE (or its absence), never just the 200, for the reason given at the
// top of this file.
// ─────────────────────────────────────────────────────────────────────────────

const SOLAR_PLAN = 'PLN_solar_annual'
const SOLAR_ORG = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const ADDON = 'billing.org_addon_subscriptions'
const PAID_AT = '2026-09-28T10:00:00.000Z'

function solarFirstCharge(meta: Record<string, unknown> = {}) {
  return {
    event: 'charge.success',
    data: {
      reference: REF,
      amount: 199900,
      paid_at: PAID_AT,
      currency: 'ZAR',
      customer: { customer_code: 'CUS_solar' },
      plan: { plan_code: SOLAR_PLAN },
      metadata: {
        type: 'org_addon_subscription',
        feature_key: 'solar',
        org_id: SOLAR_ORG,
        project_id: 'p-1',
        user_id: 'u-owner',
        return_to: '/projects/p-1/solar',
        ...meta,
      },
    },
  }
}

/** The stored subscription row, as the webhook selects it. */
function addonRow(over: Record<string, unknown> = {}) {
  return {
    id: 'oas-1',
    organisation_id: SOLAR_ORG,
    status: 'active',
    current_period_end: '2027-09-28T10:00:00.000Z',
    last_event_id: REF,
    paystack_subscription_code: 'SUB_solar',
    ...over,
  }
}

const orgExists = { 'public.organisations.select': { data: { id: SOLAR_ORG }, error: null } }

describe('org add-on — first Solar charge', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  it('inserts an ACTIVE row with a one-year period — never pending', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    const ins = serviceClientRef.value.of(`${ADDON}.insert`)
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).toMatchObject({
      organisation_id: SOLAR_ORG,
      feature_key: 'solar',
      status: 'active',
      amount_kobo: 199900,
      current_period_end: '2027-09-28T10:00:00.000Z',
      paystack_customer_code: 'CUS_solar',
      last_event_id: REF,
      started_at: PAID_AT,
    })
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('books the charge: invoice to the org + the reference→org payment event a refund needs', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    await POST(signedReq(solarFirstCharge()))
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(SOLAR_ORG)
    expect(recordInvoiceMock.mock.calls[0][2]).toMatchObject({ paystackReference: REF, status: 'paid', amountKobo: 199900 })
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/Solar/)
    const ev = serviceClientRef.value.of('billing.payment_events.upsert')
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({
      event_type: 'charge.success.org_addon_subscription',
      paystack_reference: REF,
      organisation_id: SOLAR_ORG,
    })
  })

  it('never touches the org TIER subscription', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    await POST(signedReq(solarFirstCharge()))
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('a duplicate delivery re-grants nothing but still (idempotently) books the invoice', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.select`]: { data: addonRow({ last_event_id: REF }), error: null },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    // The invoice write is idempotent on paystack_reference; a first attempt
    // that 500'd AFTER the grant must still get its invoice on the retry.
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
  })

  it('an unknown org: 200 (a retry cannot fix it), nothing granted, the money logged', async () => {
    serviceClientRef.value = makeClient({ 'public.organisations.select': { data: null, error: null } })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
    const ev = serviceClientRef.value.of('billing.payment_events.upsert')
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({
      event_type: 'charge.success.org_addon_subscription.unmatched',
      paystack_reference: REF,
      organisation_id: null,
    })
  })

  it('an unknown add-on key is logged, not granted, and never looks the org up', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    const res = await POST(signedReq(solarFirstCharge({ feature_key: 'jbcc' })))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('public.organisations.select')).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.unmatched',
    )
  })

  it('a resubscribe after a refund restores the row (D-02) and forgets the dead Paystack code', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.select`]: {
        data: addonRow({
          status: 'refunded',
          last_event_id: 'ref_old',
          current_period_end: '2026-03-01T00:00:00.000Z',
          paystack_subscription_code: 'SUB_old',
        }),
        error: null,
      },
    })
    await POST(signedReq(solarFirstCharge()))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({
      status: 'active',
      current_period_end: '2027-09-28T10:00:00.000Z',
      last_event_id: REF,
      paystack_subscription_code: null,
      started_at: PAID_AT,
      cancelled_at: null,
      refunded_at: null,
    })
    expect(upd[0].filters).toEqual([['eq', 'id', 'oas-1']])
  })

  it('a second first-charge while LIVE is a double purchase: no grant, admins told, invoice marked', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.select`]: {
        data: addonRow({ last_event_id: 'ref_other', current_period_end: '2027-12-31T00:00:00.000Z' }),
        error: null,
      },
      'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    const note = serviceClientRef.value.of('public.notifications.insert')
    expect(note).toHaveLength(1)
    expect(note[0].payload[0]).toMatchObject({ type: 'billing_duplicate_charge', organisation_id: SOLAR_ORG })
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/DUPLICATE/)
    // Logged under its OWN type, so refunding the duplicate can never lock the live subscription.
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.duplicate',
    )
  })

  it('a failed grant 500s BEFORE any invoice or payment event is written', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.insert`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(500)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
    expect(serviceClientRef.value.of('billing.payment_events.upsert')).toHaveLength(0)
  })

  it('a failed organisation lookup 500s (retryable) rather than being logged as unmatched', async () => {
    serviceClientRef.value = makeClient({
      'public.organisations.select': { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(500)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')).toHaveLength(0)
  })
})

describe('org add-on — renewals', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  const RENEW_REF = 'ref_renew_002'

  function solarRenewal(extra: Record<string, unknown> = {}) {
    return {
      event: 'charge.success',
      data: {
        reference: RENEW_REF,
        amount: 199900,
        paid_at: '2027-09-28T09:59:00.000Z',
        metadata: 0, // Paystack literally sends `"metadata": 0` on renewals
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        subscription: { subscription_code: 'SUB_solar' },
        ...extra,
      },
    }
  }

  it('matches on subscription_code, extends the period and books the invoice to the org', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    const res = await POST(signedReq(solarRenewal()))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({
      status: 'active',
      current_period_end: '2028-09-28T09:59:00.000Z',
      last_event_id: RENEW_REF,
    })
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(SOLAR_ORG)
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/renewal/)
  })

  it('never reaches Branch C — the tier subscription is not even looked up', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    await POST(signedReq(solarRenewal()))
    expect(serviceClientRef.value.of('billing.subscriptions.select')).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('falls back to customer_code + Solar plan when the code was never stored', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: addonRow({ paystack_subscription_code: null }), error: null }
          : { data: null, error: null },
    })
    await POST(signedReq(solarRenewal({ subscription: undefined })))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.status).toBe('active')
  })

  it('an unplaceable Solar-plan charge is logged and NEVER booked as a tier renewal', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': {
        data: { id: 's1', organisation_id: ORG, tier: 'starter', billing_period: 'monthly' },
        error: null,
      },
    })
    const res = await POST(signedReq(solarRenewal()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('billing.subscriptions.select')).toHaveLength(0)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.unmatched',
    )
  })

  it('a duplicate renewal delivery does not re-extend', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ last_event_id: RENEW_REF }), error: null },
    })
    await POST(signedReq(solarRenewal()))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
  })

  it('never shortens a period already paid for', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ current_period_end: '2029-01-01T00:00:00.000Z' }), error: null },
    })
    await POST(signedReq(solarRenewal()))
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload.current_period_end).toBe(
      '2029-01-01T00:00:00.000Z',
    )
  })

  it('a non-Solar renewal still reaches Branch C untouched', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': {
        data: { id: 's1', organisation_id: ORG, tier: 'starter', billing_period: 'monthly' },
        error: null,
      },
    })
    await POST(signedReq(solarRenewal({ plan: { plan_code: 'PLN_starter' }, subscription: undefined })))
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(ORG)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  function solarInvoiceUpdate(status: 'success' | 'failed') {
    return {
      event: 'invoice.update',
      data: {
        status,
        amount: 199900,
        paid_at: '2027-09-28T09:59:00.000Z',
        transaction: { reference: RENEW_REF },
        subscription: { subscription_code: 'SUB_solar', next_payment_date: '2028-09-28T10:00:00.000Z' },
      },
    }
  }

  it('invoice.update paid → active with the period from next_payment_date', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    const res = await POST(signedReq(solarInvoiceUpdate('success')))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({
      status: 'active',
      current_period_end: '2028-09-28T10:00:00.000Z',
      // A renewal booked through invoice.update is refundable too (review, spec Minor 8).
      last_event_id: RENEW_REF,
    })
    expect(
      serviceClientRef.value.of('billing.payment_events.upsert').map((c: any) => c.payload),
    ).toContainEqual(expect.objectContaining({
      event_type: 'charge.success.org_addon_subscription',
      paystack_reference: RENEW_REF,
      organisation_id: SOLAR_ORG,
    }))
    // A non_renewing row is never flipped back by a paid invoice; neither is a refund/cancel racing it.
    expect(upd[0].filters).toEqual(expect.arrayContaining([['in', 'status', ['active', 'past_due']]]))
  })

  it('invoice.update failed → past_due, only from active', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    await POST(signedReq(solarInvoiceUpdate('failed')))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd[0].payload).toEqual({ status: 'past_due' })
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'oas-1'], ['eq', 'status', 'active']]))
  })

  it('subscription.create binds the Paystack code and never shortens or re-activates', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: addonRow({ paystack_subscription_code: null }), error: null }
          : { data: null, error: null },
    })
    const res = await POST(signedReq({
      event: 'subscription.create',
      data: {
        subscription_code: 'SUB_new',
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        next_payment_date: '2027-09-28T00:00:00.000Z',
      },
    }))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({
      paystack_subscription_code: 'SUB_new',
      current_period_end: '2027-09-28T10:00:00.000Z', // stored end is later — kept
    })
  })

  it('a lookup failure 500s so Paystack retries', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(solarRenewal()))
    expect(res.status).toBe(500)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })
})

describe('org add-on — not_renew / disable', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  // Fixed far-future / far-past ends so the tests do not rot as time passes.
  const IN_PERIOD = '2099-01-01T00:00:00.000Z'
  const EXPIRED = '2020-01-01T00:00:00.000Z'

  function subEvent(event: string, extra: Record<string, unknown> = {}) {
    return {
      event,
      data: {
        subscription_code: 'SUB_solar',
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        ...extra,
      },
    }
  }

  it('not_renew → non_renewing, keeping the paid period (access runs to its end)', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ current_period_end: IN_PERIOD }), error: null },
    })
    const res = await POST(signedReq(subEvent('subscription.not_renew')))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ status: 'non_renewing' })
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([['eq', 'id', 'oas-1'], ['eq', 'status', 'active']]),
    )
  })

  it('disable MID-PERIOD → non_renewing: the paid year is honoured to its end (owner default)', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ current_period_end: IN_PERIOD }), error: null },
    })
    const res = await POST(signedReq(subEvent('subscription.disable')))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ status: 'non_renewing' })
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([['eq', 'id', 'oas-1'], ['eq', 'status', 'active']]),
    )
  })

  it('disable AFTER the period ended → cancelled + cancelled_at, never overwriting a refunded row', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ current_period_end: EXPIRED }), error: null },
    })
    await POST(signedReq(subEvent('subscription.disable')))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.status).toBe('cancelled')
    expect(upd[0].payload.cancelled_at).toEqual(expect.any(String))
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([['eq', 'id', 'oas-1'], ['in', 'status', ['active', 'non_renewing', 'past_due']]]),
    )
  })

  it('matches by customer + Solar plan when the code was never bound', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: addonRow({ paystack_subscription_code: null, current_period_end: IN_PERIOD }), error: null }
          : { data: null, error: null },
    })
    await POST(signedReq(subEvent('subscription.not_renew')))
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload).toEqual({ status: 'non_renewing' })
  })

  it('an event for a subscription that is not Solar touches no add-on row', async () => {
    serviceClientRef.value = makeClient()
    await POST(signedReq(subEvent('subscription.disable', { plan: { plan_code: 'PLN_starter' } })))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a failed write 500s so Paystack retries', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ current_period_end: EXPIRED }), error: null },
      [`${ADDON}.update`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(subEvent('subscription.disable')))
    expect(res.status).toBe(500)
  })
})

describe('org add-on — refund / chargeback → refunded (D-02: hidden but kept)', () => {
  // The refunded charge is the one that funded the CURRENT period: the row's
  // last_event_id is its reference (owner default — see the prior-period tests).
  const solarCharge = {
    'billing.payment_events.select': { data: { organisation_id: SOLAR_ORG }, error: null },
    [`${ADDON}.select`]: { data: addonRow({ last_event_id: REF }), error: null },
    'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
  }

  const refundProcessed = {
    event: 'refund.processed',
    data: { status: 'processed', amount: 199900, transaction_reference: REF },
  }

  it('finds the org through the charge payment-event and marks the row refunded', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null },
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(200)
    const lookup = serviceClientRef.value.of('billing.payment_events.select')
    expect(lookup[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'event_type', 'charge.success.org_addon_subscription'],
        ['eq', 'paystack_reference', REF],
      ]),
    )
    expect(serviceClientRef.value.of(`${ADDON}.select`)[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'organisation_id', SOLAR_ORG],
        ['eq', 'feature_key', 'solar'],
      ]),
    )
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.status).toBe('refunded')
    expect(upd[0].payload.refunded_at).toEqual(expect.any(String))
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'oas-1'],
        // Re-checked in the UPDATE itself: a renewal applied between the read
        // and the write moves last_event_id on, and the refund then changes nothing.
        ['eq', 'last_event_id', REF],
        ['neq', 'status', 'refunded'],
      ]),
    )
  })

  it('tells the org owners/admins once, and says the data is kept', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null },
    })
    await POST(signedReq(refundProcessed))
    const note = serviceClientRef.value.of('public.notifications.insert')
    expect(note).toHaveLength(1)
    expect(note[0].payload[0]).toMatchObject({ type: 'billing_refund_processed', organisation_id: SOLAR_ORG })
    expect(note[0].payload[0].body).toMatch(/kept/i)
  })

  it('a duplicate refund delivery changes no row and notifies nobody', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [], error: null }, // already refunded → 0 rows
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('public.notifications.insert')).toHaveLength(0)
  })

  it('refunding an OLDER year’s charge is logged against the org but does not lock the current, paid year', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      // The row has since been renewed by a later charge.
      [`${ADDON}.select`]: { data: addonRow({ last_event_id: 'ref_renew_2027' }), error: null },
      [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null },
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(serviceClientRef.value.of('public.notifications.insert')).toHaveLength(0)
    const prior = serviceClientRef.value
      .of('billing.payment_events.upsert')
      .filter((c: any) => c.payload.event_type === 'refund.org_addon_subscription.prior_period')
    expect(prior).toHaveLength(1)
    expect(prior[0].payload).toMatchObject({ paystack_reference: REF, organisation_id: SOLAR_ORG })
  })

  it('a refund for a reference that was never a Solar charge touches no add-on row', async () => {
    serviceClientRef.value = makeClient() // payment_events lookup → null
    await POST(signedReq(refundProcessed))
    expect(serviceClientRef.value.of(`${ADDON}.select`)).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('refund.pending takes nothing away', async () => {
    serviceClientRef.value = makeClient({ ...solarCharge })
    await POST(signedReq({ ...refundProcessed, event: 'refund.pending' }))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a failed revoke 500s so Paystack retries', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(500)
  })

  it('a failed subscription read 500s so Paystack retries', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.select`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(500)
  })

  it('a chargeback the merchant lost (dispute resolved merchant-accepted) → refunded', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null },
    })
    const res = await POST(signedReq({
      event: 'charge.dispute.resolve',
      data: { status: 'resolved', resolution: 'merchant-accepted', transaction: { reference: REF, amount: 199900 } },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload.status).toBe('refunded')
  })

  it('an OPENED dispute, or one the merchant won, takes nothing away', async () => {
    for (const ev of [
      { event: 'charge.dispute.create', data: { status: 'awaiting-merchant-feedback', transaction: { reference: REF } } },
      { event: 'charge.dispute.resolve', data: { status: 'resolved', resolution: 'declined', transaction: { reference: REF } } },
    ]) {
      serviceClientRef.value = makeClient({ ...solarCharge, [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null } })
      await POST(signedReq(ev))
      expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    }
  })
})

describe('org add-on — failed charges', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  const tierSub = {
    'billing.subscriptions.select': {
      data: { id: 's1', payment_failure_count: 0, last_payment_failure_at: null },
      error: null,
    },
  }

  it('a failed FIRST Solar charge never marks the org tier plan past_due', async () => {
    serviceClientRef.value = makeClient({ ...tierSub })
    const res = await POST(signedReq({
      event: 'charge.failed',
      data: {
        reference: REF,
        customer: { customer_code: 'CUS_solar' },
        metadata: { type: 'org_addon_subscription', feature_key: 'solar', org_id: SOLAR_ORG },
      },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('billing.subscriptions.select')).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a failed Solar RENEWAL → past_due on the add-on, and the tier plan untouched', async () => {
    serviceClientRef.value = makeClient({ ...tierSub, [`${ADDON}.select`]: { data: addonRow(), error: null } })
    await POST(signedReq({
      event: 'charge.failed',
      data: {
        reference: 'ref_fail',
        metadata: 0,
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        subscription: { subscription_code: 'SUB_solar' },
      },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ status: 'past_due' })
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('an unplaceable Solar-plan failure still never reaches the tier plan', async () => {
    serviceClientRef.value = makeClient({ ...tierSub })
    await POST(signedReq({
      event: 'charge.failed',
      data: { reference: 'ref_fail', metadata: 0, customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
    }))
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('a non-Solar failed charge still opens the tier recovery cycle (unchanged)', async () => {
    serviceClientRef.value = makeClient({ ...tierSub })
    await POST(signedReq({
      event: 'charge.failed',
      data: { reference: 'ref_fail', metadata: { org_id: ORG }, customer: { customer_code: 'CUS_x' } },
    }))
    expect(serviceClientRef.value.of('billing.subscriptions.update')[0].payload.status).toBe('past_due')
  })

  it('invoice.payment_failed on the Solar subscription → past_due', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    const res = await POST(signedReq({
      event: 'invoice.payment_failed',
      data: { subscription: { subscription_code: 'SUB_solar' } },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload).toEqual({ status: 'past_due' })
  })
})

describe('org add-on — invoice.update never resurrects without a genuinely new charge', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  function paidInvoice(reference: string, nextPaymentDate: string) {
    return {
      event: 'invoice.update',
      data: {
        status: 'success',
        amount: 199900,
        paid_at: '2027-09-28T09:59:00.000Z',
        transaction: { reference },
        subscription: { subscription_code: 'SUB_solar', next_payment_date: nextPaymentDate },
      },
    }
  }

  it('a late invoice for the REFUNDED charge leaves the row refunded', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: {
        data: addonRow({ status: 'refunded', last_event_id: REF, current_period_end: '2027-09-28T10:00:00.000Z' }),
        error: null,
      },
    })
    const res = await POST(signedReq(paidInvoice(REF, '2028-09-28T10:00:00.000Z')))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a paid invoice with a new reference but no later period leaves the row refunded', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: {
        data: addonRow({ status: 'refunded', last_event_id: REF, current_period_end: '2028-12-31T00:00:00.000Z' }),
        error: null,
      },
    })
    await POST(signedReq(paidInvoice('ref_other', '2028-09-28T10:00:00.000Z')))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a NEW paid charge after a refund (new reference, later period) → active again (D-02)', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: {
        data: addonRow({ status: 'refunded', last_event_id: 'ref_old', current_period_end: '2027-09-28T10:00:00.000Z' }),
        error: null,
      },
    })
    await POST(signedReq(paidInvoice('ref_new', '2028-09-28T10:00:00.000Z')))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({
      status: 'active',
      current_period_end: '2028-09-28T10:00:00.000Z',
      last_event_id: 'ref_new',
      refunded_at: null,
    })
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'oas-1'], ['eq', 'status', 'refunded']]))
  })

  it('a stale paid invoice on a CANCELLED row leaves it cancelled', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: {
        data: addonRow({ status: 'cancelled', current_period_end: '2027-09-28T10:00:00.000Z' }),
        error: null,
      },
    })
    await POST(signedReq(paidInvoice('ref_stale', '2027-01-01T00:00:00.000Z')))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a paid invoice for a NEW future period reactivates a cancelled row (a resubscribe)', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: {
        data: addonRow({ status: 'cancelled', current_period_end: '2020-01-01T00:00:00.000Z' }),
        error: null,
      },
    })
    await POST(signedReq(paidInvoice('ref_new', '2099-01-01T00:00:00.000Z')))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({
      status: 'active',
      current_period_end: '2099-01-01T00:00:00.000Z',
      cancelled_at: null,
    })
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'oas-1'], ['eq', 'status', 'cancelled']]))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review fixes (Phase 1B code + spec reviews)
// ─────────────────────────────────────────────────────────────────────────────

describe('org add-on — review: a foreign Paystack subscription never re-binds or moves the row (I-1)', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  /** Code lookup misses; the customer + Solar-plan fallback finds the row bound to SUB_solar. */
  const boundRowByCustomer = {
    [`${ADDON}.select`]: (ctx: any) =>
      ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
        ? { data: addonRow({ paystack_subscription_code: 'SUB_solar', current_period_end: '2099-01-01T00:00:00.000Z' }), error: null }
        : { data: null, error: null },
    'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
  }

  it('subscription.create for a DIFFERENT subscription does not overwrite the bound code', async () => {
    serviceClientRef.value = makeClient(boundRowByCustomer)
    const res = await POST(signedReq({
      event: 'subscription.create',
      data: {
        subscription_code: 'SUB_dup',
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        next_payment_date: '2100-01-01T00:00:00.000Z',
      },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('subscription.create binds only a row whose code is still null (guarded in the UPDATE too)', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: addonRow({ paystack_subscription_code: null }), error: null }
          : { data: null, error: null },
    })
    await POST(signedReq({
      event: 'subscription.create',
      data: { subscription_code: 'SUB_new', customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([['or', 'paystack_subscription_code.is.null,paystack_subscription_code.eq.SUB_new', undefined]]),
    )
  })

  it.each(['subscription.disable', 'subscription.not_renew'])(
    '%s of the DUPLICATE subscription leaves the live row alone',
    async (ev) => {
      serviceClientRef.value = makeClient(boundRowByCustomer)
      const res = await POST(signedReq({
        event: ev,
        data: { subscription_code: 'SUB_dup', customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
      }))
      expect(res.status).toBe(200)
      expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    },
  )

  it('a renewal charge from a superseded/duplicate subscription is booked as a DUPLICATE, not absorbed (I-2)', async () => {
    serviceClientRef.value = makeClient(boundRowByCustomer)
    const res = await POST(signedReq({
      event: 'charge.success',
      data: {
        reference: 'ref_old_sub',
        amount: 199900,
        currency: 'ZAR',
        paid_at: '2027-09-28T09:59:00.000Z',
        metadata: 0,
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        subscription: { subscription_code: 'SUB_old' },
      },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.duplicate',
    )
    const note = serviceClientRef.value.of('public.notifications.insert')
    expect(note).toHaveLength(1)
    expect(note[0].payload[0].body).toMatch(/SUB_old/)
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/DUPLICATE/)
  })
})

describe('org add-on — review: one Paystack customer, two orgs (I-3)', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  it('subscription.create with an ambiguous customer binds the single still-unbound row', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) => {
        if (ctx.filters.some((f: any) => f[0] === 'is' && f[1] === 'paystack_subscription_code')) {
          return { data: addonRow({ id: 'oas-2', organisation_id: 'org-2', paystack_subscription_code: null }), error: null }
        }
        if (ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')) {
          return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
        }
        return { data: null, error: null }
      },
    })
    await POST(signedReq({
      event: 'subscription.create',
      data: { subscription_code: 'SUB_org2', customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ paystack_subscription_code: 'SUB_org2' })
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'oas-2']]))
  })

  it('an ambiguous RENEWAL is never guessed onto either org', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
          : { data: null, error: null },
    })
    const res = await POST(signedReq({
      event: 'charge.success',
      data: {
        reference: 'ref_amb', amount: 199900, currency: 'ZAR', metadata: 0,
        customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN },
      },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.unmatched',
    )
  })
})

describe('org add-on — review: a first charge must be for the Solar plan, in ZAR (I-4)', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  function firstCharge(over: Record<string, unknown>) {
    const ev = solarFirstCharge()
    return { ...ev, data: { ...ev.data, ...over } }
  }

  it('an R1 charge on another plan carrying Solar metadata grants nothing and is logged', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    const res = await POST(signedReq(firstCharge({ amount: 100, plan: { plan_code: 'PLN_other' } })))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.unmatched',
    )
  })

  it('a non-ZAR charge grants nothing', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    await POST(signedReq(firstCharge({ currency: 'USD' })))
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
  })

  it('a full-price ZAR charge whose payload omits the plan still grants', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    await POST(signedReq(firstCharge({ plan: undefined })))
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(1)
  })
})

describe('org add-on — review: past_due and non_renewing transitions (minors)', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  it('disable on a PAST_DUE row goes to cancelled, never back to live non_renewing', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ status: 'past_due', current_period_end: '2099-01-01T00:00:00.000Z' }), error: null },
    })
    await POST(signedReq({
      event: 'subscription.disable',
      data: { subscription_code: 'SUB_solar', customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.status).toBe('cancelled')
  })

  it('a renewal charge.success reviving a refunded row clears refunded_at', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: {
        data: addonRow({ status: 'refunded', last_event_id: 'ref_old', current_period_end: '2027-09-28T10:00:00.000Z' }),
        error: null,
      },
    })
    await POST(signedReq({
      event: 'charge.success',
      data: {
        reference: 'ref_renew_x', amount: 199900, currency: 'ZAR', paid_at: '2027-09-28T09:59:00.000Z', metadata: 0,
        customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN },
        subscription: { subscription_code: 'SUB_solar' },
      },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ status: 'active', refunded_at: null, cancelled_at: null })
  })
})

describe('org add-on — re-review: ended bindings and repeated disables (N-1, N-2)', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  it('disable on a NON_RENEWING row mid-period (re-delivery, or end-of-term disable) leaves it non_renewing', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: {
        data: addonRow({ status: 'non_renewing', current_period_end: '2099-01-01T00:00:00.000Z' }),
        error: null,
      },
    })
    const res = await POST(signedReq({
      event: 'subscription.disable',
      data: { subscription_code: 'SUB_solar', customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  /** Row bound to SUB_A, which has ENDED; found by customer + plan for an event naming SUB_B. */
  const endedBinding = {
    [`${ADDON}.select`]: (ctx: any) =>
      ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
        ? {
            data: addonRow({ status: 'cancelled', paystack_subscription_code: 'SUB_A', current_period_end: '2020-01-01T00:00:00.000Z' }),
            error: null,
          }
        : { data: null, error: null },
    'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
  }

  it('after the bound subscription ended, a renewal from the surviving subscription restores Solar and rebinds', async () => {
    serviceClientRef.value = makeClient(endedBinding)
    await POST(signedReq({
      event: 'charge.success',
      data: {
        reference: 'ref_survivor', amount: 199900, currency: 'ZAR', paid_at: '2027-09-28T09:59:00.000Z', metadata: 0,
        customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN },
        subscription: { subscription_code: 'SUB_B' },
      },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ status: 'active', paystack_subscription_code: 'SUB_B', last_event_id: 'ref_survivor' })
    expect(serviceClientRef.value.of('public.notifications.insert')).toHaveLength(0)
    expect(recordInvoiceMock.mock.calls[0][2].description).not.toMatch(/DUPLICATE/)
  })

  it('subscription.create of the surviving subscription takes over an ENDED binding (optimistic guard on the old code)', async () => {
    serviceClientRef.value = makeClient(endedBinding)
    await POST(signedReq({
      event: 'subscription.create',
      data: { subscription_code: 'SUB_B', customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ paystack_subscription_code: 'SUB_B' })
    expect(upd[0].payload).not.toHaveProperty('status')
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'paystack_subscription_code', 'SUB_A']]))
  })
})
