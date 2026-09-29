/**
 * Every Site-profile chart and KPI (functional spec §4.5) derived on the SERVER from the stored
 * 8760-hour site series. The browser receives these aggregates (≤ 365 daily bands, 12 × 24, 3 × 24,
 * 12, 101 points), never the raw series — and never recomputes them.
 */
import { dayTypeOf, HOURS_PER_YEAR, monthOf, referenceYearDates } from './calendar'

/** Day = 06:00–18:00 local (the split shown on the KPI strip). */
export const DAY_WINDOW = { startHour: 6, endHour: 18 } as const

export interface DayBand { day: string; min: number; mean: number; max: number }
export interface SiteProfileKpis {
  annualKwh: number
  peakKw: number
  peakAt: string
  loadFactor: number
  dayKwh: number
  nightKwh: number
  dayPct: number
}
export interface SiteProfileCharts {
  annual: DayBand[]
  avgDayByMonth: number[][]
  dayTypeProfiles: { weekday: number[]; saturday: number[]; sunday: number[] }
  monthlyKwh: number[]
  ldc: Array<{ pct: number; kw: number }>
  kpis: SiteProfileKpis
}

type Pool = 'weekday' | 'saturday' | 'sunday'
const zeros = (n: number) => Array(n).fill(0) as number[]

export function siteProfileCharts(series: ArrayLike<number>, referenceYear: number): SiteProfileCharts {
  if (series.length !== HOURS_PER_YEAR) throw new RangeError(`siteProfileCharts: expected ${HOURS_PER_YEAR} hours, got ${series.length}`)
  const dates = referenceYearDates(referenceYear)
  const annual: DayBand[] = []
  const monthSum = Array.from({ length: 12 }, () => zeros(24))
  const monthDays = zeros(12)
  const pools: Record<Pool, { sum: number[]; n: number }> = {
    weekday: { sum: zeros(24), n: 0 }, saturday: { sum: zeros(24), n: 0 }, sunday: { sum: zeros(24), n: 0 },
  }
  const monthlyKwh = zeros(12)
  let annualKwh = 0
  let dayKwh = 0
  let peak = -Infinity
  let peakIdx = 0
  dates.forEach((d, di) => {
    const m = monthOf(d) - 1
    const t = dayTypeOf(d)
    const pool: Pool = t === 'weekday' ? 'weekday' : t === 'saturday' ? 'saturday' : 'sunday'
    let mn = Infinity
    let mx = -Infinity
    let s = 0
    for (let h = 0; h < 24; h++) {
      const v = series[di * 24 + h]
      s += v
      if (v < mn) mn = v
      if (v > mx) mx = v
      monthSum[m][h] += v
      pools[pool].sum[h] += v
      if (h >= DAY_WINDOW.startHour && h < DAY_WINDOW.endHour) dayKwh += v
      if (v > peak) {
        peak = v
        peakIdx = di * 24 + h
      }
    }
    monthDays[m]++
    pools[pool].n++
    monthlyKwh[m] += s
    annualKwh += s
    annual.push({ day: d, min: mn, mean: s / 24, max: mx })
  })
  const avg = (p: { sum: number[]; n: number }) => p.sum.map((v) => (p.n > 0 ? v / p.n : 0))
  const sorted = Array.from(series).sort((a, b) => b - a)
  const ldc = Array.from({ length: 101 }, (_, pct) => ({ pct, kw: sorted[Math.min(HOURS_PER_YEAR - 1, Math.round((pct / 100) * (HOURS_PER_YEAR - 1)))] }))
  const peakDate = dates[Math.floor(peakIdx / 24)]
  return {
    annual,
    avgDayByMonth: monthSum.map((row, m) => row.map((v) => (monthDays[m] > 0 ? v / monthDays[m] : 0))),
    dayTypeProfiles: { weekday: avg(pools.weekday), saturday: avg(pools.saturday), sunday: avg(pools.sunday) },
    monthlyKwh,
    ldc,
    kpis: {
      annualKwh,
      peakKw: peak,
      peakAt: `${peakDate} ${String(peakIdx % 24).padStart(2, '0')}:00`,
      loadFactor: peak > 0 ? annualKwh / (peak * HOURS_PER_YEAR) : 0,
      dayKwh,
      nightKwh: annualKwh - dayKwh,
      dayPct: annualKwh > 0 ? (dayKwh / annualKwh) * 100 : 0,
    },
  }
}

/** Full-resolution CSV rows for "Download CSV" on the annual chart (hour starts, local SAST). */
export function seriesCsvRows(series: ArrayLike<number>, referenceYear: number): string[][] {
  const rows: string[][] = [['date', 'hour_start', 'kW']]
  referenceYearDates(referenceYear).forEach((d, di) => {
    for (let h = 0; h < 24; h++) rows.push([d, `${String(h).padStart(2, '0')}:00`, series[di * 24 + h].toFixed(3)])
  })
  return rows
}
