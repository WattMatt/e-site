/**
 * Normalisation of one file's rows into per-channel reading grids (engine spec §2.1 steps 1–6).
 * Input labels are already UTC ms of the source label; `convention` says whether that label is the
 * interval's beginning (format A) or end (B/C). Output readings are stored at the interval END.
 */
import { detectLevelShifts, flagSpikesAndNegatives, medianOf } from './artefacts'
import { channelStats } from './stats'
import { MeterParseError, QUALITY, type ChannelSpec, type LevelShiftSegment, type NormalisedChannel, type QualityCode, type Quantity, type Reading, type RowOrder, type TsConvention } from './types'
import { storedUnitFor, toStoredValue } from './units'

export interface RawRow {
  labelUtcMs: number
  /** Raw cell strings, one per channel, in the same order as the channel specs. */
  cells: string[]
  status: string | null
  fileIndex: number
}

export type StatusMode = 'pnp_b' | 'pnp_c' | 'none'

export interface NormaliseInput {
  channels: ChannelSpec[]
  rows: RawRow[]
  convention: TsConvention
  statusMode: StatusMode
  decimalComma?: boolean
  intervalOverrideMin?: number
}

export interface NormaliseResult {
  intervalMin: number
  rowOrder: RowOrder
  duplicates: number
  irregularSteps: number
  calcRows: number
  statusRows: number
  channels: NormalisedChannel[]
}

export function detectRowOrder(labels: number[]): RowOrder {
  let inc = 0
  let dec = 0
  for (let i = 1; i < labels.length; i++) {
    if (labels[i] > labels[i - 1]) inc++
    else if (labels[i] < labels[i - 1]) dec++
  }
  if (dec === 0) return 'ascending'
  if (inc === 0) return 'descending'
  return 'unordered'
}

export function detectIntervalMin(sortedUniqueLabels: number[]): number | null {
  const counts = new Map<number, number>()
  for (let i = 1; i < sortedUniqueLabels.length; i++) {
    const m = Math.round((sortedUniqueLabels[i] - sortedUniqueLabels[i - 1]) / 60_000)
    if (m > 0) counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  let best: number | null = null
  let bestN = 0
  for (const [m, n] of counts) if (n > bestN || (n === bestN && best !== null && m < best)) [best, bestN] = [m, n]
  return best
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/
export function parseNumericCell(raw: string, decimalComma: boolean): number | null {
  const t = raw.trim()
  if (t === '') return null
  const s = decimalComma ? t.replace(',', '.') : t
  return NUMERIC.test(s) ? Number(s) : null
}

const isEnergyLike = (q: Quantity) => q === 'active_energy' || q === 'reactive_energy' || q === 'apparent_energy' || q === 'unknown'
const isLoadQuantity = (q: Quantity) => q === 'active_power' || q === 'active_energy' || q === 'apparent_power' || q === 'apparent_energy'

/** ≥ 98 % of steps non-decreasing over ALL present values, ≥ 50 % strictly increasing, median step ≤ 1 % of median level. */
export function detectCumulative(readings: Reading[]): boolean {
  const v = readings.filter((r) => r.value !== null).map((r) => r.value as number)
  if (v.length < 3) return false
  const steps = v.slice(1).map((x, i) => x - v[i])
  const nonDecreasing = steps.filter((s) => s >= 0).length / steps.length
  const increasing = steps.filter((s) => s > 0).length / steps.length
  const medStep = medianOf(steps) as number
  const medLevel = medianOf(v.map(Math.abs)) as number
  return nonDecreasing >= 0.98 && increasing >= 0.5 && medLevel > 0 && medStep <= 0.01 * medLevel
}

function toDeltas(readings: Reading[]): { readings: Reading[]; rollovers: number } {
  let rollovers = 0
  let prev: number | null = null
  const out = readings.map((r): Reading => {
    if (r.value === null) {
      prev = null
      return r
    }
    const current = r.value
    const p = prev
    prev = current
    if (p === null) return { ...r, value: null, quality: QUALITY.MISSING }
    const d = current - p
    if (d < 0) {
      rollovers++
      return { ...r, value: null, quality: QUALITY.SPIKE }
    }
    return { ...r, value: d }
  })
  return { readings: out, rollovers }
}

export function normaliseSeries(input: NormaliseInput): NormaliseResult {
  const rowOrder = detectRowOrder(input.rows.map((r) => r.labelUtcMs))
  const sorted = [...input.rows].sort((a, b) => a.labelUtcMs - b.labelUtcMs || a.fileIndex - b.fileIndex)
  const unique: RawRow[] = []
  const conflict = new Set<number>()
  let duplicates = 0
  for (const r of sorted) {
    const prev = unique[unique.length - 1]
    if (prev && prev.labelUtcMs === r.labelUtcMs) {
      duplicates++
      if (prev.cells.join('\u0001') !== r.cells.join('\u0001') || prev.status !== r.status) conflict.add(r.labelUtcMs)
      continue
    }
    unique.push(r)
  }
  if (unique.length < 2) throw new MeterParseError('too_few_rows', 'The file needs at least two distinct timestamps.')
  const intervalMin = input.intervalOverrideMin ?? detectIntervalMin(unique.map((r) => r.labelUtcMs))
  if (!intervalMin) throw new MeterParseError('irregular_interval', 'No interval could be determined.')
  const stepMs = intervalMin * 60_000
  const offset = input.convention === 'begin' ? stepMs : 0

  const slotRows: Array<RawRow | null> = []
  const slotLabels: number[] = []
  let irregularSteps = 0
  for (let i = 0; i < unique.length; i++) {
    if (i > 0) {
      const gap = unique[i].labelUtcMs - unique[i - 1].labelUtcMs
      if (gap > stepMs && gap % stepMs === 0) {
        for (let k = 1; k < gap / stepMs; k++) {
          slotRows.push(null)
          slotLabels.push(unique[i - 1].labelUtcMs + k * stepMs)
        }
      } else if (gap !== stepMs) irregularSteps++
    }
    slotRows.push(unique[i])
    slotLabels.push(unique[i].labelUtcMs)
  }

  let calcRows = 0
  let statusRows = 0
  for (const r of unique) {
    const s = r.status?.trim().toLowerCase() ?? null
    if (input.statusMode === 'pnp_b' && s === 'calc') calcRows++
    if (input.statusMode === 'pnp_c' && s !== null && s !== '0') statusRows++
  }

  const channels = input.channels.map((spec, ci): NormalisedChannel => {
    let readings: Reading[] = slotRows.map((r, si): Reading => {
      const tsEnd = slotLabels[si] + offset
      if (!r) return { tsEnd, value: null, quality: QUALITY.MISSING }
      const v = parseNumericCell(r.cells[ci] ?? '', !!input.decimalComma)
      if (v === null) return { tsEnd, value: null, quality: QUALITY.MISSING }
      let q: QualityCode = QUALITY.OK
      const s = r.status?.trim().toLowerCase() ?? null
      if (input.statusMode === 'pnp_b' && s !== null) {
        if (s === 'calc') {
          if (v === 0) return { tsEnd, value: null, quality: QUALITY.MISSING }
          q = QUALITY.ESTIMATED
        } else if (s !== 'ok') q = QUALITY.STATUS
      } else if (input.statusMode === 'pnp_c' && s !== null && s !== '0') q = QUALITY.STATUS
      if (conflict.has(r.labelUtcMs)) q = QUALITY.DUPLICATE
      return { tsEnd, value: v, quality: q }
    })

    const isCumulative = isEnergyLike(spec.quantity) && detectCumulative(readings)
    let rollovers = 0
    if (isCumulative) ({ readings, rollovers } = toDeltas(readings))
    readings = readings.map((r) => (r.value === null ? r : { ...r, value: toStoredValue(r.value, spec, intervalMin) }))

    let levelShifts: LevelShiftSegment[] = []
    let flags = { spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0 }
    if (isLoadQuantity(spec.quantity)) {
      const ls = detectLevelShifts(readings)
      readings = ls.readings
      levelShifts = ls.segments
      const f = flagSpikesAndNegatives(readings)
      readings = f.readings
      flags = f.counts
    }
    return {
      spec,
      storedUnit: storedUnitFor(spec.quantity),
      intervalMin,
      isCumulative,
      coverageOnly: intervalMin >= 1440,
      readings,
      levelShifts,
      stats: channelStats(readings, intervalMin, {
        ...flags,
        rollovers,
        duplicateConflicts: conflict.size,
        levelShiftIntervals: levelShifts.reduce((n, s) => n + s.count, 0),
      }),
    }
  })

  return { intervalMin, rowOrder, duplicates, irregularSteps, calcRows, statusRows, channels }
}
