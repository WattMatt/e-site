import type { GcrSettingsRow, GcrZoneRow, GcrZoneGeneratorRow, TenantNodeRow } from './db-row-types'

export interface ReadinessResult {
  ready: boolean
  gaps: string[]
}

export interface CheckReadinessArgs {
  settings: GcrSettingsRow | null
  zones: GcrZoneRow[]
  generators: GcrZoneGeneratorRow[]
  tenantNodes: TenantNodeRow[]
}

/**
 * Check whether all required data is present to run the GCR engine. Pure — no IO.
 */
export function checkReadiness(d: CheckReadinessArgs): ReadinessResult {
  const gaps: string[] = []

  if (d.settings === null) {
    gaps.push('Generator settings not configured')
  }

  if (d.zones.length === 0) {
    gaps.push('No generator zones configured')
  }

  if (d.generators.length === 0) {
    gaps.push('No generators configured')
  }

  const sharedTenants = d.tenantNodes.filter((t) => t.generator_participation === 'shared')

  const missingArea = sharedTenants.filter(
    (t) => t.shop_area_m2 == null || t.shop_area_m2 <= 0,
  ).length
  if (missingArea > 0) {
    gaps.push(`${missingArea} tenant(s) missing floor area`)
  }

  const missingCategory = sharedTenants.filter((t) => !t.shop_category).length
  if (missingCategory > 0) {
    gaps.push(`${missingCategory} tenant(s) missing category`)
  }

  return { ready: gaps.length === 0, gaps }
}
