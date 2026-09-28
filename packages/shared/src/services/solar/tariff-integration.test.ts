/**
 * End to end across the three phase libraries: a 3a site series (flat 50 kW), the 4a engine
 * (100 kWp PV on the committed PVGIS Johannesburg TMY) and a real Eskom Megaflex tariff parsed by
 * 2a from the committed 2025/26 workbook cells, with its Gen-offset export tariff and the NERSA
 * net-billing rule, priced through `tariffBillCalculator` into `runFinancials`.
 *
 * The TOU calendar is SYNTHETIC (Eskom-like windows, not Eskom's published hours) — the parsed
 * workbook carries rates, not hours, and no Eskom calendar constant exists yet.
 */
import { describe, expect, it } from 'vitest'
import { loadWeather } from './__fixtures__/pvgis'
import { runFinancials, simulateCase, type CaseInput } from './case'
import { SOLAR_ENGINE_DEFAULTS } from './defaults'
import type { FinanceInput } from './finance/cashflow'
import { referenceYearHolidays, tariffBillCalculator } from './finance/tariff-bill-calculator'
import { buildS3 } from './load/site-series'
import { caseLoadFromSiteSeries } from './load/case-load'
import { costHourly } from '../../tariffs/bill-calculator'
import { netBillingRule } from '../../tariffs/net-billing-rules'
import type { TouCalendar } from '../../tariffs/tou'
import type { Tariff } from '../../tariffs/types'
import { gridFromFixture, type CellFixture } from '../../tariffs/parsers/grid'
import { parseEskomWorkbook } from '../../tariffs/parsers/eskom-xlsm'
import hf25 from '../../tariffs/__fixtures__/eskom-2025-homeflex.cells.json'
import go25 from '../../tariffs/__fixtures__/eskom-2025-gen-offset.cells.json'
import lf25 from '../../tariffs/__fixtures__/eskom-2025-loss-factors.cells.json'
import br25 from '../../tariffs/__fixtures__/eskom-2025-businessrate.cells.json'
import mf25 from '../../tariffs/__fixtures__/eskom-2025-megaflex.cells.json'

const REFERENCE_YEAR = 2025

const parsed = parseEskomWorkbook(
  [hf25, go25, lf25, br25, mf25].map((f) => gridFromFixture(f as CellFixture)),
  { fileSha256: (hf25 as CellFixture).source.sha256 },
)
const byCode = (code: string): Tariff => {
  const t = parsed.tariffs.find((x) => x.code === code)
  if (!t) throw new Error(`no ${code}`)
  return t
}
const megaflex = byCode('Me01N')
const genOffset = byCode(megaflex.exportTariffCode!)

const w = (season: 'high' | 'low', dayType: 'weekday' | 'saturday', s: number, e: number, period: 'peak' | 'standard') =>
  ({ season, dayType, startMinute: s * 60, endMinute: e * 60, period })
const ESKOM_LIKE: TouCalendar = {
  highSeasonMonths: [6, 7, 8],
  holidayTreatedAs: 'sunday',
  source: 'assumed_eskom',
  windows: (['high', 'low'] as const).flatMap((s) => [
    w(s, 'weekday', 6, 9, 'peak'), w(s, 'weekday', 9, 17, 'standard'), w(s, 'weekday', 17, 19, 'peak'), w(s, 'weekday', 19, 22, 'standard'),
    w(s, 'saturday', 7, 12, 'standard'), w(s, 'saturday', 18, 20, 'standard'),
  ]),
}

const weather = { id: 'pvgis-5.2-tmy:-26.2,28.05', year: loadWeather('jhb') }

// 3a: a flat 50 kW site (one synthesised tenant, no common area) → engine load.
const siteSeries = buildS3({ synths: [new Float64Array(8760).fill(50)], commonAreaPct: 0 })

const input: CaseInput = {
  weatherDatasetId: weather.id,
  pv: {
    arrays: [{
      id: 'roof', kWpDc: 100, tiltDeg: 15, azimuthDeg: 0,
      module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
      cellTemp: { kind: 'noct', noctC: 45 },
      losses: SOLAR_ENGINE_DEFAULTS.losses.dc,
      inverterId: 'inv',
    }],
    inverters: [{ id: 'inv', acRatedKw: 90 }],
    acLosses: SOLAR_ENGINE_DEFAULTS.losses.ac,
    albedo: 0.2,
    transposition: 'perez',
  },
  load: caseLoadFromSiteSeries(siteSeries),
  loadAdjustment: 0,
  battery: null,
  export: { allowed: true, limitKw: 100 },
}

const fin: FinanceInput = {
  kWpDc: 100,
  capex: { totalZar: 1_200_000, inverterZar: 150_000, batteryZar: 0, section12bQualifyingZar: 1_050_000 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 },
  replacements: SOLAR_ENGINE_DEFAULTS.finance.replacements,
  tax: { enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 90 },
  degradation: SOLAR_ENGINE_DEFAULTS.degradation,
  analysis: { years: 25, discountRate: 0.11, cpi: 0.05, escalation: SOLAR_ENGINE_DEFAULTS.finance.escalation, loadGrowth: 0 },
  models: [{ kind: 'cash' }],
  loadShedding: { hoursPerYear: 0, backedLoadKw: 0, valueZarPerKwh: 0 },
}

const costOpts = {
  calendar: ESKOM_LIKE,
  referenceYear: REFERENCE_YEAR,
  exportTariff: genOffset,
  sseg: netBillingRule('eskom'),
  // Notified maximum demand: the utilised-capacity charges need it and hourly kWh cannot give it.
  demandForMonth: () => ({ nmdKva: 60 }),
}

describe('end to end: 3a site load → 4a engine → 2a Megaflex bill → finance', () => {
  const result = simulateCase(input, weather)
  const calc = tariffBillCalculator(megaflex, costOpts)
  const fr = runFinancials(result, fin, calc)

  it('exports at midday (100 kWp over a 50 kW load), so the net-billing path is exercised', () => {
    expect(result.balance.kpis.exportKwh).toBeGreaterThan(1000)
    expect(fr.year1Bills.exportCreditUsedZar).toBeGreaterThan(0)
  })

  it('year-1 bill before solar is larger than after', () => {
    expect(fr.year1Bills.beforeZar).toBeGreaterThan(fr.year1Bills.afterZar)
    // 50 kW x 8760 h = 438 MWh at Megaflex rates (well over R1/kWh all-in) plus fixed charges.
    expect(fr.year1Bills.beforeZar).toBeGreaterThan(438_000)
  })

  it('export credit used never exceeds that month\'s energy charges (NERSA energy-only offset)', () => {
    const bills = costHourly(
      megaflex,
      { importKwh: result.balance.import, exportKwh: result.balance.export },
      { calendar: ESKOM_LIKE, year: REFERENCE_YEAR, holidays: referenceYearHolidays(REFERENCE_YEAR), exportTariff: genOffset, sseg: costOpts.sseg, demandForMonth: costOpts.demandForMonth },
    )
    expect(bills).toHaveLength(12)
    for (const b of bills) {
      expect(b.credit.used).toBeGreaterThanOrEqual(0)
      expect(b.credit.used).toBeLessThanOrEqual(b.energyCharges + 1e-9)
    }
    const annualCredit = bills.reduce((s, b) => s + b.credit.used, 0)
    expect(fr.year1Bills.exportCreditUsedZar).toBeCloseTo(annualCredit, 6)
  })

  it('produces a finite, positive NPV on the cash model', () => {
    const view = fr.finance.models[0]!.views[0]!
    expect(Number.isFinite(view.npvZar)).toBe(true)
    expect(view.npvZar).toBeGreaterThan(0)
    expect(fr.year1Bills.afterPvOnlyZar).toBe(fr.year1Bills.afterZar) // no battery → PV-only twin is the case
  })
})
