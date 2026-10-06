/**
 * A monthly consumption profile -> twelve MonthUsage for the bill engine.
 *
 * E8 hand-off: this is the seam a load-profile tool feeds. A profile is
 * monthly energy (one figure, or twelve) split across TOU periods by fixed
 * shares, plus demand. Seasons come from the tariff's calendar, so the same
 * profile prices correctly against tariffs with different high seasons.
 * A real interval profile should go through aggregateHourly() instead.
 */
import { REFERENCE_MONTH_DAYS, seasonForMonth } from '../tou'
import type { MonthUsage, TouKwh } from '../types'

export interface ConsumptionProfile {
  /** kWh in every month; ignored when byMonthKwh is given. */
  monthlyKwh: number
  /** Twelve monthly kWh figures, January first. */
  byMonthKwh?: readonly number[] | null
  /** Shares of each month's energy by TOU period; they must add up to 1. */
  touSplit: TouKwh
  /** Maximum demand in kVA, assumed to fall in the peak window. Null = not supplied. */
  maxDemandKva: number | null
  /** Notified maximum demand in kVA. Null = not supplied. */
  nmdKva: number | null
  /** kW = kVA x power factor, for kW-based demand charges. */
  powerFactor: number
  /** Supply rating in amps, for per-amp capacity charges. */
  ampsRating?: number | null
}

const SPLIT_TOLERANCE = 0.001

export function validateProfile(p: ConsumptionProfile): string[] {
  const errors: string[] = []
  if (!Number.isFinite(p.monthlyKwh) || p.monthlyKwh < 0) errors.push('Monthly energy must be zero or more kWh.')
  if (p.byMonthKwh) {
    if (p.byMonthKwh.length !== 12) errors.push('A month-by-month profile needs exactly 12 values.')
    else if (p.byMonthKwh.some((v) => !Number.isFinite(v) || v < 0)) errors.push('Every monthly figure must be zero or more kWh.')
  }
  const s = p.touSplit
  if ([s.peak, s.standard, s.off_peak].some((v) => !Number.isFinite(v) || v < 0)) errors.push('Each TOU share must be zero or more.')
  else if (Math.abs(s.peak + s.standard + s.off_peak - 1) > SPLIT_TOLERANCE) errors.push('The peak, standard and off-peak shares must add up to 100 %.')
  if (!Number.isFinite(p.powerFactor) || p.powerFactor <= 0 || p.powerFactor > 1) errors.push('Power factor must be above 0 and at most 1.')
  for (const [v, what] of [[p.maxDemandKva, 'Maximum demand'], [p.nmdKva, 'Notified maximum demand'], [p.ampsRating ?? null, 'Supply rating']] as const) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) errors.push(`${what} must be zero or more.`)
  }
  return errors
}

export function buildProfileMonths(p: ConsumptionProfile, opts: { highSeasonMonths: readonly number[]; year: number }): MonthUsage[] {
  const errors = validateProfile(p)
  if (errors.length) throw new RangeError(errors.join(' '))
  const cal = { highSeasonMonths: [...opts.highSeasonMonths] }
  return REFERENCE_MONTH_DAYS.map((days, k) => {
    const kwh = p.byMonthKwh ? p.byMonthKwh[k] : p.monthlyKwh
    return {
      year: opts.year,
      month: k + 1,
      days,
      season: seasonForMonth(k + 1, cal),
      importKwh: { peak: kwh * p.touSplit.peak, standard: kwh * p.touSplit.standard, off_peak: kwh * p.touSplit.off_peak },
      maxDemandKva: p.maxDemandKva,
      maxDemandKw: p.maxDemandKva === null ? null : p.maxDemandKva * p.powerFactor,
      peakWindowMdKva: p.maxDemandKva,
      nmdKva: p.nmdKva,
      ampsRating: p.ampsRating ?? null,
      kvarh: null,
    }
  })
}
