export type ShopCategory = 'standard' | 'fast_food' | 'restaurant' | 'national' | 'other'
export type GeneratorParticipation = 'shared' | 'own' | 'none'

export interface GeneratorSettings {
  // kW/m² loading rates. All 4 category rates are honoured independently (WM decision);
  // this is a deliberate divergence from nexus's 2-tier billed behaviour (which maps
  // fast_food → restaurantKwPerSqm and national → standardKwPerSqm).
  standardKwPerSqm: number
  fastFoodKwPerSqm: number
  restaurantKwPerSqm: number
  nationalKwPerSqm: number
  capitalRecoveryPeriodYears: number
  capitalRecoveryRatePercent: number
  ratePerTenantDb: number
  numMainBoards: number
  ratePerMainBoard: number
  additionalCablingCost: number
  controlWiringCost: number
  dieselCostPerLitre: number
  runningHoursPerMonth: number
  maintenanceCostAnnual: number
  powerFactor: number
  runningLoadPercentage: number
  maintenanceContingencyPercent: number
}

export interface TenantInput {
  shopNumber: string
  shopName: string
  areaM2: number
  category: ShopCategory
  participation: GeneratorParticipation
  manualKwOverride: number | null
}

export interface GeneratorInput { size: string; cost: number }
export interface ZoneInput { zoneName: string; generators: GeneratorInput[] }

export interface OperationalTariff {
  dieselPerKwh: number
  maintenancePerKwh: number
  base: number
  contingency: number
  finalTariff: number
}

export interface TenantAllocation {
  shopNumber: string
  shopName: string
  areaM2: number
  participation: GeneratorParticipation
  loadingKw: number
  portionPercent: number
  monthly: number
  ratePerSqm: number
}

export interface GeneratorCostRecoveryModel {
  totalCapitalCost: number
  monthlyCapitalRepayment: number
  tariff: OperationalTariff
  allocations: TenantAllocation[]
}

export interface GeneratorCostRecoveryInput {
  settings: GeneratorSettings
  zones: ZoneInput[]
  tenants: TenantInput[]
}

// ─── Client-facing outputs-only review payload (Phase 2) ──────────────────────
// SECURITY: this shape MUST contain only tenant-facing outputs. Never add a
// contractor cost-input field here (generator capital, total capital, diesel,
// maintenance, tariff build-up components, margin). See client-projection.ts.

export interface ClientGcrTenantRow {
  shopNumber: string
  shopName: string
  areaM2: number
  participation: GeneratorParticipation
  loadingKw: number
  portionPercent: number
  monthly: number
  ratePerSqm: number
}

export interface ClientGcrBankRow {
  zoneName: string
  installedKva: number | null
  utilisationPercent: number | null
}

export interface ClientGcrScheme {
  monthlyCapitalRepayment: number
  finalTariff: number
}

export interface ClientGcrReviewPayload {
  tenants: ClientGcrTenantRow[]
  banks: ClientGcrBankRow[]
  scheme: ClientGcrScheme
}

// Proposable fields = editable INPUTS ONLY (D1, spec §5.3).
export type GcrChangeRequestField =
  | 'area'
  | 'category'
  | 'participation'
  | 'zone'
  | 'manual_kw_override'

export type GcrChangeRequestStatus = 'open' | 'accepted' | 'declined'

export interface GcrChangeRequestInput {
  nodeId: string
  field: GcrChangeRequestField
  oldValue: string | null
  newValue: string | null
  comment: string | null
}

export interface GcrChangeRequestRow {
  id: string
  project_id: string
  organisation_id: string
  snapshot_id: string
  node_id: string
  client_id: string
  field: GcrChangeRequestField
  old_value: string | null
  new_value: string | null
  comment: string | null
  status: GcrChangeRequestStatus
  admin_reply: string | null
  actioned_by: string | null
  actioned_at: string | null
  created_at: string
  updated_at: string
}
