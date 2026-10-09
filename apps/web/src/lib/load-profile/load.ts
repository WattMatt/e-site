import 'server-only'
/**
 * Reads a project's load profile through the CALLER's session (00230 RLS) and composes the view.
 * Tariffs too (tariff-source: published years only; the library's own RLS is the gate, ADR-007).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TenantSynthInput } from '@esite/shared/load-profile'
import { composeView, type ComposeInput, type LibraryMeterData, type SourceRow } from './compose'
import { readChannelReadings } from '@/lib/solar/load/readings'
import type { Reading } from '@esite/shared/meter-data'
import { loadCostingTariff } from './tariff-source'
import type { LoadProfileView } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const SOURCE_COLUMNS =
  'id, kind, label, included, file_name, format, source_column, kva_column, interval_min, first_ts_end, values, quality, kva_values, conversion, quality_report, params, role, solar_meter_id, created_at'

export async function loadTenants(supabase: AnyClient, projectId: string): Promise<TenantSynthInput[]> {
  const { data, error } = await supabase.schema('structure').from('nodes')
    .select('id, code, name, shop_number, shop_name, shop_area_m2, shop_category')
    .eq('project_id', projectId).eq('kind', 'tenant_db').is('deleted_at', null)
  if (error) throw new Error(`tenants: ${error.message}`)
  return ((data ?? []) as Row[]).map((n) => ({
    label: [n.shop_number, n.shop_name ?? n.name].filter(Boolean).join(' ') || String(n.code ?? n.id),
    matchName: (n.shop_name as string | null) ?? (n.name as string | null) ?? null,
    areaM2: n.shop_area_m2 == null ? null : Number(n.shop_area_m2),
    category: (n.shop_category as TenantSynthInput['category']) ?? null,
  }))
}

/**
 * Library meters through the caller's session (Solar RLS decides what is readable). A meter can have
 * channels from several imported files (different periods): its primary kW channels are merged by
 * timestamp, and its kVA channels on the same interval likewise. A meter the caller cannot read is
 * simply absent, and its source reports why.
 *
 * Only each meter's LATEST LIBRARY_WINDOW_DAYS are read, ending at its own last reading: the measured
 * series uses the latest 365 complete days (latestWindow), and solar.channel_readings refuses a window
 * over 1,500 days. Meters are read a few at a time, since each has its own window.
 */
export const LIBRARY_WINDOW_DAYS = 400

async function lastReadingMs(supabase: AnyClient, channelId: string): Promise<number> {
  const { data, error } = await supabase.schema('solar').from('meter_readings').select('ts_end').eq('channel_id', channelId).order('ts_end', { ascending: false }).limit(1)
  if (error) throw new Error(`latest reading: ${error.message}`)
  const ts = (data as Array<{ ts_end: string }> | null)?.[0]?.ts_end
  return ts ? Date.parse(ts) : -Infinity
}
const LIBRARY_READ_CONCURRENCY = 6

export async function loadLibraryMeters(supabase: AnyClient, meterIds: string[]): Promise<Map<string, LibraryMeterData>> {
  const out = new Map<string, LibraryMeterData>()
  if (meterIds.length === 0) return out
  const solar = supabase.schema('solar')
  const [{ data: meters }, { data: channels }] = await Promise.all([
    solar.from('meters').select('id, label, kind, site_label').in('id', meterIds),
    solar.from('meter_channels').select('id, meter_id, quantity, direction, phase, unit, interval_min, is_primary, coverage_only').in('meter_id', meterIds),
  ])
  const chans = ((channels ?? []) as Row[]).filter((c) => !c.coverage_only && Number(c.interval_min) < 1440)
  const kwIds = chans.filter((c) => c.is_primary && c.unit === 'kW').map((c) => String(c.id))
  const kvaIds = chans.filter((c) => c.unit === 'kVA' && c.phase == null).map((c) => String(c.id))
  const readings = new Map<string, Reading[]>()
  const meterIdsWithKw = [...new Set(chans.filter((c) => kwIds.includes(String(c.id))).map((c) => String(c.meter_id)))]
  const readMeter = async (meterId: string) => {
    const ids = chans.filter((c) => c.meter_id === meterId && (kwIds.includes(String(c.id)) || kvaIds.includes(String(c.id)))).map((c) => String(c.id))
    // The latest reading per channel is one probe of the (channel_id, ts_end) key; channel_summaries
    // aggregates every row and times out on a 100-meter site.
    const last = Math.max(...(await Promise.all(ids.map((id) => lastReadingMs(supabase, id)))))
    if (!Number.isFinite(last)) return
    for (const [id, rs] of await readChannelReadings(supabase, ids, last - LIBRARY_WINDOW_DAYS * 86_400_000, last + 1)) readings.set(id, rs)
  }
  for (let i = 0; i < meterIdsWithKw.length; i += LIBRARY_READ_CONCURRENCY) {
    await Promise.all(meterIdsWithKw.slice(i, i + LIBRARY_READ_CONCURRENCY).map(readMeter))
  }
  const merged = (ids: string[]) => {
    const byTs = new Map<number, Reading>()
    for (const id of ids) for (const r of readings.get(id) ?? []) if (!byTs.has(r.tsEnd)) byTs.set(r.tsEnd, r)
    return [...byTs.values()].sort((a, b) => a.tsEnd - b.tsEnd)
  }
  for (const m of (meters ?? []) as Row[]) {
    const id = String(m.id)
    const kw = chans.filter((c) => c.meter_id === id && kwIds.includes(String(c.id)))
    if (kw.length === 0) continue
    const intervalMin = Number(kw[0].interval_min)
    const kwSame = kw.filter((c) => Number(c.interval_min) === intervalMin).map((c) => String(c.id))
    const kvaSame = chans.filter((c) => c.meter_id === id && kvaIds.includes(String(c.id)) && Number(c.interval_min) === intervalMin).map((c) => String(c.id))
    out.set(id, {
      label: String(m.label), kind: String(m.kind), siteLabel: (m.site_label as string | null) ?? null, intervalMin,
      kw: merged(kwSame), kva: kvaSame.length ? merged(kvaSame) : null,
    })
  }
  return out
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
    const t = await loadCostingTariff(supabase, settings.tariffId)
    costing = t
      ? { tariffId: t.tariffId, tariff: t.tariff, calendar: t.calendar, calendarAssumedEskom: t.calendarAssumedEskom, label: t.label }
      : { tariffId: settings.tariffId, error: 'This tariff is not available: it is no longer published, or the tariff library is not open to your organisation yet. Choose another.' }
  }
  const libraryIds = [...new Set(rows.filter((r) => r.kind === 'library_meter' && r.solar_meter_id).map((r) => r.solar_meter_id as string))]
  const library = await loadLibraryMeters(supabase, libraryIds)
  const view = composeView({ ...settings, sources: rows, tenants, costing, includeHourly: opts.includeHourly, library })
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
    compositionNote: view.compositionNote,
  }
}
