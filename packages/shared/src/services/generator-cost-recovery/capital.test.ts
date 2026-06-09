import { describe, it, expect } from 'vitest'
import { calculateTotalCapitalCost, calculateMonthlyCapitalRepayment } from './capital'
import { DEFAULT_GENERATOR_SETTINGS } from './defaults'
import type { ZoneInput, TenantInput } from './types'

const zones: ZoneInput[] = [{ zoneName: 'Z1', generators: [{ size: '250 kVA', cost: 500000 }, { size: '100 kVA', cost: 300000 }] }]
const tenants: TenantInput[] = [
  { shopNumber: 'A', shopName: 'a', areaM2: 100, category: 'standard', participation: 'shared', manualKwOverride: null },
  { shopNumber: 'B', shopName: 'b', areaM2: 200, category: 'standard', participation: 'shared', manualKwOverride: null },
  { shopNumber: 'C', shopName: 'c', areaM2: 50,  category: 'standard', participation: 'own',    manualKwOverride: null },
  { shopNumber: 'D', shopName: 'd', areaM2: 80,  category: 'standard', participation: 'none',   manualKwOverride: null },
]

it('total capital cost', () => {
  const s = { ...DEFAULT_GENERATOR_SETTINGS, ratePerTenantDb: 2000, numMainBoards: 1, ratePerMainBoard: 10000, additionalCablingCost: 50000, controlWiringCost: 20000 }
  // gens 800000 + boardMod(2 SHARED tenant DBs A,B × 2000 + 1 main × 10000 = 14000; C=own, D=none excluded) + cabling 50000 + control 20000
  expect(calculateTotalCapitalCost(zones, tenants, s)).toBe(884000)
})

it('PMT monthly repayment', () => {
  // capex 1,000,000 @ 12% over 10y → annual 176,984.16 → /12 ≈ 14,748.68
  expect(calculateMonthlyCapitalRepayment(1_000_000, DEFAULT_GENERATOR_SETTINGS)).toBeCloseTo(14748.68, 1)
})

it('zero capex → 0 (no divide-by-zero)', () => {
  expect(calculateMonthlyCapitalRepayment(0, DEFAULT_GENERATOR_SETTINGS)).toBe(0)
})
