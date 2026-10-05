// No 'server-only' import: this module holds no secret (the caller passes the
// client) and the backfill script runs it under plain Node.
/**
 * Rate library data layer (E6). Every function takes the Supabase client to
 * use, so the CALLER decides whose permissions apply:
 *   - pages and actions pass the user's cookie client → RLS (00225) decides,
 *     and a contractor or client viewer reads nothing;
 *   - the backfill script passes the service client.
 * The rate_* tables are not in the generated Database types yet, so the
 * client is used untyped here and nowhere else.
 */
import {
  escalate, lineTotalRate, rateStats, type IndexSeries, type IngestLine, type KnownItem,
  type PlannedLine, type RateStats, planIngest,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = any

export const CPI_SERIES = 'statssa_cpi_headline'
const PAGE = 1000

/** PostgREST caps a response at 1000 rows: read every page. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

// ── CPI ──────────────────────────────────────────────────────────────────────
export async function loadIndexSeries(client: AnyClient, series = CPI_SERIES): Promise<IndexSeries> {
  const rows = await fetchAll<{ month: string; value: number }>((a, b) =>
    client.from('rate_index_values').select('month, value').eq('series', series).order('month').range(a, b))
  return new Map(rows.map(r => [r.month.slice(0, 7), Number(r.value)]))
}

// ── Access log ───────────────────────────────────────────────────────────────
export type AccessAction = 'view_library' | 'view_item' | 'view_review' | 'view_sources' | 'export_budget' | 'price_from_library'

/**
 * Who looked at or took contractor rates. A failed log write is reported but
 * never blocks the read — the RLS on the rates themselves is the gate; this is
 * the audit trail. user_id is bound by trigger, never trusted from here.
 */
export async function logRateAccess(client: AnyClient, organisationId: string, action: AccessAction, target?: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  const { error } = await client.from('rate_library_access_log').insert({ organisation_id: organisationId, action, target: target ?? null, detail })
  if (error) console.error('[rate-library] access log write failed', { action, code: error.code })
}

// ── Library + item statistics ───────────────────────────────────────────────
export interface LibraryFilters { from?: string; to?: string; province?: string; contractor?: string; category?: string; q?: string }

export interface ObservationRow {
  id: string; rate_item_id: string; source_id: string; source_line_id: string | null; occurrences: number; unit: string
  supply_rate: number | null; install_rate: number | null; rate: number; contractor_name: string
  project_id: string | null; project_label: string | null; province: string | null; priced_on: string; created_at: string
}

export interface ItemRow {
  id: string; code: string; signature: string; category: string; description: string; unit: string
  attributes: Record<string, string>; origin: 'rule' | 'manual'; is_active: boolean
}

export interface ItemSummary {
  item: ItemRow
  nominal: RateStats
  escalated: RateStats
  contractors: number
  provinces: string[]
  earliest: string | null
}

function applyFilters(obs: ObservationRow[], f: LibraryFilters): ObservationRow[] {
  return obs.filter(o =>
    (!f.from || o.priced_on >= f.from) && (!f.to || o.priced_on <= f.to)
    && (!f.province || o.province === f.province)
    && (!f.contractor || o.contractor_name === f.contractor))
}

export function escalatedRate(o: Pick<ObservationRow, 'rate' | 'priced_on'>, cpi: IndexSeries): number | null {
  return escalate(Number(o.rate), o.priced_on, cpi).value
}

export function summarise(item: ItemRow, obs: ObservationRow[], cpi: IndexSeries): ItemSummary {
  const nominal = rateStats(obs.map(o => ({ rate: Number(o.rate), pricedOn: o.priced_on })))
  const esc = obs.flatMap(o => { const v = escalatedRate(o, cpi); return v === null ? [] : [{ rate: v, pricedOn: o.priced_on }] })
  return {
    item, nominal, escalated: rateStats(esc),
    contractors: new Set(obs.map(o => o.contractor_name)).size,
    provinces: [...new Set(obs.map(o => o.province).filter((p): p is string => !!p))].sort(),
    earliest: obs.reduce<string | null>((a, o) => (a === null || o.priced_on < a ? o.priced_on : a), null),
  }
}

export async function loadItems(client: AnyClient, organisationId: string): Promise<ItemRow[]> {
  return fetchAll<ItemRow>((a, b) => client.from('rate_items')
    .select('id, code, signature, category, description, unit, attributes, origin, is_active')
    .eq('organisation_id', organisationId).order('code').range(a, b))
}

export async function loadActiveObservations(client: AnyClient, organisationId: string, itemId?: string): Promise<ObservationRow[]> {
  return fetchAll<ObservationRow>((a, b) => {
    let q = client.from('rate_observations_active')
      .select('id, rate_item_id, source_id, source_line_id, occurrences, unit, supply_rate, install_rate, rate, contractor_name, project_id, project_label, province, priced_on, created_at')
      .eq('organisation_id', organisationId)
    if (itemId) q = q.eq('rate_item_id', itemId)
    return q.order('priced_on').order('id').range(a, b)
  })
}

export interface LibraryView {
  summaries: ItemSummary[]
  facets: { provinces: string[]; contractors: string[]; categories: string[] }
  cpiLatest: string | null
}

export async function loadLibrary(client: AnyClient, organisationId: string, f: LibraryFilters): Promise<LibraryView> {
  const [items, obs, cpi] = await Promise.all([loadItems(client, organisationId), loadActiveObservations(client, organisationId), loadIndexSeries(client)])
  const filtered = applyFilters(obs, f)
  const byItem = new Map<string, ObservationRow[]>()
  for (const o of filtered) (byItem.get(o.rate_item_id) ?? byItem.set(o.rate_item_id, []).get(o.rate_item_id)!).push(o)
  const q = f.q?.trim().toLowerCase()
  const summaries = items
    .filter(i => (!f.category || i.category === f.category) && (!q || i.description.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)))
    .map(i => summarise(i, byItem.get(i.id) ?? [], cpi))
    .filter(s => s.nominal.n > 0)
  let cpiLatest: string | null = null
  for (const k of cpi.keys()) if (!cpiLatest || k > cpiLatest) cpiLatest = k
  return {
    summaries,
    facets: {
      provinces: [...new Set(obs.map(o => o.province).filter((p): p is string => !!p))].sort(),
      contractors: [...new Set(obs.map(o => o.contractor_name))].sort(),
      categories: [...new Set(items.map(i => i.category))].sort(),
    },
    cpiLatest,
  }
}

export interface ItemDetail {
  summary: ItemSummary
  byProvince: { province: string; nominal: RateStats; escalated: RateStats }[]
  observations: (ObservationRow & { escalated: number | null; factor: number | null; flag: string | null; source: SourceRow | null; line: LineRow | null })[]
}

export interface SourceRow {
  id: string; kind: string; source_ref: string; contractor_name: string; project_id: string | null; project_label: string | null
  province: string | null; priced_on: string; priced_on_basis: string; source_file: string | null; total_ex_vat: number | null
  reconciliation: Record<string, unknown>; imported_at: string
}
export interface LineRow {
  id: string; source_id: string; sheet: string | null; row_ref: string | null; code: string | null; section_path: string[]
  description: string; unit: string | null; quantity: number | null; supply_rate: number | null; install_rate: number | null
  rate: number | null; amount: number | null; group_key: string; match_status: string; exclusion_reason: string | null
  suggested_item_id: string | null; matched_item_id: string | null; match_method: string | null; match_detail: Record<string, unknown>
}

export async function loadItemDetail(client: AnyClient, organisationId: string, itemId: string, f: LibraryFilters): Promise<ItemDetail | null> {
  const { data: item, error } = await client.from('rate_items')
    .select('id, code, signature, category, description, unit, attributes, origin, is_active')
    .eq('organisation_id', organisationId).eq('id', itemId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!item) return null
  const [obsAll, cpi] = await Promise.all([loadActiveObservations(client, organisationId, itemId), loadIndexSeries(client)])
  const obs = applyFilters(obsAll, f)
  const sourceIds = [...new Set(obs.map(o => o.source_id))]
  const lineIds = obs.map(o => o.source_line_id).filter((x): x is string => !!x)
  const [sources, lines] = await Promise.all([
    sourceIds.length ? client.from('rate_sources').select('*').in('id', sourceIds) : { data: [] },
    lineIds.length ? client.from('rate_source_lines').select('*').in('id', lineIds) : { data: [] },
  ])
  const sMap = new Map<string, SourceRow>((sources.data ?? []).map((s: SourceRow) => [s.id, s]))
  const lMap = new Map<string, LineRow>((lines.data ?? []).map((l: LineRow) => [l.id, l]))
  const provinces = [...new Set(obs.map(o => o.province ?? 'Unspecified'))].sort()
  return {
    summary: summarise(item, obs, cpi),
    byProvince: provinces.map(p => {
      const s = summarise(item, obs.filter(o => (o.province ?? 'Unspecified') === p), cpi)
      return { province: p, nominal: s.nominal, escalated: s.escalated }
    }),
    observations: obs.map(o => {
      const e = escalate(Number(o.rate), o.priced_on, cpi)
      return { ...o, escalated: e.value, factor: e.factor, flag: e.flag, source: sMap.get(o.source_id) ?? null, line: o.source_line_id ? lMap.get(o.source_line_id) ?? null : null }
    }),
  }
}

// ── Review queue ─────────────────────────────────────────────────────────────
export interface QueueGroup {
  groupKey: string
  heading: string
  description: string
  unit: string | null
  status: 'suggested' | 'unmatched' | 'rejected'
  lines: number
  sources: number
  suggestedItemId: string | null
  method: string | null
  detail: Record<string, unknown>
  sampleRate: number | null
}

export async function loadQueue(client: AnyClient, organisationId: string): Promise<QueueGroup[]> {
  const rows = await fetchAll<LineRow>((a, b) => client.from('rate_source_lines')
    .select('id, source_id, section_path, description, unit, supply_rate, install_rate, rate, group_key, match_status, suggested_item_id, match_method, match_detail')
    .eq('organisation_id', organisationId).in('match_status', ['suggested', 'unmatched', 'rejected'])
    .order('group_key').range(a, b))
  const groups = new Map<string, QueueGroup & { _sources: Set<string> }>()
  for (const r of rows) {
    let g = groups.get(r.group_key)
    if (!g) {
      g = {
        groupKey: r.group_key, heading: r.section_path[r.section_path.length - 1] ?? '', description: r.description, unit: r.unit,
        status: r.match_status as QueueGroup['status'], lines: 0, sources: 0, suggestedItemId: r.suggested_item_id, method: r.match_method,
        detail: r.match_detail ?? {}, sampleRate: lineTotalRate({ supplyRate: r.supply_rate, installRate: r.install_rate, rate: r.rate }) || null,
        _sources: new Set(),
      }
      groups.set(r.group_key, g)
    }
    g.lines++
    g._sources.add(r.source_id)
    if (r.match_status === 'suggested') { g.status = 'suggested'; g.suggestedItemId = r.suggested_item_id; g.method = r.match_method }
  }
  return [...groups.values()].map(({ _sources, ...g }) => ({ ...g, sources: _sources.size }))
    .sort((a, b) => (a.status === b.status ? b.lines - a.lines : a.status === 'suggested' ? -1 : 1))
}

export async function loadSources(client: AnyClient, organisationId: string): Promise<(SourceRow & { counts: Record<string, number> })[]> {
  const sources: SourceRow[] = await fetchAll((a, b) => client.from('rate_sources').select('*').eq('organisation_id', organisationId).order('priced_on', { ascending: false }).range(a, b))
  const lines = await fetchAll<{ source_id: string; match_status: string }>((a, b) =>
    client.from('rate_source_lines').select('source_id, match_status').eq('organisation_id', organisationId).range(a, b))
  return sources.map(s => {
    const counts: Record<string, number> = {}
    for (const l of lines) if (l.source_id === s.id) counts[l.match_status] = (counts[l.match_status] ?? 0) + 1
    return { ...s, counts }
  })
}

// ── Ingest (writes) ──────────────────────────────────────────────────────────
export interface SourceMeta {
  kind: 'boq_import' | 'historical_file' | 'tender_submission' | 'manual'
  sourceRef: string
  contractorName: string
  projectId: string | null
  projectLabel: string | null
  province: string | null
  pricedOn: string
  pricedOnBasis: 'document_date' | 'import_date' | 'submission_date' | 'stated'
  sourceFile: string | null
  totalExVat: number | null
  reconciliation: Record<string, unknown>
}

export interface IngestResult {
  sourceId: string
  alreadyImported: boolean
  counts: { lines: number; autoConfirmed: number; suggested: number; unmatched: number; excluded: number; newItems: number; observations: number }
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export async function loadKnownItems(client: AnyClient, organisationId: string): Promise<(KnownItem & { id: string })[]> {
  const items = await loadItems(client, organisationId)
  return items.map(i => ({ id: i.id, signature: i.signature, category: i.category, unit: i.unit, attributes: i.attributes ?? {} }))
}

/**
 * Write one priced document into the library. Idempotent per
 * (organisation, kind, source_ref): a second run returns alreadyImported and
 * writes nothing.
 */
export async function ingestSource(client: AnyClient, organisationId: string, meta: SourceMeta, lines: IngestLine[]): Promise<IngestResult> {
  const existing = await client.from('rate_sources').select('id').eq('organisation_id', organisationId).eq('kind', meta.kind).eq('source_ref', meta.sourceRef).maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  const zero = { lines: 0, autoConfirmed: 0, suggested: 0, unmatched: 0, excluded: 0, newItems: 0, observations: 0 }
  if (existing.data) return { sourceId: existing.data.id, alreadyImported: true, counts: zero }

  const known = await loadKnownItems(client, organisationId)
  const plan = planIngest(lines, known)

  // Items first (another ingest may have created the same signature meanwhile: ignore duplicates).
  if (plan.newItems.length) {
    const { error } = await client.from('rate_items').upsert(plan.newItems.map(n => ({
      organisation_id: organisationId, code: n.code, signature: n.signature, category: n.category,
      description: n.description, unit: n.unit, attributes: n.attributes, origin: 'rule',
    })), { onConflict: 'organisation_id,signature', ignoreDuplicates: true })
    if (error) throw new Error(`rate_items: ${error.message}`)
  }
  const itemIds = new Map((await loadKnownItems(client, organisationId)).map(i => [i.signature, i.id]))

  const { data: src, error: se } = await client.from('rate_sources').insert({
    organisation_id: organisationId, kind: meta.kind, source_ref: meta.sourceRef, contractor_name: meta.contractorName,
    project_id: meta.projectId, project_label: meta.projectLabel, province: meta.province, priced_on: meta.pricedOn,
    priced_on_basis: meta.pricedOnBasis, source_file: meta.sourceFile, total_ex_vat: meta.totalExVat,
    reconciliation: meta.reconciliation,
  }).select('id').single()
  if (se) throw new Error(`rate_sources: ${se.message}`)

  const lineRows = plan.lines.map((l: PlannedLine) => ({
    organisation_id: organisationId, source_id: src.id, sheet: l.sheet, row_ref: l.rowRef, code: l.code,
    section_path: l.sectionPath, description: l.description, unit: l.unit, quantity: l.quantity,
    supply_rate: l.supplyRate, install_rate: l.installRate, rate: l.rate, amount: l.amount, group_key: l.groupKey,
    match_status: l.status, exclusion_reason: l.exclusionReason,
    matched_item_id: l.status === 'auto_confirmed' ? itemIds.get(l.matchedSignature!) ?? null : null,
    suggested_item_id: l.status === 'suggested' ? itemIds.get(l.suggestedItemSignature!) ?? null : null,
    match_method: l.status === 'excluded' ? null : 'rule', match_detail: l.detail,
  }))
  const lineIds: string[] = []
  for (const part of chunk(lineRows, 500)) {
    const { data, error } = await client.from('rate_source_lines').insert(part).select('id')
    if (error) throw new Error(`rate_source_lines: ${error.message}`)
    if ((data ?? []).length !== part.length) throw new Error('rate_source_lines: insert returned fewer rows than sent')
    lineIds.push(...data.map((d: { id: string }) => d.id))
  }

  const obsRows = plan.observations.map(o => ({
    organisation_id: organisationId, rate_item_id: itemIds.get(o.signature), source_id: src.id,
    source_line_id: lineIds[o.lineIndexes[0]], occurrences: o.occurrences, unit: o.unit,
    supply_rate: o.supplyRate, install_rate: o.installRate, rate: o.rate, contractor_name: meta.contractorName,
    project_id: meta.projectId, project_label: meta.projectLabel, province: meta.province, priced_on: meta.pricedOn,
  }))
  for (const part of chunk(obsRows, 500)) {
    const { error } = await client.from('rate_observations').insert(part)
    if (error) throw new Error(`rate_observations: ${error.message}`)
  }

  const c = (s: string) => plan.lines.filter(l => l.status === s).length
  return {
    sourceId: src.id, alreadyImported: false,
    counts: { lines: plan.lines.length, autoConfirmed: c('auto_confirmed'), suggested: c('suggested'), unmatched: c('unmatched'), excluded: c('excluded'), newItems: plan.newItems.length, observations: obsRows.length },
  }
}
