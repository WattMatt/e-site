/**
 * Solar tabs and readiness (spec §0.3 status dots, §2.3 readiness rules) —
 * the single source for the tab bar and the Overview checklist. Live rules:
 * Site & Supply (1), Load and Schematics (3b), Tariff (2b, via withTariffReadiness),
 * Layout (5; green when the selected case uses a manual size, 4b), Yield & Scenarios
 * and Financials (4b), Schedule (5b). A built tab whose aggregate the caller did not
 * pass is a live grey "Not started"; only an unbuilt tab (Reports) is "available in a
 * later phase". No statuses are hard-coded per project.
 */
import type { SolarAccessLevel } from './access'
import { layoutReadiness, type LayoutReadinessInput } from './layout/readiness'

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
  { slug: 'tariff',     label: 'Tariff',             built: true,  financial: true,  hidden: false },
  { slug: 'layout',     label: 'Layout',             built: true,  financial: false, hidden: false },
  { slug: 'yield',      label: 'Yield & Scenarios',  built: true,  financial: false, hidden: false },
  { slug: 'financials', label: 'Financials',         built: true,  financial: true,  hidden: false },
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
  // Tenant assignment only feeds the build under S2/S3 (null = S2). S1 reads the bulk meter and S4
  // scales monthly bills, so unassigned tenants there change nothing and must not hold the dot amber.
  const tenantsMatter = i.basis === null || i.basis === 'S2' || i.basis === 'S3'
  if (tenantsMatter && i.unassignedTenants > 0) return { status: 'amber', reason: `Load: ${i.unassignedTenants} of ${i.totalTenants} tenants unassigned` }
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

export interface SolarReadinessExtra {
  yield?: YieldReadinessInput
  financials?: FinancialsReadinessInput | null
  /** The selected case uses a manual system size (§2.3 Layout rule). */
  layoutManual?: boolean
  /** Phase 5: the layout aggregate (undefined = not computed). */
  layout?: LayoutReadinessInput | null
  /** Phase 5b: live solar.schedule_tasks rows on the project; null/undefined = not loaded. */
  scheduleTaskCount?: number | null
  /** Phase 3b: computed only when the caller passes the aggregate (undefined = not computed). */
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

export function computeSolarReadiness(site: SiteReadinessInput | null, level: SolarAccessLevel, extra: SolarReadinessExtra = {}): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      if (t.slug === 'yield') return { slug: t.slug, label: t.label, live: true, ...yieldReadiness(extra.yield ?? { caseCount: 0, selectedCaseId: null, selectedStatus: null }) }
      if (t.slug === 'financials') return { slug: t.slug, label: t.label, live: true, ...financialsReadiness(extra.financials ?? null) }
      if (t.slug === 'layout' && extra.layoutManual) return { slug: t.slug, label: t.label, live: t.built, status: 'green' as const, reason: 'The selected case uses a manual system size' }
      // Load / Schematics are live once their tabs are built (3b-i / 3b-ii flip SOLAR_TABS);
      // their status is computed only when the caller passes the aggregate.
      if (t.slug === 'load' && extra.load !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...loadReadiness(extra.load) }
      if (t.slug === 'schematics' && extra.schematics !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...schematicsReadiness(extra.schematics) }
      // The Layout step (Phase 5) is computed only when the caller passes the aggregate; a manual-size
      // selected case (4b, above) wins because that case needs no layout.
      if (t.slug === 'layout' && extra.layout !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...layoutReadiness(extra.layout) }
      if (t.slug === 'schedule') return { slug: t.slug, label: t.label, live: true, ...scheduleReadiness(extra.scheduleTaskCount) }
      // A built tab whose aggregate the caller did not pass is still a live link (grey, not
      // "later phase" — that sentence would be false once every phase through 5b is merged).
      return { slug: t.slug, label: t.label, live: t.built, status: 'grey' as const, reason: t.built ? 'Not started' : LATER_PHASE_REASON }
    })
}
