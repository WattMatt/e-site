import { describe, it, expect } from 'vitest'
import { calculateApportionment } from './apportionment'
import { DEFAULT_GENERATOR_SETTINGS as S } from './defaults'
import type { TenantInput } from './types'

const tenants: TenantInput[] = [
  { shopNumber: 'A', shopName: 'a', areaM2: 100, category: 'standard', participation: 'shared', manualKwOverride: null }, // 3 kW
  { shopNumber: 'B', shopName: 'b', areaM2: 200, category: 'standard', participation: 'shared', manualKwOverride: null }, // 6 kW
  { shopNumber: 'C', shopName: 'c', areaM2: 50,  category: 'standard', participation: 'own',    manualKwOverride: null }, // 0
  { shopNumber: 'D', shopName: 'd', areaM2: 80,  category: 'standard', participation: 'none',   manualKwOverride: null }, // 0
]

it('apportions monthly repayment by load share', () => {
  const rows = calculateApportionment(tenants, S, 900) // total active load 9 kW (A,B shared)
  const a = rows.find(r => r.shopNumber === 'A')!
  expect(a.loadingKw).toBe(3)
  expect(a.portionPercent).toBeCloseTo(33.333, 2)
  expect(a.monthly).toBeCloseTo(300, 6)
  expect(a.ratePerSqm).toBeCloseTo(3, 6)
  expect(rows.find(r => r.shopNumber === 'C')!.monthly).toBe(0)
  expect(rows.find(r => r.shopNumber === 'D')!.monthly).toBe(0)
})

it('reconciliation invariant: Σ monthly === monthly repayment', () => {
  const sum = calculateApportionment(tenants, S, 900).reduce((s, r) => s + r.monthly, 0)
  expect(sum).toBeCloseTo(900, 6)
})
