/**
 * Cross-check a legacy reference table (transcribed from the Aberdare "Facts &
 * Figures" booklet) against the SANS 10142-1 table it claims to equal, cell by
 * cell. The mapping says which legacy column corresponds to which SANS column
 * and how the row keys line up; it holds no values.
 *
 * Outcome per cell: `match` (equal within the tolerance), `mismatch`, or
 * `no_counterpart` (the legacy row or column has nothing to compare with in
 * the standard — e.g. a 2.0 m depth row where SANS stops at 1.5 m, or an XLPE
 * column in a PVC-only SANS table). `no_counterpart` is never counted as a
 * pass: it is reported so the reader sees exactly what SANS does NOT back.
 */

export interface ColumnPair { legacy: string; sans: string }

export interface CrosscheckMapping {
  legacyCode: string
  /** SANS clause the legacy table is compared with, e.g. "6.13". */
  sansClause: string
  /** Legacy key column and the matching SANS key column. */
  legacyKey: string
  sansKey: string
  /** Legacy key = SANS key × keyScale (e.g. depth mm vs m → 1000). */
  keyScale?: number
  pairs: ColumnPair[]
  /** Legacy columns deliberately outside the comparison, with the reason. */
  unpaired?: Record<string, string>
  /** Absolute tolerance per cell (0 = exact). */
  tolerance?: number
}

export type CellOutcome = 'match' | 'mismatch' | 'no_counterpart'

export interface CellResult {
  key: number
  column: string
  legacy: number | null
  sans: number | null | undefined
  outcome: CellOutcome
}

export interface CrosscheckResult {
  legacyCode: string
  sansClause: string
  cells: CellResult[]
  matched: number
  mismatched: number
  noCounterpart: number
}

type Row = Record<string, unknown>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sameKey = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

export function crosscheck(
  mapping: CrosscheckMapping,
  legacyRows: Row[],
  sansRows: Row[],
): CrosscheckResult {
  const tol = mapping.tolerance ?? 0
  const scale = mapping.keyScale ?? 1
  const cells: CellResult[] = []
  for (const lr of legacyRows) {
    const key = num(lr[mapping.legacyKey])
    if (key == null) continue
    const sr = sansRows.find((r) => {
      const k = num(r[mapping.sansKey])
      return k != null && sameKey(k * scale, key)
    })
    for (const p of mapping.pairs) {
      if (!(p.legacy in lr)) continue
      const legacy = num(lr[p.legacy])
      const sans = sr ? (sr[p.sans] === null ? null : num(sr[p.sans]) ?? undefined) : undefined
      let outcome: CellOutcome
      if (sans === undefined || sans === null) outcome = 'no_counterpart'
      else if (legacy != null && Math.abs(legacy - sans) <= tol + 1e-9) outcome = 'match'
      else outcome = 'mismatch'
      cells.push({ key, column: p.legacy, legacy, sans, outcome })
    }
    for (const col of Object.keys(mapping.unpaired ?? {})) {
      if (col in lr) cells.push({ key, column: col, legacy: num(lr[col]), sans: undefined, outcome: 'no_counterpart' })
    }
  }
  return {
    legacyCode: mapping.legacyCode,
    sansClause: mapping.sansClause,
    cells,
    matched: cells.filter((c) => c.outcome === 'match').length,
    mismatched: cells.filter((c) => c.outcome === 'mismatch').length,
    noCounterpart: cells.filter((c) => c.outcome === 'no_counterpart').length,
  }
}

const XLPE_NOT_IN_SANS = 'SANS 10142-1 publishes no XLPE (90 °C) factor for this axis; manufacturer data only.'

/** Legacy LV tables and the SANS 10142-1 tables they are claimed to equal. */
export const LEGACY_CROSSCHECKS: CrosscheckMapping[] = [
  {
    legacyCode: 'TABLE_6_3_1', sansClause: '6.16', legacyKey: 'depth_mm', sansKey: 'depth_m', keyScale: 1000,
    pairs: [
      { legacy: 'factor_direct_in_ground', sans: 'buried_direct' },
      { legacy: 'factor_single_way_duct', sans: 'in_pipes' },
    ],
  },
  {
    legacyCode: 'TABLE_6_3_2', sansClause: '6.12', legacyKey: 'resistivity_kmw', sansKey: 'resistivity_kmw',
    pairs: [
      { legacy: 'factor_direct_in_ground', sans: 'buried_direct' },
      { legacy: 'factor_single_way_duct', sans: 'in_pipes' },
    ],
  },
  {
    legacyCode: 'TABLE_6_3_3', sansClause: '6.13', legacyKey: 'n_cables', sansKey: 'n_cables',
    pairs: [
      { legacy: 'ground_touching', sans: 'direct_touching' },
      { legacy: 'ground_150mm', sans: 'direct_150mm' },
      { legacy: 'ground_300mm', sans: 'direct_300mm' },
      { legacy: 'ground_450mm', sans: 'direct_450mm' },
      { legacy: 'ground_600mm', sans: 'direct_600mm' },
      { legacy: 'duct_touching', sans: 'pipes_touching' },
      { legacy: 'duct_300mm', sans: 'pipes_300mm' },
      { legacy: 'duct_450mm', sans: 'pipes_450mm' },
      { legacy: 'duct_600mm', sans: 'pipes_600mm' },
    ],
  },
  {
    legacyCode: 'TABLE_6_3_4', sansClause: '6.11', legacyKey: 'ambient_c', sansKey: 'soil_temp_c',
    pairs: [{ legacy: 'factor_pvc_70c', sans: 'buried_direct_or_pipes' }],
    unpaired: { factor_xlpe_90c: XLPE_NOT_IN_SANS },
  },
  {
    legacyCode: 'TABLE_6_3_5', sansClause: '6.10', legacyKey: 'ambient_c', sansKey: 'ambient_c',
    pairs: [{ legacy: 'factor_pvc_70c', sans: 'pvc_70c' }],
    unpaired: { factor_xlpe_90c: XLPE_NOT_IN_SANS },
  },
  {
    legacyCode: 'TABLE_6_2', sansClause: '6.8', legacyKey: 'size_mm2', sansKey: 'size_mm2',
    pairs: [
      { legacy: 'current_rating_ground_a', sans: 'buried_3or4core_a' },
      { legacy: 'current_rating_duct_a', sans: 'duct_3or4core_a' },
    ],
  },
  {
    legacyCode: 'TABLE_6_2', sansClause: '6.4(a)', legacyKey: 'size_mm2', sansKey: 'size_mm2',
    pairs: [{ legacy: 'current_rating_air_a', sans: 'tray_air_3or4core_a' }],
  },
]

/** Per legacy column: how far up the key range every row was proven equal. */
export interface ColumnCoverage {
  /** Largest key K such that every legacy row with key ≤ K matched SANS in this column; null if the first row did not. */
  up_to: number | null
  /** Every legacy row of this column matched. */
  whole: boolean
  /** The proven cells (legacy key → value), so a consumer can check a stored factor is one of them. */
  values: Record<string, number>
  /** Index into the verdict's `against` list: the SANS table that backs this column. */
  against_index?: number
}

/**
 * Turn cell outcomes into coverage a consumer can apply to one input value:
 * a factor read at `value` is backed by SANS iff value ≤ up_to (the
 * conservative lookup then lands on a proven row). Columns never compared are
 * absent, so they are never cited.
 */
export function columnCoverage(result: CrosscheckResult, legacyKeys: number[]): Record<string, ColumnCoverage> {
  const keys = [...new Set(legacyKeys)].sort((a, b) => a - b)
  const out: Record<string, ColumnCoverage> = {}
  const columns = [...new Set(result.cells.map((c) => c.column))]
  for (const col of columns) {
    const cells = result.cells.filter((c) => c.column === col)
    if (!cells.some((c) => c.outcome === 'match')) continue
    const matched = new Set(cells.filter((c) => c.outcome === 'match').map((c) => c.key))
    const present = new Set(cells.map((c) => c.key))
    let upTo: number | null = null
    for (const k of keys) {
      if (!present.has(k)) continue
      if (!matched.has(k)) break
      upTo = k
    }
    const whole = [...present].every((k) => matched.has(k))
    const values: Record<string, number> = {}
    for (const c of cells) if (c.outcome === 'match' && c.legacy != null) values[String(c.key)] = c.legacy
    out[col] = { up_to: upTo, whole, values }
  }
  return out
}
