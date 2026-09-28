import { describe, expect, it } from 'vitest'
import { loadWeather } from './__fixtures__/pvgis'
import { stubBillCalculator } from './__fixtures__/stub-bill-calculator'
import { runFinancials, simulateCase, type CaseInput } from './case'
import { SOLAR_ENGINE_DEFAULTS } from './defaults'
import { ENGINE_VERSION } from './version'
import type { FinanceInput } from './finance/cashflow'

const weather = { id: 'pvgis-5.2-tmy:-26.2,28.05', year: loadWeather('jhb') }

const input = (over: Partial<CaseInput> = {}): CaseInput => ({
  weatherDatasetId: weather.id,
  pv: {
    arrays: [
      {
        id: 'roof-a',
        kWpDc: 100,
        tiltDeg: 15,
        azimuthDeg: 0,
        module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
        cellTemp: { kind: 'noct', noctC: 45 },
        losses: SOLAR_ENGINE_DEFAULTS.losses.dc,
        inverterId: 'inv-1',
      },
    ],
    inverters: [{ id: 'inv-1', acRatedKw: 80 }],
    acLosses: SOLAR_ENGINE_DEFAULTS.losses.ac,
    albedo: 0.2,
    transposition: 'perez',
  },
  load: Array.from({ length: 8760 }, (_, h) => (h % 24 >= 7 && h % 24 < 19 ? 60 : 15)),
  loadAdjustment: 0,
  battery: {
    usableKwh: 100,
    maxChargeKw: 50,
    maxDischargeKw: 50,
    roundTripEfficiency: 0.9,
    socMin: 0.1,
    socMax: 0.95,
    initialSoc: 0.1,
    backupReserve: 0.2,
    strategy: { kind: 'self-consumption' },
  },
  export: { allowed: true, limitKw: 50 },
  ...over,
})

const fin: FinanceInput = {
  kWpDc: 100,
  capex: { totalZar: 1_600_000, inverterZar: 150_000, batteryZar: 450_000, section12bQualifyingZar: 1_150_000 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 },
  replacements: SOLAR_ENGINE_DEFAULTS.finance.replacements,
  tax: { enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 80 },
  degradation: SOLAR_ENGINE_DEFAULTS.degradation,
  analysis: { years: 25, discountRate: 0.11, cpi: 0.05, escalation: SOLAR_ENGINE_DEFAULTS.finance.escalation, loadGrowth: 0 },
  models: [{ kind: 'cash' }, { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 0 }],
  loadShedding: { hoursPerYear: 200, backedLoadKw: 30, valueZarPerKwh: 6 },
}

describe('simulateCase', () => {
  const r = simulateCase(input(), weather)

  it('stamps the engine version and a stable inputs hash', () => {
    expect(r.engineVersion).toBe(ENGINE_VERSION)
    expect(r.inputsHash).toMatch(/^[0-9a-f]{64}$/)
    expect(simulateCase(input(), weather).inputsHash).toBe(r.inputsHash)
    expect(simulateCase(input({ loadAdjustment: 0.01 }), weather).inputsHash).not.toBe(r.inputsHash)
  })

  it('refuses weather that is not the dataset the input names', () => {
    expect(() => simulateCase(input(), { ...weather, id: 'other' })).toThrow(/weather dataset mismatch/)
  })

  it('runs the battery and a PV-only twin; the battery raises self-consumption', () => {
    expect(r.balance.kpis.selfConsumption).toBeGreaterThan(r.balancePvOnly.kpis.selfConsumption)
    expect(r.monthly.pvKwh.reduce((a, b) => a + b, 0)).toBeCloseTo(r.pv.annual.acKwh, 6)
  })

  it('without a battery the twin IS the balance', () => {
    const n = simulateCase(input({ battery: null }), weather)
    expect(n.balancePvOnly).toBe(n.balance)
  })
})

describe('runFinancials through the BillCalculator seam (stub until Phase 2a)', () => {
  const r = simulateCase(input(), weather)
  const out = runFinancials(r, fin, stubBillCalculator)

  it('prices before / PV-only / PV+battery, and saving is positive', () => {
    expect(out.year1Bills.beforeZar).toBeGreaterThan(out.year1Bills.afterPvOnlyZar)
    expect(out.year1Bills.afterPvOnlyZar).toBeGreaterThan(out.year1Bills.afterZar)
  })

  it('a PPA is billed on delivered energy: curtailment under a zero-export limit is not charged', () => {
    const z = simulateCase(input({ battery: null, export: { allowed: false, limitKw: null } }), weather)
    expect(z.balance.kpis.curtailKwh).toBeGreaterThan(0)
    const ppa: FinanceInput = { ...fin, models: [{ kind: 'ppa', startTariffZarPerKwh: 1.5, escalation: 0, termYears: 10, buyout: null }] }
    const o = runFinancials(z, ppa, stubBillCalculator)
    const delivered = z.balance.kpis.pvKwh - z.balance.kpis.curtailKwh
    expect(o.finance.models[0]!.views[0]!.rows[0]!.financeZar).toBeCloseTo(delivered * (1 - 0.02) * 1.5, 6)
  })

  it('produces every selected model, a tornado and a separate load-shedding line', () => {
    expect(out.finance.models.map((m) => m.model)).toEqual(['cash', 'debt'])
    expect(out.finance.models[0]!.views[0]!.rows).toHaveLength(25)
    expect(out.tornado.bars).toHaveLength(5)
    expect(out.finance.loadShedding!.annualZar[0]).toBeCloseTo(200 * 30 * 6, 9)
    expect(out.engineVersion).toBe(ENGINE_VERSION)
  })
})
