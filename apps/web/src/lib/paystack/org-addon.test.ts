// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  ORG_ADDON_METADATA_TYPE,
  ORG_ADDON_CHARGE_EVENT,
  ORG_ADDON_DUPLICATE_EVENT,
  ORG_ADDON_UNMATCHED_EVENT,
  solarPlanCode,
  planCodeOf,
  subscriptionCodeOf,
  nextAddonPeriodEnd,
} from './org-addon'

describe('constants', () => {
  it('uses the metadata type the spec names', () => {
    expect(ORG_ADDON_METADATA_TYPE).toBe('org_addon_subscription')
  })

  it('keeps the three payment-event types distinct — a refund lookup keys on the first only', () => {
    const all = [ORG_ADDON_CHARGE_EVENT, ORG_ADDON_DUPLICATE_EVENT, ORG_ADDON_UNMATCHED_EVENT]
    expect(new Set(all).size).toBe(3)
    expect(ORG_ADDON_CHARGE_EVENT).toBe('charge.success.org_addon_subscription')
  })
})

describe('solarPlanCode', () => {
  it('reads PAYSTACK_PLAN_SOLAR_ANNUAL, trimmed', () => {
    expect(solarPlanCode({ PAYSTACK_PLAN_SOLAR_ANNUAL: '  PLN_x  ' })).toBe('PLN_x')
  })

  it('is undefined when unset or blank — the route then 503s', () => {
    expect(solarPlanCode({})).toBeUndefined()
    expect(solarPlanCode({ PAYSTACK_PLAN_SOLAR_ANNUAL: '   ' })).toBeUndefined()
  })
})

describe('planCodeOf / subscriptionCodeOf', () => {
  it('reads the plan code from an object, a plan_object, or a bare string', () => {
    expect(planCodeOf({ plan: { plan_code: 'PLN_a' } })).toBe('PLN_a')
    expect(planCodeOf({ plan: {}, plan_object: { plan_code: 'PLN_b' } })).toBe('PLN_b')
    expect(planCodeOf({ plan: 'PLN_c' })).toBe('PLN_c')
    expect(planCodeOf({ plan: '' })).toBeUndefined()
    expect(planCodeOf(null)).toBeUndefined()
  })

  it('reads the subscription code from subscription or plan_object', () => {
    expect(subscriptionCodeOf({ subscription: { subscription_code: 'SUB_a' } })).toBe('SUB_a')
    expect(subscriptionCodeOf({ plan_object: { subscription_code: 'SUB_b' } })).toBe('SUB_b')
    expect(subscriptionCodeOf({})).toBeUndefined()
    expect(subscriptionCodeOf(undefined)).toBeUndefined()
  })
})

describe('nextAddonPeriodEnd', () => {
  it('is paid_at + 1 year when nothing else is known', () => {
    expect(nextAddonPeriodEnd(null, '2026-09-28T10:00:00.000Z')).toBe('2027-09-28T10:00:00.000Z')
  })

  it('prefers Paystack next_payment_date when given', () => {
    expect(
      nextAddonPeriodEnd(null, '2026-09-28T10:00:00.000Z', '2027-10-01T00:00:00.000Z'),
    ).toBe('2027-10-01T00:00:00.000Z')
  })

  it('never shortens a period already paid for — an out-of-order event cannot take time away', () => {
    expect(nextAddonPeriodEnd('2029-01-01T00:00:00.000Z', '2026-09-28T10:00:00.000Z')).toBe(
      '2029-01-01T00:00:00.000Z',
    )
  })

  it('extends past an earlier stored end', () => {
    expect(nextAddonPeriodEnd('2026-12-31T00:00:00.000Z', '2026-12-30T08:00:00.000Z')).toBe(
      '2027-12-30T08:00:00.000Z',
    )
  })

  it('falls back to now + 1 year for an unparseable paid_at', () => {
    const got = new Date(nextAddonPeriodEnd(null, 'not a date'))
    const expected = new Date()
    expected.setUTCFullYear(expected.getUTCFullYear() + 1)
    expect(Math.abs(got.getTime() - expected.getTime())).toBeLessThan(60_000)
  })

  it('ignores an unparseable stored end rather than returning Invalid Date', () => {
    expect(nextAddonPeriodEnd('garbage', '2026-09-28T10:00:00.000Z')).toBe('2027-09-28T10:00:00.000Z')
  })
})
