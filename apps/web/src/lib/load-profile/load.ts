import 'server-only'
/**
 * Reads a project's load profile through the CALLER's session (00225 RLS) and composes the view.
 * Tariffs come from tariff-source (service client, published years only).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TenantSynthInput } from '@esite/shared/load-profile'
import { composeView, type ComposeInput, type SourceRow } from './compose'
import { loadCostingTariff } from './tariff-source'
import type { LoadProfileView } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const SOURCE_COLUMNS =
  'id, kind, label, included, file_name, format, source_column, kva_column, interval_min, first_ts_end, values, quality, kva_values, conversion, quality_report, params, created_at'

export async function loadTenants(supabase: AnyClient, projectId: string): Promise<TenantSynthInput[]> {
  const { data, error } = await supabase.schema('structure').from('nodes')
    .select('id, code, name, shop_number, shop_name, shop_area_m2, shop_category')
    .eq('project_id', projectId).eq('kind', 'tenant_db').is('deleted_at', null)
  if (error) throw new Error(`tenants: ${error.message}`)
  return ((data ?? []) as Row[]).map((n) => ({
    label: [n.shop_number, n.shop_name ?? n.name].filter(Boolean).join(' ') || String(n.code ?? n.id),
    areaM2: n.shop_area_m2 == null ? null : Number(n.shop_area_m2),
    category: (n.shop_category as TenantSynthInput['category']) ?? null,
  }))
}

export async function loadLoadProfileView(supabase: AnyClient, projectId: string, opts: { canEdit: boolean; includeHourly?: boolean }): Promise<LoadProfileView> {
  const p = supabase.schema('projects')
  const [{ data: project }, { data: profile, error: pe }, tenants] = await Promise.all([
    p.from('projects').select('name').eq('id', projectId).maybeSingle(),
    p.from('load_profiles').select('id, reference_year, power_factor, nmd_kva, tariff_id').eq('project_id', projectId).maybeSingle(),
    loadTenants(supabase, projectId),
  ])
  if (pe) throw new Error(`load profile: ${pe.message}`)
  const prof = profile as Row | null
  const settings = {
    referenceYear: prof ? Number(prof.reference_year) : 2025,
    powerFactor: prof ? Number(prof.power_factor) : 0.95,
    nmdKva: prof?.nmd_kva == null ? null : Number(prof.nmd_kva),
    tariffId: (prof?.tariff_id as string | null) ?? null,
  }
  let rows: SourceRow[] = []
  if (prof) {
    const { data, error } = await p.from('load_profile_sources').select(SOURCE_COLUMNS).eq('profile_id', prof.id as string).order('created_at')
    if (error) throw new Error(`load profile sources: ${error.message}`)
    rows = (data ?? []) as unknown as SourceRow[]
  }
  let costing: ComposeInput['costing'] = null
  if (settings.tariffId) {
    const t = await loadCostingTariff(settings.tariffId)
    costing = t
      ? { tariffId: t.tariffId, tariff: t.tariff, calendar: t.calendar, calendarAssumedEskom: t.calendarAssumedEskom, label: t.label }
      : { tariffId: settings.tariffId, error: 'This tariff is no longer published. Choose another.' }
  }
  const view = composeView({ ...settings, sources: rows, tenants, costing, includeHourly: opts.includeHourly })
  return {
    projectId,
    projectName: String((project as Row | null)?.name ?? ''),
    canEdit: opts.canEdit,
    profileId: (prof?.id as string | undefined) ?? null,
    settings,
    sources: view.sources,
    tenants: {
      count: tenants.length,
      withArea: tenants.filter((t) => (t.areaM2 ?? 0) > 0).length,
      totalAreaM2: tenants.reduce((s, t) => s + (t.areaM2 ?? 0), 0),
    },
    analysis: view.analysis,
    cost: view.cost,
  }
}
