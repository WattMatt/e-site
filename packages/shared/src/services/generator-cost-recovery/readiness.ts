import type { GcrSettingsRow, GcrZoneRow, GcrZoneGeneratorRow, TenantNodeRow } from './db-row-types'
import { hasFuelRating } from './sizing-table'

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

  // A size the sizing table can't resolve makes getFuelConsumption return 0,
  // silently collapsing the operational tariff to R0/kWh — surface it here
  // instead of letting a zero flow into a billed report.
  const unratedGenerators = d.generators.filter((g) => !hasFuelRating(g.generator_size)).length
  if (unratedGenerators > 0) {
    gaps.push(
      `${unratedGenerators} generator(s) with a size not in the sizing table — the operational tariff would be R0/kWh`,
    )
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
