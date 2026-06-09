import type { GeneratorSettings, TenantInput } from './types'

export function calculateTenantLoadingKw(tenant: TenantInput, settings: GeneratorSettings): number {
  if (tenant.participation !== 'shared') return 0   // own + none excluded
  if (tenant.manualKwOverride != null) return tenant.manualKwOverride
  if (!tenant.areaM2) return 0
  // esite honours 4 distinct category rates per WM — a deliberate divergence from nexus's
  // billed path (which bills fast_food at the restaurant rate and national at the standard
  // rate). 'other' has no dedicated rate field and falls back to standard.
  const rate: Record<import('./types').ShopCategory, number> = {
    standard:   settings.standardKwPerSqm,
    fast_food:  settings.fastFoodKwPerSqm,
    restaurant: settings.restaurantKwPerSqm,
    national:   settings.nationalKwPerSqm,
    other:      settings.standardKwPerSqm,
  }
  return tenant.areaM2 * rate[tenant.category]
}
