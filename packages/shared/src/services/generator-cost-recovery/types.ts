export type ShopCategory = 'standard' | 'fast_food' | 'restaurant' | 'national' | 'other'
export type GeneratorParticipation = 'shared' | 'own' | 'none'

export interface GeneratorSettings {
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
