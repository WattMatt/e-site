/**
 * The meter-import pipeline's only Supabase code. It uses the CALLER's client, so every read and
 * write goes through RLS (the service key is never used here). Everything else in the pipeline is
 * pure and is tested against the in-memory fake (fake-repo.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type AnyClient = SupabaseClient<any, any, any>

export const METER_RAW_BUCKET = 'solar-meter-raw'
export const MAX_METER_FILE_BYTES = 50 * 1024 * 1024

export type MeterKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'water' | 'unknown'
export type AreaSource = 'register_exact' | 'register_llm' | 'filename' | 'manual'

export interface MeterFileRow {
  id: string
  organisation_id: string
  project_id: string
  sha256: string
  size_bytes: number
  storage_path: string
  original_name: string
  status: 'uploaded' | 'parsed' | 'accepted' | 'skipped' | 'failed'
}
export interface MeterRow {
  id: string
  organisation_id: string
  label: string
  site_label: string | null
  serials: string[]
  kind: MeterKind
}
export interface NewMeter {
  organisation_id: string
  label: string
  site_label: string | null
  serials: string[]
  shop_no: string | null
  area_m2: number | null
  area_source: AreaSource | null
  kind: MeterKind
  node_id: string | null
}
export interface ChannelRow {
  meter_id: string
  file_id: string
  source_column: string
  quantity: string
  direction: string
  phase: string | null
  source_unit: string
  unit: string
  interval_min: number
  is_cumulative: boolean
  tz_convention: 'begin' | 'end'
  is_primary: boolean
  coverage_only: boolean
  parser_version: string
}
export interface ExistingChannel {
  id: string
  source_column: string
  is_primary: boolean
}
export interface FileMeter {
  meterId: string
  label: string
  siteLabel: string | null
}
export interface RegisterHint {
  tenantName: string | null
  shopNo: string | null
  areaM2: number | null
  matchMethod: string
  fileName: string | null
}

export interface MeterImportRepo {
  projectOrg(projectId: string): Promise<string | null>
  studyId(projectId: string): Promise<string | null>
  downloadRaw(storagePath: string): Promise<Uint8Array | null>
  fileBySha(orgId: string, sha256: string): Promise<MeterFileRow | null>
  insertFile(row: { project_id: string; organisation_id: string; sha256: string; size_bytes: number; storage_path: string; original_name: string }): Promise<MeterFileRow>
  getFile(fileId: string): Promise<MeterFileRow | null>
  updateFile(fileId: string, patch: Record<string, unknown>): Promise<void>
  seriesByBodyHash(orgId: string, bodyHash: string): Promise<Array<{ meterId: string; fileId: string; label: string; siteLabel: string | null }>>
  /** The meters this file already feeds: through its channels OR its series-hash row (RLS-scoped). */
  metersForFile(fileId: string): Promise<FileMeter[]>
  metersBySerials(orgId: string, serials: string[]): Promise<MeterRow[]>
  registerBySerials(orgId: string, serials: string[]): Promise<Array<{ serial: string; mallName: string | null; tenantName: string | null }>>
  registerForFile(orgId: string, hints: { label: string | null; shopNo: string | null }): Promise<RegisterHint[]>
  insertReport(row: { file_id: string; parser_version: string; options: unknown; report: unknown }): Promise<string>
  acceptReport(reportId: string): Promise<void>
  getMeter(meterId: string): Promise<MeterRow | null>
  insertMeter(row: NewMeter): Promise<MeterRow>
  /** Channels already stored for this (meter, file). */
  channelsForFile(meterId: string, fileId: string): Promise<ExistingChannel[]>
  upsertChannel(row: ChannelRow): Promise<string>
  /** is_primary = false on one channel (before another is promoted). */
  demoteChannel(channelId: string): Promise<void>
  /** Empty a channel's readings (solar.clear_channel_readings; Edit on its library). Returns rows removed. */
  clearChannelReadings(channelId: string): Promise<number>
  writeReadings(channelId: string, chunk: { ts: string[]; value: Array<number | null>; quality: number[] }): Promise<number>
  countReadings(channelId: string): Promise<number>
  insertSeriesHash(row: { organisation_id: string; body_hash: string; meter_id: string; file_id: string }): Promise<void>
  linkStudyMeter(studyId: string, meterId: string): Promise<void>
  insertRegisterRows(rows: Array<Record<string, unknown>>): Promise<number>
  audit(projectId: string, verb: string, objectRef: Record<string, unknown>): Promise<void>
}

const FILE_COLS = 'id, organisation_id, project_id, sha256, size_bytes, storage_path, original_name, status'
const METER_COLS = 'id, organisation_id, label, site_label, serials, kind'

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  if (r.data === null) throw new Error(`${what}: no row returned`)
  return r.data
}
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function createMeterImportRepo(supabase: AnyClient): MeterImportRepo {
  const solar = () => supabase.schema('solar')
  return {
    async projectOrg(projectId) {
      const r = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', projectId).maybeSingle()
      return (r.data as { organisation_id: string } | null)?.organisation_id ?? null
    },
    async studyId(projectId) {
      const r = await solar().from('studies').select('id').eq('project_id', projectId).maybeSingle()
      return (r.data as { id: string } | null)?.id ?? null
    },
    async downloadRaw(storagePath) {
      const r = await supabase.storage.from(METER_RAW_BUCKET).download(storagePath)
      if (r.error || !r.data) return null
      if (r.data.size > MAX_METER_FILE_BYTES) throw new Error('meter file is larger than 50 MB')
      return new Uint8Array(await r.data.arrayBuffer())
    },
    async fileBySha(orgId, sha256) {
      const r = await solar().from('meter_files').select(FILE_COLS).eq('organisation_id', orgId).eq('sha256', sha256).maybeSingle()
      return (r.data as MeterFileRow | null) ?? null
    },
    async insertFile(row) {
      return must(await solar().from('meter_files').insert(row).select(FILE_COLS).single(), 'insert meter file') as MeterFileRow
    },
    async getFile(fileId) {
      const r = await solar().from('meter_files').select(FILE_COLS).eq('id', fileId).maybeSingle()
      return (r.data as MeterFileRow | null) ?? null
    },
    async updateFile(fileId, patch) {
      const r = await solar().from('meter_files').update(patch).eq('id', fileId)
      if (r.error) throw new Error(`update meter file: ${r.error.message}`)
    },
    async seriesByBodyHash(orgId, bodyHash) {
      const r = await solar().from('meter_series_hashes').select('meter_id, file_id, meters(label, site_label)').eq('organisation_id', orgId).eq('body_hash', bodyHash)
      if (r.error) throw new Error(`series hashes: ${r.error.message}`)
      // supabase-js infers a to-one embed as an array; PostgREST returns an object for a many-to-one FK.
      return ((r.data ?? []) as unknown as Array<{ meter_id: string; file_id: string; meters: { label: string; site_label: string | null } | null }>).map((x) => ({
        meterId: x.meter_id, fileId: x.file_id, label: x.meters?.label ?? '(unknown meter)', siteLabel: x.meters?.site_label ?? null,
      }))
    },
    async metersForFile(fileId) {
      type Row = { meter_id: string; meters: { label: string; site_label: string | null } | null }
      const byChannel = await solar().from('meter_channels').select('meter_id, meters(label, site_label)').eq('file_id', fileId)
      if (byChannel.error) throw new Error(`meters for file (channels): ${byChannel.error.message}`)
      const byHash = await solar().from('meter_series_hashes').select('meter_id, meters(label, site_label)').eq('file_id', fileId)
      if (byHash.error) throw new Error(`meters for file (hashes): ${byHash.error.message}`)
      const out = new Map<string, FileMeter>()
      for (const x of [...(byChannel.data ?? []), ...(byHash.data ?? [])] as unknown as Row[]) {
        if (!out.has(x.meter_id)) out.set(x.meter_id, { meterId: x.meter_id, label: x.meters?.label ?? '(unknown meter)', siteLabel: x.meters?.site_label ?? null })
      }
      return [...out.values()]
    },
    async metersBySerials(orgId, serials) {
      if (serials.length === 0) return []
      const r = await solar().from('meters').select(METER_COLS).eq('organisation_id', orgId).overlaps('serials', serials)
      if (r.error) throw new Error(`meters by serial: ${r.error.message}`)
      return (r.data ?? []) as MeterRow[]
    },
    async registerBySerials(orgId, serials) {
      if (serials.length === 0) return []
      const r = await solar().from('meter_register').select('serial, mall_name, tenant_name').eq('organisation_id', orgId).eq('kind', 'download_log').in('serial', serials)
      if (r.error) throw new Error(`register by serial: ${r.error.message}`)
      return ((r.data ?? []) as Array<{ serial: string; mall_name: string | null; tenant_name: string | null }>).map((x) => ({ serial: x.serial, mallName: x.mall_name, tenantName: x.tenant_name }))
    },
    async registerForFile(orgId, hints) {
      let q = solar().from('meter_register').select('tenant_name, shop_no, area_m2, match_method, file_name').eq('organisation_id', orgId).eq('kind', 'summary')
      if (hints.shopNo) q = q.eq('shop_no', hints.shopNo)
      else if (hints.label) q = q.ilike('tenant_name', like(hints.label))
      else return []
      const r = await q.limit(10)
      if (r.error) throw new Error(`register for file: ${r.error.message}`)
      return ((r.data ?? []) as Array<{ tenant_name: string | null; shop_no: string | null; area_m2: number | null; match_method: string; file_name: string | null }>).map((x) => ({
        tenantName: x.tenant_name, shopNo: x.shop_no, areaM2: x.area_m2 === null ? null : Number(x.area_m2), matchMethod: x.match_method, fileName: x.file_name,
      }))
    },
    async insertReport(row) {
      return (must(await solar().from('meter_import_reports').insert(row).select('id').single(), 'insert import report') as { id: string }).id
    },
    async acceptReport(reportId) {
      const r = await solar().from('meter_import_reports').update({ accepted_at: new Date().toISOString() }).eq('id', reportId)
      if (r.error) throw new Error(`accept report: ${r.error.message}`)
    },
    async getMeter(meterId) {
      const r = await solar().from('meters').select(METER_COLS).eq('id', meterId).maybeSingle()
      return (r.data as MeterRow | null) ?? null
    },
    async insertMeter(row) {
      return must(await solar().from('meters').insert(row).select(METER_COLS).single(), 'insert meter') as MeterRow
    },
    async channelsForFile(meterId, fileId) {
      const r = await solar().from('meter_channels').select('id, source_column, is_primary').eq('meter_id', meterId).eq('file_id', fileId)
      if (r.error) throw new Error(`channels for file: ${r.error.message}`)
      return (r.data ?? []) as ExistingChannel[]
    },
    async upsertChannel(row) {
      const r = await solar().from('meter_channels').upsert(row, { onConflict: 'meter_id,file_id,source_column' }).select('id').single()
      return (must(r, 'upsert channel') as { id: string }).id
    },
    async demoteChannel(channelId) {
      const r = await solar().from('meter_channels').update({ is_primary: false }).eq('id', channelId)
      if (r.error) throw new Error(`demote channel: ${r.error.message}`)
    },
    async clearChannelReadings(channelId) {
      const r = await solar().rpc('clear_channel_readings', { p_channel_id: channelId })
      if (r.error) throw new Error(`clear channel readings: ${r.error.message}`)
      return Number(r.data)
    },
    async writeReadings(channelId, chunk) {
      const r = await solar().rpc('write_readings', { p_channel_id: channelId, p_ts_end: chunk.ts, p_value: chunk.value, p_quality: chunk.quality })
      if (r.error) throw new Error(`write readings: ${r.error.message}`)
      return Number(r.data)
    },
    async countReadings(channelId) {
      const r = await solar().from('meter_readings').select('channel_id', { count: 'exact', head: true }).eq('channel_id', channelId)
      if (r.error) throw new Error(`count readings: ${r.error.message}`)
      return r.count ?? 0
    },
    async insertSeriesHash(row) {
      const r = await solar().from('meter_series_hashes').upsert(row, { onConflict: 'organisation_id,body_hash,file_id', ignoreDuplicates: true })
      if (r.error) throw new Error(`series hash: ${r.error.message}`)
    },
    async linkStudyMeter(studyId, meterId) {
      const r = await solar().from('study_meters').upsert({ study_id: studyId, meter_id: meterId }, { onConflict: 'study_id,meter_id', ignoreDuplicates: true })
      if (r.error) throw new Error(`link study meter: ${r.error.message}`)
    },
    async insertRegisterRows(rows) {
      const r = await solar().from('meter_register').insert(rows).select('id')
      if (r.error) throw new Error(`register rows: ${r.error.message}`)
      return (r.data ?? []).length
    },
    async audit(projectId, verb, objectRef) {
      const r = await solar().from('audit_events').insert({ project_id: projectId, verb, object_ref: objectRef })
      if (r.error) throw new Error(`audit: ${r.error.message}`)
    },
  }
}
