import type { GeneratorCostRecoveryInput, ShopCategory } from './types'
import { DEFAULT_GENERATOR_SETTINGS } from './defaults'
import type {
  GcrSettingsRow,
  GcrZoneRow,
  GcrZoneGeneratorRow,
  TenantNodeRow,
  GcrTenantAssignmentRow,
} from './db-row-types'

export interface MapDbToEngineInputArgs {
  settings: GcrSettingsRow | null
  zones: GcrZoneRow[]
  generators: GcrZoneGeneratorRow[]
  tenants: TenantNodeRow[]
  assignments: GcrTenantAssignmentRow[]
}

/**
 * Map DB rows into the engine's `GeneratorCostRecoveryInput`. Pure — no IO.
 */
export function mapDbToEngineInput(d: MapDbToEngineInputArgs): GeneratorCostRecoveryInput {
  // --- settings ---
  const settings = d.settings
    ? {
        standardKwPerSqm: d.settings.standard_kw_per_sqm,
        fastFoodKwPerSqm: d.settings.fast_food_kw_per_sqm,
        restaurantKwPerSqm: d.settings.restaurant_kw_per_sqm,
        nationalKwPerSqm: d.settings.national_kw_per_sqm,
        capitalRecoveryPeriodYears: d.settings.capital_recovery_period_years,
        capitalRecoveryRatePercent: d.settings.capital_recovery_rate_percent,
        ratePerTenantDb: d.settings.rate_per_tenant_db,
        numMainBoards: d.settings.num_main_boards,
        ratePerMainBoard: d.settings.rate_per_main_board,
        additionalCablingCost: d.settings.additional_cabling_cost,
        controlWiringCost: d.settings.control_wiring_cost,
        dieselCostPerLitre: d.settings.diesel_cost_per_litre,
        runningHoursPerMonth: d.settings.running_hours_per_month,
        maintenanceCostAnnual: d.settings.maintenance_cost_annual,
        powerFactor: d.settings.power_factor,
        runningLoadPercentage: d.settings.running_load_percentage,
        maintenanceContingencyPercent: d.settings.maintenance_contingency_percent,
      }
    : DEFAULT_GENERATOR_SETTINGS

  // --- zones (sorted by display_order) ---
  const zones = [...d.zones]
    .sort((a, b) => a.display_order - b.display_order)
    .map((zone) => ({
      zoneName: zone.zone_name,
      generators: d.generators
        .filter((g) => g.zone_id === zone.id)
        .sort((a, b) => a.generator_number - b.generator_number)
        .map((g) => ({
          size: g.generator_size ?? '',
          cost: g.generator_cost,
        })),
    }))

  // --- tenants ---
  const VALID_CATEGORIES = new Set<ShopCategory>([
    'standard',
    'fast_food',
    'restaurant',
    'national',
    'other',
  ])

  const tenants = d.tenants.map((t) => {
    const assignment = d.assignments.find((a) => a.node_id === t.id)
    const rawCategory = t.shop_category ?? ''
    const category: ShopCategory = VALID_CATEGORIES.has(rawCategory as ShopCategory)
      ? (rawCategory as ShopCategory)
      : 'standard'
    return {
      shopNumber: t.shop_number,
      shopName: t.shop_name ?? '',
      areaM2: t.shop_area_m2 ?? 0,
      category,
      participation: t.generator_participation,
      manualKwOverride: assignment?.manual_kw_override ?? null,
    }
  })

  return { settings, zones, tenants }
}
