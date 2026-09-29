// apps/web/src/lib/solar/load/gather.ts
import 'server-only'
/**
 * Everything buildSiteLoad needs for one study, read with the CALLER's client (RLS decides), plus a
 * sha256 of the inputs so the Site profile can say "stale" without reading any readings. Load growth
 * is deliberately NOT in the hash: it changes only the cashflow, never the site series.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeBoDate } from '@esite/shared'
import { sha256Hex, type Reading } from '@esite/shared/meter-data'
import {
  SITE_LOAD_ENGINE_VERSION, type ArchetypeCode, type BuildMeter, type BuildMeterKind, type BuildSiteLoadInput,
  type BuildTenant, type ChannelData, type LoadBasis, type MonthlyBills, type TenantSource,
} from '@esite/shared/solar-load'
import { channelSummaries, readChannelReadings, type ChannelSummary } from './readings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const DAY_MS = 86_400_000
/** Readings older than this before the newest reading are not read (3 years is ample for a 12-month window). */
export const READ_WINDOW_DAYS = 1100

export const STUDY_LOAD_COLUMNS = 'id, load_basis, reference_year, common_area_pct, diversity_factor, load_growth_pct, monthly_bills, schematic_waived, updated_at'
export const METER_COLUMNS = 'id, label, kind, site_label, serials, supply_point_confirmed, existing_pv_channel_id, node_id, shop_no, area_m2, area_source, updated_at'
export const CHANNEL_COLUMNS = 'id, meter_id, file_id, source_column, quantity, direction, unit, interval_min, is_primary, coverage_only, updated_at'
export const NODE_COLUMNS = 'id, code, name, shop_number, shop_name, shop_area_m2, shop_category, status'

export interface StudyLoadRow {
  id: string
  load_basis: LoadBasis | null
  reference_year: number | null
  common_area_pct: number | string
  diversity_factor: number | string
  load_growth_pct: number | string
  monthly_bills: MonthlyBills | null
  schematic_waived: boolean
  updated_at: string
}
export interface ChannelRow {
  id: string
  meter_id: string
  file_id: string | null
  source_column: string
  quantity: string
  direction: string
  unit: string
  interval_min: number
  is_primary: boolean
  coverage_only: boolean
  updated_at: string
}
export interface MeterRow {
  id: string
  label: string
  kind: BuildMeterKind
  site_label: string | null
  serials: string[] | null
  supply_point_confirmed: boolean
  existing_pv_channel_id: string | null
  node_id: string | null
  shop_no: string | null
  area_m2: number | string | null
  area_source: string | null
  updated_at: string
}
export interface TenantNodeRow {
  id: string
  code: string | null
  name: string | null
  shop_number: string | null
  shop_name: string | null
  shop_area_m2: number | string | null
  shop_category: BuildTenant['category']
  status: string
}
export interface BasisRow {
  id: string
  node_id: string
  source: 'metered' | 'synthesised' | 'excluded'
  meters: Array<{ meter_id: string; weight: number }>
  archetype: ArchetypeCode | null
  density_override_w_m2: number | string | null
  updated_at: string
}
export interface MeterChannels { primary: ChannelRow[]; kva: ChannelRow[]; pv: ChannelRow | null }

export function tenantLabel(n: Pick<TenantNodeRow, 'shop_number' | 'shop_name' | 'name' | 'code'>): string {
  const name = n.shop_name ?? n.name ?? n.code ?? 'Tenant'
  return n.shop_number ? `${n.shop_number} · ${name}` : name
}

const newestFirst = (a: ChannelRow, b: ChannelRow) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)

/** A meter's primary kW channels (one per file; the newest's interval wins), kVA at that interval, and its PV channel. */
export function pickChannels(meter: Pick<MeterRow, 'id' | 'existing_pv_channel_id'>, channels: ChannelRow[]): MeterChannels {
  const own = channels.filter((c) => c.meter_id === meter.id && !c.coverage_only)
  const primaries = own.filter((c) => c.is_primary && c.unit === 'kW' && c.quantity === 'active_power').sort(newestFirst)
  const candidates = primaries.length > 0
    ? primaries
    : own.filter((c) => c.unit === 'kW' && c.quantity === 'active_power' && c.direction !== 'export').sort(newestFirst).slice(0, 1)
  const interval = candidates[0]?.interval_min
  return {
    primary: candidates.filter((c) => c.interval_min === interval),
    kva: own.filter((c) => c.quantity === 'apparent_power' && c.unit === 'kVA' && c.interval_min === interval).sort(newestFirst),
    pv: meter.existing_pv_channel_id ? channels.find((c) => c.id === meter.existing_pv_channel_id) ?? null : null,
  }
}

/** Several files' channels of one meter as one reading list; a newer file wins a shared timestamp. */
export function mergeChannelData(list: ChannelRow[], readings: Map<string, Reading[]>): ChannelData | null {
  if (list.length === 0) return null
  const byTs = new Map<number, Reading>()
  for (const c of [...list].reverse()) for (const r of readings.get(c.id) ?? []) byTs.set(r.tsEnd, r)
  return { intervalMin: list[0].interval_min, readings: [...byTs.values()].sort((a, b) => a.tsEnd - b.tsEnd) }
}

export interface InputCounts { studyMeters: number; schematicLines: number; basisRows: number }

export type GatherResult =
  | {
      ok: true
      study: StudyLoadRow
      input: BuildSiteLoadInput
      inputsHash: string
      nodes: TenantNodeRow[]
      basisRows: BasisRow[]
      meters: MeterRow[]
      channels: ChannelRow[]
      picked: Map<string, MeterChannels>
      summaries: Map<string, ChannelSummary>
      /** Sizes of exactly the row sets the hash covers, stored with a build so the cheap stale probe can see a pure DELETE. */
      inputCounts: InputCounts
    }
  | { ok: false; error: 'no_study' }

export async function gatherLoadInputs(
  supabase: AnyClient, projectId: string,
  opts: { readReadings: boolean; onProgress?: (done: number, total: number) => void; now?: Date },
): Promise<GatherResult> {
  const solar = () => supabase.schema('solar')
  const { data: studyRow } = await solar().from('studies').select(STUDY_LOAD_COLUMNS).eq('project_id', projectId).maybeSingle()
  if (!studyRow) return { ok: false, error: 'no_study' }
  const study = studyRow as StudyLoadRow

  const [projectRes, nodesRes, basisRes, linksRes, linesRes] = await Promise.all([
    supabase.schema('projects').from('projects').select('opening_date').eq('id', projectId).maybeSingle(),
    supabase.schema('structure').from('nodes').select(NODE_COLUMNS).eq('project_id', projectId).eq('kind', 'tenant_db').is('deleted_at', null),
    solar().from('tenant_load_basis').select('id, node_id, source, meters, archetype, density_override_w_m2, updated_at').eq('study_id', study.id),
    solar().from('study_meters').select('meter_id').eq('study_id', study.id),
    solar().from('schematic_lines').select('from_meter_id, to_meter_id, line_type').eq('project_id', projectId),
  ])
  const nodes = ((nodesRes.data ?? []) as TenantNodeRow[]).filter((n) => n.status !== 'decommissioned')
  const nodeIds = nodes.map((n) => n.id)
  const { data: details } = nodeIds.length
    ? await supabase.schema('structure').from('tenant_details').select('node_id, bo_period_days, bo_date_override').in('node_id', nodeIds)
    : { data: [] }

  const meterIds = ((linksRes.data ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
  const [meterRes, channelRes] = meterIds.length
    ? await Promise.all([
        solar().from('meters').select(METER_COLUMNS).in('id', meterIds),
        solar().from('meter_channels').select(CHANNEL_COLUMNS).in('meter_id', meterIds),
      ])
    : [{ data: [] }, { data: [] }]
  const meters = (meterRes.data ?? []) as MeterRow[]
  const channels = [...((channelRes.data ?? []) as ChannelRow[])]
  const pvIds = meters.map((m) => m.existing_pv_channel_id).filter((x): x is string => !!x && !channels.some((c) => c.id === x))
  if (pvIds.length > 0) {
    const { data } = await solar().from('meter_channels').select(CHANNEL_COLUMNS).in('id', pvIds)
    channels.push(...((data ?? []) as ChannelRow[]))
  }
  const picked = new Map(meters.map((m) => [m.id, pickChannels(m, channels)]))
  const usedIds = [...new Set([...picked.values()].flatMap((p) => [...p.primary, ...p.kva, ...(p.pv ? [p.pv] : [])].map((c) => c.id)))]
  const summaries = await channelSummaries(supabase, usedIds)
  let readings = new Map<string, Reading[]>()
  if (opts.readReadings && usedIds.length > 0) {
    const last = Math.max(0, ...[...summaries.values()].map((s) => s.lastTs ?? 0))
    if (last > 0) readings = await readChannelReadings(supabase, usedIds, last - READ_WINDOW_DAYS * DAY_MS, last + 1000, opts.onProgress)
  }

  const opening = (projectRes.data as { opening_date?: string | null } | null)?.opening_date ?? null
  const bo = new Map(((details ?? []) as Array<{ node_id: string; bo_period_days: number | null; bo_date_override: string | null }>).map((d) => [d.node_id, d]))
  const basisRows = (basisRes.data ?? []) as BasisRow[]
  const basisByNode = new Map(basisRows.map((b) => [b.node_id, b]))
  const tenants: BuildTenant[] = nodes.map((n) => {
    const b = basisByNode.get(n.id)
    const d = bo.get(n.id)
    return {
      nodeId: n.id,
      label: tenantLabel(n),
      areaM2: n.shop_area_m2 == null ? null : Number(n.shop_area_m2),
      category: n.shop_category ?? null,
      source: (b?.source ?? 'unassigned') as TenantSource,
      meters: (b?.meters ?? []).map((x) => ({ meterId: x.meter_id, weight: Number(x.weight) })),
      archetype: b?.archetype ?? null,
      densityOverrideWPerM2: b?.density_override_w_m2 == null ? null : Number(b.density_override_w_m2),
      boDate: computeBoDate(opening, d?.bo_period_days ?? null, d?.bo_date_override ?? null),
    }
  })
  const buildMeters: BuildMeter[] = meters.map((m) => {
    const p = picked.get(m.id) as MeterChannels
    return {
      meterId: m.id, label: m.label, kind: m.kind, supplyPointConfirmed: m.supply_point_confirmed, serials: m.serials ?? [],
      primary: mergeChannelData(p.primary, readings), kva: mergeChannelData(p.kva, readings),
      existingPv: p.pv ? mergeChannelData([p.pv], readings) : null,
    }
  })
  const lines = ((linesRes.data ?? []) as Array<{ from_meter_id: string; to_meter_id: string; line_type: 'supply' | 'check' }>)
    .map((l) => ({ fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, lineType: l.line_type }))
  const input: BuildSiteLoadInput = {
    basis: study.load_basis ?? 'S2',
    referenceYear: study.reference_year,
    fallbackYear: (opts.now ?? new Date()).getUTCFullYear() - 1,
    commonAreaPct: Number(study.common_area_pct),
    diversityFactor: Number(study.diversity_factor),
    tenants,
    meters: buildMeters,
    lines,
    bills: study.monthly_bills ?? null,
  }

  const summaryKey = (id: string) => {
    const s = summaries.get(id)
    return [id, s?.nRows ?? 0, s?.lastTs ?? null, s?.sumValue ?? null]
  }
  const canonical = {
    engine: SITE_LOAD_ENGINE_VERSION,
    settings: [input.basis, input.referenceYear, input.commonAreaPct, input.diversityFactor, input.bills],
    tenants: tenants.map((t) => JSON.stringify(t)).sort(),
    meters: meters.map((m) => {
      const p = picked.get(m.id) as MeterChannels
      return JSON.stringify([m.id, m.kind, m.supply_point_confirmed, [...(m.serials ?? [])].sort(),
        p.primary.map((c) => summaryKey(c.id)), p.kva.map((c) => summaryKey(c.id)), p.pv ? summaryKey(p.pv.id) : null])
    }).sort(),
    lines: lines.map((l) => JSON.stringify(l)).sort(),
  }
  return {
    ok: true, study, input, inputsHash: await sha256Hex(JSON.stringify(canonical)),
    nodes, basisRows, meters, channels, picked, summaries,
    inputCounts: { studyMeters: meterIds.length, schematicLines: lines.length, basisRows: basisRows.length },
  }
}
