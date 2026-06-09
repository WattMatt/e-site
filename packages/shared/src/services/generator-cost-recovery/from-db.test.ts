import { describe, it, expect } from 'vitest'
import { mapDbToEngineInput } from './from-db'
import { DEFAULT_GENERATOR_SETTINGS } from './defaults'
import type {
  GcrSettingsRow,
  GcrZoneRow,
  GcrZoneGeneratorRow,
  TenantNodeRow,
  GcrTenantAssignmentRow,
} from './db-row-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SETTINGS_ROW: GcrSettingsRow = {
  standard_kw_per_sqm: 0.03,
  fast_food_kw_per_sqm: 0.045,
  restaurant_kw_per_sqm: 0.045,
  national_kw_per_sqm: 0.03,
  capital_recovery_period_years: 10,
  capital_recovery_rate_percent: 12,
  rate_per_tenant_db: 500,
  num_main_boards: 2,
  rate_per_main_board: 1000,
  additional_cabling_cost: 2000,
  control_wiring_cost: 3000,
  diesel_cost_per_litre: 23,
  running_hours_per_month: 100,
  maintenance_cost_annual: 18800,
  power_factor: 0.95,
  running_load_percentage: 75,
  maintenance_contingency_percent: 10,
}

const ZONE_A: GcrZoneRow = { id: 'zone-a', zone_name: 'Zone A', zone_number: 1, display_order: 1 }
const ZONE_B: GcrZoneRow = { id: 'zone-b', zone_name: 'Zone B', zone_number: 2, display_order: 2 }

const GEN_A1: GcrZoneGeneratorRow = { zone_id: 'zone-a', generator_number: 1, generator_size: '500 kVA', generator_cost: 120000 }
const GEN_A2: GcrZoneGeneratorRow = { zone_id: 'zone-a', generator_number: 2, generator_size: '250 kVA', generator_cost: 80000 }
const GEN_B1: GcrZoneGeneratorRow = { zone_id: 'zone-b', generator_number: 1, generator_size: '400 kVA', generator_cost: 100000 }

const TENANT_SHARED: TenantNodeRow = {
  id: 'tenant-1',
  shop_number: 'T001',
  shop_name: 'Pick n Pay',
  shop_area_m2: 500,
  shop_category: 'national',
  generator_participation: 'shared',
}

const TENANT_OWN: TenantNodeRow = {
  id: 'tenant-2',
  shop_number: 'T002',
  shop_name: 'Steers',
  shop_area_m2: 120,
  shop_category: 'fast_food',
  generator_participation: 'own',
}

const TENANT_NONE: TenantNodeRow = {
  id: 'tenant-3',
  shop_number: 'T003',
  shop_name: null,
  shop_area_m2: null,
  shop_category: null,
  generator_participation: 'none',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapDbToEngineInput', () => {
  it('uses DEFAULT_GENERATOR_SETTINGS when settings row is null', () => {
    const result = mapDbToEngineInput({
      settings: null,
      zones: [],
      generators: [],
      tenants: [],
      assignments: [],
    })
    expect(result.settings).toEqual(DEFAULT_GENERATOR_SETTINGS)
  })

  it('maps a settings row to camelCase engine fields', () => {
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [],
      assignments: [],
    })
    expect(result.settings.standardKwPerSqm).toBe(0.03)
    expect(result.settings.fastFoodKwPerSqm).toBe(0.045)
    expect(result.settings.capitalRecoveryPeriodYears).toBe(10)
    expect(result.settings.ratePerTenantDb).toBe(500)
    expect(result.settings.numMainBoards).toBe(2)
    expect(result.settings.maintenanceContingencyPercent).toBe(10)
  })

  it('sorts zones by display_order and nests their generators', () => {
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [ZONE_B, ZONE_A], // intentionally reversed
      generators: [GEN_B1, GEN_A2, GEN_A1], // intentionally shuffled
      tenants: [],
      assignments: [],
    })
    expect(result.zones).toHaveLength(2)
    expect(result.zones[0].zoneName).toBe('Zone A')
    expect(result.zones[1].zoneName).toBe('Zone B')
    // Zone A generators sorted by generator_number
    expect(result.zones[0].generators).toHaveLength(2)
    expect(result.zones[0].generators[0].size).toBe('500 kVA')
    expect(result.zones[0].generators[0].cost).toBe(120000)
    expect(result.zones[0].generators[1].size).toBe('250 kVA')
    // Zone B
    expect(result.zones[1].generators).toHaveLength(1)
    expect(result.zones[1].generators[0].size).toBe('400 kVA')
  })

  it('maps a normal shared tenant correctly', () => {
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [TENANT_SHARED],
      assignments: [],
    })
    expect(result.tenants).toHaveLength(1)
    const t = result.tenants[0]
    expect(t.shopNumber).toBe('T001')
    expect(t.shopName).toBe('Pick n Pay')
    expect(t.areaM2).toBe(500)
    expect(t.category).toBe('national')
    expect(t.participation).toBe('shared')
    expect(t.manualKwOverride).toBeNull()
  })

  it('passes through own and none participation', () => {
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [TENANT_OWN, TENANT_NONE],
      assignments: [],
    })
    const own = result.tenants.find((t) => t.shopNumber === 'T002')!
    const none = result.tenants.find((t) => t.shopNumber === 'T003')!
    expect(own.participation).toBe('own')
    expect(none.participation).toBe('none')
  })

  it('falls back to "standard" category when shop_category is null', () => {
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [TENANT_NONE],
      assignments: [],
    })
    expect(result.tenants[0].category).toBe('standard')
  })

  it('falls back to "standard" category for an unknown category value', () => {
    const unknownTenant: TenantNodeRow = {
      ...TENANT_SHARED,
      id: 'tenant-x',
      shop_number: 'TX',
      shop_category: 'supermarket',
    }
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [unknownTenant],
      assignments: [],
    })
    expect(result.tenants[0].category).toBe('standard')
  })

  it('coerces null shop_name to empty string', () => {
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [TENANT_NONE],
      assignments: [],
    })
    expect(result.tenants[0].shopName).toBe('')
  })

  it('coerces null shop_area_m2 to 0', () => {
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [TENANT_NONE],
      assignments: [],
    })
    expect(result.tenants[0].areaM2).toBe(0)
  })

  it('applies a manual kW override from the assignments', () => {
    const assignment: GcrTenantAssignmentRow = {
      node_id: 'tenant-1',
      zone_id: 'zone-a',
      manual_kw_override: 42,
    }
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [TENANT_SHARED],
      assignments: [assignment],
    })
    expect(result.tenants[0].manualKwOverride).toBe(42)
  })

  it('leaves manualKwOverride null when assignment has null override', () => {
    const assignment: GcrTenantAssignmentRow = {
      node_id: 'tenant-1',
      zone_id: null,
      manual_kw_override: null,
    }
    const result = mapDbToEngineInput({
      settings: SETTINGS_ROW,
      zones: [],
      generators: [],
      tenants: [TENANT_SHARED],
      assignments: [assignment],
    })
    expect(result.tenants[0].manualKwOverride).toBeNull()
  })
})
