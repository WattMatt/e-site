/**
 * parseMeterFile: one file in, one outcome out (engine spec §2.1; as-is/10 §6.1).
 * Pure. bytes + name (+ the user's confirmations) → series | register | rejected, each with a report.
 * The server re-runs it at commit time with the confirmed options; it never trusts a client parse.
 */
import { laggedDuplicateShare } from './artefacts'
import { parseMeterFilename, type ParsedFilename } from './filename'
import { canonicalBody, sha256Hex } from './hash'
import { parseDownloadLog, parseRegisterCsv, type RegisterRow } from './register'
import { baseReport, channelReport, IMPLIED_DENSITY_BAND_W_PER_M2, iso, issue, type ValidationReport } from './report'
import { normaliseSeries, parseNumericCell, type NormaliseResult, type RawRow, type StatusMode } from './series'
import { GENERIC_TS_RE, sniffMeterText, type SniffResult } from './sniff'
import { decodeMeterText, splitLines, splitRow, type DecodedText } from './text'
import { detectDateOrder, parseLabelA, parseLabelB, parseLabelC, parseLabelGeneric, type ParsedLabel } from './timestamps'
import { MeterParseError, type ChannelSpec, type DateOrder, type IssueCode, type MeterFormatId, type NormalisedChannel, type ReportIssue, type SourceUnit, type TsConvention } from './types'
import { mapColumnA, mapColumnB, mapColumnC, mapColumnGeneric, suggestUnitFromHeader, withUnit, type NonChannelColumn } from './units'

export interface ParseOptions {
  /** Generic path only: the confirmed file-level date order. */
  dateOrder?: DateOrder
  /** Generic path only: whether labels mark the start or the end of the interval. A/B/C are fixed. */
  tsConvention?: TsConvention
  /** Per source column: a unit chosen by the user (required on the generic path; an override elsewhere). */
  units?: Record<string, SourceUnit>
  /** Area for the implied W/m² check; defaults to the filename hint. */
  areaM2?: number | null
}

export interface SeriesOutcome {
  kind: 'series'
  format: 'A' | 'B' | 'C' | 'generic'
  fileSha256: string
  bodySha256: string
  filename: ParsedFilename
  sourceSerials: string[]
  channels: NormalisedChannel[]
  primaryColumn: string | null
  report: ValidationReport
}
export interface RegisterOutcome {
  kind: 'register'
  format: 'E' | 'G'
  fileSha256: string
  filename: ParsedFilename
  rows: RegisterRow[]
  report: ValidationReport
}
export interface RejectedOutcome {
  kind: 'rejected'
  format: MeterFormatId
  fileSha256: string
  bodySha256: string | null
  filename: ParsedFilename
  report: ValidationReport
}
export type MeterParseOutcome = SeriesOutcome | RegisterOutcome | RejectedOutcome

const XLS_MESSAGE =
  'Legacy .xls workbooks in this corpus are consolidation summaries, not meter data. Save it as CSV (Excel: File, Save As, CSV UTF-8) and use Import meter register.'

function rejected(format: MeterFormatId, fileSha256: string, bodySha256: string | null, filename: ParsedFilename, report: ValidationReport): RejectedOutcome {
  return { kind: 'rejected', format, fileSha256, bodySha256, filename, report }
}

export async function parseMeterFile(input: { bytes: Uint8Array; fileName: string; options?: ParseOptions }): Promise<MeterParseOutcome> {
  const options = input.options ?? {}
  const fileSha256 = await sha256Hex(input.bytes)
  const filename = parseMeterFilename(input.fileName)
  if (filename.extension === 'xls') {
    return rejected('G', fileSha256, null, filename, baseReport({ format: 'G', errors: [issue('xls_not_supported', XLS_MESSAGE)] }))
  }
  if (filename.extension === 'xlsx') {
    return rejected('generic', fileSha256, null, filename, baseReport({ format: 'generic', errors: [issue('workbook_file', 'Workbooks are read sheet by sheet with parseMeterWorkbook.')] }))
  }

  const decoded = decodeMeterText(input.bytes)
  const common = { encoding: decoded.encoding, lineEnding: decoded.lineEnding }
  const warnings: ReportIssue[] = decoded.encoding === 'latin1' ? [issue('latin1_encoding', 'The file is not valid UTF-8; it was read as Windows-1252.')] : []
  const sniff = sniffMeterText(decoded.text)

  switch (sniff.format) {
    case 'empty':
      return rejected('empty', fileSha256, null, filename, baseReport({
        ...common, format: 'empty', warnings,
        errors: [sniff.reason === 'header_only' ? issue('header_only', 'The file has a header but no data rows.') : issue('empty_file', 'The file holds no data.')],
      }))
    case 'D':
      return parseEscapedCopy(decoded, fileSha256, filename, warnings)
    case 'E':
      return {
        kind: 'register', format: 'E', fileSha256, filename, rows: parseDownloadLog(decoded.text),
        report: baseReport({ ...common, format: 'E', delimiter: ',', headerRow: 1, warnings, errors: [issue('download_log', 'A batch-downloader log: import it as a serial register, never as load data.')] }),
      }
    case 'G': {
      const reg = parseRegisterCsv(decoded.text)
      return {
        kind: 'register', format: 'G', fileSha256, filename, rows: reg.rows,
        report: baseReport({ ...common, format: 'G', delimiter: ',', headerRow: 1, warnings: [...warnings, ...reg.warnings], errors: [issue('register_file', 'A consolidation summary: use Import meter register.')] }),
      }
    }
    case 'F':
      return rejected('F', fileSha256, null, filename, baseReport({ ...common, format: 'F', warnings, errors: [issue('derived_file', 'A derived working column from a hand analysis, not a meter export.')] }))
    default:
      return parseSeries(decoded, sniff, fileSha256, filename, options, warnings)
  }
}

async function parseEscapedCopy(decoded: DecodedText, fileSha256: string, filename: ParsedFilename, warnings: ReportIssue[]): Promise<RejectedOutcome> {
  const lines = splitLines(decoded.text.replace(/\\n/g, '\n'))
  const h = lines.findIndex((l) => /^date,/i.test(l))
  let bodySha256: string | null = null
  if (h >= 0) {
    const header = splitRow(lines[h], ',')
    const specs = header.map((x, k) => ({ x, k })).filter((c) => c.k > 0 && c.x !== '').map((c) => mapColumnA(c.x, c.k))
    const rows: RawRow[] = []
    lines.slice(h + 1).forEach((l, fileIndex) => {
      if (l.trim() === '') return
      const cells = splitRow(l, ',')
      const label = parseLabelA(cells[0] ?? '')
      if (label) rows.push({ labelUtcMs: label.utcMs, cells: specs.map((s) => cells[s.columnIndex] ?? ''), status: null, fileIndex })
    })
    bodySha256 = await sha256Hex(canonicalBody(specs, rows))
  }
  return rejected('D', fileSha256, bodySha256, filename, baseReport({
    format: 'D', encoding: decoded.encoding, lineEnding: decoded.lineEnding, warnings,
    errors: [issue('escaped_copy', 'A single-line copy of another export with escaped line breaks. Import the original file instead.')],
  }))
}

interface Layout {
  specs: ChannelSpec[]
  labelOf: (cells: string[]) => ParsedLabel | null
  statusCol: number | null
  statusMode: StatusMode
  convention: TsConvention
  conventionSource: 'format' | 'user'
  dateOrder: DateOrder
  dateOrderAmbiguous: boolean
  decimalComma: boolean
  errors: ReportIssue[]
}

const isSpec = (x: ChannelSpec | NonChannelColumn): x is ChannelSpec => typeof x !== 'string'

function resolveLayout(format: 'A' | 'B' | 'C' | 'generic', header: string[], sample: string[][], delimiter: string, options: ParseOptions): Layout {
  const fixed = { conventionSource: 'format' as const, dateOrderAmbiguous: false, decimalComma: false, errors: [] as ReportIssue[] }
  if (format === 'A') {
    return {
      ...fixed,
      specs: header.map((h, k) => ({ h, k })).filter((c) => c.k > 0 && c.h.trim() !== '').map((c) => mapColumnA(c.h, c.k)),
      labelOf: (c) => parseLabelA(c[0] ?? ''),
      statusCol: null, statusMode: 'none', convention: 'begin', dateOrder: 'DMY',
    }
  }
  if (format === 'B') {
    const mapped = header.map((h, k) => mapColumnB(h, k))
    const dateCol = mapped.indexOf('date')
    const timeCol = mapped.indexOf('time')
    const statusCol = mapped.indexOf('status')
    return {
      ...fixed,
      specs: mapped.filter(isSpec),
      labelOf: (c) => parseLabelB(c[dateCol] ?? '', c[timeCol] ?? ''),
      statusCol: statusCol >= 0 ? statusCol : null, statusMode: 'pnp_b', convention: 'end', dateOrder: 'YMD',
    }
  }
  if (format === 'C') {
    const mapped = header.map((h, k) => mapColumnC(h, k))
    const tsCol = mapped.indexOf('timestamp')
    const statusCol = mapped.indexOf('status')
    return {
      ...fixed,
      specs: mapped.filter(isSpec),
      labelOf: (c) => parseLabelC(c[tsCol] ?? ''),
      statusCol: statusCol >= 0 ? statusCol : null, statusMode: 'pnp_c', convention: 'end', dateOrder: 'YMD',
    }
  }
  const errors: ReportIssue[] = []
  const share = (k: number) => sample.filter((r) => GENERIC_TS_RE.test((r[k] ?? '').trim())).length / Math.max(1, sample.length)
  const tsCol = header.findIndex((_, k) => share(k) >= 0.9)
  if (tsCol < 0) throw new MeterParseError('unparseable_timestamps', 'No column holds a readable timestamp in at least 90 % of rows.')
  const det = detectDateOrder(sample.map((r) => r[tsCol] ?? ''))
  const dateOrder = options.dateOrder ?? det.order ?? 'DMY'
  if (!options.dateOrder && det.order === null) {
    errors.push(issue('ambiguous_date_order', 'Every day and month in the file is 12 or less, so the date order cannot be told from the data. Confirm DD/MM or MM/DD.'))
  }
  const convention = options.tsConvention ?? 'end'
  if (!options.tsConvention) errors.push(issue('convention_required', 'Confirm whether each timestamp marks the start or the end of its interval.'))
  const decimalComma = delimiter !== ',' && sample.some((r) => r.some((c, k) => k !== tsCol && /^-?\d+,\d+$/.test(c.trim())))
  return {
    specs: header.map((h, k) => ({ h, k })).filter((c) => c.k !== tsCol && c.h.trim() !== '').map((c) => mapColumnGeneric(c.h, c.k)),
    labelOf: (c) => parseLabelGeneric(c[tsCol] ?? '', dateOrder),
    statusCol: null, statusMode: 'none', convention, conventionSource: 'user', dateOrder,
    dateOrderAmbiguous: det.order === null, decimalComma, errors,
  }
}

/** The channel carrying the energy: active import (never a lagged copy), largest energy wins. */
function choosePrimary(channels: NormalisedChannel[], lagged: Set<string>): string | null {
  const cands = channels.filter((c) => (c.spec.quantity === 'active_power' || c.spec.quantity === 'active_energy') && !lagged.has(c.spec.sourceColumn))
  const pool = cands.some((c) => c.spec.direction === 'import') ? cands.filter((c) => c.spec.direction === 'import') : cands
  if (pool.length === 0) return channels.find((c) => c.spec.quantity === 'unknown')?.spec.sourceColumn ?? null
  return pool.reduce((a, b) => (Math.abs(b.stats.sumUsable) > Math.abs(a.stats.sumUsable) ? b : a)).spec.sourceColumn
}

async function parseSeries(decoded: DecodedText, sniff: SniffResult, fileSha256: string, filename: ParsedFilename, options: ParseOptions, warnings: ReportIssue[]): Promise<MeterParseOutcome> {
  const format = sniff.format as 'A' | 'B' | 'C' | 'generic'
  const common = {
    encoding: decoded.encoding, lineEnding: decoded.lineEnding, delimiter: sniff.delimiter,
    headerRow: sniff.headerLineIndex === null ? null : sniff.headerLineIndex + 1,
  }
  const reject = (code: IssueCode, message: string) =>
    rejected(format, fileSha256, null, filename, baseReport({ ...common, format, warnings, errors: [issue(code, message)] }))
  if (sniff.delimiter === null || sniff.headerLineIndex === null || sniff.dataStartIndex === null) {
    return reject('no_header', 'No header row followed by timestamped data was found.')
  }
  const delimiter = sniff.delimiter
  const lines = splitLines(decoded.text)
  const header = splitRow(lines[sniff.headerLineIndex], delimiter)
  const data = lines.slice(sniff.dataStartIndex).filter((l) => l.trim() !== '').map((l) => splitRow(l, delimiter))

  let layout: Layout
  try {
    layout = resolveLayout(format, header, data.slice(0, 50), delimiter, options)
  } catch (e) {
    if (e instanceof MeterParseError) return reject(e.code, e.message)
    throw e
  }
  const water = layout.specs.find((s) => s.quantity === 'volume')
  if (water) return reject('water_channel', `Column "${water.sourceColumn}" is a water (volume) meter, not electrical load.`)

  const errors = [...layout.errors]
  const tableSpecs = layout.specs
  const specs = tableSpecs.map((s) => {
    const u = options.units?.[s.sourceColumn]
    if (!u) return s
    if (s.unitFromTable && u !== s.sourceUnit) {
      warnings.push(issue('unit_overridden', `Unit of "${s.sourceColumn}" changed from ${s.sourceUnit} to ${u} by the user.`, s.sourceColumn))
    }
    return withUnit(s, u)
  })
  for (const s of specs) {
    if (s.sourceUnit !== 'unknown') continue
    const hint = suggestUnitFromHeader(s.sourceColumn)
    errors.push(issue('unknown_unit', `Choose a unit for "${s.sourceColumn}"${hint ? ` (the header suggests ${hint})` : ''}. Units are never assumed.`, s.sourceColumn))
  }

  const rows: RawRow[] = []
  let unparseable = 0
  let t2400 = 0
  data.forEach((cells, fileIndex) => {
    const label = layout.labelOf(cells)
    if (!label) {
      unparseable++
      return
    }
    if (label.was2400) t2400++
    rows.push({
      labelUtcMs: label.utcMs,
      cells: specs.map((s) => cells[s.columnIndex] ?? ''),
      status: layout.statusCol === null ? null : (cells[layout.statusCol] ?? null),
      fileIndex,
    })
  })
  if (data.length > 0 && unparseable / data.length > 0.01) {
    errors.push(issue('unparseable_timestamps', `${unparseable} of ${data.length} rows have a timestamp that could not be read.`))
  } else if (unparseable > 0) {
    warnings.push(issue('unparseable_timestamps', `${unparseable} row(s) skipped: unreadable timestamp.`))
  }

  let norm: NormaliseResult
  try {
    norm = normaliseSeries({ channels: specs, rows, convention: layout.convention, statusMode: layout.statusMode, decimalComma: layout.decimalComma })
  } catch (e) {
    if (e instanceof MeterParseError) return reject(e.code, e.message)
    throw e
  }
  // Identity hash from the TABLE specs, so a user's unit override never changes a file's identity.
  const bodySha256 = await sha256Hex(canonicalBody(tableSpecs, rows))

  const lagged: Array<{ column: string; reference: string; share: number }> = []
  const active = norm.channels.filter((c) => c.spec.quantity === 'active_power' && c.spec.direction === 'import')
  for (const a of active) {
    for (const b of active) {
      if (a === b) continue
      const share = laggedDuplicateShare(a.readings, b.readings)
      if (share !== null && share >= 0.9) lagged.push({ column: b.spec.sourceColumn, reference: a.spec.sourceColumn, share })
    }
  }
  for (const l of lagged) {
    warnings.push(issue('lagged_channel', `"${l.column}" repeats "${l.reference}" one interval later (${(l.share * 100).toFixed(1)} % of steps), so its time label follows the other convention. It is never used as the primary channel.`, l.column))
  }
  const primaryColumn = choosePrimary(norm.channels, new Set(lagged.map((l) => l.column)))
  const primary = norm.channels.find((c) => c.spec.sourceColumn === primaryColumn) ?? null

  const sourceSerials = sniff.serials
  const serialMismatch = filename.serialHint !== null && sourceSerials.length > 0 && !sourceSerials.includes(filename.serialHint)
  if (serialMismatch) {
    warnings.push(issue('serial_mismatch', `The file name says meter ${filename.serialHint}; the file holds ${sourceSerials.join(', ')}. The serial inside the file is the meter.`))
  }
  if (norm.intervalMin >= 1440) {
    warnings.push(issue('daily_interval', 'Daily averages: counted as coverage only, never used for the hourly profile or maximum demand.'))
  } else if (![5, 10, 15, 30, 60].includes(norm.intervalMin) || norm.irregularSteps > 0) {
    warnings.push(issue('irregular_interval', `Interval ${norm.intervalMin} min with ${norm.irregularSteps} irregular step(s).`))
  }
  if (norm.duplicates > 0) warnings.push(issue('duplicate_timestamps', `${norm.duplicates} duplicate timestamp(s); the first of each was kept.`))
  for (const c of norm.channels) {
    const s = c.stats
    const col = c.spec.sourceColumn
    if (c.levelShifts.length > 0) {
      warnings.push(issue('level_shift', `${s.levelShiftIntervals} readings in ${c.levelShifts.length} segment(s) are about 1,000 times the rest (W recorded as kW?). Excluded unless you confirm dividing them by 1,000.`, col))
    }
    if (s.spikes - s.resetPairs > 0) warnings.push(issue('spikes', `${s.spikes - s.resetPairs} spike(s) excluded.`, col))
    if (s.resetPairs > 0) warnings.push(issue('reset_pairs', `${s.resetPairs} large negative register artefact(s) excluded.`, col))
    if (s.tinyNegatives > 0) warnings.push(issue('tiny_negatives', `${s.tinyNegatives} tiny negative value(s) clamped to 0.`, col))
    if (s.largeNegatives > 0) warnings.push(issue('large_negatives', `${s.largeNegatives} negative value(s) shown but excluded.`, col))
    if (s.rollovers > 0) warnings.push(issue('rollover', `${s.rollovers} register decrease(s): a rollover or a meter exchange.`, col))
  }
  if (format === 'B' && norm.calcRows > 0) {
    warnings.push(issue('calc_padding', `${norm.calcRows} of ${rows.length} rows are PnP "Calc" (estimated); exact zeros among them are treated as missing.`))
  }
  if (format === 'C' && norm.statusRows > 0) {
    warnings.push(issue('status_codes_unmapped', `${norm.statusRows} row(s) carry a status code other than 0; their meaning is not documented, so they are excluded.`))
  }
  if (primary) {
    if (primary.stats.completeness < 0.5) {
      errors.push(issue('low_completeness', `Only ${(primary.stats.completeness * 100).toFixed(1)} % of intervals of "${primary.spec.sourceColumn}" hold data.`, primary.spec.sourceColumn))
    }
    if (primary.stats.spanDays < 30) {
      warnings.push(issue('short_window', `Only ${primary.stats.spanDays.toFixed(1)} days of data: usable as a shape sample, not as a year.`))
    }
  }

  const area = options.areaM2 ?? filename.areaM2Hint
  let impliedWPerM2: ValidationReport['impliedWPerM2'] = null
  if (primary && !primary.coverageOnly && primary.storedUnit === 'kW' && primary.stats.meanUsable !== null && area !== null && area > 0) {
    const { low, high } = IMPLIED_DENSITY_BAND_W_PER_M2
    const value = (primary.stats.meanUsable * 1000) / area
    const outOfBand = value < low || value > high
    impliedWPerM2 = { value, areaM2: area, low, high, outOfBand }
    if (outOfBand) {
      warnings.push(issue('implied_density_out_of_band', `Average ${value.toFixed(1)} W/m² over ${area} m² is outside ${low}–${high} W/m². Check the unit (kW or kWh) and the area.`))
    }
  }

  const primaryIdx = primary ? specs.indexOf(primary.spec) : -1
  const calcRowsList = format === 'B' ? rows.filter((r) => r.status?.trim().toLowerCase() === 'calc') : []
  const calcShare = format === 'B' && rows.length > 0 ? calcRowsList.length / rows.length : null
  const calcZeroShare =
    format === 'B' && rows.length > 0 && primaryIdx >= 0
      ? calcRowsList.filter((r) => parseNumericCell(r.cells[primaryIdx] ?? '', false) === 0).length / rows.length
      : null
  const firsts = norm.channels.map((c) => c.stats.firstTsEnd).filter((x): x is number => x !== null)
  const lasts = norm.channels.map((c) => c.stats.lastTsEnd).filter((x): x is number => x !== null)

  const report = baseReport({
    ...common,
    format,
    decimalSeparator: layout.decimalComma ? ',' : '.',
    rowOrder: norm.rowOrder,
    dateOrder: layout.dateOrder,
    dateOrderAmbiguous: layout.dateOrderAmbiguous,
    tsConvention: layout.convention,
    tsConventionSource: layout.conventionSource,
    intervalMin: norm.intervalMin,
    dailyInterval: norm.intervalMin >= 1440,
    dataRows: rows.length,
    unparseableRows: unparseable,
    duplicates: norm.duplicates,
    twentyFourHundredRows: t2400,
    irregularSteps: norm.irregularSteps,
    periodStart: iso(firsts.length ? Math.min(...firsts) : null),
    periodEnd: iso(lasts.length ? Math.max(...lasts) : null),
    spanDays: primary?.stats.spanDays ?? null,
    calcShare,
    calcZeroShare,
    identity: { sourceSerials, filenameSerial: filename.serialHint, serialMismatch, virtual: sourceSerials.length > 1 },
    channels: norm.channels.map(channelReport),
    primaryColumn,
    laggedChannels: lagged,
    impliedWPerM2,
    errors,
    warnings,
  })
  return { kind: 'series', format, fileSha256, bodySha256, filename, sourceSerials, channels: norm.channels, primaryColumn, report }
}
