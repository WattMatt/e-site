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

  it('clamps maintenance at zero when running hours are very low (WM "2 clamp")', () => {
    // 10 h/mo: costServicePerMonth = (10/250)×18800 = 752; maintMonthly = 18800/12 = 1566.667.
    // Un-clamped additional = 752 − 1566.667 = −814.667 → negative. WM clamp forces it to 0,
    // so maintenancePerKwh must be 0 (maintenance never reduces the tariff). Tariff = diesel only.
    const s = { ...DEFAULT_GENERATOR_SETTINGS, runningHoursPerMonth: 10 }
    const r = calculateOperationalTariff(s, { kva: 250, fuelConsumptionLPerH: 50 })
    expect(r.maintenancePerKwh).toBe(0)
    expect(r.maintenancePerKwh).toBeGreaterThanOrEqual(0)
    expect(r.finalTariff).toBeGreaterThan(0) // diesel still applies
  })
})
