import { describe, it, expect } from 'vitest'
import { checkReadiness } from './readiness'
import type { GcrSettingsRow, GcrZoneRow, GcrZoneGeneratorRow, TenantNodeRow } from './db-row-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SETTINGS: GcrSettingsRow = {
  standard_kw_per_sqm: 0.03,
  fast_food_kw_per_sqm: 0.045,
  restaurant_kw_per_sqm: 0.045,
  national_kw_per_sqm: 0.03,
  capital_recovery_period_years: 10,
  capital_recovery_rate_percent: 12,
  rate_per_tenant_db: 0,
  num_main_boards: 0,
  rate_per_main_board: 0,
  additional_cabling_cost: 0,
  control_wiring_cost: 0,
  diesel_cost_per_litre: 23,
  running_hours_per_month: 100,
  maintenance_cost_annual: 18800,
  power_factor: 0.95,
  running_load_percentage: 75,
  maintenance_contingency_percent: 10,
}

const ZONE: GcrZoneRow = { id: 'z1', zone_name: 'Zone 1', zone_number: 1, display_order: 1 }
const GEN: GcrZoneGeneratorRow = { zone_id: 'z1', generator_number: 1, generator_size: '500 kVA', generator_cost: 100000 }

function makeSharedTenant(overrides: Partial<TenantNodeRow> = {}): TenantNodeRow {
  return {
    id: 'tenant-1',
    shop_number: 'T001',
    shop_name: 'Pick n Pay',
    shop_area_m2: 300,
    shop_category: 'national',
    generator_participation: 'shared',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkReadiness', () => {
  it('returns ready:true with empty gaps when everything is configured', () => {
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [ZONE],
      generators: [GEN],
      tenantNodes: [makeSharedTenant()],
    })
    expect(result.ready).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('reports "Generator settings not configured" when settings is null', () => {
    const result = checkReadiness({
      settings: null,
      zones: [ZONE],
      generators: [GEN],
      tenantNodes: [],
    })
    expect(result.ready).toBe(false)
    expect(result.gaps).toContain('Generator settings not configured')
  })

  it('reports "No generator zones configured" when zones array is empty', () => {
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [],
      generators: [GEN],
      tenantNodes: [],
    })
    expect(result.ready).toBe(false)
    expect(result.gaps).toContain('No generator zones configured')
  })

  it('reports "No generators configured" when generators array is empty', () => {
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [ZONE],
      generators: [],
      tenantNodes: [],
    })
    expect(result.ready).toBe(false)
    expect(result.gaps).toContain('No generators configured')
  })

  it('reports tenant(s) missing floor area for shared tenants with null area', () => {
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [ZONE],
      generators: [GEN],
      tenantNodes: [makeSharedTenant({ shop_area_m2: null })],
    })
    expect(result.ready).toBe(false)
    expect(result.gaps).toContain('1 tenant(s) missing floor area')
  })

  it('reports tenant(s) missing floor area for shared tenants with zero area', () => {
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [ZONE],
      generators: [GEN],
      tenantNodes: [makeSharedTenant({ shop_area_m2: 0 })],
    })
    expect(result.ready).toBe(false)
    expect(result.gaps).toContain('1 tenant(s) missing floor area')
  })

  it('counts multiple shared tenants missing floor area', () => {
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [ZONE],
      generators: [GEN],
      tenantNodes: [
        makeSharedTenant({ id: 't1', shop_number: 'T001', shop_area_m2: null }),
        makeSharedTenant({ id: 't2', shop_number: 'T002', shop_area_m2: null }),
        makeSharedTenant({ id: 't3', shop_number: 'T003', shop_area_m2: 200 }),
      ],
    })
    expect(result.gaps).toContain('2 tenant(s) missing floor area')
  })

  it('reports tenant(s) missing category for shared tenants with null category', () => {
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [ZONE],
      generators: [GEN],
      tenantNodes: [makeSharedTenant({ shop_category: null })],
    })
    expect(result.ready).toBe(false)
    expect(result.gaps).toContain('1 tenant(s) missing category')
  })

  it('does NOT count own/none tenants missing area toward the gap', () => {
    const ownTenant: TenantNodeRow = {
      id: 'own-1',
      shop_number: 'OWN1',
      shop_name: 'Own Gen',
      shop_area_m2: null, // missing — but participation is own
      shop_category: null,
      generator_participation: 'own',
    }
    const noneTenant: TenantNodeRow = {
      id: 'none-1',
      shop_number: 'NONE1',
      shop_name: 'No Gen',
      shop_area_m2: null,
      shop_category: null,
      generator_participation: 'none',
    }
    const result = checkReadiness({
      settings: SETTINGS,
      zones: [ZONE],
      generators: [GEN],
      tenantNodes: [ownTenant, noneTenant],
    })
    // No shared tenants missing area or category
    expect(result.gaps).not.toContain('1 tenant(s) missing floor area')
    expect(result.gaps).not.toContain('2 tenant(s) missing floor area')
    expect(result.gaps).not.toContain('1 tenant(s) missing category')
    expect(result.gaps).not.toContain('2 tenant(s) missing category')
  })

  it('collects all gaps together when multiple things are missing', () => {
    const result = checkReadiness({
      settings: null,
      zones: [],
      generators: [],
      tenantNodes: [makeSharedTenant({ shop_area_m2: null, shop_category: null })],
    })
    expect(result.ready).toBe(false)
    expect(result.gaps).toContain('Generator settings not configured')
    expect(result.gaps).toContain('No generator zones configured')
    expect(result.gaps).toContain('No generators configured')
    expect(result.gaps).toContain('1 tenant(s) missing floor area')
    expect(result.gaps).toContain('1 tenant(s) missing category')
  })
})
