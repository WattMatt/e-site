// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { addBillingPeriod } from './billing-period'

/**
 * The value this produces is written to billing.subscriptions.next_billing_date
 * (a DATE column) and is the ONLY thing the nightly downgrade job compares
 * against. A wrong value here silently gives away or takes away a paid period.
 */

describe('addBillingPeriod', () => {
  it('adds one month by default', () => {
    expect(addBillingPeriod('2026-09-11T08:00:00.000Z', 'monthly')).toBe('2026-10-11')
  })

  it('adds one year for annual', () => {
    expect(addBillingPeriod('2026-09-11T08:00:00.000Z', 'annual')).toBe('2027-09-11')
  })

  it('rolls the year over at December', () => {
    expect(addBillingPeriod('2026-12-15T00:00:00.000Z', 'monthly')).toBe('2027-01-15')
  })

  it.each([
    // The naive `setUTCMonth(m + 1)` overflows these into the FOLLOWING month,
    // handing the customer 2-3 extra days of paid tier every cycle.
    ['2026-01-31T00:00:00.000Z', '2026-02-28'],
    ['2028-01-31T00:00:00.000Z', '2028-02-29'], // leap year
    ['2026-03-31T00:00:00.000Z', '2026-04-30'],
    ['2026-05-31T00:00:00.000Z', '2026-06-30'],
    ['2026-08-31T00:00:00.000Z', '2026-09-30'],
  ])('clamps %s to the last valid day of the next month (%s)', (from, expected) => {
    expect(addBillingPeriod(from, 'monthly')).toBe(expected)
  })

  it('clamps 29 February + 1 year to 28 February', () => {
    expect(addBillingPeriod('2028-02-29T00:00:00.000Z', 'annual')).toBe('2029-02-28')
  })

  it('emits a bare YYYY-MM-DD, because the column is a DATE', () => {
    expect(addBillingPeriod('2026-09-11T23:59:59.999Z', 'monthly')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each([undefined, null, '', 'not-a-date'])(
    'falls back to now rather than emitting Invalid Date for %o',
    (bad) => {
      const out = addBillingPeriod(bad as string | undefined, 'monthly')
      expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(out).not.toContain('NaN')
      // And it must be in the future — a past date would make the nightly job
      // downgrade a customer who has just paid.
      expect(out > new Date().toISOString().slice(0, 10)).toBe(true)
    },
  )

  it('treats any unknown period as monthly rather than throwing', () => {
    expect(addBillingPeriod('2026-09-11T00:00:00.000Z', 'weekly')).toBe('2026-10-11')
  })
})
