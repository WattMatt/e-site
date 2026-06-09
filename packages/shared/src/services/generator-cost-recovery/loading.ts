import type { GeneratorSettings, TenantInput } from './types'

export function calculateTenantLoadingKw(tenant: TenantInput, settings: GeneratorSettings): number {
  if (tenant.participation !== 'shared') return 0   // own + none excluded
  if (tenant.manualKwOverride != null) return tenant.manualKwOverride
  if (!tenant.areaM2) return 0
  // Nexus billing path (GeneratorReportExportPDFButton.tsx): only restaurant & fast_food
  // use the restaurant rate; every other category (standard, national, other) uses the
  // standard rate. There is no separate national/other rate in the billed report.
  const isRestaurant = tenant.category === 'restaurant' || tenant.category === 'fast_food'
  const rate = isRestaurant ? settings.restaurantKwPerSqm : settings.standardKwPerSqm
  return tenant.areaM2 * rate
}
