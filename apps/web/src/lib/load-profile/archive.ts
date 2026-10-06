import 'server-only'
/**
 * The workspace Load profiles page: the org's Solar meter library grouped by site (meters.site_label).
 * The archive sites are entries here, never projects (owner, 2026-10-05). Read through the caller's
 * session, so Solar RLS decides what is listed; an org without a Solar library sees none.
 */
import { roleOfKind, type MeterKind } from '@esite/shared/load-profile'
import { composeView, type SourceRow } from './compose'
import { loadLibraryMeters, type AnyClient } from './load'
import type { LoadProfileView } from './view-types'

type Row = Record<string, unknown>

export interface ArchiveSite {
  site: string
  meters: number
  kinds: Record<string, number>
}

const PAGE = 1000

/** The site from the route segment: decoded once if still encoded, never throwing on a literal '%'. */
export function siteFromParam(raw: string): string {
  let site = raw
  try { site = decodeURIComponent(raw) } catch { /* already decoded */ }
  return site.slice(0, 200)
}

/** Reference year and power factor from the query string; anything out of range falls back to the defaults. */
export function archiveSettings(q: { year?: string; pf?: string }): { referenceYear: number; powerFactor: number } {
  const year = Number(q.year)
  const pf = Number(q.pf)
  return { referenceYear: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : 2025, powerFactor: pf > 0 && pf <= 1 ? pf : 0.95 }
}

async function allMeters(supabase: AnyClient, site?: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.schema('solar').from('meters').select('id, label, kind, site_label, shop_no').neq('kind', 'water').order('site_label').order('label').range(from, from + PAGE - 1)
    if (site !== undefined) q = q.eq('site_label', site)
    const { data, error } = await q
    if (error) throw new Error(`meters: ${error.message}`)
    out.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) return out
  }
}

export async function listArchiveSites(supabase: AnyClient): Promise<ArchiveSite[]> {
  const bySite = new Map<string, ArchiveSite>()
  for (const m of await allMeters(supabase)) {
    const site = String(m.site_label ?? '').trim()
    if (!site) continue
    const s = bySite.get(site) ?? { site, meters: 0, kinds: {} }
    s.meters++
    s.kinds[String(m.kind)] = (s.kinds[String(m.kind)] ?? 0) + 1
    bySite.set(site, s)
  }
  return [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site))
}

/**
 * A site's analysis: every library meter of the site as a source, its role from its kind (the bulk rule
 * then decides what is added: Σ bulk, else Σ tenant; check / submain / solar / generator shown only).
 */
export async function loadArchiveSiteView(supabase: AnyClient, site: string, opts: { referenceYear: number; powerFactor: number; includeHourly?: boolean }): Promise<LoadProfileView | null> {
  const meters = await allMeters(supabase, site)
  if (meters.length === 0) return null
  const library = await loadLibraryMeters(supabase, meters.map((m) => String(m.id)))
  const rows: SourceRow[] = meters.map((m) => ({
    id: String(m.id), kind: 'library_meter', label: `${String(m.label)}${m.shop_no ? ` · shop ${String(m.shop_no)}` : ''}`.slice(0, 200), included: true,
    file_name: null, format: null, source_column: null, kva_column: null, interval_min: null, first_ts_end: null,
    values: null, quality: null, kva_values: null, conversion: null, quality_report: null, params: null,
    role: roleOfKind(String(m.kind) as MeterKind), solar_meter_id: String(m.id),
  }))
  const v = composeView({ referenceYear: opts.referenceYear, powerFactor: opts.powerFactor, nmdKva: null, sources: rows, tenants: [], costing: null, library, includeHourly: opts.includeHourly })
  return {
    projectId: '', projectName: site, canEdit: false, profileId: null,
    settings: { referenceYear: opts.referenceYear, powerFactor: opts.powerFactor, nmdKva: null, tariffId: null },
    sources: v.sources, tenants: { count: 0, withArea: 0, totalAreaM2: 0 }, analysis: v.analysis, cost: null, compositionNote: v.compositionNote,
  }
}
