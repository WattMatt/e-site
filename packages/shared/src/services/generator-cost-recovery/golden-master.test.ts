import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildGeneratorCostRecovery } from './index'
import { calculateTotalCapitalCost, calculateMonthlyCapitalRepayment } from './capital'
import { calculateTenantLoadingKw } from './loading'
import { getFuelConsumption } from './sizing-table'
import { calculateOperationalTariff } from './operational'
import type { GeneratorCostRecoveryInput, GeneratorSettings } from './types'

// ── Golden-master fixtures ──
// Capital-recovery (PMT) + apportionment expectations are anchored to WM's Rev-6 standby-power
// report methodology (annual annuity ÷ 12, ANNUAL compounding) — the AUTHORITATIVE billed
// source of truth — which deliberately diverges from nexus's code (monthly compounding, which
// under-charges ~2.72%). The diesel/contingency/loading/capex expectations still match nexus's
// billing maths (generatorReportPdfBuilder.ts) verbatim. Expectations were computed by
// replicating those formulas — NOT by running this esite port. The fixtures are the source of
// truth; if these fail the engine has diverged and the engine must be fixed (never the fixtures).

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'nexus-golden')

interface Allocation {
  shopNumber: string
  loadingKw: number
  portionPercent: number
  monthly: number
  ratePerSqm: number
}

interface Fixture {
  name: string
  description: string
  input: GeneratorCostRecoveryInput
  expected: {
    totalCapitalCost: number
    numTenantDBs: number
    monthlyCapitalRepayment: number
    tariff: {
      largestGenKva: number
      netKva: number
      netKwh: number
      fuelConsumptionLPerH: number
      dieselPerKwh: number
      maintenancePerKwh: number
      base: number
      contingency: number
      finalTariff: number
    }
    totalActiveLoad: number
    allocations: Allocation[]
  }
}

const loadFixture = (file: string): Fixture =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture

const FIXTURE_FILES = [
  'single-zone-standard-plus-own.json',
  'multi-zone-mixed-categories-override.json',
  'three-zone-large-scheme.json',
]

// nexus largest-generator-by-kVA reduce, used only to recompute the expected fuel input.
const largestGenSize = (input: GeneratorCostRecoveryInput): string => {
  const gens = input.zones.flatMap((z) => z.generators)
  if (gens.length === 0) return ''
  return gens.reduce((largest, g) => {
    const sizeNum = parseInt(g.size, 10) || 0
    return sizeNum > (parseInt(largest, 10) || 0) ? g.size : largest
  }, gens[0].size)
}

const MONEY_DP = 4 // tight precision on money / rates

describe.each(FIXTURE_FILES)('nexus golden-master: %s', (file) => {
  const fx = loadFixture(file)
  const { input, expected } = fx
  const settings = input.settings as GeneratorSettings
  const model = buildGeneratorCostRecovery(input)

  it('totalCapitalCost (exact)', () => {
    expect(model.totalCapitalCost).toBe(expected.totalCapitalCost)
    // and via the standalone capital function
    expect(calculateTotalCapitalCost(input.zones, input.tenants, settings)).toBe(expected.totalCapitalCost)
  })

  it('numTenantDBs implied by board-mod arithmetic', () => {
    // numTenantDBs is internal to capital cost; assert the count nexus would compute
    // (tenants not on their own generator) matches the fixture.
    const numNotOwn = input.tenants.filter((t) => t.participation !== 'own' && t.participation !== 'none').length
    expect(numNotOwn).toBe(expected.numTenantDBs)
  })

  it('monthlyCapitalRepayment (PMT, WM Rev-6: annual annuity ÷ 12)', () => {
    expect(model.monthlyCapitalRepayment).toBeCloseTo(expected.monthlyCapitalRepayment, MONEY_DP)
    expect(calculateMonthlyCapitalRepayment(expected.totalCapitalCost, settings)).toBeCloseTo(
      expected.monthlyCapitalRepayment,
      MONEY_DP,
    )
  })

  it('fuel consumption l/h at running load (largest gen)', () => {
    const size = largestGenSize(input)
    expect(getFuelConsumption(size, settings.runningLoadPercentage)).toBeCloseTo(
      expected.tariff.fuelConsumptionLPerH,
      6,
    )
  })

  it('operational tariff fields (diesel, maintenance, base, contingency, final)', () => {
    expect(model.tariff.dieselPerKwh).toBeCloseTo(expected.tariff.dieselPerKwh, MONEY_DP)
    expect(model.tariff.maintenancePerKwh).toBeCloseTo(expected.tariff.maintenancePerKwh, MONEY_DP)
    expect(model.tariff.base).toBeCloseTo(expected.tariff.base, MONEY_DP)
    expect(model.tariff.contingency).toBeCloseTo(expected.tariff.contingency, MONEY_DP)
    expect(model.tariff.finalTariff).toBeCloseTo(expected.tariff.finalTariff, MONEY_DP)
  })

  it('operational tariff via standalone function matches', () => {
    const size = largestGenSize(input)
    const t = calculateOperationalTariff(settings, {
      kva: expected.tariff.largestGenKva,
      fuelConsumptionLPerH: getFuelConsumption(size, settings.runningLoadPercentage),
    })
    expect(t.finalTariff).toBeCloseTo(expected.tariff.finalTariff, MONEY_DP)
  })

  it('per-tenant loadingKw matches nexus', () => {
    for (const exp of expected.allocations) {
      const tenant = input.tenants.find((t) => t.shopNumber === exp.shopNumber)!
      expect(calculateTenantLoadingKw(tenant, settings)).toBeCloseTo(exp.loadingKw, 6)
      const alloc = model.allocations.find((a) => a.shopNumber === exp.shopNumber)!
      expect(alloc.loadingKw).toBeCloseTo(exp.loadingKw, 6)
    }
  })

  it('per-tenant apportionment {portionPercent, monthly, ratePerSqm} matches nexus', () => {
    for (const exp of expected.allocations) {
      const alloc = model.allocations.find((a) => a.shopNumber === exp.shopNumber)!
      expect(alloc.portionPercent).toBeCloseTo(exp.portionPercent, MONEY_DP)
      expect(alloc.monthly).toBeCloseTo(exp.monthly, MONEY_DP)
      expect(alloc.ratePerSqm).toBeCloseTo(exp.ratePerSqm, MONEY_DP)
    }
  })

  it('reconciliation invariant: Σ tenant monthly ≈ monthlyCapitalRepayment', () => {
    const sum = model.allocations.reduce((s, a) => s + a.monthly, 0)
    expect(sum).toBeCloseTo(expected.monthlyCapitalRepayment, MONEY_DP)
  })
})
