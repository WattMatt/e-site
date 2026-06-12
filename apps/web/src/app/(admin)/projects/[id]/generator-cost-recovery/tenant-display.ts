/**
 * Pure display-model helpers for the GCR Tenants tab.
 * Display value = server truth + pending patch overlay; everything downstream
 * (filters, counts, coverage) computes off the display value so the UI is
 * always self-consistent.
 */
import {
  calculateTenantLoadingKw,
  type GeneratorSettings,
  type GeneratorParticipation,
  type ShopCategory,
  type TenantNodeRow,
  type GcrTenantAssignmentRow,
  type GcrZoneRow,
  type GcrZoneGeneratorRow,
} from '@esite/shared'
import type { GcrAssignmentPatch } from './gcr.schemas'

export interface DisplayTenant {
  id: string
  shop_number: string | null
  shop_name: string | null
  shop_area_m2: number | null
  category: ShopCategory | null
  participation: GeneratorParticipation
  zoneId: string | null
  manualKwOverride: number | null
}

const VALID_CATEGORIES = new Set(['standard', 'fast_food', 'restaurant', 'national', 'other'])

export function toDisplayTenant(
  node: TenantNodeRow,
  assignment: GcrTenantAssignmentRow | undefined,
  patch: GcrAssignmentPatch | undefined,
): DisplayTenant {
  const rawCat = node.shop_category
  const serverCategory = rawCat && VALID_CATEGORIES.has(rawCat) ? (rawCat as ShopCategory) : null
  return {
    id: node.id,
    shop_number: node.shop_number,
    shop_name: node.shop_name,
    shop_area_m2: node.shop_area_m2,
    category:          patch?.shop_category      !== undefined ? patch.shop_category      : serverCategory,
    participation:     patch?.participation      !== undefined ? patch.participation      : node.generator_participation,
    zoneId:            patch?.zone_id            !== undefined ? patch.zone_id            : assignment?.zone_id ?? null,
    manualKwOverride:  patch?.manual_kw_override !== undefined ? patch.manual_kw_override : assignment?.manual_kw_override ?? null,
  }
}

export type TenantFilter = 'all' | 'needs_setup' | 'no_zone' | 'uncategorized' | 'opted_out' | { zoneId: string }

export function matchesFilter(t: DisplayTenant, f: TenantFilter): boolean {
  if (f === 'all') return true
  if (f === 'needs_setup') return needsSetup(t)
  if (f === 'no_zone') return t.participation === 'shared' && t.zoneId === null
  if (f === 'uncategorized') return t.category === null
  if (f === 'opted_out') return t.participation !== 'shared'
  return t.zoneId === f.zoneId
}

export function filterCounts(tenants: DisplayTenant[]) {
  const byZone: Record<string, number> = {}
  let needs_setup = 0, no_zone = 0, uncategorized = 0, opted_out = 0
  for (const t of tenants) {
    if (needsSetup(t)) needs_setup++
    if (matchesFilter(t, 'no_zone')) no_zone++
    if (matchesFilter(t, 'uncategorized')) uncategorized++
    if (matchesFilter(t, 'opted_out')) opted_out++
    // byZone is a table-filter count: every member of the zone regardless of
    // participation. zoneCoverage counts shared-only (load model) — intentional divergence.
    if (t.zoneId) byZone[t.zoneId] = (byZone[t.zoneId] ?? 0) + 1
  }
  return { all: tenants.length, needs_setup, no_zone, uncategorized, opted_out, byZone }
}

/** Shared shop missing zone or category — the "needs setup" bucket. */
export function needsSetup(t: DisplayTenant): boolean {
  return t.participation === 'shared' && (t.zoneId === null || t.category === null)
}

/** Configured = categorised AND (zoned OR explicitly opted out). */
export function isConfigured(t: DisplayTenant): boolean {
  return t.category !== null && (t.zoneId !== null || t.participation !== 'shared')
}

export interface ZoneCoverage {
  zoneId: string
  zoneName: string
  shopCount: number
  totalKw: number
  /** Sum of parseable generator sizes; null when any size fails parseFloat. */
  installedKva: number | null
}

export function zoneCoverage(
  tenants: DisplayTenant[],
  zones: GcrZoneRow[],
  generators: GcrZoneGeneratorRow[],
  settings: GeneratorSettings,
): { perZone: ZoneCoverage[]; configured: number; total: number } {
  const perZone = zones.map((z) => {
    const inZone = tenants.filter((t) => t.zoneId === z.id && t.participation === 'shared')
    const totalKw = inZone.reduce(
      (sum, t) =>
        sum +
        calculateTenantLoadingKw(
          {
            shopNumber: t.shop_number ?? '',
            shopName: t.shop_name ?? '',
            areaM2: t.shop_area_m2 ?? 0,
            category: t.category ?? 'standard',
            participation: t.participation,
            manualKwOverride: t.manualKwOverride,
          },
          settings,
        ),
      0,
    )
    const sizes = generators.filter((g) => g.zone_id === z.id).map((g) => parseFloat(g.generator_size ?? ''))
    const installedKva = sizes.length > 0 && sizes.every((n) => Number.isFinite(n))
      ? sizes.reduce((a, b) => a + b, 0)
      : null
    return { zoneId: z.id, zoneName: z.zone_name, shopCount: inZone.length, totalKw, installedKva }
  })
  return {
    perZone,
    configured: tenants.filter(isConfigured).length,
    total: tenants.length,
  }
}
