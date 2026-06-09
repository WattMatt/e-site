import type { GeneratorSettings, TenantInput, ShopCategory } from './types'

export function calculateTenantLoadingKw(tenant: TenantInput, settings: GeneratorSettings): number {
  if (tenant.participation !== 'shared') return 0   // own + none excluded
  if (tenant.manualKwOverride != null) return tenant.manualKwOverride
  if (!tenant.areaM2) return 0
  const rate: Record<ShopCategory, number> = {
    standard: settings.standardKwPerSqm,
    fast_food: settings.fastFoodKwPerSqm,
    restaurant: settings.restaurantKwPerSqm,
    national: settings.nationalKwPerSqm,
    other: settings.standardKwPerSqm,
  }
  return tenant.areaM2 * rate[tenant.category]
}
