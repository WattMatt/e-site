// @vitest-environment node
/**
 * cancelSubscriptionAction must cancel the SAME organisation the billing page
 * resolved — finding #29(b) of the 2026-09 payments audit.
 *
 * The shipped action read its org with
 *
 *     .from('user_organisations').select('organisation_id, role')
 *      .eq('user_id', …).eq('is_active', true).limit(1).single()
 *
 * — no `.order()`, so PostgREST returns an ARBITRARY membership row, and the
 * OrgSwitcher's `profiles.active_organisation_id` is ignored entirely. The
 * write that follows runs on the SERVICE client and `disableSubscription` hits
 * Paystack BEFORE the local write, so a multi-org owner genuinely stops the
 * wrong organisation's recurring billing.
 *
 * THE FIXTURE RULE. A single-org fixture cannot express this property: every
 * resolution strategy agrees when there is only one membership, so the test
 * would pass against the broken code. The fixture below is therefore a
 * TWO-org owner whose `active_organisation_id` points at the NEWER org while
 * the membership table lists the older one first — the only shape in which
 * "arbitrary row" and "the org the user is looking at" differ. Adding
 * `.order('created_at')` instead of resolving through getOrgContext (the
 * tempting one-line fix) still targets ORG_OLD and still turns this red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ORG_OLD = '11111111-1111-4111-8111-111111111111'
const ORG_ACTIVE = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

const {
  authUser, profileRow, memberships,
  getSubscriptionMock, disableMock, serviceUpdates,
} = vi.hoisted(() => ({
  authUser: { value: { id: '33333333-3333-4333-8333-333333333333' } as { id: string } | null },
  profileRow: { value: null as { active_organisation_id: string | null } | null },
  memberships: { value: [] as Array<{ organisation_id: string; role: string; is_active: boolean }> },
  getSubscriptionMock: vi.fn(),
  disableMock: vi.fn(),
  serviceUpdates: [] as Array<{ payload: Record<string, unknown>; orgId: string | null }>,
}))

/**
 * Minimal PostgREST-shaped fake. `user_organisations` deliberately honours
 * `.eq('organisation_id', …)` but IGNORES ordering — returning the first
 * matching row exactly as an unordered `.limit(1)` does in production.
 */
function userClient() {
  return {
    auth: { getUser: async () => ({ data: { user: authUser.value }, error: null }) },
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters[col] = val; return builder },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: resolve(), error: null }),
        single: async () => ({ data: resolve(), error: null }),
      }
      function resolve() {
        if (table === 'profiles') return profileRow.value
        if (table === 'user_organisations') {
          const rows = memberships.value.filter((m) =>
            m.is_active &&
            (filters.organisation_id === undefined || m.organisation_id === filters.organisation_id))
          return rows[0] ?? null
        }
        return null
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => userClient(),
  createServiceClient: () => ({
    schema: () => ({
      from: () => {
        let orgId: string | null = null
        let payload: Record<string, unknown> = {}
        const b: any = {
          update: (p: Record<string, unknown>) => { payload = p; return b },
          eq: (_c: string, v: string) => {
            orgId = v
            serviceUpdates.push({ payload, orgId })
            return Promise.resolve({ error: null })
          },
        }
        return b
      },
    }),
  }),
}))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<typeof import('@esite/shared')>('@esite/shared')
  return {
    ...actual,
    billingService: { getSubscription: (...a: unknown[]) => getSubscriptionMock(...a) },
  }
})

vi.mock('@esite/db', () => ({
  getPaystackService: () => ({ disableSubscription: (...a: unknown[]) => disableMock(...a) }),
}))

import { cancelSubscriptionAction } from './billing.actions'

/** Subscription codes differ per org so the Paystack call names its target. */
const SUB_BY_ORG: Record<string, any> = {
  [ORG_OLD]: { tier: 'professional', status: 'active', paystack_subscription_code: 'SUB_OLD' },
  [ORG_ACTIVE]: { tier: 'professional', status: 'active', paystack_subscription_code: 'SUB_ACTIVE' },
}

beforeEach(() => {
  authUser.value = { id: USER_ID }
  // Owner of two orgs. ORG_OLD is the oldest membership and therefore both the
  // arbitrary `.limit(1)` answer and the `.order('created_at')` answer.
  memberships.value = [
    { organisation_id: ORG_OLD, role: 'owner', is_active: true },
    { organisation_id: ORG_ACTIVE, role: 'owner', is_active: true },
  ]
  // …but the OrgSwitcher has the user in ORG_ACTIVE, which is what
  // /settings/billing rendered and what the Cancel button meant.
  profileRow.value = { active_organisation_id: ORG_ACTIVE }
  serviceUpdates.length = 0
  getSubscriptionMock.mockReset()
  getSubscriptionMock.mockImplementation(async (_c: unknown, orgId: string) => SUB_BY_ORG[orgId] ?? null)
  disableMock.mockReset()
  disableMock.mockResolvedValue(undefined)
})

describe('cancelSubscriptionAction — targets the org the user is actually in', () => {
  it('disables the ACTIVE org subscription at Paystack, not the oldest membership', async () => {
    const res = await cancelSubscriptionAction()
    expect(res).toEqual({ ok: true })
    // The wire call to Paystack is the money-moving side effect: it names the org.
    expect(disableMock).toHaveBeenCalledWith('SUB_ACTIVE')
    expect(disableMock).not.toHaveBeenCalledWith('SUB_OLD')
  })

  it('writes cancelled against the ACTIVE org row', async () => {
    await cancelSubscriptionAction()
    expect(serviceUpdates).toHaveLength(1)
    expect(serviceUpdates[0].orgId).toBe(ORG_ACTIVE)
    expect(serviceUpdates[0].payload).toMatchObject({ status: 'cancelled' })
  })

  it('reads the subscription for the ACTIVE org', async () => {
    await cancelSubscriptionAction()
    expect(getSubscriptionMock).toHaveBeenCalledWith(expect.anything(), ORG_ACTIVE)
  })

  it('still fails closed on role — a contractor in the active org cannot cancel', async () => {
    memberships.value = [
      { organisation_id: ORG_OLD, role: 'owner', is_active: true },
      { organisation_id: ORG_ACTIVE, role: 'contractor', is_active: true },
    ]
    const res = await cancelSubscriptionAction()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/owner or admin/i)
    // and nothing was disabled anywhere
    expect(disableMock).not.toHaveBeenCalled()
    expect(serviceUpdates).toHaveLength(0)
  })

  it('falls back to the sole membership when no active org is chosen', async () => {
    profileRow.value = { active_organisation_id: null }
    memberships.value = [{ organisation_id: ORG_OLD, role: 'owner', is_active: true }]
    const res = await cancelSubscriptionAction()
    expect(res).toEqual({ ok: true })
    expect(disableMock).toHaveBeenCalledWith('SUB_OLD')
  })

  it('401-equivalent when unauthenticated, with no Paystack call', async () => {
    authUser.value = null
    const res = await cancelSubscriptionAction()
    expect(res.ok).toBe(false)
    expect(disableMock).not.toHaveBeenCalled()
  })
})
