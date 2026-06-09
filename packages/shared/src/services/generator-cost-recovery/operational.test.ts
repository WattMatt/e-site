import { describe, it, expect } from 'vitest'
import { calculateOperationalTariff } from './operational'
import { DEFAULT_GENERATOR_SETTINGS } from './defaults'

describe('calculateOperationalTariff', () => {
  it('diesel + maintenance + contingency tariff', () => {
    // Nexus maths (generatorReportPdfBuilder.ts buildAppendixB), largest gen 250 kVA @ 75%
    // → netKva 187.5, netKwh 178.125.
    // diesel: dieselCostPerHour = 50 l/h (injected) × R23 = 1150 → /178.125 = 6.4561 R/kWh
    //         (nexus does NOT multiply by running hours for the per-kWh figure)
    // maint:  maintMonthly = 18800/12 = 1566.667; serviceCostPer250h = 18800 (annual used directly);
    //         costServicePerMonth = (100/250)×18800 = 7520; additional = 7520−1566.667 = 5953.333 (no max(0));
    //         perKwh = 5953.333/(178.125×100) = 0.33422 R/kWh
    // base 6.79036 ; +10% contingency 0.67904 ; final 7.46940
    const r = calculateOperationalTariff(DEFAULT_GENERATOR_SETTINGS, { kva: 250, fuelConsumptionLPerH: 50 })
    expect(r.dieselPerKwh).toBeCloseTo(6.4561, 3)
    expect(r.maintenancePerKwh).toBeCloseTo(0.33422, 4)
    expect(r.finalTariff).toBeCloseTo(7.46940, 3)
  })

  it('zero netKwh → no divide-by-zero', () => {
    const r = calculateOperationalTariff(DEFAULT_GENERATOR_SETTINGS, { kva: 0, fuelConsumptionLPerH: 50 })
    expect(r.finalTariff).toBe(0)
  })
})
