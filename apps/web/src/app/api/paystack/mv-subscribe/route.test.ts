// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/paystack/mv-subscribe records disclaimer acceptance, then hands the user
 * to Paystack's hosted page for the recurring MV plan.
 *
 * The property pinned here is one the route's OWN COMMENT already claimed and
 * the code did not do. The comment said:
 *
 *   "…so only set status='pending' when there is no row yet — never downgrade
 *    an active one."
 *
 * while the upsert sent `status: 'pending'` unconditionally. PostgREST's
 * merge-duplicates writes EVERY supplied column on conflict, so an existing
 * subscriber who pressed Subscribe a second time had their stored status
 * rewritten from 'active' back to 'pending' — and `current_period_end` was
 * left untouched, so nothing ever repaired it. Paystack, meanwhile, keeps
 * billing the plan. Access revoked, money still taken.
 *
 * The fix is to omit `status` entirely: `billing.user_mv_subscriptions.status`
 * is NOT NULL DEFAULT 'pending', so a genuinely new row still lands as
 * 'pending' from the column default, and an existing row keeps whatever the
 * webhook last set.
 *
 * ⚠ FIXTURE NOTE — this is the whole reason the test can fail.
 * The stored row below is seeded `status: 'active'`. Seeding it 'pending' (the
 * obvious choice, and what the buggy code writes) would make the assertion
 * vacuous: writing 'pending' over 'pending' is invisible, so the test would
 * pass with the bug present and prove nothing. Ask of any fixture what it
 * would have to look like for the test to be ABLE to fail.
 */

const { getUserMock, upsertSpy, fetchMock } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'
  process.env.PAYSTACK_PLAN_MV_ANNUAL = 'PLN_mv_annual'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.e-site.live'
  return {
    getUserMock: vi.fn(),
    upsertSpy: vi.fn(),
    fetchMock: vi.fn(),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
  createServiceClient: () => ({
    schema: () => ({
      from: () => ({
        upsert: (payload: unknown, opts: unknown) => {
          upsertSpy(payload, opts)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { POST } from './route'

const USER_ID = '11111111-1111-1111-1111-111111111111'

/**
 * The row already in the database for this user. `active` is deliberate — see
 * the FIXTURE NOTE above.
 */
const STORED_ROW = {
  user_id: USER_ID,
  status: 'active',
  current_period_end: '2027-01-01T00:00:00.000Z',
}

/** Apply a PostgREST merge-duplicates upsert to the stored row, as Postgres would. */
function applyUpsert(stored: Record<string, unknown>, payload: Record<string, unknown>) {
  // ON CONFLICT DO UPDATE SET <every supplied column>. Columns absent from the
  // payload are not in the SET list and keep their stored value.
  return { ...stored, ...payload }
}

function req() {
  return new Request('https://www.e-site.live/api/paystack/mv-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID, email: 'a@b.co' } } })
  fetchMock.mockResolvedValue({
    json: async () => ({ status: true, data: { authorization_url: 'https://paystack/x' } }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('/api/paystack/mv-subscribe — acceptance upsert', () => {
  it('does not send status, so an active subscription is never downgraded', async () => {
    await POST(req())

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [payload] = upsertSpy.mock.calls[0] as [Record<string, unknown>, unknown]

    // The guard. With `status: 'pending'` in the payload this fails.
    expect(payload).not.toHaveProperty('status')

    // And the consequence it exists to prevent, spelled out against the row
    // that is actually in the table.
    const after = applyUpsert(STORED_ROW, payload)
    expect(after.status).toBe('active')
  })

  it('still records the disclaimer acceptance and targets the right conflict key', async () => {
    await POST(req())

    const [payload, opts] = upsertSpy.mock.calls[0] as [Record<string, unknown>, any]
    expect(payload.user_id).toBe(USER_ID)
    expect(typeof payload.disclaimer_accepted_at).toBe('string')
    expect(Number.isNaN(Date.parse(payload.disclaimer_accepted_at as string))).toBe(false)

    // Omitting status must not turn the upsert into an insert-only call: an
    // existing row still has to be matched, or every re-press would 409.
    expect(opts.onConflict).toBe('user_id')
    expect(opts.ignoreDuplicates).toBe(false)
  })

  it('leaves the billing period alone — the webhook owns it', async () => {
    await POST(req())

    const [payload] = upsertSpy.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(payload).not.toHaveProperty('current_period_end')

    const after = applyUpsert(STORED_ROW, payload)
    expect(after.current_period_end).toBe('2027-01-01T00:00:00.000Z')
  })
})
