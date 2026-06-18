import { describe, it, expect } from 'vitest'
import { toClientReviewPayload, parseGeneratorKva } from './client-projection'
import type { GeneratorCostRecoveryModel } from './types'

const CONTRACTOR_KEYS = [
  'totalCapitalCost',
  'dieselPerKwh',
  'maintenancePerKwh',
  'base',
  'contingency',
  'dieselCostPerLitre',
  'maintenanceCostAnnual',
  'cost',
]

const model: GeneratorCostRecoveryModel = {
  totalCapitalCost: 1_234_567,
  monthlyCapitalRepayment: 42_000,
  tariff: {
    dieselPerKwh: 3.1,
    maintenancePerKwh: 0.4,
    base: 3.5,
    contingency: 0.35,
    finalTariff: 3.85,
  },
  allocations: [
    {
      shopNumber: 'S1',
      shopName: 'Shop One',
      areaM2: 100,
      participation: 'shared',
      loadingKw: 3,
      portionPercent: 60,
      monthly: 25_200,
      ratePerSqm: 252,
    },
    {
      shopNumber: 'S2',
      shopName: 'Shop Two',
      areaM2: 50,
      participation: 'shared',
      loadingKw: 2,
      portionPercent: 40,
      monthly: 16_800,
      ratePerSqm: 336,
    },
  ],
}

const banks = [
  { zoneName: 'Bank A', generatorSizes: ['500 kVA'], assignedLoadKw: 5 },
]

describe('toClientReviewPayload', () => {
  it('returns only outputs-only fields and never contractor inputs', () => {
    const payload = toClientReviewPayload(model, banks)
    const json = JSON.stringify(payload)
    for (const key of CONTRACTOR_KEYS) {
      expect(json).not.toContain(`"${key}"`)
    }
  })

  it('projects per-tenant outputs verbatim', () => {
    const payload = toClientReviewPayload(model, banks)
    expect(payload.tenants).toEqual([
      { shopNumber: 'S1', shopName: 'Shop One', areaM2: 100, participation: 'shared', loadingKw: 3, portionPercent: 60, monthly: 25_200, ratePerSqm: 252 },
      { shopNumber: 'S2', shopName: 'Shop Two', areaM2: 50, participation: 'shared', loadingKw: 2, portionPercent: 40, monthly: 16_800, ratePerSqm: 336 },
    ])
  })

  it('exposes only scheme monthlyCapitalRepayment + finalTariff', () => {
    const payload = toClientReviewPayload(model, banks)
    expect(payload.scheme).toEqual({ monthlyCapitalRepayment: 42_000, finalTariff: 3.85 })
  })

  it('computes bank installed kVA + utilisation, null on unparseable size', () => {
    const payload = toClientReviewPayload(model, [
      { zoneName: 'Bank A', generatorSizes: ['500 kVA'], assignedLoadKw: 250 },
      { zoneName: 'Bank B', generatorSizes: ['big one'], assignedLoadKw: 100 },
    ])
    expect(payload.banks[0]).toEqual({ zoneName: 'Bank A', installedKva: 500, utilisationPercent: 50 })
    expect(payload.banks[1]).toEqual({ zoneName: 'Bank B', installedKva: null, utilisationPercent: null })
  })
})

describe('parseGeneratorKva', () => {
  it('parses a numeric kVA from a free-text size', () => {
    expect(parseGeneratorKva('500 kVA')).toBe(500)
    expect(parseGeneratorKva('1000kva')).toBe(1000)
  })
  it('returns null for unparseable text', () => {
    expect(parseGeneratorKva('big one')).toBeNull()
    expect(parseGeneratorKva('')).toBeNull()
  })
})
