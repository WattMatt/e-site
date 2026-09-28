/**
 * Solar tabs and readiness (spec §0.3 status dots, §2.3 readiness rules) —
 * the single source for the tab bar and the Overview checklist. Live rules:
 * Site & Supply (Phase 1), Yield & Scenarios and Financials (Phase 4b), and
 * Layout when the selected case uses a manual system size; every other step
 * is grey "available in a later phase". No statuses are hard-coded per project.
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
  { slug: 'yield',      label: 'Yield & Scenarios',  built: true,  financial: false, hidden: false },
  { slug: 'financials', label: 'Financials',         built: true,  financial: true,  hidden: false },
  { slug: 'reports',    label: 'Reports & Proposal', built: true , financial: false, hidden: false },
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

export interface YieldReadinessInput {
  caseCount: number
  selectedCaseId: string | null
  selectedStatus: 'not_run' | 'running' | 'done' | 'failed' | 'stale' | null
}
export function yieldReadiness(y: YieldReadinessInput): { status: ReadinessStatus; reason: string } {
  if (y.caseCount === 0) return { status: 'grey', reason: 'No cases yet' }
  if (!y.selectedCaseId) return { status: 'amber', reason: 'Cases exist but none is selected' }
  switch (y.selectedStatus) {
    case 'failed': return { status: 'red', reason: 'The selected case’s last run failed' }
    case 'stale': return { status: 'amber', reason: 'The selected case is stale — re-run it' }
    case 'running': return { status: 'amber', reason: 'The selected case is running' }
    case 'done': return { status: 'green', reason: 'The selected case’s run is current' }
    default: return { status: 'amber', reason: 'The selected case has not been run' }
  }
}

export interface FinancialsReadinessInput {
  capexZar: number; hasModel: boolean; usingOrgDefaults: boolean
  /** false = the selected case has no saved financials row: the tab opens on the org defaults (§2.3 amber). */
  saved?: boolean
}
export function financialsReadiness(f: FinancialsReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!f) return { status: 'grey', reason: 'No financials yet' }
  if (f.saved === false) return { status: 'amber', reason: 'Using org defaults — review the capex' }
  if (!(f.capexZar > 0) || !f.hasModel) return { status: 'amber', reason: 'Add capex and choose a finance model' }
  if (f.usingOrgDefaults) return { status: 'amber', reason: 'Using org defaults — review the capex' }
  return { status: 'green', reason: 'Capex and a finance model are set' }
}

export function reportsReadiness(r: { hasCurrentFeasibility: boolean } | null): { status: ReadinessStatus; reason: string } {
  if (!r) return { status: 'grey', reason: 'Feasibility reports need Edit + financials access' }
  return r.hasCurrentFeasibility
    ? { status: 'green', reason: 'A feasibility report exists for the selected case’s current run' }
    : { status: 'grey', reason: 'No feasibility report for the selected case’s current run yet' }
}

export interface SolarReadinessExtra {
  yield?: YieldReadinessInput
  financials?: FinancialsReadinessInput | null
  /** Null (or absent) for callers below Edit + financials, who cannot see feasibility reports. */
  reports?: { hasCurrentFeasibility: boolean } | null
  /** The selected case uses a manual system size (§2.3 Layout rule). */
  layoutManual?: boolean
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

export function computeSolarReadiness(site: SiteReadinessInput | null, level: SolarAccessLevel, extra: SolarReadinessExtra = {}): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      if (t.slug === 'yield') return { slug: t.slug, label: t.label, live: true, ...yieldReadiness(extra.yield ?? { caseCount: 0, selectedCaseId: null, selectedStatus: null }) }
      if (t.slug === 'financials') return { slug: t.slug, label: t.label, live: true, ...financialsReadiness(extra.financials ?? null) }
      if (t.slug === 'reports') return { slug: t.slug, label: t.label, live: true, ...reportsReadiness(extra.reports ?? null) }
      if (t.slug === 'layout' && extra.layoutManual) return { slug: t.slug, label: t.label, live: t.built, status: 'green' as const, reason: 'The selected case uses a manual system size' }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
