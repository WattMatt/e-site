/**
 * Meter data — shared types (Solar Phase 3a).
 * Spec: docs/solar/02-calculation-engine-spec.md §1.2, §2.1; docs/solar/as-is/10-meter-csv-source.md §2, §6.
 * A reading is stored at its interval END (tsEnd, epoch ms UTC). Power-like quantities are stored in
 * kW / kvar / kVA; energy per interval is converted with kW = kWh × 60 / interval_min.
 */
export type MeterFormatId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'generic' | 'empty'

export const FORMAT_LABELS: Record<MeterFormatId, string> = {
  A: 'A: sep= power export (average kW, interval-beginning labels)',
  B: 'B: PnP SCADA power export (average kW, interval-ending labels)',
  C: 'C: PnP SCADA energy export (kWh per interval, interval-ending labels)',
  D: 'D: escaped single-line copy of another export (not data)',
  E: 'E: batch-downloader log (serial register, not data)',
  F: 'F: derived working column (not data)',
  G: 'G: consolidation summary (meter register, not data)',
  generic: 'Generic delimited file (every choice confirmed by the user)',
  empty: 'Empty or header-only file',
}

export type Quantity =
  | 'active_power' | 'reactive_power' | 'apparent_power'
  | 'active_energy' | 'reactive_energy' | 'apparent_energy'
  | 'voltage' | 'current' | 'power_factor' | 'volume' | 'unknown'
export type Direction = 'import' | 'export' | 'none'
export type Phase = 'l1' | 'l2' | 'l3' | null

export const SOURCE_UNITS = ['kW', 'W', 'MW', 'kWh', 'Wh', 'MWh', 'kvar', 'kvarh', 'kVA', 'kVAh', 'V', 'A', 'm3', 'PF', 'unknown'] as const
export type SourceUnit = (typeof SOURCE_UNITS)[number]
export type StoredUnit = 'kW' | 'kvar' | 'kVA' | 'V' | 'A' | 'PF' | 'm3' | 'unknown'
export type TsConvention = 'begin' | 'end'
export type RowOrder = 'ascending' | 'descending' | 'unordered'
export type DateOrder = 'DMY' | 'MDY' | 'YMD'

/** Engine spec §2.1 step 5. */
export const QUALITY = {
  OK: 0, MISSING: 1, ESTIMATED: 2, NEGATIVE: 3, SPIKE: 4, DUPLICATE: 5, STATUS: 6, SCALE_CORRECTED: 7,
} as const
export type QualityCode = (typeof QUALITY)[keyof typeof QUALITY]

export interface ChannelSpec {
  sourceColumn: string
  /** Index of the column in the file's header row. */
  columnIndex: number
  quantity: Quantity
  direction: Direction
  phase: Phase
  sourceUnit: SourceUnit
  /** true when the unit came from the format's fixed table; false when user-chosen or unknown. */
  unitFromTable: boolean
  /** PnP "scalar sum S": the sum across phases or serials. */
  isScalarSum?: boolean
}

export interface Reading {
  tsEnd: number
  value: number | null
  quality: QualityCode
}

/**
 * The one usability rule. Usable = has a value and is OK, estimated, scale-corrected,
 * or a tiny negative that was clamped to 0 (quality 3 with value >= 0). A large negative keeps
 * its raw value with quality 3 so it can be shown, and is excluded here.
 */
export function isUsable(r: Pick<Reading, 'value' | 'quality'>): boolean {
  if (r.value === null) return false
  if (r.quality === QUALITY.OK || r.quality === QUALITY.ESTIMATED || r.quality === QUALITY.SCALE_CORRECTED) return true
  return r.quality === QUALITY.NEGATIVE && r.value >= 0
}

export interface LevelShiftSegment {
  startTsEnd: number
  endTsEnd: number
  count: number
  medianValue: number
}

export interface ChannelStats {
  slots: number
  present: number
  usable: number
  estimated: number
  statusFlagged: number
  /** present / slots */
  completeness: number
  firstTsEnd: number | null
  lastTsEnd: number | null
  spanDays: number
  longestGapHours: number
  zeroRunsOver6h: number
  spikes: number
  resetPairs: number
  tinyNegatives: number
  largeNegatives: number
  rollovers: number
  duplicateConflicts: number
  levelShiftIntervals: number
  meanUsable: number | null
  maxUsable: number | null
  sumUsable: number
}

export interface NormalisedChannel {
  spec: ChannelSpec
  storedUnit: StoredUnit
  intervalMin: number
  isCumulative: boolean
  /** Daily (1,440-min) channels: coverage only, never load or MD (engine spec §2.1 step 6). */
  coverageOnly: boolean
  readings: Reading[]
  levelShifts: LevelShiftSegment[]
  stats: ChannelStats
}

export type IssueCode =
  | 'empty_file' | 'header_only' | 'escaped_copy' | 'download_log' | 'derived_file' | 'register_file'
  | 'workbook_file' | 'xls_not_supported' | 'water_channel' | 'unparseable_timestamps' | 'too_few_rows'
  | 'low_completeness' | 'unknown_unit' | 'ambiguous_date_order' | 'convention_required' | 'no_header'
  | 'short_window' | 'daily_interval' | 'irregular_interval' | 'serial_mismatch' | 'level_shift' | 'spikes'
  | 'reset_pairs' | 'tiny_negatives' | 'large_negatives' | 'rollover' | 'lagged_channel'
  | 'implied_density_out_of_band' | 'calc_padding' | 'status_codes_unmapped' | 'duplicate_timestamps'
  | 'unit_overridden' | 'formula_columns' | 'latin1_encoding'

export interface ReportIssue {
  code: IssueCode
  message: string
  column?: string
}

export class MeterParseError extends Error {
  readonly code: IssueCode
  constructor(code: IssueCode, message: string) {
    super(message)
    this.code = code
    this.name = 'MeterParseError'
  }
}
