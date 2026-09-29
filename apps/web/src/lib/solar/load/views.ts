// apps/web/src/lib/solar/load/views.ts
import 'server-only'
/**
 * Server loaders for the Load tab's four sub-tabs and the gated layout's readiness aggregate. Read
 * with the caller's client; everything a client component receives is JSON (view-types.ts).
 * Nothing here computes load: charts come from siteProfileCharts over the STORED series.
 */
import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeBoDate, loadReadiness, loadSettingsFormFromRow, type LoadReadinessInput, type SchematicsReadinessInput } from '@esite/shared'
import {
  autoMatchMeters, CATEGORY_ARCHETYPE, NOT_TENANT_KINDS, DEFAULT_DENSITY_W_PER_M2, siteProfileCharts, type BulkReconciliation, type LoadCheck,
  type MdMonth, type ParentReconciliation, type SiteLoadCoverage, type TenantSummary,
} from '@esite/shared/solar-load'
import {
  CHANNEL_COLUMNS, gatherLoadInputs, METER_COLUMNS, NODE_COLUMNS, pickChannels, STUDY_LOAD_COLUMNS, tenantLabel,
  type ChannelRow, type InputCounts, type MeterRow, type StudyLoadRow, type TenantNodeRow,
} from './gather'
import { channelSummaries } from './readings'
import { isVacantTenant, type AutoMatchView, type ChecksView, type MetersView, type MeterView, type ProfileView, type TenantRowView, type TenantsView } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const DAY = 86_400_000

interface SiteLoadRow {
  id: string
  basis: 'S1' | 'S2' | 'S3' | 'S4'
  reference_year: number
  series: number[]
  md_monthly: MdMonth[]
  inputs_hash: string
  built_at: string
  coverage: SiteLoadCoverage & { designMdKw: number | null; checks: LoadCheck[]; reconciliation: { bulk: BulkReconciliation[]; parents: ParentReconciliation[] }; tenants: TenantSummary[]; inputCounts?: InputCounts }
}

async function study(supabase: AnyClient, projectId: string): Promise<StudyLoadRow | null> {
  const { data } = await supabase.schema('solar').from('studies').select(STUDY_LOAD_COLUMNS).eq('project_id', projectId).maybeSingle()
  return (data as StudyLoadRow | null) ?? null
}
async function latestSiteLoad(supabase: AnyClient, studyId: string): Promise<SiteLoadRow | null> {
  const { data } = await supabase.schema('solar').from('site_load').select('id, basis, reference_year, series, md_monthly, inputs_hash, built_at, coverage')
    .eq('study_id', studyId).order('built_at', { ascending: false }).limit(1).maybeSingle()
  return (data as SiteLoadRow | null) ?? null
}
async function tenantNodes(supabase: AnyClient, projectId: string): Promise<TenantNodeRow[]> {
  const { data } = await supabase.schema('structure').from('nodes').select(NODE_COLUMNS).eq('project_id', projectId).eq('kind', 'tenant_db').is('deleted_at', null)
  return ((data ?? []) as TenantNodeRow[]).filter((n) => n.status !== 'decommissioned').sort((a, b) => (a.shop_number ?? '').localeCompare(b.shop_number ?? '', undefined, { numeric: true }))
}
async function studyMeters(supabase: AnyClient, studyId: string): Promise<{ meters: MeterRow[]; channels: ChannelRow[] }> {
  const { data: links } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', studyId)
  const ids = ((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
  if (ids.length === 0) return { meters: [], channels: [] }
  const [m, c] = await Promise.all([
    supabase.schema('solar').from('meters').select(METER_COLUMNS).in('id', ids),
    supabase.schema('solar').from('meter_channels').select(CHANNEL_COLUMNS).in('meter_id', ids),
  ])
  return { meters: ((m.data ?? []) as MeterRow[]).sort((a, b) => a.label.localeCompare(b.label)), channels: (c.data ?? []) as ChannelRow[] }
}
const isVacant = (n: TenantNodeRow) => isVacantTenant(n)

type BasisLite = { node_id: string; source: string; meters: Array<{ meter_id: string }> | null }

/**
 * The tenant label for each meter, from tenant_load_basis (what the builder uses). A meter in a
 * synthesised or excluded tenant's row says so (the builder ignores it there). meters.node_id (the
 * tenant chosen at import) is shown only as "not assigned" when that tenant has no basis row yet —
 * exactly the case Auto-match proposes it for.
 */
export function meterTenantLabels(basisRows: BasisLite[], nodeLabel: Map<string, string>) {
  const on = new Map<string, string[]>()
  const hasBasis = new Set(basisRows.map((b) => b.node_id))
  for (const b of basisRows) {
    const label = `${nodeLabel.get(b.node_id) ?? 'Tenant'}${b.source === 'metered' ? '' : ` (${b.source})`}`
    for (const x of b.meters ?? []) on.set(x.meter_id, [...(on.get(x.meter_id) ?? []), label])
  }
  return (m: { id: string; kind: string; node_id: string | null }): string | null => {
    const labels = on.get(m.id)
    if (labels) return labels.join(', ')
    const chosen = m.node_id && !hasBasis.has(m.node_id) && !NOT_TENANT_KINDS.has(m.kind) ? nodeLabel.get(m.node_id) : undefined
    return chosen ? `${chosen} (not assigned — Tenants → Auto-match)` : null
  }
}

export async function loadMetersView(supabase: AnyClient, projectId: string, isGrantor: boolean): Promise<MetersView> {
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id, cloud_storage_connection_id, cloud_storage_folder_id').eq('id', projectId).maybeSingle()
  const p = (project ?? {}) as { organisation_id?: string; cloud_storage_connection_id?: string | null; cloud_storage_folder_id?: string | null }
  const s = await study(supabase, projectId)
  const nodes = await tenantNodes(supabase, projectId)
  const nodeLabel = new Map(nodes.map((n) => [n.id, tenantLabel(n)]))
  const { meters, channels } = s ? await studyMeters(supabase, s.id) : { meters: [], channels: [] }
  const picked = new Map(meters.map((m) => [m.id, pickChannels(m, channels)]))
  const primaryIds = [...picked.values()].flatMap((x) => x.primary.map((c) => c.id))
  const sums = await channelSummaries(supabase, primaryIds)
  // The tenant a meter feeds is read from tenant_load_basis, the one place the builder reads it from.
  const basisRes = s ? await supabase.schema('solar').from('tenant_load_basis').select('node_id, source, meters').eq('study_id', s.id) : { data: [], error: null }
  const tenantOf = basisRes.error
    ? (m: { node_id: string | null }) => (m.node_id ? nodeLabel.get(m.node_id) ?? null : null)
    : meterTenantLabels((basisRes.data ?? []) as BasisLite[], nodeLabel)
  const otherLinks = new Map<string, number>()
  if (isGrantor && meters.length > 0) {
    const { data } = await supabase.schema('solar').from('study_meters').select('meter_id, study_id').in('meter_id', meters.map((m) => m.id))
    for (const r of (data ?? []) as Array<{ meter_id: string; study_id: string }>) if (r.study_id !== s?.id) otherLinks.set(r.meter_id, (otherLinks.get(r.meter_id) ?? 0) + 1)
  }
  const view: MeterView[] = meters.map((m) => {
    const pc = picked.get(m.id) as ReturnType<typeof pickChannels>
    const ss = pc.primary.map((c) => sums.get(c.id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    const interval = pc.primary[0]?.interval_min ?? null
    const first = ss.length ? Math.min(...ss.map((x) => x.firstTs ?? Infinity)) : null
    const last = ss.length ? Math.max(...ss.map((x) => x.lastTs ?? 0)) : null
    const nUsable = ss.reduce((a, x) => a + x.nUsable, 0)
    const sum = ss.reduce((a, x) => a + (x.sumValue ?? 0), 0)
    const slots = first !== null && last !== null && interval ? Math.round((last - first) / (interval * 60_000)) + 1 : null
    const spanDays = first !== null && last !== null && interval ? (last - first) / DAY + interval / 1440 : null
    return {
      id: m.id, label: m.label, kind: m.kind, siteLabel: m.site_label, serials: m.serials ?? [], nodeId: m.node_id,
      tenantLabel: tenantOf(m), shopNo: m.shop_no,
      areaM2: m.area_m2 == null ? null : Number(m.area_m2), supplyPointConfirmed: m.supply_point_confirmed, updatedAt: m.updated_at,
      primaryChannelId: pc.primary[0]?.id ?? null, intervalMin: interval,
      periodStart: first !== null && Number.isFinite(first) ? new Date(first).toISOString() : null,
      periodEnd: last ? new Date(last).toISOString() : null,
      completeness: slots ? nUsable / slots : null,
      peakKw: ss.length ? Math.max(...ss.map((x) => x.maxValue ?? 0)) : null,
      annualKwh: spanDays && interval ? (sum * (interval / 60) * 365) / spanDays : null,
      fileIds: [...new Set(channels.filter((c) => c.meter_id === m.id && c.file_id).map((c) => c.file_id as string))],
      otherStudyLinks: otherLinks.get(m.id) ?? 0,
      status: pc.primary.length > 0 && ss.length > 0 ? 'imported' : 'no_data',
    }
  })
  const orgId = p.organisation_id ?? ''
  const [{ data: reg }, { data: files }] = await Promise.all([
    supabase.schema('solar').from('meter_register').select('id, site_label, file_name, tenant_name, shop_no, area_m2, match_method, confirmed_at, kind').eq('organisation_id', orgId).eq('kind', 'summary').limit(2000),
    supabase.schema('solar').from('meter_files').select('original_name').eq('organisation_id', orgId).limit(5000),
  ])
  const imported = new Set(((files ?? []) as Array<{ original_name: string }>).map((f) => f.original_name.toLowerCase()))
  const sl = s ? await latestSiteLoad(supabase, s.id) : null
  return {
    studyId: s?.id ?? null,
    orgId,
    meters: view,
    nodes: nodes.map((n) => ({ id: n.id, label: tenantLabel(n), shopNumber: n.shop_number })),
    register: ((reg ?? []) as Array<{ id: string; site_label: string | null; file_name: string | null; tenant_name: string | null; shop_no: string | null; area_m2: number | null; match_method: string; confirmed_at: string | null }>).map((r) => ({
      id: r.id, siteLabel: r.site_label, fileName: r.file_name, tenantName: r.tenant_name, shopNo: r.shop_no,
      areaM2: r.area_m2 == null ? null : Number(r.area_m2), matchMethod: r.match_method, confirmed: r.confirmed_at !== null,
      fileImported: r.file_name ? imported.has(r.file_name.toLowerCase()) : false,
    })),
    cloudMapped: Boolean(p.cloud_storage_connection_id && p.cloud_storage_folder_id),
    isGrantor,
    bulkRecon: sl?.coverage.reconciliation?.bulk ?? [],
  }
}

export async function loadTenantsView(supabase: AnyClient, projectId: string): Promise<TenantsView> {
  const s = await study(supabase, projectId)
  const nodes = await tenantNodes(supabase, projectId)
  const { meters } = s ? await studyMeters(supabase, s.id) : { meters: [] }
  const { data: basisRows } = s ? await supabase.schema('solar').from('tenant_load_basis').select('id, node_id, source, meters, archetype, density_override_w_m2, updated_at').eq('study_id', s.id) : { data: [] }
  const basis = new Map(((basisRows ?? []) as Array<{ id: string; node_id: string; source: 'metered' | 'synthesised' | 'excluded'; meters: Array<{ meter_id: string; weight: number }>; archetype: string | null; density_override_w_m2: number | null; updated_at: string }>).map((b) => [b.node_id, b]))
  const nodeIds = nodes.map((n) => n.id)
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id, opening_date').eq('id', projectId).maybeSingle()
  const opening = (project as { opening_date?: string | null } | null)?.opening_date ?? null
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id ?? ''
  const { data: details } = nodeIds.length ? await supabase.schema('structure').from('tenant_details').select('node_id, bo_period_days, bo_date_override').in('node_id', nodeIds) : { data: [] }
  const bo = new Map(((details ?? []) as Array<{ node_id: string; bo_period_days: number | null; bo_date_override: string | null }>).map((d) => [d.node_id, computeBoDate(opening, d.bo_period_days, d.bo_date_override)]))
  const sl = s ? await latestSiteLoad(supabase, s.id) : null
  const summaries = new Map((sl?.coverage.tenants ?? []).map((t) => [t.nodeId, t]))
  const tenants: TenantRowView[] = nodes.map((n) => {
    const b = basis.get(n.id)
    const cat = n.shop_category ?? 'standard'
    return {
      nodeId: n.id, shopNumber: n.shop_number, name: n.shop_name ?? n.name ?? n.code ?? 'Tenant', category: n.shop_category,
      areaM2: n.shop_area_m2 == null ? null : Number(n.shop_area_m2), boDate: bo.get(n.id) ?? null,
      basis: b ? { id: b.id, source: b.source, meters: b.meters.map((m) => ({ meterId: m.meter_id, weight: Number(m.weight) })), archetype: b.archetype, densityOverride: b.density_override_w_m2 == null ? null : Number(b.density_override_w_m2), updatedAt: b.updated_at } : null,
      summary: summaries.get(n.id) ?? null,
      vacant: isVacant(n),
      defaultDensity: DEFAULT_DENSITY_W_PER_M2[cat],
      defaultArchetype: CATEGORY_ARCHETYPE[cat],
    }
  })
  const assigned = new Set([...basis.values()].flatMap((b) => b.meters.map((m) => m.meter_id)))
  const { data: reg } = await supabase.schema('solar').from('meter_register').select('file_name, shop_no, tenant_name, serial, match_method, confirmed_at').eq('organisation_id', orgId).eq('kind', 'summary').limit(2000)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const meterById = new Map(meters.map((m) => [m.id, m]))
  const proposals: AutoMatchView[] = autoMatchMeters({
    // The tenant chosen at import is proposed only while that tenant has no basis row: once someone has
    // decided the tenant on the Tenants tab, a stale node_id must not keep re-proposing a removed meter.
    meters: meters.map((m) => ({ meterId: m.id, label: m.label, kind: m.kind, serials: m.serials ?? [], shopNo: m.shop_no, nodeId: m.node_id && !basis.has(m.node_id) ? m.node_id : null })),
    tenants: nodes.map((n) => ({ nodeId: n.id, shopNumber: n.shop_number, name: n.shop_name ?? n.name })),
    register: ((reg ?? []) as Array<{ file_name: string | null; shop_no: string | null; tenant_name: string | null; serial: string | null; match_method: 'exact' | 'llm' | 'unmapped' | 'manual' | 'none'; confirmed_at: string | null }>).map((r) => ({
      fileName: r.file_name, shopNo: r.shop_no, tenantName: r.tenant_name, serial: r.serial, matchMethod: r.match_method, confirmed: r.confirmed_at !== null,
    })),
    assignedMeterIds: assigned,
  }).map((p) => ({
    ...p, nodeLabel: tenantLabel(nodeById.get(p.nodeId) as TenantNodeRow), meterLabel: meterById.get(p.meterId)?.label ?? p.meterId,
    meterUpdatedAt: meterById.get(p.meterId)?.updated_at ?? null, basisUpdatedAt: basis.get(p.nodeId)?.updated_at ?? null,
  }))
  return {
    studyId: s?.id ?? null, studyUpdatedAt: s?.updated_at ?? null, commonAreaPct: s ? Number(s.common_area_pct) : 0,
    tenants, studyMeters: meters.map((m) => ({ id: m.id, label: m.label, kind: m.kind })), proposals,
  }
}

/**
 * Per-request memo (React `cache` scopes the Map to one server render), so the gated layout and the
 * page beneath it (overview, Site profile) share one staleness answer instead of each recomputing it.
 * Keyed on the project, not the client object: every caller in one request is the same session.
 * Outside a render (server actions, tests) `cache` does not memoise, so nothing leaks across requests.
 */
const requestMemo = cache(() => new Map<string, Promise<unknown>>())
function memo<T>(key: string, run: () => Promise<T>): Promise<T> {
  const m = requestMemo()
  let p = m.get(key) as Promise<T> | undefined
  if (!p) { p = run(); m.set(key, p) }
  return p
}

/**
 * The FULL staleness rule, for the Site profile banner: the stored inputs hash vs one recomputed from
 * rows + per-channel summaries (no readings read). It calls `channel_summaries`, which can fail (a
 * statement timeout, >500 channels → 22023); a failure reads as "not stale" and is logged — it must
 * never take the page down.
 */
function siteLoadIsStale(supabase: AnyClient, projectId: string, storedHash: string): Promise<boolean> {
  return memo(`hash:${projectId}:${storedHash}`, async () => {
    try {
      const g = await gatherLoadInputs(supabase, projectId, { readReadings: false })
      return g.ok ? g.inputsHash !== storedHash : false
    } catch (e) {
      console.error('[solar/load] staleness hash check failed', { projectId, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  })
}

/**
 * The CHEAP staleness signal, for the Load tab dot (rendered on every solar page by the gated
 * layout): has any input row been written after the build? One `limit(1)` probe per input table, no
 * `channel_summaries`, no readings.
 *
 * It never says fresh when the banner would say stale because an input ROW was inserted or edited:
 * every such row bumps a timestamp read here (studies / tenant_load_basis / meters / meter_channels /
 * schematic_lines / structure.nodes / tenant_details `updated_at`, study_meters `added_at`,
 * meter_import_reports `accepted_at`). Where the two CAN disagree (dot fresh, banner stale):
 *   - a DELETE that leaves every input count unchanged (none known today). A pure DELETE leaves no row
 *     to carry a timestamp, so the build stores the sizes of the sets the hash covers
 *     (`coverage.inputCounts`: study-meter links, schematic lines, basis rows) and a count that differs
 *     reads stale — a removed study meter, the last line off a schematic, a deleted schematic sheet.
 *     A build without stored counts (older) is unknown here, not stale. Tenant nodes are soft-deleted,
 *     so those ARE seen by timestamp.
 *   - `projects.opening_date` (BO dates) — `projects.updated_at` is bumped by cloud sync every 15 min,
 *     so it cannot be used as a signal.
 *   - readings landing in an existing channel with no newer channel row or accepted import report.
 *   - an existing-PV channel on a meter outside the study.
 * The other way (dot stale, banner fresh) happens when a row was re-saved with identical values.
 * Any failure reads as "not stale" and is logged.
 */
function inputsChangedSinceBuild(supabase: AnyClient, projectId: string, studyRow: StudyLoadRow, builtAt: string, nodeIds: string[], storedCounts: InputCounts | undefined): Promise<boolean> {
  return memo(`cheap:${projectId}:${builtAt}`, async () => {
    try {
      const built = Date.parse(builtAt)
      if (Date.parse(studyRow.updated_at) > built) return true
      const solar = () => supabase.schema('solar')
      const any = (r: { data: unknown; error: unknown }) => {
        if (r.error) throw new Error(`staleness probe: ${String((r.error as { message?: string }).message ?? r.error)}`)
        return Array.isArray(r.data) && r.data.length > 0
      }
      const count = (r: { count?: number | null; error: unknown }) => {
        if (r.error) throw new Error(`staleness probe: ${String((r.error as { message?: string }).message ?? r.error)}`)
        return r.count ?? null
      }
      const counted = storedCounts != null
      const [links, basis, lines, nodes, details, basisCount, lineCount] = await Promise.all([
        solar().from('study_meters').select('meter_id, added_at').eq('study_id', studyRow.id),
        solar().from('tenant_load_basis').select('id').eq('study_id', studyRow.id).gt('updated_at', builtAt).limit(1),
        solar().from('schematic_lines').select('id').eq('project_id', projectId).gt('updated_at', builtAt).limit(1),
        supabase.schema('structure').from('nodes').select('id').eq('project_id', projectId).eq('kind', 'tenant_db').gt('updated_at', builtAt).limit(1),
        nodeIds.length ? supabase.schema('structure').from('tenant_details').select('node_id').in('node_id', nodeIds).gt('updated_at', builtAt).limit(1) : Promise.resolve({ data: [], error: null }),
        // Scoped exactly as gatherLoadInputs reads them for the hash.
        counted ? solar().from('tenant_load_basis').select('id', { count: 'exact', head: true }).eq('study_id', studyRow.id) : Promise.resolve({ count: null, error: null }),
        counted ? solar().from('schematic_lines').select('id', { count: 'exact', head: true }).eq('project_id', projectId) : Promise.resolve({ count: null, error: null }),
      ])
      if (links.error) throw new Error(`staleness probe: ${String((links.error as { message?: string }).message ?? links.error)}`)
      const linkRows = (links.data ?? []) as Array<{ meter_id: string; added_at: string | null }>
      if (any(basis) || any(lines) || any(nodes) || any(details)) return true
      if (storedCounts) {
        if (linkRows.length !== storedCounts.studyMeters) return true
        const b = count(basisCount)
        const l = count(lineCount)
        if (b !== null && b !== storedCounts.basisRows) return true
        if (l !== null && l !== storedCounts.schematicLines) return true
      }
      if (linkRows.some((l) => l.added_at && Date.parse(l.added_at) > built)) return true
      const meterIds = linkRows.map((l) => l.meter_id)
      if (meterIds.length === 0) return false
      const [meters, changed, files] = await Promise.all([
        solar().from('meters').select('id').in('id', meterIds).gt('updated_at', builtAt).limit(1),
        solar().from('meter_channels').select('id').in('meter_id', meterIds).gt('updated_at', builtAt).limit(1),
        solar().from('meter_channels').select('file_id').in('meter_id', meterIds),
      ])
      if (any(meters) || any(changed)) return true
      if (files.error) throw new Error(`staleness probe: ${String((files.error as { message?: string }).message ?? files.error)}`)
      const fileIds = [...new Set(((files.data ?? []) as Array<{ file_id: string | null }>).map((f) => f.file_id).filter((x): x is string => Boolean(x)))]
      if (fileIds.length === 0) return false
      return any(await solar().from('meter_import_reports').select('file_id').in('file_id', fileIds).gt('accepted_at', builtAt).limit(1))
    } catch (e) {
      console.error('[solar/load] staleness probe failed', { projectId, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  })
}

export async function loadProfileView(supabase: AnyClient, projectId: string): Promise<ProfileView> {
  const s = await study(supabase, projectId)
  const { form, bills } = loadSettingsFormFromRow(s as unknown as Record<string, unknown> | null)
  if (!s) return { studyId: null, studyUpdatedAt: null, form, bills, diversityApplies: true, years: [], siteLoad: null }
  const sl = await latestSiteLoad(supabase, s.id)
  const { meters, channels } = await studyMeters(supabase, s.id)
  const ids = meters.flatMap((m) => pickChannels(m, channels).primary.map((c) => c.id))
  const sums = await channelSummaries(supabase, ids)
  const years = new Set<number>()
  for (const x of sums.values()) {
    if (x.firstTs === null || x.lastTs === null) continue
    for (let y = new Date(x.firstTs).getUTCFullYear(); y <= new Date(x.lastTs).getUTCFullYear(); y++) years.add(y)
  }
  const stale = sl ? await siteLoadIsStale(supabase, projectId, sl.inputs_hash) : false
  const { data: metered } = await supabase.schema('solar').from('tenant_load_basis').select('id').eq('study_id', s.id).eq('source', 'metered').limit(1)
  const diversityApplies = sl ? sl.basis === 'S3' : form.loadBasis === 'S2' && !(Array.isArray(metered) && metered.length > 0)
  return {
    studyId: s.id, studyUpdatedAt: s.updated_at, form, bills, diversityApplies, years: [...years].sort(),
    siteLoad: sl ? {
      basis: sl.basis, referenceYear: sl.reference_year, builtAt: sl.built_at, stale,
      charts: siteProfileCharts(sl.series, sl.reference_year),
      coverage: sl.coverage, md: sl.md_monthly, designMdKw: sl.coverage.designMdKw ?? null,
      bulkRecon: sl.coverage.reconciliation?.bulk ?? [], parentRecon: sl.coverage.reconciliation?.parents ?? [],
    } : null,
  }
}

export async function loadChecksView(supabase: AnyClient, projectId: string): Promise<ChecksView> {
  const s = await study(supabase, projectId)
  if (!s) return { studyId: null, builtAt: null, checks: [], imports: [] }
  const sl = await latestSiteLoad(supabase, s.id)
  const { data: acks } = await supabase.schema('solar').from('load_check_acks').select('check_key, note, acknowledged_at').eq('study_id', s.id)
  const ackBy = new Map(((acks ?? []) as Array<{ check_key: string; note: string | null; acknowledged_at: string }>).map((a) => [a.check_key, { at: a.acknowledged_at, note: a.note }]))
  const order = { error: 0, warning: 1, info: 2 }
  const checks = (sl?.coverage.checks ?? [])
    .map((c) => ({ ...c, ack: ackBy.get(c.key) ?? null }))
    .sort((a, b) => order[a.severity] - order[b.severity])
  const { channels } = await studyMeters(supabase, s.id)
  const fileIds = [...new Set(channels.map((c) => c.file_id).filter((x): x is string => Boolean(x)))]
  const { data: files } = fileIds.length ? await supabase.schema('solar').from('meter_files').select('id, original_name, detected_format').in('id', fileIds) : { data: [] }
  const { data: reports } = fileIds.length ? await supabase.schema('solar').from('meter_import_reports').select('file_id, report, accepted_at, created_at').in('file_id', fileIds).order('created_at', { ascending: false }) : { data: [] }
  type ReportRow = { file_id: string; report: { errors?: Array<{ code: string; message: string }>; warnings?: Array<{ code: string; message: string }> }; accepted_at: string | null }
  const latest = new Map<string, ReportRow>()
  for (const r of (reports ?? []) as unknown as ReportRow[]) if (!latest.has(r.file_id) && r.accepted_at) latest.set(r.file_id, r)
  return {
    studyId: s.id,
    builtAt: sl?.built_at ?? null,
    checks,
    imports: ((files ?? []) as Array<{ id: string; original_name: string; detected_format: string | null }>).map((f) => {
      const r = latest.get(f.id)
      return { fileId: f.id, fileName: f.original_name, format: f.detected_format, acceptedAt: r?.accepted_at ?? null, errors: r?.report.errors ?? [], warnings: r?.report.warnings ?? [] }
    }),
  }
}

type LoadReadiness = { load: LoadReadinessInput | null; schematics: SchematicsReadinessInput | null }

/**
 * For the gated layout's tab dots (spec §2.3), awaited by the layout on EVERY solar page (and by the
 * overview), so it must be cheap and must never throw. Staleness uses the cheap timestamp signal
 * (`inputsChangedSinceBuild`), not the banner's hash check. It is the last rule in `loadReadiness`,
 * so it is only computed when the dot would otherwise be green. Deduped per request (layout +
 * overview); an unexpected failure resolves to "no load data" and is logged.
 */
export function loadLoadReadiness(supabase: AnyClient, projectId: string): Promise<LoadReadiness> {
  return memo(`readiness:${projectId}`, async () => {
    try {
      return await computeLoadReadiness(supabase, projectId)
    } catch (e) {
      console.error('[solar/load] readiness failed', { projectId, error: e instanceof Error ? e.message : String(e) })
      return { load: null, schematics: null }
    }
  })
}

async function computeLoadReadiness(supabase: AnyClient, projectId: string): Promise<LoadReadiness> {
  const s = await study(supabase, projectId)
  if (!s) return { load: null, schematics: null }
  const [sl, nodes, { data: basisRows }, { data: links }, { data: schematics }] = await Promise.all([
    latestSiteLoad(supabase, s.id),
    tenantNodes(supabase, projectId),
    supabase.schema('solar').from('tenant_load_basis').select('node_id').eq('study_id', s.id),
    supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', s.id),
    supabase.schema('solar').from('schematics').select('id').eq('study_id', s.id),
  ])
  const assigned = new Set(((basisRows ?? []) as Array<{ node_id: string }>).map((b) => b.node_id))
  const schematicIds = ((schematics ?? []) as Array<{ id: string }>).map((x) => x.id)
  const { data: cards } = schematicIds.length ? await supabase.schema('solar').from('schematic_cards').select('meter_id').in('schematic_id', schematicIds) : { data: [] }
  const studyMeterIds = new Set(((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id))
  const placed = new Set(((cards ?? []) as Array<{ meter_id: string }>).map((c) => c.meter_id).filter((id) => studyMeterIds.has(id)))
  const load: LoadReadinessInput = {
    hasSiteLoad: sl !== null,
    stale: false,
    basis: sl?.basis ?? s.load_basis,
    fullYearFromData: sl?.coverage.fullYearFromData ?? false,
    unassignedTenants: nodes.filter((n) => !assigned.has(n.id)).length,
    totalTenants: nodes.length,
    // An accepted import cannot carry an error: commit refuses one (3a commit.ts `unresolved_errors`).
    failingAcceptedImports: 0,
  }
  if (sl && loadReadiness(load).status === 'green') load.stale = await inputsChangedSinceBuild(supabase, projectId, s, sl.built_at, nodes.map((n) => n.id), sl.coverage.inputCounts)
  return {
    load,
    schematics: { waived: s.schematic_waived, schematics: schematicIds.length, studyMeters: studyMeterIds.size, placedMeters: placed.size },
  }
}
