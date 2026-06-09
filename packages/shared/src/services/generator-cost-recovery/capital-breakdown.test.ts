import { describe, it, expect } from 'vitest'
import { capitalCostBreakdown } from './capital-breakdown'
import { calculateTotalCapitalCost } from './capital'
import { DEFAULT_GENERATOR_SETTINGS } from './defaults'
import type { ZoneInput, TenantInput } from './types'

const zones: ZoneInput[] = [
  {
    zoneName: 'Zone A',
    generators: [
      { size: '250 kVA', cost: 500_000 },
      { size: '100 kVA', cost: 300_000 },
    ],
  },
  {
    zoneName: 'Zone B',
    generators: [{ size: '150 kVA', cost: 400_000 }],
  },
]

const tenants: TenantInput[] = [
  { shopNumber: 'T01', shopName: 'Alpha', areaM2: 120, category: 'standard', participation: 'shared', manualKwOverride: null },
  { shopNumber: 'T02', shopName: 'Beta',  areaM2: 80,  category: 'standard', participation: 'shared', manualKwOverride: null },
  // 'own' and 'none' must NOT be counted in board mods
  { shopNumber: 'T03', shopName: 'Gamma', areaM2: 60,  category: 'standard', participation: 'own',    manualKwOverride: null },
  { shopNumber: 'T04', shopName: 'Delta', areaM2: 40,  category: 'standard', participation: 'none',   manualKwOverride: null },
]

const S = {
  ...DEFAULT_GENERATOR_SETTINGS,
  ratePerTenantDb: 3_000,
  numMainBoards: 2,
  ratePerMainBoard: 15_000,
  additionalCablingCost: 75_000,
  controlWiringCost: 25_000,
}

describe('capitalCostBreakdown', () => {
  const bd = capitalCostBreakdown(zones, tenants, S)

  it('total === calculateTotalCapitalCost (DRY-consistent)', () => {
    expect(bd.total).toBe(calculateTotalCapitalCost(zones, tenants, S))
  })

  it('generators = sum of all generator costs across zones', () => {
    // 500_000 + 300_000 + 400_000 = 1_200_000
    expect(bd.generators).toBe(1_200_000)
  })

  it('boardMods counts only shared tenants', () => {
    // 2 shared × 3_000 + 2 main × 15_000 = 6_000 + 30_000 = 36_000
    expect(bd.boardMods).toBe(36_000)
  })

  it('cabling = additionalCablingCost setting', () => {
    expect(bd.cabling).toBe(75_000)
  })

  it('controlWiring = controlWiringCost setting', () => {
    expect(bd.controlWiring).toBe(25_000)
  })

  it('components sum to total', () => {
    expect(bd.generators + bd.boardMods + bd.cabling + bd.controlWiring).toBe(bd.total)
  })

  it('own and none tenants do not inflate boardMods', () => {
    // With all tenants as 'shared' the boardMods would be higher
    const allSharedTenants: TenantInput[] = tenants.map((t) => ({ ...t, participation: 'shared' as const }))
    const bdAllShared = capitalCostBreakdown(zones, allSharedTenants, S)
    expect(bdAllShared.boardMods).toBeGreaterThan(bd.boardMods)
  })
})
