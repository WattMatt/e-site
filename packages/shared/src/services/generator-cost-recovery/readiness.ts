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

  // The operational tariff derives solely from the LARGEST generator (by
  // parseInt of its size — mirrors the engine's parseKva reduce). If THAT
  // generator's size can't be resolved to a sizing-table row,
  // getFuelConsumption returns 0 and the tariff silently collapses to
  // R0/kWh — surface it here instead of letting a zero flow into a billed
  // report. Unrated non-largest generators don't affect the tariff and must
  // not block report generation.
  if (d.generators.length > 0) {
    const kvaOf = (g: GcrZoneGeneratorRow) => {
      const n = parseInt(g.generator_size ?? '', 10)
      return Number.isNaN(n) ? 0 : n
    }
    const largest = d.generators.reduce((max, g) => (kvaOf(g) > kvaOf(max) ? g : max))
    if (!hasFuelRating(largest.generator_size)) {
      gaps.push(
        `Largest generator size "${largest.generator_size ?? '(blank)'}" is not in the sizing table — the operational tariff would be R0/kWh`,
      )
    }
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
