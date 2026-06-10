import type { GeneratorSettings } from './types'

export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
  standardKwPerSqm: 0.03,
  fastFoodKwPerSqm: 0.045,
  restaurantKwPerSqm: 0.045,
  nationalKwPerSqm: 0.03,
  capitalRecoveryPeriodYears: 10,
  capitalRecoveryRatePercent: 12,
  ratePerTenantDb: 0,
  numMainBoards: 0,
  ratePerMainBoard: 0,
  additionalCablingCost: 0,
  controlWiringCost: 0,
  dieselCostPerLitre: 23,
  runningHoursPerMonth: 100,
  maintenanceCostAnnual: 18800,
  powerFactor: 0.95,
  runningLoadPercentage: 75,
  maintenanceContingencyPercent: 10,
}
