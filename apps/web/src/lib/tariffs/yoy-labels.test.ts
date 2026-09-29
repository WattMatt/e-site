import { describe, it, expect } from 'vitest'
import { chargeKey, makeCharge, makeTariff } from '@esite/shared'
import { describeChargeKeys } from './yoy-labels'

describe('describeChargeKeys', () => {
  it('names a diff key by tariff name and component in words, with season, period and block when they narrow it', () => {
    const t = makeTariff({ name: 'Business Rate 1', structure: 'tou', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250, season: 'high', tou: 'peak' }),
      makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 400 }),
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, blockMinKwh: 600 }),
    ] })
    const keys = t.charges.map((c) => chargeKey(t, c))
    expect(describeChargeKeys([t], keys)).toEqual([
      'Business Rate 1 — Energy (High demand (winter), Peak)',
      'Business Rate 1 — Basic charge',
      'Business Rate 1 — Energy (from 600 kWh)',
    ])
    expect(keys.every((k) => k.includes('|'))).toBe(true)
  })
  it('a key it cannot find is shown as "Unknown charge", never the raw key', () => {
    expect(describeChargeKeys([], ['x|energy|all|all|-'])).toEqual(['Unknown charge'])
  })
})
