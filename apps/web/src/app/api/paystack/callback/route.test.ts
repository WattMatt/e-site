// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/paystack/callback is a browser navigation back from Paystack that
 * writes billing.subscriptions with the SERVICE client (RLS bypassed).
 *
 * Two properties are pinned here, both of which were absent in production:
 *
 *  1. AUTHORISATION. The org id is read out of the *transaction's* metadata,
 *     not out of the caller's session, so without a gate any member of any
 *     org — contractor, client_viewer, or a complete stranger who has seen a
 *     reference — could GET this route and rewrite that org's subscription
 *     tier. billing.invoices is PostgREST-exposed and its SELECT policy was
 *     role-blind, so a contractor could read the references to replay.
 *
 *  2. REPLAY. recordInvoice is idempotent on paystack_reference, but
 *     upsertSubscription is NOT. An owner replaying their own paid reference
 *     flips a cancelled/past_due subscription back to `active` with no new
 *     charge and no new invoice row — the only trace is subscriptions.updated_at.
 *
 * The assertions deliberately check that the WRITE never happened, not just
 * that the redirect looked right: a redirect assertion alone would still pass
 * if the upsert ran before the redirect.
 */

const {
  getUserMock,
  membershipResult,
  existingInvoiceResult,
  upsertSubscriptionMock,
  recordInvoiceMock,
  fetchMock,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'
  return {
    getUserMock: vi.fn(),
    membershipResult: { value: { data: null as any, error: null as any } },
    existingInvoiceResult: { value: { data: null as any, error: null as any } },
    upsertSubscriptionMock: vi.fn(),
    recordInvoiceMock: vi.fn(),
    fetchMock: vi.fn(),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  // User-scoped client: only ever asked for the caller's membership row.
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve(membershipResult.value) }),
          }),
        }),
      }),
    }),
  }),
  // Service client: RLS-bypassing. Used for the replay lookup + the writes.
  createServiceClient: () => ({
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve(existingInvoiceResult.value) }),
        }),
      }),
    }),
  }),
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

import { GET } from './route'

const ORG_ID = 'dddddddd-0000-0000-0000-000000000001'
const REFERENCE = 'fdgyux6ite'

function req(reference = REFERENCE) {
  return {
    url: `https://www.e-site.live/api/paystack/callback?reference=${reference}`,
  } as unknown as Parameters<typeof GET>[0]
}

/** A genuine Paystack `transaction/verify` success body for a subscription charge. */
function paystackSuccess(metadata?: Record<string, unknown>, extra?: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      status: true,
      data: {
        status: 'success',
        amount: 49900,
        reference: REFERENCE,
        paid_at: '2026-09-11T08:00:00.000Z',
        customer: { customer_code: 'CUS_x' },
        metadata: metadata ?? {
          org_id: ORG_ID,
          tier: 'starter',
          period: 'monthly',
          amount_kobo: 49900,
          mode: 'one_off',
        },
        ...extra,
      },
    }),
  }
}

function location(res: Response): string {
  return res.headers.get('location') ?? ''
}

beforeEach(() => {
  getUserMock.mockReset()
  upsertSubscriptionMock.mockReset()
  recordInvoiceMock.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(paystackSuccess())
  // Default: an owner of the org named in the transaction metadata.
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-owner' } }, error: null })
  membershipResult.value = { data: { role: 'owner' }, error: null }
  existingInvoiceResult.value = { data: null, error: null }
  upsertSubscriptionMock.mockResolvedValue({})
  recordInvoiceMock.mockResolvedValue({})
})

describe('GET /api/paystack/callback — authorisation', () => {
  it('grants the plan for an owner of the org named in the transaction metadata', async () => {
    const res = await GET(req())
    expect(location(res)).toContain('/settings/billing?success=1')
    expect(upsertSubscriptionMock).toHaveBeenCalledTimes(1)
    expect(upsertSubscriptionMock.mock.calls[0][1]).toBe(ORG_ID)
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
  })

  it('grants the plan for an admin', async () => {
    membershipResult.value = { data: { role: 'admin' }, error: null }
    const res = await GET(req())
    expect(location(res)).toContain('success=1')
    expect(upsertSubscriptionMock).toHaveBeenCalledTimes(1)
  })

  it('redirects a contractor of the same org to ?error=forbidden and writes nothing', async () => {
    membershipResult.value = { data: { role: 'contractor' }, error: null }
    const res = await GET(req())
    expect(location(res)).toContain('/settings/billing?error=forbidden')
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('redirects a client_viewer of the same org to ?error=forbidden and writes nothing', async () => {
    membershipResult.value = { data: { role: 'client_viewer' }, error: null }
    const res = await GET(req())
    expect(location(res)).toContain('error=forbidden')
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
  })

  it('redirects a project_manager to ?error=forbidden — billing is owner/admin only', async () => {
    membershipResult.value = { data: { role: 'project_manager' }, error: null }
    const res = await GET(req())
    expect(location(res)).toContain('error=forbidden')
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
  })

  it('redirects a non-member of the org in the metadata and writes nothing', async () => {
    // Authenticated, but holds no active membership of the org being paid for.
    membershipResult.value = { data: null, error: null }
    const res = await GET(req())
    expect(location(res)).toContain('error=forbidden')
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated caller and writes nothing', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await GET(req())
    expect(location(res)).toContain('error=forbidden')
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('never returns a JSON 403 — this is a browser navigation back from Paystack', async () => {
    membershipResult.value = { data: { role: 'contractor' }, error: null }
    const res = await GET(req())
    // Pinned together: refusing must be a redirect to the billing page, not
    // requireRoleAPI's JSON 403 (which would render as a blank page to a user
    // arriving from Paystack's hosted checkout).
    expect(location(res)).toContain('/settings/billing?error=forbidden')
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('content-type') ?? '').not.toContain('application/json')
  })
})

describe('GET /api/paystack/callback — replay guard', () => {
  it('does not re-write the subscription when the reference is already invoiced', async () => {
    // The owner (or the webhook) already recorded this reference. Replaying it
    // must not flip a cancelled/past_due subscription back to active.
    existingInvoiceResult.value = { data: { id: 'inv-1' }, error: null }
    const res = await GET(req())
    expect(location(res)).toContain('success=1')
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('still writes when the reference has never been invoiced', async () => {
    existingInvoiceResult.value = { data: null, error: null }
    await GET(req())
    expect(upsertSubscriptionMock).toHaveBeenCalledTimes(1)
  })

  it('checks authorisation before the replay lookup — a stranger sees forbidden, not success', async () => {
    membershipResult.value = { data: null, error: null }
    existingInvoiceResult.value = { data: { id: 'inv-1' }, error: null }
    const res = await GET(req())
    expect(location(res)).toContain('error=forbidden')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #18 — every non-subscription purchase dead-ended on ?error=meta
// ─────────────────────────────────────────────────────────────────────────────
//
// All four purchase routes pass the same callback_url, but this route
// destructured { org_id, tier } and bailed unless BOTH were present.
// feature_unlock / feature_seat / mv_subscription metadata carry no `tier`
// (mv carries no org_id either), so a customer who had just paid R250, R1,999
// or R2,000 was redirected to /settings/billing?error=meta — a page that never
// read searchParams, so it did not even render the error. Prod has 0 unlocks,
// 0 seats and 0 MV subscriptions, so this has never had a chance to bite.
//
// The assertions check the *destination*, not just "not error=meta": a fix
// that merely swapped the error code would still strand the payer.

describe('GET /api/paystack/callback — non-subscription purchases (#18)', () => {
  function purchase(metadata: Record<string, unknown>) {
    fetchMock.mockResolvedValue(paystackSuccess(metadata))
    return GET(req())
  }

  it('returns a feature-unlock buyer to the path the purchase route chose', async () => {
    const res = await purchase({
      type: 'feature_unlock',
      org_id: ORG_ID,
      feature_key: 'jbcc',
      return_to: '/projects/p1/jbcc',
    })
    expect(location(res)).toContain('/projects/p1/jbcc')
    expect(location(res)).not.toContain('error=meta')
  })

  it('acknowledges the payment on the destination so the buyer sees confirmation', async () => {
    const res = await purchase({
      type: 'feature_unlock',
      org_id: ORG_ID,
      feature_key: 'inspections',
      return_to: '/inspections',
    })
    expect(location(res)).toMatch(/[?&]payment=received/)
  })

  it('returns a seat buyer to their own return_to', async () => {
    const res = await purchase({
      type: 'feature_seat',
      org_id: ORG_ID,
      user_id: 'u-1',
      feature_key: 'generator_cost_recovery',
      return_to: '/projects/p1/generator-cost-recovery',
    })
    expect(location(res)).toContain('/projects/p1/generator-cost-recovery')
  })

  it('returns an MV subscriber to a page their role can actually see', async () => {
    // mv_subscribe applies no role gate, so the buyer may be a contractor or
    // inspector — /settings/billing is requireRolePage(OWNER_ADMIN) and would
    // bounce them a second time, to /dashboard, with no evidence of payment.
    const res = await purchase({ type: 'mv_subscription', user_id: 'u-1', return_to: '/dashboard' })
    expect(location(res)).toContain('/dashboard')
    expect(location(res)).not.toContain('/settings/billing')
  })

  it('does NOT write entitlements from the callback — the webhook is the sole writer', async () => {
    await purchase({ type: 'feature_unlock', org_id: ORG_ID, feature_key: 'jbcc', return_to: '/x' })
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })

  it('branches on metadata.type BEFORE the org_id/tier gate', async () => {
    // mv_subscription metadata has no org_id at all — under the old ordering
    // this was the guaranteed ?error=meta case.
    const res = await purchase({ type: 'mv_subscription', user_id: 'u-1' })
    expect(location(res)).not.toContain('error=meta')
  })

  it('still reports ?error=meta for metadata that names no purchase at all', async () => {
    const res = await purchase({ something: 'else' })
    expect(location(res)).toContain('error=meta')
  })

  it('keeps the subscription flow working — checkout sets no metadata.type', async () => {
    const res = await GET(req())
    expect(location(res)).toContain('success=1')
    expect(upsertSubscriptionMock).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/paystack/callback — return_to cannot leave the origin (#18)', () => {
  it.each([
    '//evil.test/pwn',
    'https://evil.test',
    'javascript:alert(1)',
    '\\\\evil.test',
  ])('refuses to redirect off-site for %s', async (hostile) => {
    fetchMock.mockResolvedValue(
      paystackSuccess({ type: 'feature_unlock', org_id: ORG_ID, feature_key: 'jbcc', return_to: hostile }),
    )
    const res = await GET(req())
    // The property that matters: whatever is emitted stays on this origin.
    expect(new URL(location(res)).origin).toBe('https://www.e-site.live')
    expect(location(res)).not.toContain('evil.test')
  })

  it('falls back to the billing page rather than dropping the payer nowhere', async () => {
    fetchMock.mockResolvedValue(
      paystackSuccess({ type: 'feature_unlock', org_id: ORG_ID, feature_key: 'jbcc', return_to: '//evil.test' }),
    )
    const res = await GET(req())
    expect(location(res)).toContain('/settings/billing')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #19 — a one-off paid tier was permanent
// ─────────────────────────────────────────────────────────────────────────────
//
// downgradeExpiredCancellations filters .lt('next_billing_date', today). In
// one-off mode — the only mode exercised in production — nothing ever wrote
// next_billing_date, so it stayed NULL, `NULL < today` is NULL, the row was
// never selected, and a cancelled customer kept their tier forever. Verified
// on prod: both billing.subscriptions rows have next_billing_date NULL,
// including the one with three paid invoices.

describe('GET /api/paystack/callback — the paid period gets an end date (#19)', () => {
  it('stamps next_billing_date one month out for a monthly charge', async () => {
    await GET(req())
    expect(upsertSubscriptionMock.mock.calls[0][2].nextBillingDate).toBe('2026-10-11')
  })

  it('stamps next_billing_date one year out for an annual charge', async () => {
    fetchMock.mockResolvedValue(
      paystackSuccess({ org_id: ORG_ID, tier: 'professional', period: 'annual', amount_kobo: 1499000 }),
    )
    await GET(req())
    expect(upsertSubscriptionMock.mock.calls[0][2].nextBillingDate).toBe('2027-09-11')
  })

  it('never leaves it undefined — a NULL is invisible to the downgrade job', async () => {
    fetchMock.mockResolvedValue(paystackSuccess({ org_id: ORG_ID, tier: 'starter' }))
    await GET(req())
    expect(upsertSubscriptionMock.mock.calls[0][2].nextBillingDate).toBeTruthy()
  })
})
