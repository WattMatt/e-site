/**
 * Monthly maximum demand (engine spec §2.6): the highest sub-hourly interval in chargeable windows.
 * A measured kVA channel (PnP B "S (per kVA)", C "S (kVA)") is used directly; otherwise kW / PF
 * (assumed, shown). Daily files cannot produce MD. The averaged profile's peak is never MD.
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

export function monthlyMaxDemand(
  input: { kw?: Reading[] | null; kva?: Reading[] | null; intervalMin: number },
  opts: { powerFactor?: number; isChargeable?: (tsEnd: number) => boolean } = {},
): { months: MonthlyMd[] } | { error: 'daily_interval' | 'no_data' } {
  if (input.intervalMin >= 1440) return { error: 'daily_interval' }
  const pf = opts.powerFactor ?? 0.95
  const useKva = !!input.kva && input.kva.some(isUsable)
  const src = useKva ? (input.kva as Reading[]) : (input.kw ?? [])
  const best = new Map<string, { kva: number; tsEnd: number }>()
  for (const r of src) {
    if (!isUsable(r)) continue
    if (opts.isChargeable && !opts.isChargeable(r.tsEnd)) continue
    const month = intervalStartLocal(r.tsEnd, input.intervalMin).date.slice(0, 7)
    const kva = useKva ? (r.value as number) : (r.value as number) / pf
    const cur = best.get(month)
    if (!cur || kva > cur.kva) best.set(month, { kva, tsEnd: r.tsEnd })
  }
  if (best.size === 0) return { error: 'no_data' }
  return {
    months: [...best.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, v]) => ({
      month, kva: v.kva, source: useKva ? 'measured_kva' : 'kw_over_pf', powerFactor: useKva ? null : pf, tsEnd: v.tsEnd,
    })),
  }
}

/** For a site series that has no sub-hourly data behind it (S2 aggregate, S3, S4). */
export function monthlyMaxDemandFromHourly(series: Float64Array, referenceYear: number, powerFactor = 0.95): MonthlyMd[] {
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
    kva: Number.isFinite(v) ? v / powerFactor : 0,
    source: 'hourly_series' as const,
    powerFactor,
    tsEnd: null,
  }))
}
