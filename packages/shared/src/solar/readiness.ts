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
  { slug: 'load',       label: 'Load',               built: false, financial: false, hidden: false },
  { slug: 'schematics', label: 'Schematics',         built: false, financial: false, hidden: false },
  { slug: 'tariff',     label: 'Tariff',             built: false, financial: true,  hidden: false },
  { slug: 'layout',     label: 'Layout',             built: false, financial: false, hidden: false },
  { slug: 'yield',      label: 'Yield & Scenarios',  built: false, financial: false, hidden: false },
  { slug: 'financials', label: 'Financials',         built: false, financial: true,  hidden: false },
  { slug: 'reports',    label: 'Reports & Proposal', built: false, financial: false, hidden: false },
  { slug: 'schedule',   label: 'Schedule',           built: true,  financial: false, hidden: false },
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

export interface ReadinessExtras {
  /** Live solar.schedule_tasks rows on the project; null/undefined = not loaded. */
  scheduleTaskCount?: number | null
}

/**
 * Schedule (functional spec §1.3): green with at least one task — start, end
 * and owner are NOT NULL in 00212, so any task qualifies — grey with none.
 * The red "dependency cycle" case cannot arise (00212 refuses loops at write
 * time), so it is not modelled.
 */
export function scheduleReadiness(count: number | null | undefined): { status: ReadinessStatus; reason: string } {
  if (!count) return { status: 'grey', reason: 'Not started' }
  return { status: 'green', reason: `${count} ${count === 1 ? 'task' : 'tasks'} scheduled` }
}

export function computeSolarReadiness(
  site: SiteReadinessInput | null,
  level: SolarAccessLevel,
  extras: ReadinessExtras = {},
): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      if (t.slug === 'schedule') return { slug: t.slug, label: t.label, live: true, ...scheduleReadiness(extras.scheduleTaskCount) }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
