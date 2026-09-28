import { describe, it, expect } from 'vitest'
import { loadWeather } from '../../services/solar/__fixtures__/pvgis'
import { stubBillCalculator } from '../../services/solar/__fixtures__/stub-bill-calculator'
import { runFinancials, simulateCase } from '../../services/solar/case'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig } from './config'
import { buildCaseInput } from './build-input'
import { defaultFinanceConfig } from './finance-config'
import { buildFinanceInput } from './finance-input'
import { decodeHourlyCsv, encodeHourlyCsv, hourlyFromResult } from './hourly-csv'
import { runStoredFinancials } from './stored-financials'

function scenario(battery: boolean) {
  const s = solarOrgSettingDefaults()
  const c0 = defaultCaseConfig(s, { dcKwp: 300, acKw: 250 })
  const c = { ...c0,
    pv: { ...c0.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } },
    weather: { source: 'pvgis_tmy' as const, datasetId: '22222222-2222-4222-8222-222222222222' },
    battery: battery ? { ...c0.battery, enabled: true, usableKwh: 200, maxChargeKw: 100, maxDischargeKw: 100 } : c0.battery,
  }
  const load = Array.from({ length: 8760 }, (_, h) => 120 + 80 * Math.sin(((h % 24) - 6) / 24 * 2 * Math.PI))
  const b = buildCaseInput({ config: c, study: { exportMode: 'net_billing', exportLimitKw: null }, siteLoad: { series: load, basis: 'S1', referenceYear: 2025 }, touPeriods: null })
  if (!b.ok) throw new Error(b.reasons.join('; '))
  const result = simulateCase(b.input, { id: b.input.weatherDatasetId, year: loadWeather('jhb') })
  const fin = buildFinanceInput({ ...defaultFinanceConfig(s), capex: [{ id: 'a', category: 'modules', description: 'PV', qty: 300_000, unit: 'Wp', rateZar: 11, qualifies12b: true, source: 'manual' }] }, c, { dcKwp: 300, acKw: 250 })
  if (!fin.ok) throw new Error(fin.reasons.join('; '))
  return { result, fin: fin.input }
}

describe('runStoredFinancials', () => {
  for (const battery of [false, true]) {
    it(`equals runFinancials exactly on the in-memory series (battery ${battery})`, () => {
      const { result, fin } = scenario(battery)
      const calc = stubBillCalculator
      const direct = runFinancials(result, fin, calc)
      const stored = runStoredFinancials({ hourly: hourlyFromResult(result), year1PvKwh: result.pv.annual.acKwh, year1DeliveredKwh: result.balance.kpis.pvKwh - result.balance.kpis.curtailKwh }, fin, calc)
      expect(stored).toEqual(direct)
    })
  }

  it('after a CSV round trip (4 d.p.) NPV and IRR agree to 1e-6 relative', () => {
    const { result, fin } = scenario(true)
    const calc = stubBillCalculator
    const direct = runFinancials(result, fin, calc)
    const hourly = decodeHourlyCsv(encodeHourlyCsv(hourlyFromResult(result)))
    const stored = runStoredFinancials({ hourly, year1PvKwh: result.pv.annual.acKwh, year1DeliveredKwh: result.balance.kpis.pvKwh - result.balance.kpis.curtailKwh }, fin, calc)
    const a = direct.finance.models[0]!.views[0]!, b = stored.finance.models[0]!.views[0]!
    expect(Math.abs(b.npvZar - a.npvZar) / Math.abs(a.npvZar)).toBeLessThan(1e-6)
    expect(b.irr! - a.irr!).toBeCloseTo(0, 6)
  })
})
