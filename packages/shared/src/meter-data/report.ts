import { FORMAT_LABELS, type ChannelStats, type DateOrder, type Direction, type IssueCode, type MeterFormatId, type NormalisedChannel, type Phase, type Quantity, type ReportIssue, type RowOrder, type SourceUnit, type StoredUnit, type TsConvention } from './types'

export const METER_PARSER_VERSION = '3a.1'
/** as-is/10 §6.3: median tenant 15 W/m² average, P10/P90 5/76. Warn outside, never block. */
export const IMPLIED_DENSITY_BAND_W_PER_M2 = { low: 2, high: 150 } as const

export interface ChannelReport {
  column: string
  quantity: Quantity
  direction: Direction
  phase: Phase
  sourceUnit: SourceUnit
  storedUnit: StoredUnit
  unitFromTable: boolean
  isCumulative: boolean
  coverageOnly: boolean
  intervalMin: number
  stats: Omit<ChannelStats, 'firstTsEnd' | 'lastTsEnd'> & { first: string | null; last: string | null }
  levelShifts: Array<{ start: string; end: string; count: number; medianValue: number }>
}

export interface ValidationReport {
  parserVersion: string
  format: MeterFormatId
  formatLabel: string
  encoding: string | null
  lineEnding: string | null
  delimiter: string | null
  decimalSeparator: '.' | ','
  /** 1-based line number of the header. */
  headerRow: number | null
  rowOrder: RowOrder | null
  dateOrder: DateOrder | null
  dateOrderAmbiguous: boolean
  tsConvention: TsConvention | null
  tsConventionSource: 'format' | 'user' | null
  intervalMin: number | null
  dailyInterval: boolean
  dataRows: number
  unparseableRows: number
  duplicates: number
  twentyFourHundredRows: number
  irregularSteps: number
  periodStart: string | null
  periodEnd: string | null
  spanDays: number | null
  calcShare: number | null
  calcZeroShare: number | null
  identity: { sourceSerials: string[]; filenameSerial: string | null; serialMismatch: boolean; virtual: boolean }
  channels: ChannelReport[]
  primaryColumn: string | null
  laggedChannels: Array<{ column: string; reference: string; share: number }>
  impliedWPerM2: { value: number; areaM2: number; low: number; high: number; outOfBand: boolean } | null
  errors: ReportIssue[]
  warnings: ReportIssue[]
}

export const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

export function issue(code: IssueCode, message: string, column?: string): ReportIssue {
  return column === undefined ? { code, message } : { code, message, column }
}

export function baseReport(p: Partial<ValidationReport> & { format: MeterFormatId }): ValidationReport {
  return {
    parserVersion: METER_PARSER_VERSION,
    formatLabel: FORMAT_LABELS[p.format],
    encoding: null, lineEnding: null, delimiter: null, decimalSeparator: '.', headerRow: null,
    rowOrder: null, dateOrder: null, dateOrderAmbiguous: false, tsConvention: null, tsConventionSource: null,
    intervalMin: null, dailyInterval: false, dataRows: 0, unparseableRows: 0, duplicates: 0,
    twentyFourHundredRows: 0, irregularSteps: 0, periodStart: null, periodEnd: null, spanDays: null,
    calcShare: null, calcZeroShare: null,
    identity: { sourceSerials: [], filenameSerial: null, serialMismatch: false, virtual: false },
    channels: [], primaryColumn: null, laggedChannels: [], impliedWPerM2: null, errors: [], warnings: [],
    ...p,
  }
}

export function channelReport(ch: NormalisedChannel): ChannelReport {
  const { firstTsEnd, lastTsEnd, ...rest } = ch.stats
  return {
    column: ch.spec.sourceColumn,
    quantity: ch.spec.quantity,
    direction: ch.spec.direction,
    phase: ch.spec.phase,
    sourceUnit: ch.spec.sourceUnit,
    storedUnit: ch.storedUnit,
    unitFromTable: ch.spec.unitFromTable,
    isCumulative: ch.isCumulative,
    coverageOnly: ch.coverageOnly,
    intervalMin: ch.intervalMin,
    stats: { ...rest, first: iso(firstTsEnd), last: iso(lastTsEnd) },
    levelShifts: ch.levelShifts.map((s) => ({ start: iso(s.startTsEnd) as string, end: iso(s.endTsEnd) as string, count: s.count, medianValue: s.medianValue })),
  }
}
