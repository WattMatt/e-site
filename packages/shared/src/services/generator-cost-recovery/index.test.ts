import { describe, it, expect } from 'vitest'
import { buildGeneratorCostRecovery } from './index'
import { calculateTotalCapitalCost, calculateMonthlyCapitalRepayment } from './capital'
import { DEFAULT_GENERATOR_SETTINGS as S } from './defaults'
import type { GeneratorCostRecoveryInput, TenantInput, ZoneInput } from './types'

const zones: ZoneInput[] = [
  {
    zoneName: 'Z1',
    generators: [
      { size: '250 kVA', cost: 500_000 },
      { size: '100 kVA', cost: 300_000 },
    ],
  },
]

const tenants: TenantInput[] = [
  { shopNumber: 'A', shopName: 'a', areaM2: 100, category: 'standard', participation: 'shared', manualKwOverride: null },
  { shopNumber: 'B', shopName: 'b', areaM2: 200, category: 'standard', participation: 'shared', manualKwOverride: null },
  { shopNumber: 'C', shopName: 'c', areaM2: 50,  category: 'standard', participation: 'own',    manualKwOverride: null },
  { shopNumber: 'D', shopName: 'd', areaM2: 80,  category: 'standard', participation: 'none',   manualKwOverride: null },
]

const input: GeneratorCostRecoveryInput = { settings: S, zones, tenants }

describe('buildGeneratorCostRecovery (end-to-end compose)', () => {
  const model = buildGeneratorCostRecovery(input)

  it('totalCapitalCost matches capital function for same inputs', () => {
    const expected = calculateTotalCapitalCost(zones, tenants, S)
    expect(model.totalCapitalCost).toBe(expected)
  })

  it('monthlyCapitalRepayment matches capital function for same inputs', () => {
    const expected = calculateMonthlyCapitalRepayment(model.totalCapitalCost, S)
    expect(model.monthlyCapitalRepayment).toBeCloseTo(expected, 6)
  })

  it('allocations length equals tenants length', () => {
    expect(model.allocations.length).toBe(tenants.length)
  })

  it('tariff.finalTariff > 0 (largest gen is 250 kVA)', () => {
    expect(model.tariff.finalTariff).toBeGreaterThan(0)
  })

  it('reconciliation: Σ shared monthly ≈ monthlyCapitalRepayment', () => {
    const sum = model.allocations.reduce((s, r) => s + r.monthly, 0)
    expect(sum).toBeCloseTo(model.monthlyCapitalRepayment, 6)
  })
})
