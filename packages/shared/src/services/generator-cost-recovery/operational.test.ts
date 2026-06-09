import { describe, it, expect } from 'vitest'
import { calculateOperationalTariff } from './operational'
import { DEFAULT_GENERATOR_SETTINGS } from './defaults'

describe('calculateOperationalTariff', () => {
  it('diesel + maintenance + contingency tariff', () => {
    // largest gen 250 kVA, load 75% → netKva 187.5, netKwh 178.125
    // diesel: 50 l/h (injected) × R23 × 100h = 115,000/mo → /178.125 = 645.614 R/kWh
    // maint: 18800/12 = 1566.667/mo; serviceCostPer250h = 18800×(100/250/12)=626.667; additional = max(0, 626.667-1566.667)=0
    //        → 1566.667/178.125 = 8.795 R/kWh ; base 654.409 ; +10% contingency 65.441 ; final 719.850
    const r = calculateOperationalTariff(DEFAULT_GENERATOR_SETTINGS, { kva: 250, fuelConsumptionLPerH: 50 })
    expect(r.dieselPerKwh).toBeCloseTo(645.614, 2)
    expect(r.maintenancePerKwh).toBeCloseTo(8.795, 2)
    expect(r.finalTariff).toBeCloseTo(719.850, 2)
  })

  it('zero netKwh → no divide-by-zero', () => {
    const r = calculateOperationalTariff(DEFAULT_GENERATOR_SETTINGS, { kva: 0, fuelConsumptionLPerH: 50 })
    expect(r.finalTariff).toBe(0)
  })
})
