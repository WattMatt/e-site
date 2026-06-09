/** Snake-case row interfaces that mirror migration 00124. Pure types — no IO. */

export interface GcrSettingsRow {
  standard_kw_per_sqm: number
  fast_food_kw_per_sqm: number
  restaurant_kw_per_sqm: number
  national_kw_per_sqm: number
  capital_recovery_period_years: number
  capital_recovery_rate_percent: number
  rate_per_tenant_db: number
  num_main_boards: number
  rate_per_main_board: number
  additional_cabling_cost: number
  control_wiring_cost: number
  diesel_cost_per_litre: number
  running_hours_per_month: number
  maintenance_cost_annual: number
  power_factor: number
  running_load_percentage: number
  maintenance_contingency_percent: number
}

export interface GcrZoneRow {
  id: string
  zone_name: string
  zone_number: number
  display_order: number
}

export interface GcrZoneGeneratorRow {
  zone_id: string
  generator_number: number
  generator_size: string | null
  generator_cost: number
}

export interface TenantNodeRow {
  id: string
  shop_number: string
  shop_name: string | null
  shop_area_m2: number | null
  shop_category: string | null
  generator_participation: 'shared' | 'own' | 'none'
}

export interface GcrTenantAssignmentRow {
  node_id: string
  zone_id: string | null
  manual_kw_override: number | null
}
