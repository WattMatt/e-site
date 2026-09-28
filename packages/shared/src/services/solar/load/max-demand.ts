/**
 * Monthly maximum demand (engine spec §2.6): the highest sub-hourly interval in chargeable windows.
 * A measured kVA channel (PnP B "S (per kVA)", C "S (kVA)") is used directly; otherwise kW / PF
 * (assumed, shown). The choice is made PER MONTH: a month the kVA channel does not cover falls back
 * to kW / PF rather than disappearing. Daily files cannot produce MD. The averaged profile's peak is
 * never MD.
 */
import { isUsable, type Reading } from '../../../meter-data/types'
import { intervalStartLocal, monthOf, referenceYearDates } from './calendar'

export interface MonthlyMd {
  month: string
  kva: number
  source: 'measured_kva' | 'kw_over_pf' | 'hourly_series'
  powerFactor: number | null
  tsEnd: number | null
}

/** From an hourly series: a month with no data at all has no MD (kva null), never 0 kVA. */
export interface HourlyMonthlyMd extends Omit<MonthlyMd, 'kva'> {
  kva: number | null
}

type Peak = { value: number; tsEnd: number }

function monthlyPeaks(src: Reading[] | null | undefined, intervalMin: number, isChargeable?: (tsEnd: number) => boolean): Map<string, Peak> {
  const best = new Map<string, Peak>()
  for (const r of src ?? []) {
    if (!isUsable(r)) continue
    if (isChargeable && !isChargeable(r.tsEnd)) continue
    const month = intervalStartLocal(r.tsEnd, intervalMin).date.slice(0, 7)
    const cur = best.get(month)
    if (!cur || (r.value as number) > cur.value) best.set(month, { value: r.value as number, tsEnd: r.tsEnd })
  }
  return best
}

export function monthlyMaxDemand(
  input: { kw?: Reading[] | null; kva?: Reading[] | null; intervalMin: number },
  opts: { powerFactor?: number; isChargeable?: (tsEnd: number) => boolean } = {},
): { months: MonthlyMd[] } | { error: 'daily_interval' | 'no_data' } {
  if (input.intervalMin >= 1440) return { error: 'daily_interval' }
  const pf = opts.powerFactor ?? 0.95
  const kva = monthlyPeaks(input.kva, input.intervalMin, opts.isChargeable)
  const kw = monthlyPeaks(input.kw, input.intervalMin, opts.isChargeable)
  const months = [...new Set([...kva.keys(), ...kw.keys()])].sort()
  if (months.length === 0) return { error: 'no_data' }
  return {
    months: months.map((month): MonthlyMd => {
      const measured = kva.get(month)
      if (measured) return { month, kva: measured.value, source: 'measured_kva', powerFactor: null, tsEnd: measured.tsEnd }
      const p = kw.get(month) as Peak
      return { month, kva: p.value / pf, source: 'kw_over_pf', powerFactor: pf, tsEnd: p.tsEnd }
    }),
  }
}

/** For a site series that has no sub-hourly data behind it (S2 aggregate, S3, S4). */
export function monthlyMaxDemandFromHourly(series: Float64Array, referenceYear: number, powerFactor = 0.95): HourlyMonthlyMd[] {
  const max = Array(12).fill(-Infinity) as number[]
  referenceYearDates(referenceYear).forEach((d, di) => {
    const m = monthOf(d) - 1
    for (let h = 0; h < 24; h++) {
      const v = series[di * 24 + h]
      if (!Number.isNaN(v) && v > max[m]) max[m] = v
    }
  })
  return max.map((v, i) => ({
    month: `${referenceYear}-${String(i + 1).padStart(2, '0')}`,
    kva: Number.isFinite(v) ? v / powerFactor : null,
    source: 'hourly_series' as const,
    powerFactor,
    tsEnd: null,
  }))
}
