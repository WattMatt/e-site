/**
 * Solar tabs and readiness (spec §0.3 status dots, §2.3 readiness rules) —
 * the single source for the tab bar and the Overview checklist. Phase 1 has
 * ONE live rule (Site & Supply); every other step is grey "available in a
 * later phase". No statuses are hard-coded per project.
 */
import type { SolarAccessLevel } from './access'

export type SolarTabSlug =
  | 'overview' | 'site' | 'load' | 'schematics' | 'tariff' | 'layout'
  | 'yield' | 'financials' | 'reports' | 'schedule' | 'operations'

export interface SolarTab {
  slug: SolarTabSlug
  label: string
  /** A route exists for this tab. Unbuilt tabs render disabled. */
  built: boolean
  /** Visible only at Edit + financials (COST_VIEW legend). */
  financial: boolean
  /** Not shown at all yet (Operations until Phase 7, D-12). */
  hidden: boolean
}

export const SOLAR_TABS: readonly SolarTab[] = [
  { slug: 'overview',   label: 'Overview',           built: true,  financial: false, hidden: false },
  { slug: 'site',       label: 'Site & Supply',      built: true,  financial: false, hidden: false },
  { slug: 'load',       label: 'Load',               built: true,  financial: false, hidden: false },
  { slug: 'schematics', label: 'Schematics',         built: true,  financial: false, hidden: false },
  { slug: 'tariff',     label: 'Tariff',             built: false, financial: true,  hidden: false },
  { slug: 'layout',     label: 'Layout',             built: false, financial: false, hidden: false },
  { slug: 'yield',      label: 'Yield & Scenarios',  built: false, financial: false, hidden: false },
  { slug: 'financials', label: 'Financials',         built: false, financial: true,  hidden: false },
  { slug: 'reports',    label: 'Reports & Proposal', built: false, financial: false, hidden: false },
  { slug: 'schedule',   label: 'Schedule',           built: false, financial: false, hidden: false },
  { slug: 'operations', label: 'Operations',         built: false, financial: false, hidden: true },
]

export function visibleSolarTabs(level: SolarAccessLevel): SolarTab[] {
  return SOLAR_TABS.filter((t) => !t.hidden && (!t.financial || level === 'edit_financials'))
}

export type ReadinessStatus = 'grey' | 'amber' | 'green' | 'red'

export interface ReadinessStep {
  slug: Exclude<SolarTabSlug, 'overview'>
  label: string
  status: ReadinessStatus
  /** The exact rule outcome — used as the dot tooltip and the checklist text. */
  reason: string
  /** The step's tab exists (so the checklist row can link to it). */
  live: boolean
}

export interface SiteReadinessInput {
  latitude: number | null
  longitude: number | null
  licenseeName: string | null
  nmdKva: number | null
}

export const SA_BOUNDS = { latMin: -35, latMax: -22, lngMin: 16, lngMax: 33 } as const
export const LATER_PHASE_REASON = 'Not started — available in a later phase'

export function isInSouthAfrica(lat: number, lng: number): boolean {
  return lat >= SA_BOUNDS.latMin && lat <= SA_BOUNDS.latMax && lng >= SA_BOUNDS.lngMin && lng <= SA_BOUNDS.lngMax
}

export function siteReadiness(s: SiteReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!s) return { status: 'grey', reason: 'Not started' }
  const hasCoords = s.latitude !== null && s.longitude !== null
  const missing: string[] = []
  if (!hasCoords) missing.push('coordinates')
  if (!s.licenseeName || !s.licenseeName.trim()) missing.push('supply authority')
  if (s.nmdKva === null) missing.push('connection capacity (NMD kVA)')
  if (hasCoords && !isInSouthAfrica(s.latitude as number, s.longitude as number)) {
    return { status: 'red', reason: 'Coordinates are outside South Africa — check the location' }
  }
  if (missing.length === 3) return { status: 'grey', reason: 'Not started' }
  if (missing.length > 0) return { status: 'amber', reason: `Missing: ${missing.join(', ')}` }
  return { status: 'green', reason: 'Coordinates, supply authority and NMD are set' }
}

export interface LoadReadinessInput {
  hasSiteLoad: boolean
  /** The stored inputs hash differs from the current one. */
  stale: boolean
  basis: 'S1' | 'S2' | 'S3' | 'S4' | null
  fullYearFromData: boolean
  unassignedTenants: number
  totalTenants: number
  failingAcceptedImports: number
}

export function loadReadiness(i: LoadReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!i) return { status: 'grey', reason: 'Not started' }
  if (i.failingAcceptedImports > 0) return { status: 'red', reason: `${i.failingAcceptedImports} accepted import(s) carry a validation error` }
  if (!i.hasSiteLoad) return { status: 'amber', reason: 'No site profile built yet' }
  if (i.unassignedTenants > 0) return { status: 'amber', reason: `Load: ${i.unassignedTenants} of ${i.totalTenants} tenants unassigned` }
  const synthesised = i.basis === 'S3' || i.basis === 'S4'
  if (!synthesised && !i.fullYearFromData) return { status: 'amber', reason: 'Meter data covers less than 12 months' }
  if (i.stale) return { status: 'amber', reason: 'Inputs changed since the profile was built — rebuild it' }
  return { status: 'green', reason: synthesised ? 'Synthesised site profile accepted' : 'Site profile built from 12 months of meter data' }
}

export interface SchematicsReadinessInput { waived: boolean; schematics: number; studyMeters: number; placedMeters: number }

export function schematicsReadiness(i: SchematicsReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!i) return { status: 'grey', reason: 'Not started' }
  if (i.waived) return { status: 'green', reason: 'No schematic required' }
  if (i.schematics === 0) return { status: 'grey', reason: 'Not started' }
  const unplaced = Math.max(0, i.studyMeters - i.placedMeters)
  if (unplaced > 0) return { status: 'amber', reason: `${unplaced} of ${i.studyMeters} meters not placed` }
  return { status: 'green', reason: 'Every study meter is placed' }
}

export interface ReadinessExtra {
  load?: LoadReadinessInput | null
  schematics?: SchematicsReadinessInput | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** A solar.studies row (or null) → the readiness input. */
export function toSiteReadinessInput(row: Record<string, unknown> | null | undefined): SiteReadinessInput | null {
  if (!row) return null
  return {
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    licenseeName: typeof row.licensee_name === 'string' ? row.licensee_name : null,
    nmdKva: num(row.nmd_kva),
  }
}

export function computeSolarReadiness(site: SiteReadinessInput | null, level: SolarAccessLevel, extra?: ReadinessExtra): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      // Load / Schematics are live once their tabs are built (3b-i / 3b-ii flip SOLAR_TABS);
      // their status is computed only when the caller passes the aggregate.
      if (t.slug === 'load' && extra && extra.load !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...loadReadiness(extra.load) }
      if (t.slug === 'schematics' && extra && extra.schematics !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...schematicsReadiness(extra.schematics) }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
