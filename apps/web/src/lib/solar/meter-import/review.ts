/**
 * Review model for the import dialog (functional spec §4.3): what the parser found, what needs a
 * choice, and the identity panel. Pure except lookupIdentity, which reads through the repository.
 */
import { siteKey, suggestUnitFromHeader, type MeterParseOutcome, type SeriesOutcome, type ValidationReport } from '@esite/shared/meter-data'
import type { MeterImportRepo, RegisterHint } from './repo'

/** Errors the user resolves by choosing (they do not skip the file). */
export const CHOICE_ERRORS = new Set(['unknown_unit', 'ambiguous_date_order', 'convention_required'])

export type IdentityConflictKind = 'same_body' | 'same_serial' | 'serial_other_mall' | 'filename_serial_mismatch'
export interface IdentityConflict {
  kind: IdentityConflictKind
  message: string
  meterId?: string
  /** A duplicate of another file in the same upload (client-side check): that file's id. */
  fileId?: string
}
export interface IdentityPanel {
  sourceSerials: string[]
  filenameSerial: string | null
  conflicts: IdentityConflict[]
  /** A conflict must be resolved (link / skip / override with a reason) before Accept. */
  blocking: boolean
}

export async function lookupIdentity(repo: MeterImportRepo, orgId: string, outcome: SeriesOutcome, selfFileId?: string): Promise<IdentityPanel> {
  const conflicts: IdentityConflict[] = []
  for (const d of await repo.seriesByBodyHash(orgId, outcome.bodySha256)) {
    if (d.fileId === selfFileId) continue
    conflicts.push({ kind: 'same_body', meterId: d.meterId, message: `Same data as ${d.label}${d.siteLabel ? ` at ${d.siteLabel}` : ''}.` })
  }
  if (outcome.sourceSerials.length > 0) {
    // The meter(s) this file already feeds (an earlier commit or a partial one) hold its serials by
    // construction; they are the file itself, not a conflict, on a re-parse, re-commit or retry.
    const own = new Set(selfFileId ? (await repo.metersForFile(selfFileId)).map((m) => m.meterId) : [])
    for (const m of await repo.metersBySerials(orgId, outcome.sourceSerials)) {
      if (own.has(m.id)) continue
      const shared = m.serials.filter((s) => outcome.sourceSerials.includes(s)).join(', ')
      conflicts.push({ kind: 'same_serial', meterId: m.id, message: `Serial ${shared} is already meter ${m.label}${m.site_label ? ` at ${m.site_label}` : ''}.` })
    }
    const site = outcome.filename.siteHint
    for (const r of await repo.registerBySerials(orgId, outcome.sourceSerials)) {
      if (r.mallName && site && siteKey(r.mallName) !== siteKey(site)) {
        conflicts.push({ kind: 'serial_other_mall', message: `The downloader log files serial ${r.serial} under ${r.mallName}, not ${site}.` })
      }
    }
  }
  if (outcome.report.identity.serialMismatch) {
    conflicts.push({ kind: 'filename_serial_mismatch', message: `The file name says meter ${outcome.report.identity.filenameSerial}; the file holds ${outcome.sourceSerials.join(', ')}.` })
  }
  return { sourceSerials: outcome.sourceSerials, filenameSerial: outcome.report.identity.filenameSerial, conflicts, blocking: conflicts.length > 0 }
}

export function fileStatusFor(outcome: MeterParseOutcome): { status: 'parsed' | 'skipped'; skip_reason: string | null } {
  if (outcome.kind === 'register') return { status: 'parsed', skip_reason: null }
  if (outcome.kind === 'rejected') return { status: 'skipped', skip_reason: outcome.report.errors[0]?.code ?? 'rejected' }
  const hard = outcome.report.errors.filter((e) => !CHOICE_ERRORS.has(e.code))
  return hard.length > 0 ? { status: 'skipped', skip_reason: hard[0].code } : { status: 'parsed', skip_reason: null }
}

export function fileParsePatch(outcome: MeterParseOutcome): Record<string, unknown> {
  const r = outcome.report
  const s = fileStatusFor(outcome)
  return {
    detected_format: r.format,
    parsed_filename: outcome.filename,
    delimiter: r.delimiter,
    decimal_sep: r.decimalSeparator,
    header_row: r.headerRow,
    encoding: r.encoding,
    body_sha256: outcome.kind === 'register' ? null : outcome.bodySha256,
    source_serials: outcome.kind === 'series' ? outcome.sourceSerials : [],
    ts_convention: r.tsConvention,
    row_order: r.rowOrder,
    status: s.status,
    skip_reason: s.skip_reason,
  }
}

export interface ChannelReview {
  column: string
  quantity: string
  direction: string
  phase: string | null
  sourceUnit: string
  storedUnit: string
  unitFromTable: boolean
  suggestedUnit: string | null
  intervalMin: number
  coverageOnly: boolean
  isCumulative: boolean
  isPrimaryDefault: boolean
  completeness: number
  meanStored: number | null
  maxStored: number | null
  levelShiftSegments: number
}

export interface ReviewModel {
  fileId: string
  fileName: string
  sheetName: string | null
  reportId: string
  outcome: 'series' | 'register' | 'rejected'
  format: string
  report: ValidationReport
  hints: { site: string | null; shopNo: string | null; label: string | null; areaM2: number | null; serial: string | null; register: RegisterHint[] }
  channels: ChannelReview[]
  preview: Array<{ tsEnd: string; value: number | null; quality: number }>
  identity: IdentityPanel | null
  /** The series body hash (series only): lets the client catch two files in one upload with the same data. */
  bodySha256?: string | null
  registerRows: number
  choicesNeeded: string[]
  blockingErrors: string[]
  canAccept: boolean
}

export function buildReviewModel(args: {
  fileId: string
  fileName: string
  sheetName: string | null
  reportId: string
  outcome: MeterParseOutcome
  identity: IdentityPanel | null
  registerHints: RegisterHint[]
}): ReviewModel {
  const { outcome } = args
  const f = outcome.filename
  const errors = outcome.report.errors.map((e) => e.code)
  const choicesNeeded = [...new Set(errors.filter((c) => CHOICE_ERRORS.has(c)))]
  const blockingErrors = [...new Set(errors.filter((c) => !CHOICE_ERRORS.has(c)))]
  const channels: ChannelReview[] =
    outcome.kind === 'series'
      ? outcome.channels.map((c) => ({
          column: c.spec.sourceColumn, quantity: c.spec.quantity, direction: c.spec.direction, phase: c.spec.phase,
          sourceUnit: c.spec.sourceUnit, storedUnit: c.storedUnit, unitFromTable: c.spec.unitFromTable,
          suggestedUnit: c.spec.sourceUnit === 'unknown' ? suggestUnitFromHeader(c.spec.sourceColumn) : null,
          intervalMin: c.intervalMin, coverageOnly: c.coverageOnly, isCumulative: c.isCumulative,
          isPrimaryDefault: c.spec.sourceColumn === outcome.primaryColumn,
          completeness: c.stats.completeness, meanStored: c.stats.meanUsable, maxStored: c.stats.maxUsable,
          levelShiftSegments: c.levelShifts.length,
        }))
      : []
  const primary = outcome.kind === 'series' ? outcome.channels.find((c) => c.spec.sourceColumn === outcome.primaryColumn) : undefined
  return {
    fileId: args.fileId,
    fileName: args.fileName,
    sheetName: args.sheetName,
    reportId: args.reportId,
    outcome: outcome.kind,
    format: outcome.format,
    report: outcome.report,
    hints: { site: f.siteHint, shopNo: f.shopNo, label: f.label, areaM2: f.areaM2Hint, serial: f.serialHint, register: args.registerHints },
    channels,
    preview: (primary?.readings ?? []).slice(0, 48).map((r) => ({ tsEnd: new Date(r.tsEnd).toISOString(), value: r.value, quality: r.quality })),
    identity: args.identity,
    bodySha256: outcome.kind === 'series' ? outcome.bodySha256 : null,
    registerRows: outcome.kind === 'register' ? outcome.rows.length : 0,
    choicesNeeded,
    blockingErrors,
    canAccept: outcome.kind === 'series' && errors.length === 0,
  }
}
