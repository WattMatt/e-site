import { describe, it, expect } from 'vitest'
import { makeCharge, makeTariff } from '@esite/shared'
import { computeYearChecks } from './year-checks'

const t = (amount: number, name = 'Commercial') =>
  makeTariff({ name, structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: amount })] })

describe('computeYearChecks', () => {
  it('runs the validators and counts by severity', () => {
    const c = computeYearChecks([makeTariff({ name: 'Empty', structure: 'flat', charges: [] })], null, null)
    expect(c.blocking).toBe(1)
    expect(c.issues[0].code).toBe('empty_tariff')
    expect(c.yoy).toBeNull()
  })
  it('adds the YoY diff against the previous published year', () => {
    const c = computeYearChecks([t(300)], [t(250)], 10)
    expect(c.yoy?.changed).toHaveLength(1)
    expect(c.yoy?.changed[0].changePct).toBe(20)
    expect(c.issues.map((i) => i.code)).toContain('yoy_out_of_band')
    expect(c.review).toBe(1)
    expect(c.blocking).toBe(0)
  })
})
