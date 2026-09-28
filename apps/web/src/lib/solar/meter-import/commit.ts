/**
 * Commit a reviewed meter file. The server RE-PARSES the stored raw file with the user's confirmed
 * options (it never trusts a client-side parse), refuses unresolved errors and unresolved identity
 * conflicts, then writes channels and readings through RLS and READS THE COUNT BACK: a write that
 * reports success but lands nothing is a 500 with the numbers, not a green import.
 * Idempotent: channels upsert on (meter, file, column), readings upsert on (channel, ts_end).
 */
import { z } from 'zod'
import {
  applyScaleCorrection, METER_PARSER_VERSION, parseMeterFile, parseMeterWorkbook, SOURCE_UNITS,
  type MeterParseOutcome, type NormalisedChannel, type ParseOptions, type SeriesOutcome,
} from '@esite/shared/meter-data'
import type { MeterFileRow, MeterImportRepo, MeterRow } from './repo'
import { fileParsePatch, lookupIdentity } from './review'
import { loadVerifiedRaw } from './raw-file'

export class CommitError extends Error {
  readonly status: number
  readonly body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error))
    this.status = status
    this.body = body
  }
}

export const READING_CHUNK = 5000

const METER_KINDS = ['tenant', 'bulk', 'council', 'generator', 'solar', 'common', 'vacant', 'check', 'virtual', 'water', 'unknown'] as const
// 'm3' is excluded too: 00210's meter_channels.source_unit CHECK refuses it (water is not load, and
// the parser rejects a file with a volume column), so a user-chosen m3 must be a 422, not a DB 500.
const KNOWN_UNITS = SOURCE_UNITS.filter((u) => u !== 'unknown' && u !== 'm3') as [string, ...string[]]

const OptionsSchema = z.object({
  dateOrder: z.enum(['DMY', 'MDY', 'YMD']).optional(),
  tsConvention: z.enum(['begin', 'end']).optional(),
  units: z.record(z.enum(KNOWN_UNITS)).optional(),
  areaM2: z.number().positive().nullable().optional(),
}).strict()

const NewMeterSchema = z.object({
  label: z.string().trim().min(1).max(200),
  kind: z.enum(METER_KINDS),
  siteLabel: z.string().trim().max(200).nullable().optional(),
  shopNo: z.string().trim().max(100).nullable().optional(),
  areaM2: z.number().positive().nullable().optional(),
  areaSource: z.enum(['register_exact', 'register_llm', 'filename', 'manual']).nullable().optional(),
  nodeId: z.string().uuid().nullable().optional(),
}).strict()

const FileId = z.string().uuid()

export const CommitBodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('series'),
    fileId: FileId,
    sheet: z.string().max(200).optional(),
    meter: z.union([z.object({ existingMeterId: z.string().uuid() }).strict(), z.object({ new: NewMeterSchema }).strict()]),
    identity: z.object({ resolution: z.enum(['none', 'link', 'override']), reason: z.string().trim().min(5).max(500).optional() }).strict(),
    channels: z.array(z.object({ sourceColumn: z.string().min(1), include: z.boolean(), isPrimary: z.boolean().optional() }).strict()).optional(),
    scaleCorrections: z.array(z.object({ sourceColumn: z.string().min(1), segmentIndex: z.number().int().min(0) }).strict()).optional(),
    options: OptionsSchema.optional(),
  }).strict(),
  z.object({ mode: z.literal('register'), fileId: FileId, siteLabel: z.string().trim().max(200).nullable().optional() }).strict(),
  z.object({ mode: z.literal('skip'), fileId: FileId, reason: z.string().trim().min(3).max(500) }).strict(),
])
export type CommitBody = z.infer<typeof CommitBodySchema>
type SeriesBody = Extract<CommitBody, { mode: 'series' }>

export interface CommitContext {
  projectId: string
  orgId: string
  file: MeterFileRow
}

/** Parse the stored raw file. Workbooks: the named sheet, else the first series sheet. */
export async function parseStoredFile(repo: MeterImportRepo, file: MeterFileRow, orgId: string, options: ParseOptions, sheet?: string): Promise<{ outcome: MeterParseOutcome; sheetName: string | null }> {
  // Path must be <org>/<project>/<sha>.<ext> of this row and the bytes must hash to its sha256 (raw-file.ts).
  const raw = await loadVerifiedRaw(repo, file, orgId)
  if (!raw.ok) throw new CommitError(raw.status, raw.body)
  const bytes = raw.bytes
  if (/\.xlsx$/i.test(file.original_name)) {
    const sheets = await parseMeterWorkbook({ bytes, fileName: file.original_name, options })
    const chosen = sheet ? sheets.find((s) => s.sheetName === sheet) : (sheets.find((s) => s.outcome.kind === 'series') ?? sheets[0])
    if (!chosen) throw new CommitError(422, { error: 'sheet_not_found', sheet: sheet ?? null })
    return { outcome: chosen.outcome, sheetName: chosen.sheetName }
  }
  return { outcome: await parseMeterFile({ bytes, fileName: file.original_name, options }), sheetName: null }
}

async function resolveMeter(repo: MeterImportRepo, ctx: CommitContext, outcome: SeriesOutcome, body: SeriesBody): Promise<MeterRow> {
  // A file feeds ONE meter. If this file already feeds one (an earlier commit, or a retry after a
  // partial failure: the series-hash row is written before any channel), a re-commit resolves to
  // that meter; `new` must not mint a second meter with duplicate readings, and naming a DIFFERENT
  // meter is refused rather than silently splitting the file's data across two meters.
  const recorded = await repo.metersForFile(ctx.file.id)
  if (recorded.length > 1) throw new CommitError(409, { error: 'already_imported', meters: recorded })
  if (recorded.length === 1) {
    const r = recorded[0]
    if ('existingMeterId' in body.meter && body.meter.existingMeterId !== r.meterId) {
      throw new CommitError(409, { error: 'already_imported', meterId: r.meterId, label: r.label, siteLabel: r.siteLabel })
    }
    const m = await repo.getMeter(r.meterId)
    if (!m || m.organisation_id !== ctx.orgId) throw new CommitError(404, { error: 'meter_not_found' })
    return m
  }
  if ('existingMeterId' in body.meter) {
    const m = await repo.getMeter(body.meter.existingMeterId)
    if (!m || m.organisation_id !== ctx.orgId) throw new CommitError(404, { error: 'meter_not_found' })
    return m
  }
  const n = body.meter.new
  if (n.kind === 'water') throw new CommitError(422, { error: 'water_is_not_load' })
  if (outcome.sourceSerials.length > 1 && n.kind !== 'virtual') {
    throw new CommitError(422, { error: 'multi_serial_meter_is_virtual', serials: outcome.sourceSerials })
  }
  const area = n.areaM2 ?? null
  return repo.insertMeter({
    organisation_id: ctx.orgId,
    label: n.label,
    site_label: n.siteLabel ?? outcome.filename.siteHint,
    serials: outcome.sourceSerials,
    shop_no: n.shopNo ?? outcome.filename.shopNo,
    area_m2: area,
    area_source: area === null ? null : (n.areaSource ?? 'manual'),
    kind: n.kind,
    node_id: n.nodeId ?? null,
  })
}

function selectChannels(outcome: SeriesOutcome, body: SeriesBody): Array<{ channel: NormalisedChannel; isPrimary: boolean }> {
  const choice = new Map((body.channels ?? []).map((c) => [c.sourceColumn, c]))
  const included = outcome.channels.filter((c) => choice.get(c.spec.sourceColumn)?.include ?? c.spec.sourceUnit !== 'unknown')
  const explicit = (body.channels ?? []).filter((c) => c.isPrimary).map((c) => c.sourceColumn)
  if (explicit.length > 1) throw new CommitError(422, { error: 'one_primary_channel', columns: explicit })
  if (explicit.length === 1) {
    const column = explicit[0]
    // Owner decision 3: a lagged channel (its time label follows the other convention) is never primary.
    const reason = !outcome.channels.some((c) => c.spec.sourceColumn === column) ? 'unknown_column'
      : !included.some((c) => c.spec.sourceColumn === column) ? 'excluded'
      : outcome.report.laggedChannels.some((l) => l.column === column) ? 'lagged'
      : null
    if (reason) throw new CommitError(422, { error: 'primary_not_eligible', column, reason })
  }
  const primary = explicit[0] ?? outcome.primaryColumn
  return included.map((channel) => ({ channel, isPrimary: channel.spec.sourceColumn === primary }))
}

export async function commitMeterFile(repo: MeterImportRepo, ctx: CommitContext, body: CommitBody, opts: { chunkSize?: number } = {}): Promise<Record<string, unknown>> {
  if (body.mode === 'skip') {
    // An imported file's readings are live data; skipping it would only relabel the file.
    if (ctx.file.status === 'accepted') throw new CommitError(409, { error: 'already_imported' })
    await repo.updateFile(ctx.file.id, { status: 'skipped', skip_reason: body.reason })
    await repo.audit(ctx.projectId, 'meter_file_skipped', { file_id: ctx.file.id, reason: body.reason })
    return { skipped: true }
  }

  if (body.mode === 'register') {
    if (ctx.file.status === 'accepted') throw new CommitError(409, { error: 'already_imported' })
    const { outcome } = await parseStoredFile(repo, ctx.file, ctx.orgId, {})
    if (outcome.kind !== 'register') throw new CommitError(422, { error: 'not_a_register', format: outcome.format })
    const site = body.siteLabel ?? outcome.filename.siteHint ?? null
    const rows = outcome.rows.map((r) => ({
      organisation_id: ctx.orgId, source_file_id: ctx.file.id, kind: r.kind, site_label: site, file_name: r.fileName,
      tenant_name: r.tenantName, shop_no: r.shopNo, area_m2: r.areaM2 !== null && r.areaM2 > 0 ? r.areaM2 : null,
      match_method: r.matchMethod, serial: r.serial, mall_name: r.mallName, downloaded: r.downloaded, qa: r.qa,
    }))
    const inserted = rows.length > 0 ? await repo.insertRegisterRows(rows) : 0
    await repo.updateFile(ctx.file.id, { ...fileParsePatch(outcome), status: 'accepted', skip_reason: null })
    await repo.audit(ctx.projectId, 'meter_register_imported', { file_id: ctx.file.id, rows: inserted })
    return { registerRows: inserted }
  }

  // zod types units as Record<string, string>; the schema already restricted them to SourceUnit values.
  const options = (body.options ?? {}) as ParseOptions
  const { outcome } = await parseStoredFile(repo, ctx.file, ctx.orgId, options, body.sheet)
  if (outcome.kind !== 'series') throw new CommitError(422, { error: 'not_a_meter_series', format: outcome.format, errors: outcome.report.errors })
  if (outcome.report.errors.length > 0) throw new CommitError(422, { error: 'unresolved_errors', errors: outcome.report.errors })

  const identity = await lookupIdentity(repo, ctx.orgId, outcome, ctx.file.id)
  if (identity.blocking) {
    if (body.identity.resolution === 'none') throw new CommitError(409, { error: 'identity_conflict', identity })
    if (body.identity.resolution === 'override' && !body.identity.reason) throw new CommitError(422, { error: 'override_needs_reason' })
    if (body.identity.resolution === 'link' && !('existingMeterId' in body.meter)) throw new CommitError(422, { error: 'link_needs_existing_meter' })
  }

  // Channel choices are validated before anything is written.
  const selected = selectChannels(outcome, body)
  const meter = await resolveMeter(repo, ctx, outcome, body)
  const sameBodyLink = body.identity.resolution === 'link' && identity.conflicts.some((c) => c.kind === 'same_body' && c.meterId === meter.id)
  // Bind file -> meter FIRST, so a retry after any later failure finds this meter (resolveMeter).
  await repo.insertSeriesHash({ organisation_id: ctx.orgId, body_hash: outcome.bodySha256, meter_id: meter.id, file_id: ctx.file.id })

  const results: Array<{ channelId: string; sourceColumn: string; readings: number }> = []
  if (!sameBodyLink) {
    const chunk = opts.chunkSize ?? READING_CHUNK
    const storedChannels = await repo.channelsForFile(meter.id, ctx.file.id)
    // Demote an old primary BEFORE promoting the new one (meter_channels_one_primary_per_file), and
    // demote one this commit leaves out altogether.
    const newPrimary = selected.find((s) => s.isPrimary)?.channel.spec.sourceColumn ?? null
    for (const c of storedChannels) if (c.is_primary && c.source_column !== newPrimary) await repo.demoteChannel(c.id)
    // A re-commit REPLACES a stored channel's readings (write_readings only upserts, so a changed
    // timestamp set would leave stale rows and fail the read-back forever). The channel row is kept.
    const stored = new Set(storedChannels.map((c) => c.id))
    for (const { channel, isPrimary } of selected) {
      let readings = channel.readings
      for (const sc of (body.scaleCorrections ?? []).filter((s) => s.sourceColumn === channel.spec.sourceColumn)) {
        const seg = channel.levelShifts[sc.segmentIndex]
        if (!seg) throw new CommitError(422, { error: 'no_such_level_shift', column: sc.sourceColumn, segmentIndex: sc.segmentIndex })
        readings = applyScaleCorrection(readings, seg)
      }
      const channelId = await repo.upsertChannel({
        meter_id: meter.id, file_id: ctx.file.id, source_column: channel.spec.sourceColumn, quantity: channel.spec.quantity,
        direction: channel.spec.direction, phase: channel.spec.phase, source_unit: channel.spec.sourceUnit, unit: channel.storedUnit,
        interval_min: channel.intervalMin, is_cumulative: channel.isCumulative, tz_convention: outcome.report.tsConvention ?? 'end',
        is_primary: isPrimary, coverage_only: channel.coverageOnly, parser_version: METER_PARSER_VERSION,
      })
      if (stored.has(channelId)) await repo.clearChannelReadings(channelId)
      let written = 0
      for (let i = 0; i < readings.length; i += chunk) {
        const part = readings.slice(i, i + chunk)
        written += await repo.writeReadings(channelId, {
          ts: part.map((r) => new Date(r.tsEnd).toISOString()),
          value: part.map((r) => r.value),
          quality: part.map((r) => r.quality),
        })
      }
      const found = await repo.countReadings(channelId)
      if (found !== readings.length) {
        throw new CommitError(500, { error: 'readings_verification_failed', channel: channel.spec.sourceColumn, expected: readings.length, written, found })
      }
      results.push({ channelId, sourceColumn: channel.spec.sourceColumn, readings: found })
    }
  }

  const studyId = await repo.studyId(ctx.projectId)
  if (studyId) await repo.linkStudyMeter(studyId, meter.id)
  const reportId = await repo.insertReport({
    file_id: ctx.file.id, parser_version: METER_PARSER_VERSION, options,
    report: { ...outcome.report, identity: { ...outcome.report.identity, resolution: body.identity.resolution, reason: body.identity.reason ?? null, conflicts: identity.conflicts } },
  })
  await repo.acceptReport(reportId)
  await repo.updateFile(ctx.file.id, { ...fileParsePatch(outcome), status: 'accepted', skip_reason: null })
  await repo.audit(ctx.projectId, 'meter_file_imported', {
    file_id: ctx.file.id, meter_id: meter.id, channels: results.length, identity_resolution: body.identity.resolution,
  })
  return { meterId: meter.id, reportId, channels: results }
}
