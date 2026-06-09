export type ShopCategory = 'standard' | 'fast_food' | 'restaurant' | 'national' | 'other'
export type GeneratorParticipation = 'shared' | 'own' | 'none'

export interface GeneratorSettings {
  // kW/m² loading rates. NOTE: nexus's billed PDF path uses only TWO effective tiers —
  // restaurant|fast_food → restaurantKwPerSqm, and standard|national|other → standardKwPerSqm.
  // fastFoodKwPerSqm and nationalKwPerSqm are kept for schema/UI parity but are NOT
  // independently read by the calc today. ⚠ Open for WM: honour 4 distinct rates, or keep nexus's 2-tier behaviour?
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
