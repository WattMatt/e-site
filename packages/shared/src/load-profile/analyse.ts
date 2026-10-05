/**
 * Everything the Load profile tab and its exports show, derived from the combined 8760-hour
 * reference series plus the measured channels' NATIVE interval readings. The hourly profile's
 * peak is never presented as maximum demand: MD comes from interval data only (monthlyMaxDemand,
 * the Solar engine's rule), and a synthetic-only profile reports a design peak instead.
 */
import { isUsable, QUALITY, type Reading } from '../meter-data/types'
import { dayTypeOf, monthOf, referenceYearDates, SAST_OFFSET_MS } from '../services/solar/load/calendar'
import { monthlyMaxDemand, type MonthlyMd } from '../services/solar/load/max-demand'
import { siteProfileCharts, type DayBand, type SiteProfileKpis } from '../services/solar/load/profile-stats'

export type { SiteProfileKpis }

/** The NMD headroom and rounding rule, printed beside the suggestion. */
export const NMD_RULE = { headroom: 0.1, roundToKva: 5, text: 'Highest monthly maximum demand + 10 %, rounded up to the next 5 kVA' } as const
/** Southern-hemisphere high-demand season (Eskom: June–August). */
export const HIGH_SEASON_MONTHS = [6, 7, 8] as const

export interface MeasuredInput {
  kw: Reading[]
  /** A measured kVA channel for the same meter, when the file has one. */
  kva: Reading[] | null
  intervalMin: number
}

/** Below this many coincident days several meters' MD is not taken from their coincident sum. */
export const MIN_COINCIDENT_DAYS = 30
export type MdBasis = 'single' | 'coincident' | 'largest_single_meter' | 'sum_of_meter_peaks'
export type NmdBasis = 'measured_md' | 'measured_md_plus_synthetic' | 'design_peak'
export interface NmdSuggestion { kva: number; basis: NmdBasis; basisKva: number }

export interface ProfileAnalysis {
  kpis: SiteProfileKpis
  annual: DayBand[]
  dayTypeProfiles: { weekday: number[]; saturday: number[]; sunday: number[] }
  avgDayByMonth: number[][]
  seasonal: { high: number[]; low: number[] }
  monthlyKwh: number[]
  ldc: Array<{ pct: number; kw: number }>
  heatmap: { dates: string[]; cells: number[][] }
  md: {
    /** Per calendar month of data; empty when the meters never ran together (basis sum_of_meter_peaks). */
    months: MonthlyMd[]
    peak: { kw: number | null; kva: number; at: string; source: MonthlyMd['source'] | 'sum_of_meter_peaks' }
    intervalMin: number
    /** single meter · coincident sum of several · sum of each meter's own peak (they never overlapped) */
    basis: MdBasis
  } | null
  nmd: NmdSuggestion
}

export const localLabel = (tsEnd: number) => new Date(tsEnd + SAST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')

export function suggestNmd(input: { measuredMdKva: number | null; syntheticPeakKw: number; profilePeakKw: number; powerFactor: number }): NmdSuggestion {
  const { measuredMdKva, syntheticPeakKw, profilePeakKw, powerFactor } = input
  let basis: NmdBasis
  let basisKva: number
  if (measuredMdKva === null) {
    basis = 'design_peak'
    basisKva = profilePeakKw / powerFactor
  } else if (syntheticPeakKw > 0) {
    basis = 'measured_md_plus_synthetic'
    basisKva = measuredMdKva + syntheticPeakKw / powerFactor
  } else {
    basis = 'measured_md'
    basisKva = measuredMdKva
  }
  // Round the product first so float noise (100 × 1.1 = 110.00000000000001) cannot add a step.
  const withHeadroom = Math.round(basisKva * (1 + NMD_RULE.headroom) * 1e9) / 1e9
  return { kva: Math.ceil(withHeadroom / NMD_RULE.roundToKva) * NMD_RULE.roundToKva, basis, basisKva }
}

/** Re-bucket one channel to `target` minutes: a bucket is its mean kW, only when every sub-slot is usable. */
function rebucket(rs: Reading[], from: number, target: number): Map<number, number> {
  const per = target / from
  const step = target * 60_000
  const acc = new Map<number, { s: number; n: number }>()
  for (const r of rs) {
    if (!isUsable(r)) continue
    const end = Math.ceil(r.tsEnd / step) * step
    const e = acc.get(end) ?? { s: 0, n: 0 }
    e.s += r.value as number
    e.n++
    acc.set(end, e)
  }
  const out = new Map<number, number>()
  for (const [k, e] of acc) if (e.n === per) out.set(k, e.s / per)
  return out
}

/**
 * Several measured channels → one coincident interval series: each re-bucketed to the coarsest
 * interval, summed only where EVERY channel has a usable value (a partial sum would understate MD).
 */
export function coincidentSum(channels: Array<{ readings: Reading[]; intervalMin: number }>): { readings: Reading[]; intervalMin: number } | null {
  if (channels.length === 0) return null
  const coarsest = Math.max(...channels.map((c) => c.intervalMin))
  const target = channels.every((c) => coarsest % c.intervalMin === 0) ? coarsest : 60
  const maps = channels.map((c) => rebucket(c.readings, c.intervalMin, target))
  const keys = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k))).sort((a, b) => a - b)
  return { intervalMin: target, readings: keys.map((k) => ({ tsEnd: k, value: maps.reduce((s, m) => s + (m.get(k) as number), 0), quality: QUALITY.OK })) }
}

function mdOf(kw: { readings: Reading[]; intervalMin: number }, kva: { readings: Reading[]; intervalMin: number } | null, powerFactor: number) {
  if (kw.readings.length === 0 || kw.intervalMin >= 1440) return null
  const r = monthlyMaxDemand({ kw: kw.readings, kva: kva && kva.intervalMin === kw.intervalMin ? kva.readings : null, intervalMin: kw.intervalMin }, { powerFactor })
  if ('error' in r) return null
  const top = r.months.reduce((a, b) => (b.kva > a.kva ? b : a))
  const kwAt = top.tsEnd === null ? null : (kw.readings.find((x) => x.tsEnd === top.tsEnd)?.value ?? null)
  return { months: r.months, peak: { kw: kwAt, kva: top.kva, at: top.tsEnd === null ? '' : localLabel(top.tsEnd), source: top.source as MonthlyMd['source'] | 'sum_of_meter_peaks' } }
}

function measuredMd(measured: MeasuredInput[], powerFactor: number): ProfileAnalysis['md'] {
  if (measured.length === 0) return null
  const kw = coincidentSum(measured.map((m) => ({ readings: m.kw, intervalMin: m.intervalMin })))
  const kva = measured.every((m) => m.kva) ? coincidentSum(measured.map((m) => ({ readings: m.kva as Reading[], intervalMin: m.intervalMin }))) : null
  if (measured.length === 1) {
    const one = kw && mdOf(kw, kva, powerFactor)
    return one ? { ...one, intervalMin: kw!.intervalMin, basis: 'single' } : null
  }
  const each = measured.map((m) => mdOf({ readings: m.kw, intervalMin: m.intervalMin }, m.kva ? { readings: m.kva, intervalMin: m.intervalMin } : null, powerFactor))
  // A meter whose MD cannot be computed would silently shrink any combination: report none instead.
  if (each.some((e) => e === null)) return null
  const singles = each as NonNullable<(typeof each)[number]>[]
  const largest = singles.reduce((a, b) => (b.peak.kva > a.peak.kva ? b : a))
  const coincidentDays = kw ? (kw.readings.length * kw.intervalMin) / 1440 : 0
  if (kw && coincidentDays >= MIN_COINCIDENT_DAYS) {
    const c = mdOf(kw, kva, powerFactor)
    if (c) {
      // A short overlap can miss a meter's own peak elsewhere in the year: never report less than it.
      if (largest.peak.kva > c.peak.kva) return { months: c.months, peak: largest.peak, intervalMin: kw.intervalMin, basis: 'largest_single_meter' }
      return { ...c, intervalMin: kw.intervalMin, basis: 'coincident' }
    }
  }
  // The meters did not run together long enough to know their coincident peak: add each meter's
  // own peak (an upper bound, never an understatement) rather than dropping the measured MD.
  return {
    months: [],
    peak: { kw: null, kva: singles.reduce((s, e) => s + e.peak.kva, 0), at: '', source: 'sum_of_meter_peaks' },
    intervalMin: Math.max(...measured.map((m) => m.intervalMin)),
    basis: 'sum_of_meter_peaks',
  }
}

export function analyseProfile(input: {
  series: Float64Array
  referenceYear: number
  powerFactor: number
  measured: MeasuredInput[]
  /** Peak of the synthetic part alone (kW, hourly); 0 when there is none. */
  syntheticPeakKw: number
}): ProfileAnalysis {
  const { series, referenceYear, powerFactor } = input
  if (!(powerFactor > 0 && powerFactor <= 1)) throw new RangeError(`powerFactor ${powerFactor} must be in (0, 1]`)
  const c = siteProfileCharts(series, referenceYear)
  const dates = referenceYearDates(referenceYear)
  const seasonal = { high: { s: new Float64Array(24), n: 0 }, low: { s: new Float64Array(24), n: 0 } }
  const cells: number[][] = []
  dates.forEach((d, di) => {
    const row = Array.from(series.subarray(di * 24, di * 24 + 24))
    cells.push(row)
    if (dayTypeOf(d) !== 'weekday') return
    const pool = (HIGH_SEASON_MONTHS as readonly number[]).includes(monthOf(d)) ? seasonal.high : seasonal.low
    for (let h = 0; h < 24; h++) pool.s[h] += row[h]
    pool.n++
  })
  const avg = (p: { s: Float64Array; n: number }) => Array.from(p.s, (v) => (p.n ? v / p.n : 0))
  const md = measuredMd(input.measured, powerFactor)
  return {
    kpis: c.kpis,
    annual: c.annual,
    dayTypeProfiles: c.dayTypeProfiles,
    avgDayByMonth: c.avgDayByMonth,
    seasonal: { high: avg(seasonal.high), low: avg(seasonal.low) },
    monthlyKwh: c.monthlyKwh,
    ldc: c.ldc,
    heatmap: { dates, cells },
    md,
    nmd: suggestNmd({ measuredMdKva: md ? md.peak.kva : null, syntheticPeakKw: input.syntheticPeakKw, profilePeakKw: c.kpis.peakKw, powerFactor }),
  }
}
