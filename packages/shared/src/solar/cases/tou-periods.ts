/**
 * Tariff TOU calendar → the engine's 8760 TouPeriod series (battery TOU arbitrage) and a monthly
 * TOU split (Yield monthly table). The tariff core spells 'off_peak'; the engine spells 'off-peak'.
 * Hour h is classified by its START minute (h × 60), matching the interval-ending convention where
 * hour h covers [h:00, h+1:00).
 */
import { dayTypeOf, seasonForMonth, touPeriodAt, type TouCalendar } from '../../tariffs/tou'
import type { TouPeriod } from '../../services/solar/energy/energy-balance'
import { DAYS_IN_MONTH, monthHourRanges } from '../../services/solar/time'

export function engineTouPeriods(cal: TouCalendar, holidays: ReadonlySet<string> | undefined, year: number): TouPeriod[] {
  const out: TouPeriod[] = []
  for (let m = 1; m <= 12; m++) {
    const season = seasonForMonth(m, cal)
    for (let d = 1; d <= DAYS_IN_MONTH[m - 1]!; d++) {
      const dayType = dayTypeOf(year, m, d, holidays, cal)
      for (let h = 0; h < 24; h++) {
        const p = touPeriodAt(cal, season, dayType, h * 60)
        out.push(p === 'off_peak' ? 'off-peak' : p)
      }
    }
  }
  return out
}

export interface TouSplit { peak: number; standard: number; offPeak: number }

export function monthlyTouSplit(series: ArrayLike<number>, periods: readonly TouPeriod[]): TouSplit[] {
  return monthHourRanges().map(({ start, end }) => {
    const s: TouSplit = { peak: 0, standard: 0, offPeak: 0 }
    for (let h = start; h < end; h++) {
      const v = series[h]!
      const p = periods[h]
      if (p === 'peak') s.peak += v
      else if (p === 'standard') s.standard += v
      else s.offPeak += v
    }
    return s
  })
}
