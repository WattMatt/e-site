/** In-memory MeterImportRepo for unit tests of review/commit/routes. Not imported by runtime code. */
import type { ChannelRow, MeterFileRow, MeterImportRepo, MeterRow, NewMeter, RegisterHint } from './repo'

export interface FakeState {
  orgByProject: Record<string, string>
  studyByProject: Record<string, string>
  raw: Record<string, Uint8Array>
  files: MeterFileRow[]
  filePatches: Array<{ fileId: string; patch: Record<string, unknown> }>
  meters: MeterRow[]
  channels: Array<ChannelRow & { id: string }>
  readings: Map<string, Map<string, { value: number | null; quality: number }>>
  writeCalls: Array<{ channelId: string; n: number }>
  hashes: Array<{ organisation_id: string; body_hash: string; meter_id: string; file_id: string; label?: string; siteLabel?: string | null }>
  register: Array<Record<string, unknown>>
  reports: Array<{ id: string; accepted: boolean; row: unknown }>
  studyLinks: Array<{ studyId: string; meterId: string }>
  audits: Array<{ projectId: string; verb: string; objectRef: Record<string, unknown> }>
  /** Test hook: make countReadings lie, to prove the read-back check. */
  countOffset: number
}

export function createFakeRepo(seed: Partial<FakeState> = {}): { repo: MeterImportRepo; state: FakeState } {
  const state: FakeState = {
    orgByProject: {}, studyByProject: {}, raw: {}, files: [], filePatches: [], meters: [], channels: [],
    readings: new Map(), writeCalls: [], hashes: [], register: [], reports: [], studyLinks: [], audits: [], countOffset: 0,
    ...seed,
  }
  let seq = 0
  const id = (p: string) => `${p}-${++seq}`
  const repo: MeterImportRepo = {
    async projectOrg(p) { return state.orgByProject[p] ?? null },
    async studyId(p) { return state.studyByProject[p] ?? null },
    async downloadRaw(path) { return state.raw[path] ?? null },
    async fileBySha(org, sha) { return state.files.find((f) => f.organisation_id === org && f.sha256 === sha) ?? null },
    async insertFile(row) {
      const f: MeterFileRow = { id: id('file'), status: 'uploaded', ...row }
      state.files.push(f)
      return f
    },
    async getFile(fileId) { return state.files.find((f) => f.id === fileId) ?? null },
    async updateFile(fileId, patch) {
      state.filePatches.push({ fileId, patch })
      const f = state.files.find((x) => x.id === fileId)
      if (f && typeof patch.status === 'string') f.status = patch.status as MeterFileRow['status']
    },
    async seriesByBodyHash(org, h) {
      return state.hashes.filter((x) => x.organisation_id === org && x.body_hash === h).map((x) => ({ meterId: x.meter_id, fileId: x.file_id, label: x.label ?? 'meter', siteLabel: x.siteLabel ?? null }))
    },
    async metersBySerials(org, serials) { return state.meters.filter((m) => m.organisation_id === org && m.serials.some((s) => serials.includes(s))) },
    async registerBySerials(org, serials) {
      return state.register
        .filter((r) => r.organisation_id === org && r.kind === 'download_log' && serials.includes(r.serial as string))
        .map((r) => ({ serial: r.serial as string, mallName: (r.mall_name as string) ?? null, tenantName: (r.tenant_name as string) ?? null }))
    },
    async registerForFile(org, hints): Promise<RegisterHint[]> {
      return state.register
        .filter((r) => r.organisation_id === org && r.kind === 'summary' && (hints.shopNo ? r.shop_no === hints.shopNo : r.tenant_name === hints.label))
        .map((r) => ({ tenantName: (r.tenant_name as string) ?? null, shopNo: (r.shop_no as string) ?? null, areaM2: (r.area_m2 as number) ?? null, matchMethod: r.match_method as string, fileName: (r.file_name as string) ?? null }))
    },
    async insertReport(row) {
      const rid = id('report')
      state.reports.push({ id: rid, accepted: false, row })
      return rid
    },
    async acceptReport(rid) {
      const r = state.reports.find((x) => x.id === rid)
      if (r) r.accepted = true
    },
    async getMeter(mid) { return state.meters.find((m) => m.id === mid) ?? null },
    async insertMeter(row: NewMeter) {
      const m: MeterRow = { id: id('meter'), organisation_id: row.organisation_id, label: row.label, site_label: row.site_label, serials: row.serials, kind: row.kind }
      state.meters.push(m)
      return m
    },
    async upsertChannel(row) {
      const existing = state.channels.find((c) => c.meter_id === row.meter_id && c.file_id === row.file_id && c.source_column === row.source_column)
      if (existing) {
        Object.assign(existing, row)
        return existing.id
      }
      const c = { ...row, id: id('channel') }
      state.channels.push(c)
      return c.id
    },
    async writeReadings(channelId, chunk) {
      const m = state.readings.get(channelId) ?? new Map()
      chunk.ts.forEach((t, i) => m.set(t, { value: chunk.value[i], quality: chunk.quality[i] }))
      state.readings.set(channelId, m)
      state.writeCalls.push({ channelId, n: chunk.ts.length })
      return chunk.ts.length
    },
    async countReadings(channelId) { return (state.readings.get(channelId)?.size ?? 0) + state.countOffset },
    async insertSeriesHash(row) {
      if (!state.hashes.some((h) => h.organisation_id === row.organisation_id && h.body_hash === row.body_hash && h.file_id === row.file_id)) state.hashes.push(row)
    },
    async linkStudyMeter(studyId, meterId) {
      if (!state.studyLinks.some((l) => l.studyId === studyId && l.meterId === meterId)) state.studyLinks.push({ studyId, meterId })
    },
    async insertRegisterRows(rows) {
      state.register.push(...rows)
      return rows.length
    },
    async audit(projectId, verb, objectRef) { state.audits.push({ projectId, verb, objectRef }) },
  }
  return { repo, state }
}
