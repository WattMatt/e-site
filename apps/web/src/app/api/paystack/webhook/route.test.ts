// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
